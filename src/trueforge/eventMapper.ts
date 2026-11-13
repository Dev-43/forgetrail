import { AgentEvent } from '../shared/contracts';
import { runContext } from '../mcp/runContext';
import { estimateTokens } from '../mcp/budget';

/** Workspace-relative path as the agent writes it, without "./" and with forward slashes. */
function normalizePath(p: string): string {
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '');
}

/**
 * Parses streamed JSON arguments; undefined while the JSON is still incomplete. The first
 * fragment of a call carries "" as arguments, which is not complete yet.
 */
function parseArgs(text: string): any | undefined {
  if (!text || !text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Short text for the tool trail: the command for run_command, the path for file tools. */
function summariseArgs(name: string, args: any): string {
  if (!args || typeof args !== 'object') return '';
  if (name === 'run_command' && typeof args.command === 'string') return args.command.slice(0, 100);
  if (typeof args.path === 'string') {
    const range = args.start_line ? `:${args.start_line}-${args.end_line ?? ''}` : '';
    return `${args.path}${range}`.slice(0, 100);
  }
  if (typeof args.query === 'string') return args.query.slice(0, 100);
  return JSON.stringify(args).slice(0, 100);
}

/** A tool result counts as failed if TrueForge flags it, it is a denial/error, or a command exited non-zero. */
function isToolResultOk(raw: any, content: string): boolean {
  if (raw.isError || raw.is_error) return false;
  const text = content.trim();
  if (/^\{\s*"error"/.test(text) || /^(ERROR|REJECTED|E_[A-Z_]+)/.test(text)) return false;
  const exit = text.match(/^EXIT (-?\d+)/);
  if (exit && exit[1] !== '0') return false;
  return true;
}

export interface PendingToolCall {
  id: string;
  name: string;
  args: any;
  threadId: string;
}

/**
 * EventMapper maps raw TrueForge SDK events into strongly typed C8 AgentEvents.
 * Maintains state across a single turn stream to track tool calls, parse CONTEXT/PLAN lines,
 * and construct ReviewRequests.
 */
export class EventMapper {
  private readonly runId: string;
  private readonly pendingCalls = new Map<string, PendingToolCall>();
  private textBuffer = '';
  private contextItems: Array<{ path: string; reason: string; tokens: number }> = [];
  private planSteps: string[] = [];
  private seenContextPaths = new Set<string>();
  /** Files read with read_file → total tokens returned for them (0 until the response arrives). */
  private readFiles = new Map<string, number>();
  private hasEmittedContextReport = false;
  private threadTitles = new Map<string, string>();
  /** Tool calls arrive in pieces in model.message.delta (name first, arguments later), keyed by index. */
  private streamingCalls = new Map<number, { id?: string; name?: string; argsText: string }>();
  /** Call ids that already have a row in the tool trail. */
  private startedCalls = new Set<string>();

  constructor(runId: string) {
    this.runId = runId;
  }

  public recordPendingCall(id: string, name: string, args: any, threadId = 'main'): void {
    this.pendingCalls.set(id, { id, name, args, threadId });
    if (name === 'read_file' && args?.path && !this.readFiles.has(normalizePath(args.path))) {
      this.readFiles.set(normalizePath(args.path), 0);
    }
  }

  /** One tool-trail row per call id (rows used to be added for every streamed fragment). */
  private startCall(id: string, name: string, args: any, threadId: string): AgentEvent[] {
    if (!id || this.startedCalls.has(id)) return [];
    this.startedCalls.add(id);
    const events: AgentEvent[] = [];
    if (name === 'propose_edit') {
      events.push(...this.checkFallbackContextReport());
    }
    events.push({
      type: 'tool.started',
      runId: this.runId,
      threadId,
      toolName: name,
      toolCallId: id,
      argsSummary: summariseArgs(name, args),
    });
    return events;
  }

  /**
   * Ends the current assistant message: adds the missing line break so the next message's
   * first line (often "CONTEXT: …") starts on its own line, and lets the last line be parsed.
   */
  private endMessage(threadId: string): AgentEvent[] {
    if (!this.textBuffer || this.textBuffer.endsWith('\n')) return [];
    return [
      { type: 'text.delta', runId: this.runId, threadId, text: '\n' },
      ...this.scanTextForContextAndPlan('\n'),
    ];
  }

  public getPendingCall(id: string): PendingToolCall | undefined {
    return this.pendingCalls.get(id);
  }

  public getPlanSteps(): string[] {
    return [...this.planSteps];
  }

  public getContextItems(): Array<{ path: string; reason: string; tokens: number }> {
    return [...this.contextItems];
  }

  /**
   * Scans text delta for CONTEXT: <path> — <reason> and PLAN: <step> lines.
   */
  private scanTextForContextAndPlan(delta: string): AgentEvent[] {
    const events: AgentEvent[] = [];
    this.textBuffer += delta;

    // Check CONTEXT: <path> — <reason>, only on complete lines (a half-streamed line would lock in
    // a cut-off reason). The path may contain hyphens and may be wrapped in backticks.
    const contextRegex = /(?:^|\n)[ \t]*CONTEXT:[ \t]*`?([^\s`]+)`?[ \t]+(?:—|–|--|-|:)[ \t]+([^\r\n]+?)[ \t]*(?=\r?\n)/g;
    let contextMatch: RegExpExecArray | null;
    let newContextFound = false;

    while ((contextMatch = contextRegex.exec(this.textBuffer)) !== null) {
      const filePath = normalizePath(contextMatch[1].trim());
      const reason = contextMatch[2].trim();

      if (!this.seenContextPaths.has(filePath)) {
        this.seenContextPaths.add(filePath);
        const tokens = this.readFiles.get(filePath) ?? 0;
        this.contextItems.push({ path: filePath, reason, tokens });
        newContextFound = true;
      }
    }

    if (newContextFound) {
      this.hasEmittedContextReport = true;
      events.push({
        type: 'context.report',
        runId: this.runId,
        items: [...this.contextItems],
        used: runContext.budgetUsed,
        max: runContext.budgetMax,
      });
    }

    // Check PLAN: <step> (only complete lines, so a step is not captured half-streamed)
    const planRegex = /(?:^|\n)\s*PLAN:\s*([^\n\r]+)(?=\r?\n)/g;
    let planMatch: RegExpExecArray | null;
    let newPlanStep = false;
    while ((planMatch = planRegex.exec(this.textBuffer)) !== null) {
      const step = planMatch[1].trim();
      if (!this.planSteps.includes(step) && this.planSteps.length < 6) {
        this.planSteps.push(step);
        newPlanStep = true;
      }
    }
    if (newPlanStep) {
      events.push({ type: 'plan.update', runId: this.runId, steps: [...this.planSteps] });
    }

    return events;
  }

  /** Updates the token count of a context-card entry once its read_file result has arrived. */
  private refreshContextTokens(filePath: string): AgentEvent[] {
    const item = this.contextItems.find((c) => c.path === filePath);
    if (!item) return [];
    item.tokens = this.readFiles.get(filePath) ?? item.tokens;
    return [{
      type: 'context.report',
      runId: this.runId,
      items: [...this.contextItems],
      used: runContext.budgetUsed,
      max: runContext.budgetMax,
    }];
  }

  /**
   * Fallback: if first propose_edit is about to occur and no CONTEXT lines were emitted,
   * build context report from recorded read_file calls.
   */
  private checkFallbackContextReport(): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (!this.hasEmittedContextReport && this.readFiles.size > 0) {
      this.hasEmittedContextReport = true;
      for (const [filePath, tokens] of this.readFiles.entries()) {
        if (!this.seenContextPaths.has(filePath)) {
          this.seenContextPaths.add(filePath);
          this.contextItems.push({
            path: filePath,
            reason: 'read by agent',
            tokens,
          });
        }
      }
      events.push({
        type: 'context.report',
        runId: this.runId,
        items: [...this.contextItems],
        used: runContext.budgetUsed,
        max: runContext.budgetMax,
      });
    }
    return events;
  }

  /**
   * Maps a raw TrueForge stream event to zero or more C8 AgentEvents.
   */
  public mapEvent(raw: any): AgentEvent[] {
    const events: AgentEvent[] = [];
    if (!raw || !raw.type) {
      return events;
    }

    const threadId = raw.threadId ?? raw.thread_id ?? 'main';

    switch (raw.type) {
      case 'thread.created': {
        const title = raw.title ?? raw.name ?? `Thread ${threadId}`;
        this.threadTitles.set(threadId, title);
        break;
      }

      case 'model.message.delta': {
        // Delta text chunk
        if (typeof raw.content === 'string' && raw.content.length > 0) {
          events.push({
            type: 'text.delta',
            runId: this.runId,
            threadId,
            text: raw.content,
          });

          // Scan for CONTEXT: and PLAN: lines
          const contextEvents = this.scanTextForContextAndPlan(raw.content);
          events.push(...contextEvents);
        }

        // Tool calls stream in fragments keyed by index: the first fragment carries id and name,
        // later ones only argument text. Collect them; the row is added once the call is complete.
        const toolCalls = raw.toolCalls ?? raw.tool_calls;
        if (Array.isArray(toolCalls)) {
          events.push(...this.endMessage(threadId));
          for (const tc of toolCalls) {
            const index = typeof tc.index === 'number' ? tc.index : 0;
            let entry = this.streamingCalls.get(index) ?? { argsText: '' };
            if (tc.id && entry.id && tc.id !== entry.id) {
              entry = { argsText: '' }; // a new call reusing this index in a later message
            }
            if (tc.id) entry.id = tc.id;
            const name = tc.function?.name ?? tc.toolInfo?.name;
            if (name) entry.name = name;
            const argPiece = tc.function?.arguments;
            if (typeof argPiece === 'string') entry.argsText += argPiece;
            this.streamingCalls.set(index, entry);
            if (entry.id && entry.name) {
              const args = parseArgs(entry.argsText);
              if (args !== undefined) {
                // Arguments complete: record the call and add its single trail row
                this.recordPendingCall(entry.id, entry.name, args, threadId);
                events.push(...this.startCall(entry.id, entry.name, args, threadId));
              } else if (!this.pendingCalls.has(entry.id)) {
                this.recordPendingCall(entry.id, entry.name, {}, threadId);
              }
            }
          }
        }
        break;
      }

      case 'model.message': {
        // A complete assistant message: its tool calls are final here
        events.push(...this.endMessage(threadId));
        const toolCalls = raw.toolCalls ?? raw.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            const id = tc.id;
            if (!id) continue;
            const name = tc.function?.name ?? tc.toolInfo?.name ?? tc.name ?? 'unknown_tool';
            const rawArgs = tc.function?.arguments ?? tc.args;
            const args = typeof rawArgs === 'string' ? (parseArgs(rawArgs) ?? {}) : (rawArgs ?? {});
            // (TrueForge 0.184 streams tool calls only as deltas; this covers a full message too)
            this.recordPendingCall(id, name, args, threadId);
            events.push(...this.startCall(id, name, args, threadId));
          }
        }
        this.streamingCalls.clear();
        break;
      }

      case 'tool.call': {
        const id = raw.toolCallId ?? raw.tool_call_id ?? raw.id;
        const name = raw.tool_name ?? raw.toolName ?? raw.function?.name ?? this.getPendingCall(id)?.name ?? 'unknown_tool';
        const args = raw.args ?? raw.arguments ?? this.getPendingCall(id)?.args ?? {};
        events.push(...this.endMessage(threadId));
        this.recordPendingCall(id, name, args, threadId);
        events.push(...this.startCall(id, name, args, threadId));
        break;
      }

      case 'tool.response': {
        events.push(...this.endMessage(threadId));
        const callId: string | undefined = raw.toolCallId ?? raw.tool_call_id;
        const pending = callId ? this.getPendingCall(callId) : undefined;
        const name = raw.tool_name ?? raw.toolName ?? pending?.name ?? 'tool';
        const content = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content ?? '');

        // A call whose start we never saw (no model.message in the stream) still gets its row
        if (callId) {
          events.push(...this.startCall(callId, name, pending?.args ?? {}, threadId));
        }

        if (name === 'read_file' && pending?.args?.path) {
          const tokensMatch = content.match(/~(\d+)\s*tokens/);
          const tokens = tokensMatch ? parseInt(tokensMatch[1], 10) : estimateTokens(content);
          const filePath = normalizePath(pending.args.path);
          this.readFiles.set(filePath, (this.readFiles.get(filePath) ?? 0) + tokens);
          events.push(...this.refreshContextTokens(filePath));
        }

        events.push({
          type: 'tool.finished',
          runId: this.runId,
          toolName: name,
          toolCallId: callId,
          ok: isToolResultOk(raw, content),
          resultSummary: content.slice(0, 100),
        });
        break;
      }

      case 'tool.approval_required':
      case 'tool.response_required': {
        events.push(...this.endMessage(threadId));
        if (raw.type === 'tool.response_required') break;
        // Fallback context report before first review request if model omitted CONTEXT: lines.
        // review.requested itself is emitted by the run controller after pre-approval validation,
        // and only for edits that actually reach the review UI.
        events.push(...this.checkFallbackContextReport());
        break;
      }

      case 'turn.done': {
        events.push(...this.endMessage(threadId));
        // Final run.finished / run.error / run.cancelled events are emitted by the run controller:
        // a turn.done also arrives every time the loop pauses for an approval, which is not the end
        // of the run. The controller reads the error text from state.message (state.error is unset).
        break;
      }
    }

    return events;
  }
}
