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
} from '../shared/contracts';
import { AUTO_DENY_LIMIT_PER_FILE } from '../shared/limits';
import { runContext } from '../mcp/runContext';
import { validateWorkspacePath } from '../mcp/pathGuard';
import { createSession, sendTurn, sendApproval, cancelSession, getTrueForgeUrl } from './client';
import { EventMapper } from './eventMapper';

type EventListener = (event: AgentEvent) => void;
const listeners = new Set<EventListener>();

let currentState: RunState = 'idle';
let currentRunId: string | null = null;
let currentSessionId: string | null = null;
let activePresenter: ReviewPresenter | null = null;

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

  const absPath = guard.absolutePath!;
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
    request.startLine = 1;
    request.endLine = request.newText.split('\n').length;
  }

  return null;
}

/**
 * Cancels the currently active run immediately (A3).
 */
export async function cancelRun(): Promise<void> {
  if (currentState === 'idle') {
    return;
  }

  currentState = 'cancelling';
  runContext.cancel();

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

  const discardedCount = runContext.appliedHunks.length;
  emitEvent({
    type: 'run.cancelled',
    runId: currentRunId ?? 'unknown',
    applied: runContext.appliedHunks.length,
    discarded: discardedCount,
  });

  runContext.reset();
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
    runContext.reset();

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
      if (runContext.cancelled) {
        break;
      }

      let pendingApprovalEvent: any = null;

      for await (const chunk of stream) {
        if (runContext.cancelled) {
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
          }
        }
      }

      // If an approval is required, pause, resolve, and resume turn
      if (pendingApprovalEvent && !runContext.cancelled && finalStatus !== 'error') {
        currentState = 'awaiting_review';
        const tcs = pendingApprovalEvent.toolCalls ?? pendingApprovalEvent.tool_calls;
        const threadId = pendingApprovalEvent.threadId ?? pendingApprovalEvent.thread_id ?? 'main';
        const tc = tcs?.[0];
        const callId = tc?.id;
        const sourceEventId = tc?.sourceEventId ?? tc?.source_event_id;

        const pending = mapper.getPendingCall(callId);
        let args = pending?.args;
        if (!args || Object.keys(args).length === 0) {
          try {
            const eventsRes = await fetch(`${getTrueForgeUrl()}/api/v1/sessions/${sessionCreatedId}/events`);
            if (eventsRes.ok) {
              const eventsJson: any = await eventsRes.json();
              const sourceItem = eventsJson.data?.find((e: any) => e.event?.id === sourceEventId || e.id === sourceEventId);
              const sourceEvent = sourceItem?.event ?? sourceItem;
              const rawToolCall = sourceEvent?.tool_calls?.find((c: any) => c.id === callId) ?? sourceEvent?.toolCalls?.find((c: any) => c.id === callId) ?? sourceEvent?.tool_calls?.[0] ?? sourceEvent?.toolCalls?.[0];
              const funcArgs = rawToolCall?.function?.arguments ?? rawToolCall?.args;
              if (typeof funcArgs === 'string') {
                args = JSON.parse(funcArgs);
              } else if (funcArgs && typeof funcArgs === 'object') {
                args = funcArgs;
              }
            }
          } catch (e) {
            console.warn('Could not fetch sourceEvent from session events:', e);
          }
        }
        if (!args || Object.keys(args).length === 0) {
          const rawArgs = tc?.function?.arguments ?? tc?.args ?? tc?.arguments;
          if (typeof rawArgs === 'string') {
            try {
              args = JSON.parse(rawArgs);
            } catch {
              args = {};
            }
          } else if (rawArgs && typeof rawArgs === 'object') {
            args = rawArgs;
          } else {
            args = {};
          }
        }
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
          index: 1,
          total: tcs.length,
          baseVersion: args.baseVersion ?? 0,
        };

        // Step 1: Pre-approval validation
        const denialReason = validateProposal(reviewReq, request.workspaceRoot);
        let decision: ReviewDecision;

        if (denialReason) {
          // Auto-deny
          const denyCount = runContext.recordAutoDeny(reviewReq.path);
          decision = { id: callId, decision: 'reject', feedback: denialReason };

          if (denyCount >= AUTO_DENY_LIMIT_PER_FILE) {
            finalStatus = 'error';
            errorKind = 'tool';
            finalMessage = `Auto-deny limit reached for ${reviewReq.path}`;
            keepRunning = false;
          }
        } else if (activePresenter) {
          // Show UI to user
          emitEvent({ type: 'review.requested', request: reviewReq });
          decision = await activePresenter.present(reviewReq);
          emitEvent({ type: 'review.resolved', id: callId, decision: decision.decision });
        } else {
          // Auto-allow if no presenter
          decision = { id: callId, decision: 'accept' };
        }

        currentState = 'running';

        // Step 2: Resume TrueForge turn with allow or deny
        if (!runContext.cancelled) {
          stream = await sendApproval(
            sessionCreatedId,
            threadId,
            callId,
            decision.decision === 'accept' ? 'allow' : 'deny',
            decision.decision === 'reject' ? D_USER(decision.feedback) : undefined
          );
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

  // Cleanup
  currentState = 'finishing';
  if (activePresenter) {
    try {
      activePresenter.dispose(runId);
    } catch {
      // Ignore presenter dispose errors
    }
  }

  const appliedCount = runContext.appliedHunks.length;
  currentRunId = null;
  currentSessionId = null;
  currentState = 'idle';

  return {
    status: finalStatus,
    errorKind,
    message: finalMessage,
    appliedCount,
  };
}
