/**
 * TrueForge SDK Client Wrapper
 * Handles session creation, turn streaming, approvals, and cancellation.
 */

let cachedClient: any = null;

export function getTrueForgeUrl(): string {
  return process.env.TRUEFORGE_URL ?? 'http://localhost:8790';
}

/**
 * Returns an instance of the TrueForge SDK client.
 */
export async function getTrueForgeClient(baseUrl = getTrueForgeUrl()): Promise<any> {
  if (cachedClient) {
    return cachedClient;
  }
  const { TrueForge } = await import('@truefoundry/trueforge-sdk');
  cachedClient = new TrueForge({
    baseUrl,
    timeoutInSeconds: 120,
  });
  return cachedClient;
}

/**
 * Creates a NEW session for a named agent per run.
 */
export async function createSession(agentName: string, baseUrl = getTrueForgeUrl()): Promise<string> {
  const client = await getTrueForgeClient(baseUrl);
  const response = await client.sessions.create({
    agent: agentName,
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
  return client.sessions.createTurnStream(sessionId, { input });
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

/**
 * Resumes turn with user.tool_approval input using camelCase threadId and toolCallId (spike Test 4).
 */
export async function sendApproval(
  sessionId: string,
  threadId: string,
  toolCallId: string,
  decision: 'allow' | 'deny',
  reason?: string,
  baseUrl = getTrueForgeUrl()
): Promise<AsyncIterable<{ data: any }>> {
  const approvalPayload: any = { status: decision };
  if (decision === 'deny' && reason) {
    approvalPayload.reason = reason;
  }

  return createTurnStream(
    sessionId,
    [
      {
        type: 'user.tool_approval',
        threadId,
        toolCallId,
        approval: approvalPayload,
      },
    ],
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
