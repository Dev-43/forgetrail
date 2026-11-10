import { AgentEvent, ReviewRequest } from '../shared/contracts';

export interface PendingToolCall {
  id: string;
  name: string;
  args: any;
  threadId: string;
}

/**
 * EventMapper maps raw TrueForge SDK events into strongly typed C8 AgentEvents.
 * Maintains state across a single turn stream to track tool calls and construct ReviewRequests.
 */
export class EventMapper {
  private readonly runId: string;
  private readonly pendingCalls = new Map<string, PendingToolCall>();

  constructor(runId: string) {
    this.runId = runId;
  }

  public recordPendingCall(id: string, name: string, args: any, threadId = 'main'): void {
    this.pendingCalls.set(id, { id, name, args, threadId });
  }

  public getPendingCall(id: string): PendingToolCall | undefined {
    return this.pendingCalls.get(id);
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
      case 'model.message.delta': {
        // Delta text chunk
        if (typeof raw.content === 'string' && raw.content.length > 0) {
          events.push({
            type: 'text.delta',
            runId: this.runId,
            threadId,
            text: raw.content,
          });
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
        const tcs = raw.toolCalls ?? raw.tool_calls;
        if (Array.isArray(tcs)) {
          for (let i = 0; i < tcs.length; i++) {
            const tc = tcs[i];
            const callId = tc.id;
            const pending = this.getPendingCall(callId);

            // Construct ReviewRequest if tool call is propose_edit or propose_write
            const args = pending?.args ?? {};

            const request: ReviewRequest = {
              id: callId,
              runId: this.runId,
              threadId,
              path: args.path ?? 'unknown_file',
              kind: args.old_text || args.oldText ? 'replace' : 'create',
              oldText: args.old_text ?? args.oldText ?? '',
              newText: args.new_text ?? args.newText ?? args.new_content ?? '',
              startLine: args.start_line ?? args.startLine ?? 1,
              endLine: args.end_line ?? args.endLine ?? 1,
              reason: args.reason ?? '(no reason given)',
              sources: Array.isArray(args.sources) ? args.sources : [],
              index: i + 1,
              total: tcs.length,
              baseVersion: args.baseVersion ?? 0,
            };

            events.push({
              type: 'review.requested',
              request,
            });
          }
        }
        break;
      }

      case 'turn.done': {
        const status = raw.state?.status ?? 'done';
        if (status === 'cancelled') {
          events.push({
            type: 'run.cancelled',
            runId: this.runId,
            applied: 0,
            discarded: 0,
          });
        } else if (status === 'error') {
          const errMsg = raw.state?.error?.message ?? raw.state?.error ?? '[Model Error] Unknown turn failure';
          events.push({
            type: 'run.error',
            runId: this.runId,
            kind: 'model',
            message: String(errMsg),
          });
        } else {
          const outputText = raw.state?.output?.content ?? '';
          events.push({
            type: 'run.finished',
            runId: this.runId,
            summary: typeof outputText === 'string' ? outputText.slice(0, 200) : 'Run completed',
            applied: 0,
          });
        }
        break;
      }
    }

    return events;
  }
}
