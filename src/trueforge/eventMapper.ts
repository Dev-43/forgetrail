import { AgentEvent } from '../shared/contracts';
import { runContext } from '../mcp/runContext';
import { estimateTokens } from '../mcp/budget';

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
  private readFiles = new Map<string, number>();
  private hasEmittedContextReport = false;
  private threadTitles = new Map<string, string>();

  constructor(runId: string) {
    this.runId = runId;
  }

  public recordPendingCall(id: string, name: string, args: any, threadId = 'main'): void {
    this.pendingCalls.set(id, { id, name, args, threadId });
    if (name === 'read_file' && args?.path) {
      this.readFiles.set(args.path, 100);
    }
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

    // Check CONTEXT: <path> [—|-] <reason>
    const contextRegex = /(?:^|\n)\s*CONTEXT:\s*([^\s—\-]+)\s*(?:[—\-]|--)\s*([^\n\r]+)/g;
    let contextMatch: RegExpExecArray | null;
    let newContextFound = false;

    while ((contextMatch = contextRegex.exec(this.textBuffer)) !== null) {
      const filePath = contextMatch[1].trim();
      const reason = contextMatch[2].trim();

      if (!this.seenContextPaths.has(filePath)) {
        this.seenContextPaths.add(filePath);
        const tokens = this.readFiles.get(filePath) || 100;
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

        // Tool call descriptors inside delta
        const toolCalls = raw.toolCalls ?? raw.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            const id = tc.id ?? `call_${Date.now()}`;
            const name = tc.function?.name ?? tc.toolInfo?.name ?? 'unknown_tool';
            let args: any = {};
            try {
              args = typeof tc.function?.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {};
            } catch {
              args = tc.function?.arguments ?? {};
            }

            this.recordPendingCall(id, name, args, threadId);
            if (name === 'propose_edit') {
              events.push(...this.checkFallbackContextReport());
            }

            events.push({
              type: 'tool.started',
              runId: this.runId,
              threadId,
              toolName: name,
              argsSummary: JSON.stringify(args).slice(0, 100),
            });
          }
        }
        break;
      }

      case 'model.message': {
        const toolCalls = raw.toolCalls ?? raw.tool_calls;
        if (Array.isArray(toolCalls)) {
          for (const tc of toolCalls) {
            const id = tc.id ?? `call_${Date.now()}`;
            const name = tc.function?.name ?? tc.toolInfo?.name ?? tc.name ?? 'unknown_tool';
            let args: any = {};
            try {
              args = typeof tc.function?.arguments === 'string'
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? tc.args ?? {};
            } catch {
              args = tc.function?.arguments ?? tc.args ?? {};
            }
            this.recordPendingCall(id, name, args, threadId);
          }
        }
        break;
      }

      case 'tool.call': {
        const id = raw.id ?? raw.toolCallId ?? `call_${Date.now()}`;
        const name = raw.tool_name ?? raw.toolName ?? raw.function?.name ?? 'unknown_tool';
        const args = raw.args ?? raw.arguments ?? {};
        this.recordPendingCall(id, name, args, threadId);

        events.push({
          type: 'tool.started',
          runId: this.runId,
          threadId,
          toolName: name,
          argsSummary: JSON.stringify(args).slice(0, 100),
        });
        break;
      }

      case 'tool.response': {
        const name = raw.tool_name ?? raw.toolName ?? 'tool';
        const content = typeof raw.content === 'string' ? raw.content : JSON.stringify(raw.content ?? '');
        if (name === 'read_file') {
          const tokensMatch = content.match(/~(\d+)\s*tokens/);
          const tokens = tokensMatch ? parseInt(tokensMatch[1], 10) : estimateTokens(content);
          const callId = raw.toolCallId ?? raw.id;
          const pending = callId ? this.getPendingCall(callId) : undefined;
          if (pending?.args?.path) {
            this.readFiles.set(pending.args.path, tokens);
          }
        }

        events.push({
          type: 'tool.finished',
          runId: this.runId,
          toolName: name,
          ok: !raw.isError,
          resultSummary: content.slice(0, 100),
        });
        break;
      }

      case 'tool.approval_required': {
        // Fallback context report before first review request if model omitted CONTEXT: lines.
        // review.requested itself is emitted by the run controller after pre-approval validation,
        // and only for edits that actually reach the review UI.
        events.push(...this.checkFallbackContextReport());
        break;
      }

      case 'turn.done': {
        // Final run.finished / run.error / run.cancelled events are emitted by the run controller:
        // a turn.done also arrives every time the loop pauses for an approval, which is not the end
        // of the run. The controller reads the error text from state.message (state.error is unset).
        break;
      }
    }

    return events;
  }
}
