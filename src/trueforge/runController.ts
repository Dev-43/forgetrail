import * as fs from 'fs';
import { randomUUID } from 'crypto';
import {
  AgentEvent,
  ReviewDecision,
  ReviewPresenter,
  ReviewRequest,
  RunRequest,
  RunResult,
  RunState,
  D_AMBIGUOUS,
  D_FORMAT,
  D_NOT_FOUND,
  D_OUTSIDE_REGION,
  D_USER,
  E_FILE_EXISTS,
} from '../shared/contracts';
import { AUTO_DENY_LIMIT_PER_FILE } from '../shared/limits';
import { runContext } from '../mcp/runContext';
import { validateWorkspacePath } from '../mcp/pathGuard';
import { isCommandAutoAllowed, killActiveCommand } from '../mcp/tools/runCommand';
import { createSession, sendTurn, sendApprovals, ToolApprovalInput, cancelSession, getTrueForgeUrl } from './client';
import { EventMapper } from './eventMapper';

/**
 * Returns the current version of the open editor document for a workspace path,
 * or 0 if the file is not open (or when running headless without VS Code).
 * Used as ReviewRequest.baseVersion so the presenter's staleness check compares
 * against the version the proposal was validated on, not a constant 0.
 */
function openDocumentVersion(relPath: string, workspaceRoot: string): number {
  try {
    const vscode = require('vscode');
    const guard = validateWorkspacePath(relPath, workspaceRoot);
    if (!guard.ok || !guard.absolutePath) return 0;
    const target = guard.absolutePath.replace(/\\/g, '/').toLowerCase();
    const doc = vscode.workspace.textDocuments.find(
      (d: any) => d.uri.fsPath.replace(/\\/g, '/').toLowerCase() === target
    );
    return doc ? doc.version : 0;
  } catch {
    return 0;
  }
}

type EventListener = (event: AgentEvent) => void;
const listeners = new Set<EventListener>();

let currentState: RunState = 'idle';
let currentRunId: string | null = null;
let currentSessionId: string | null = null;
let activePresenter: ReviewPresenter | null = null;
/** Run id that cancelRun() was called for; executeRun checks this instead of runContext.cancelled,
 * because a new run may already have reset runContext by the time the old loop wakes up. */
let cancelRequestedRunId: string | null = null;
/** Proposals in the current approval batch that have not been decided yet (reported as "discarded" on cancel). */
let undecidedProposals = 0;

export function getRunState(): RunState {
  return currentState;
}

export function getActiveRunId(): string | null {
  return currentRunId;
}

export function setReviewPresenter(presenter: ReviewPresenter): void {
  activePresenter = presenter;
}

/**
 * Subscribes to C8 AgentEvents emitted during runs.
 */
export function subscribe(listener: EventListener): { dispose(): void } {
  listeners.add(listener);
  return {
    dispose: () => {
      listeners.delete(listener);
    },
  };
}

/**
 * Emits an event to all active subscribers.
 */
export function emitEvent(event: AgentEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('Error in AgentEvent listener:', err);
    }
  }
}

/**
 * Performs pre-approval validation of proposed edits before showing UI.
 * Returns null if valid, or a denial reason string if invalid.
 */
function validateProposal(request: ReviewRequest, workspaceRoot: string): string | null {
  const guard = validateWorkspacePath(request.path, workspaceRoot);
  if (!guard.ok) {
    return guard.error!;
  }

  // D_FORMAT check: old_text must not be numbered or headed output
  if (/^\[.+ \| lines \d+-\d+ of \d+ \|/.test(request.oldText) || /^\s*\d+:\s+/m.test(request.oldText)) {
    return D_FORMAT;
  }

  // M5: use the normalised workspace-relative path from here on
  request.path = guard.relativePath!;
  const absPath = guard.absolutePath!;

  // Inline mode: every edit must be in the selected file
  if (runContext.selectionRegion && runContext.selectionRegion.path !== request.path) {
    return D_OUTSIDE_REGION(runContext.selectionRegion.startLine, runContext.selectionRegion.endLine);
  }

  if (request.kind === 'replace') {
    if (!fs.existsSync(absPath)) {
      return D_NOT_FOUND(request.path);
    }

    const currentDiskText = fs.readFileSync(absPath, 'utf-8');
    const isCrlf = currentDiskText.includes('\r\n');
    const normalizedOld = isCrlf
      ? request.oldText.replace(/\r?\n/g, '\r\n')
      : request.oldText.replace(/\r\n/g, '\n');

    const occurrences = currentDiskText.split(normalizedOld).length - 1;
    if (occurrences === 0) {
      return D_NOT_FOUND(request.path);
    }
    if (occurrences > 1) {
      return D_AMBIGUOUS(occurrences, request.path);
    }

    // Compute exact startLine and endLine from matched oldText per C7
    const matchIndex = currentDiskText.indexOf(normalizedOld);
    const linesBefore = currentDiskText.slice(0, matchIndex).split(/\r?\n/);
    const matchedLines = normalizedOld.split(/\r?\n/);
    request.startLine = linesBefore.length;
    request.endLine = request.startLine + matchedLines.length - 1;

    // Inline selection region check
    if (runContext.selectionRegion && runContext.selectionRegion.path === request.path) {
      if (
        request.startLine < runContext.selectionRegion.startLine ||
        request.endLine > runContext.selectionRegion.endLine
      ) {
        return D_OUTSIDE_REGION(runContext.selectionRegion.startLine, runContext.selectionRegion.endLine);
      }
    }
  } else {
    // A create must never overwrite an existing file
    if (fs.existsSync(absPath)) {
      return E_FILE_EXISTS(request.path);
    }
    request.startLine = 1;
    request.endLine = request.newText.split('\n').length;
  }

  return null;
}

/**
 * Builds the deny reason sent back to TrueForge. Automatic rejections (REJECTED_AUTO / ERROR)
 * are passed through as-is so the model is not told that the user rejected them.
 */
function denyReason(feedback?: string): string {
  if (feedback && /^(REJECTED_AUTO|ERROR )/.test(feedback)) {
    return feedback;
  }
  return D_USER(feedback);
}

/** Maps RunResult error kinds onto the C8 run.error kinds. */
function toEventErrorKind(kind: RunResult['errorKind']): 'model' | 'tool' | 'network' | 'no-fallback' | 'no-edit' {
  switch (kind) {
    case 'model':
    case 'network':
    case 'no-fallback':
    case 'no-edit':
      return kind;
    default:
      return 'tool';
  }
}

/**
 * Cancels the currently active run immediately (A3).
 */
export async function cancelRun(): Promise<void> {
  if (currentState === 'idle') {
    return;
  }

  currentState = 'cancelling';
  cancelRequestedRunId = currentRunId;
  runContext.cancel();

  // Terminate any running child process tree immediately (C-19)
  try {
    killActiveCommand();
  } catch (err) {
    console.error('Error killing active command on cancel:', err);
  }

  // Count before dispose(): dispose resolves the open review(s) as rejected
  const discardedCount = undecidedProposals;
  const appliedCount = runContext.appliedHunks.length;
  const cancelledRunId = currentRunId ?? 'unknown';

  if (activePresenter && currentRunId) {
    try {
      activePresenter.dispose(currentRunId);
    } catch (err) {
      console.error('Error disposing review presenter on cancel:', err);
    }
  }

  if (currentSessionId) {
    try {
      await cancelSession(currentSessionId);
    } catch (err) {
      console.error('Error cancelling TrueForge session:', err);
    }
  }

  emitEvent({
    type: 'run.cancelled',
    runId: cancelledRunId,
    applied: appliedCount,
    discarded: discardedCount,
  });

  // Keep runContext.cancelled = true so any tool call still in flight writes nothing;
  // the next startRun() clears it.
  runContext.endRun();
  undecidedProposals = 0;
  currentRunId = null;
  currentSessionId = null;
  currentState = 'idle';
}

/**
 * Executes a full TrueForge agent run per C9 and C11.
 */
export async function executeRun(
  agentName: string,
  request: RunRequest,
  extraInstruction?: string
): Promise<RunResult> {
  // Concurrency check per C11: only ONE run active at a time
  if (currentState !== 'idle') {
    return {
      status: 'error',
      errorKind: 'tool',
      message: 'Another run is already active. Stop it first.',
      appliedCount: 0,
    };
  }

  const runId = randomUUID();
  currentRunId = runId;
  currentState = 'running';
  cancelRequestedRunId = null;
  undecidedProposals = 0;
  const isCancelled = (): boolean => cancelRequestedRunId === runId;
  let proposalCount = 0;
  let lastOutput = '';

  // Initialize runContext
  runContext.startRun(runId, request.workspaceRoot, request.selection);

  emitEvent({
    type: 'run.started',
    runId,
    kind: request.kind,
    instruction: request.instruction,
    agentName,
  });

  const mapper = new EventMapper(runId);
  let sessionCreatedId: string;
  try {
    sessionCreatedId = await createSession(agentName);
    currentSessionId = sessionCreatedId;
  } catch (err: any) {
    currentState = 'idle';
    currentRunId = null;
    currentSessionId = null;
    runContext.endRun();

    const errMsg = err?.message ?? String(err);
    emitEvent({
      type: 'run.error',
      runId,
      kind: 'network',
      message: errMsg,
    });

    return {
      status: 'error',
      errorKind: 'network',
      message: errMsg,
      appliedCount: 0,
    };
  }

  // Construct message to send
  let prompt = request.instruction;
  if (request.selection) {
    prompt = `File: ${request.selection.path}\nSelected lines ${request.selection.startLine}-${request.selection.endLine}:\n\`\`\`\n${request.selection.text}\n\`\`\`\n\nInstruction: ${request.instruction}`;
  }
  if (extraInstruction) {
    prompt += `\n\n${extraInstruction}`;
  }

  let finalStatus: 'done' | 'error' | 'cancelled' = 'done';
  let finalMessage = 'Run completed successfully';
  let errorKind: RunResult['errorKind'] = undefined;

  try {
    let stream = await sendTurn(sessionCreatedId, prompt);

    // Turn processing loop
    let keepRunning = true;
    while (keepRunning) {
      if (isCancelled()) {
        break;
      }

      let pendingApprovalEvent: any = null;

      for await (const chunk of stream) {
        if (isCancelled()) {
          break;
        }

        const rawEvent = (chunk as any)?.data ?? chunk;
        if (!rawEvent || !rawEvent.type) {
          continue;
        }

        const agentEvents = mapper.mapEvent(rawEvent);
        for (const evt of agentEvents) {
          emitEvent(evt);
        }

        if (rawEvent.type === 'tool.approval_required') {
          pendingApprovalEvent = rawEvent;
        }

        if (rawEvent.type === 'turn.done') {
          const status = rawEvent.state?.status;
          if (status === 'error') {
            finalStatus = 'error';
            errorKind = 'model';
            finalMessage = rawEvent.state?.error?.message ?? rawEvent.state?.message ?? '[Model Error] Turn execution failed';
          } else if (status === 'cancelled') {
            finalStatus = 'cancelled';
            finalMessage = 'Turn cancelled';
          } else {
            const out = rawEvent.state?.output?.content ?? rawEvent.state?.output;
            if (typeof out === 'string' && out.trim()) {
              lastOutput = out.trim();
            }
          }
        }
      }

      // If an approval is required, pause, resolve, and resume turn
      if (pendingApprovalEvent && !isCancelled() && finalStatus !== 'error') {
        currentState = 'awaiting_review';
        const tcs = pendingApprovalEvent.toolCalls ?? pendingApprovalEvent.tool_calls ?? [];
        undecidedProposals = tcs.length;
        const threadId = pendingApprovalEvent.threadId ?? pendingApprovalEvent.thread_id ?? 'main';
        const approvalsToSend: ToolApprovalInput[] = [];

        // Fetch session events once if any call is missing arguments
        let sessionEventsData: any[] | null = null;

        for (let i = 0; i < tcs.length; i++) {
          if (isCancelled()) {
            break;
          }
          const tc = tcs[i];
          const callId = tc?.id;
          const sourceEventId = tc?.sourceEventId ?? tc?.source_event_id;

          const pending = mapper.getPendingCall(callId);
          let toolName = pending?.name ?? tc?.name ?? tc?.toolName ?? tc?.function?.name ?? 'propose_edit';
          let args = pending?.args;

          if (!args || Object.keys(args).length === 0) {
            if (!sessionEventsData) {
              try {
                const eventsRes = await fetch(`${getTrueForgeUrl()}/api/v1/sessions/${sessionCreatedId}/events`);
                if (eventsRes.ok) {
                  const eventsJson: any = await eventsRes.json();
                  sessionEventsData = eventsJson.data || [];
                }
              } catch (e) {
                console.warn('Could not fetch session events:', e);
              }
            }

            if (sessionEventsData) {
              const sourceItem = sessionEventsData.find((e: any) => e.event?.id === sourceEventId || e.id === sourceEventId);
              const sourceEvent = sourceItem?.event ?? sourceItem;
              const rawToolCall = sourceEvent?.tool_calls?.find((c: any) => c.id === callId) ?? sourceEvent?.toolCalls?.find((c: any) => c.id === callId);
              if (rawToolCall) {
                toolName = rawToolCall.function?.name ?? rawToolCall.name ?? toolName;
                const funcArgs = rawToolCall.function?.arguments ?? rawToolCall.args;
                if (typeof funcArgs === 'string') {
                  try { args = JSON.parse(funcArgs); } catch {}
                } else if (funcArgs && typeof funcArgs === 'object') {
                  args = funcArgs;
                }
              }
            }
          }

          if (!args) args = {};

          // Check tool type: run_command vs propose_edit
          if (toolName === 'run_command') {
            const command = args.command ?? '';
            if (isCommandAutoAllowed(command)) {
              approvalsToSend.push({
                threadId,
                toolCallId: callId,
                decision: 'allow',
              });
            } else {
              // Ask user via modal (C-15)
              let userChoice: string | undefined;
              try {
                const vscode = await import('vscode');
                userChoice = await vscode.window.showInformationMessage(
                  `Run command? ${command}`,
                  { modal: true },
                  'Run',
                  'Deny'
                );
              } catch {
                userChoice = 'Run';
              }

              if (userChoice === 'Run') {
                approvalsToSend.push({
                  threadId,
                  toolCallId: callId,
                  decision: 'allow',
                });
              } else {
                approvalsToSend.push({
                  threadId,
                  toolCallId: callId,
                  decision: 'deny',
                  reason: D_USER('command denied by user'),
                });
              }
            }
            undecidedProposals = Math.max(0, undecidedProposals - 1);
          } else {
            proposalCount++;
            // propose_edit / propose_write
            const reviewReq: ReviewRequest = {
              id: callId,
              runId,
              threadId,
              path: args.path ?? 'unknown',
              kind: args.old_text || args.oldText ? 'replace' : 'create',
              oldText: args.old_text ?? args.oldText ?? '',
              newText: args.new_text ?? args.newText ?? args.new_content ?? '',
              startLine: args.start_line ?? 1,
              endLine: args.end_line ?? 1,
              reason: args.reason ?? '(no reason given)',
              sources: Array.isArray(args.sources) ? args.sources : [],
              index: i + 1,
              total: tcs.length,
              baseVersion: args.baseVersion ?? 0,
            };

            const denialReason = validateProposal(reviewReq, request.workspaceRoot);
            reviewReq.baseVersion = openDocumentVersion(reviewReq.path, request.workspaceRoot);
            let decision: ReviewDecision;

            if (denialReason) {
              const denyCount = runContext.recordAutoDeny(reviewReq.path);
              decision = { id: callId, decision: 'reject', feedback: denialReason };
              if (denyCount >= AUTO_DENY_LIMIT_PER_FILE) {
                finalStatus = 'error';
                errorKind = 'tool';
                finalMessage = `Auto-deny limit reached for ${reviewReq.path}`;
                keepRunning = false;
              }
            } else if (activePresenter) {
              emitEvent({ type: 'review.requested', request: reviewReq });
              decision = await activePresenter.present(reviewReq);
              if (isCancelled()) {
                break;
              }
              emitEvent({ type: 'review.resolved', id: callId, decision: decision.decision });
            } else {
              decision = { id: callId, decision: 'accept' };
            }
            undecidedProposals = Math.max(0, undecidedProposals - 1);

            approvalsToSend.push({
              threadId,
              toolCallId: callId,
              decision: decision.decision === 'accept' ? 'allow' : 'deny',
              reason: decision.decision === 'reject' ? denyReason(decision.feedback) : undefined,
            });
          }
        }

        if (!isCancelled()) {
          currentState = 'running';
        }

        // Step 2: Resume TrueForge turn with all collected decisions
        if (!isCancelled() && keepRunning) {
          stream = await sendApprovals(sessionCreatedId, approvalsToSend);
        } else {
          keepRunning = false;
        }
      } else {
        // Turn finished with no pending approvals
        keepRunning = false;
      }
    }
  } catch (err: any) {
    finalStatus = 'error';
    finalMessage = err?.message ?? String(err);
    errorKind = finalMessage.includes('401') ? 'model' : 'network';
  }

  // A cancelled run always reports cancelled, whatever the stream said last
  if (isCancelled()) {
    finalStatus = 'cancelled';
    errorKind = undefined;
    finalMessage = 'Run was cancelled';
  }

  // M7: an inline run that ends without proposing anything is a failure, retried by the fallback policy
  if (finalStatus === 'done' && request.kind === 'inline' && proposalCount === 0) {
    finalStatus = 'error';
    errorKind = 'no-edit';
    finalMessage = 'Inline run finished with zero proposals (no edits proposed).';
  }

  // Cleanup (skip the shared state if cancelRun() already released it, or a new run owns it)
  const ownsState = currentRunId === runId;
  if (ownsState) {
    currentState = 'finishing';
  }
  if (activePresenter) {
    try {
      activePresenter.dispose(runId);
    } catch {
      // Ignore presenter dispose errors
    }
  }

  // runContext still holds this run's hunks unless a newer run has already started
  const ownHunks = runContext.activeRunId === runId || runContext.activeRunId === null ? runContext.appliedHunks : [];
  const appliedCount = ownHunks.length;
  const appliedSummaries = ownHunks.map(
    (h) => `${h.path} lines ${h.startLine}-${h.endLine} — ${h.reason}`
  );

  // Final C8 event for this attempt (cancelRun() already emitted run.cancelled)
  if (finalStatus === 'done') {
    emitEvent({ type: 'run.finished', runId, summary: lastOutput.slice(0, 200) || 'Run completed', applied: appliedCount });
  } else if (finalStatus === 'error') {
    emitEvent({ type: 'run.error', runId, kind: toEventErrorKind(errorKind), message: finalMessage });
  }

  if (ownsState) {
    runContext.endRun();
    undecidedProposals = 0;
    currentRunId = null;
    currentSessionId = null;
    currentState = 'idle';
  }

  return {
    status: finalStatus,
    errorKind,
    message: finalMessage,
    appliedCount,
    appliedSummaries,
  };
}

export const runController = {
  executeRun,
  cancelRun,
  subscribe,
  emitEvent,
  getRunState,
  getActiveRunId,
  setReviewPresenter,
};
