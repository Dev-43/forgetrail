/**
 * TrueForge SDK Client Wrapper
 * Handles session creation, turn streaming, approvals, and cancellation.
 */

export function getTrueForgeUrl(): string {
  return process.env.TRUEFORGE_URL ?? 'http://localhost:8790';
}

// tsc (module: commonjs) rewrites `await import()` into `require()`, which loads the
// SDK's CJS build as ESM and crashes ("exports is not defined in ES module scope").
// Calling import() through Function keeps it a real ES dynamic import after compilation.
const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

export async function getTrueForgeClient(baseUrl = getTrueForgeUrl()): Promise<any> {
  const { TrueForge } = await importEsm('@truefoundry/trueforge-sdk');
  return new TrueForge({
    baseUrl,
    timeoutInSeconds: 120,
  });
}

/**
 * Creates a NEW session for a named agent per run.
 */
export async function createSession(agentName: string, baseUrl = getTrueForgeUrl()): Promise<string> {
  const client = await getTrueForgeClient(baseUrl);
  const response = await client.sessions.create({
    agent: { name: agentName },
  });
  return response.data.id;
}

/**
 * Initiates a turn stream with the given input items.
 */
export async function createTurnStream(
  sessionId: string,
  input: any[],
  baseUrl = getTrueForgeUrl()
): Promise<AsyncIterable<{ data: any }>> {
  const client = await getTrueForgeClient(baseUrl);
  const stream = await client.sessions.createTurnStream(sessionId, { input });
  return typeof stream.withMetadata === 'function' ? stream.withMetadata() : stream;
}

/**
 * Sends a user message turn and returns the event stream.
 */
export async function sendTurn(
  sessionId: string,
  message: string,
  baseUrl = getTrueForgeUrl()
): Promise<AsyncIterable<{ data: any }>> {
  return createTurnStream(
    sessionId,
    [
      {
        type: 'user.message',
        content: message,
      },
    ],
    baseUrl
  );
}

export interface ToolApprovalInput {
  threadId: string;
  toolCallId: string;
  decision: 'allow' | 'deny';
  reason?: string;
}

/** Answer to a client-side tool call (TrueForge `tool.response_required`, e.g. ask_user_question). */
export interface ToolResponseInput {
  threadId: string;
  toolCallId: string;
  content: string;
}

/**
 * Resumes turn with one or more user.tool_approval inputs using camelCase threadId and toolCallId (C-16).
 */
export async function sendApprovals(
  sessionId: string,
  approvals: ToolApprovalInput[],
  baseUrl = getTrueForgeUrl()
): Promise<AsyncIterable<{ data: any }>> {
  return sendTurnInputs(sessionId, approvals, [], baseUrl);
}

/**
 * Resumes a paused turn. TrueForge requires ONE batch that resolves every pending call:
 * approvals (user.tool_approval) and client-tool answers (user.tool_response) together,
 * otherwise it answers 422 "Send batch must resolve all pending tool calls".
 */
export async function sendTurnInputs(
  sessionId: string,
  approvals: ToolApprovalInput[],
  responses: ToolResponseInput[],
  baseUrl = getTrueForgeUrl()
): Promise<AsyncIterable<{ data: any }>> {
  const approvalInputs = approvals.map((a) => {
    const approvalPayload: any = { status: a.decision };
    if (a.decision === 'deny' && a.reason) {
      approvalPayload.reason = a.reason;
    }
    return {
      type: 'user.tool_approval',
      threadId: a.threadId,
      toolCallId: a.toolCallId,
      approval: approvalPayload,
    };
  });
  const responseInputs = responses.map((r) => ({
    type: 'user.tool_response',
    threadId: r.threadId,
    toolCallId: r.toolCallId,
    content: r.content,
  }));

  return createTurnStream(sessionId, [...approvalInputs, ...responseInputs], baseUrl);
}

/**
 * Resumes turn with a single user.tool_approval input.
 */
export async function sendApproval(
  sessionId: string,
  threadId: string,
  toolCallId: string,
  decision: 'allow' | 'deny',
  reason?: string,
  baseUrl = getTrueForgeUrl()
): Promise<AsyncIterable<{ data: any }>> {
  return sendApprovals(
    sessionId,
    [{ threadId, toolCallId, decision, reason }],
    baseUrl
  );
}

/**
 * Cancels active turn via SDK cancel on the session id.
 */
export async function cancelSession(sessionId: string, baseUrl = getTrueForgeUrl()): Promise<void> {
  const client = await getTrueForgeClient(baseUrl);
  await client.sessions.cancel(sessionId);
}

/**
 * Fetches recorded session events via HTTP API for inspection.
 */
export async function fetchSessionEvents(sessionId: string, baseUrl = getTrueForgeUrl()): Promise<any[]> {
  const res = await fetch(`${baseUrl}/api/v1/sessions/${sessionId}/events`);
  if (!res.ok) {
    throw new Error(`Failed to fetch session events (${res.status}): ${await res.text()}`);
  }
  const json = await res.json() as any;
  return json.data ?? [];
}
