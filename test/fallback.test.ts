import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../src/fallback/classifyError';
import { runWithFallback, STRICT_ADDENDUM } from '../src/fallback/runWithFallback';
import { RunRequest, RunResult, AgentEvent } from '../src/shared/contracts';
import { runController } from '../src/trueforge/runController';

test('classifyError: classifies all error kinds per A-5', () => {
  assert.equal(classifyError('', undefined, 'cancelled'), 'cancelled');
  assert.equal(classifyError('TypeError: fetch failed'), 'unreachable');
  assert.equal(classifyError('connect ECONNREFUSED 127.0.0.1:8790'), 'unreachable');
  assert.equal(classifyError('Request failed (401): API key invalid'), 'auth');
  assert.equal(classifyError('Request failed (403): Forbidden'), 'auth');
  assert.equal(classifyError('Request failed (404): Model not found'), 'model-not-found');
  assert.equal(classifyError('Request failed (429): Quota exceeded'), 'rate-limit');
  assert.equal(classifyError('Rate limit reached'), 'rate-limit');
  assert.equal(classifyError('Request failed (503): Service Unavailable'), 'transient');
  assert.equal(classifyError('Request failed with Headers Timeout'), 'transient');
  assert.equal(classifyError('Auto-deny limit reached for src/flask/cli.py'), 'tool-mismatch');
  assert.equal(classifyError('old_text was not found in file.py'), 'tool-mismatch');
  assert.equal(classifyError('zero proposals applied', 'no-edit'), 'no-edit');
  assert.equal(classifyError('edit is outside the selected region (lines 10-20)'), 'region');
  assert.equal(classifyError('random unexpected exception'), 'unknown');
});

test('runWithFallback: succeeds immediately on done', async () => {
  let executionCount = 0;
  const mockExecutor = async (agent: string, req: RunRequest, extra?: string): Promise<RunResult> => {
    executionCount++;
    return { status: 'done', message: 'Success', appliedCount: 1 };
  };

  const req: RunRequest = { kind: 'inline', instruction: 'test', workspaceRoot: '.' };
  const result = await runWithFallback(req, { executor: mockExecutor });

  assert.equal(result.status, 'done');
  assert.equal(executionCount, 1);
});

test('runWithFallback: cancels immediately without retries or switching', async () => {
  let executionCount = 0;
  const mockExecutor = async (agent: string, req: RunRequest, extra?: string): Promise<RunResult> => {
    executionCount++;
    return { status: 'cancelled', message: 'Cancelled by user', appliedCount: 0 };
  };

  const req: RunRequest = { kind: 'inline', instruction: 'test', workspaceRoot: '.' };
  const result = await runWithFallback(req, { executor: mockExecutor });

  assert.equal(result.status, 'cancelled');
  assert.equal(executionCount, 1);
});

test('runWithFallback: switches to fallback immediately on 401 auth failure', async () => {
  const executedAgents: string[] = [];
  const eventsEmitted: AgentEvent[] = [];

  const unsub = runController.subscribe((ev) => eventsEmitted.push(ev));

  const mockExecutor = async (agent: string, req: RunRequest, extra?: string): Promise<RunResult> => {
    executedAgents.push(agent);
    if (agent === 'forgetrail-inline-primary') {
      return { status: 'error', message: 'Request failed (401): Invalid key', appliedCount: 0 };
    }
    return { status: 'done', message: 'Fallback completed', appliedCount: 1 };
  };

  const req: RunRequest = { kind: 'inline', instruction: 'test', workspaceRoot: '.' };
  const result = await runWithFallback(req, { executor: mockExecutor });

  unsub.dispose();

  assert.equal(result.status, 'done');
  assert.deepEqual(executedAgents, ['forgetrail-inline-primary', 'forgetrail-inline-fallback']);
  const switchEvent = eventsEmitted.find((e) => e.type === 'model.switched');
  assert.ok(switchEvent);
  assert.equal((switchEvent as any).from, 'forgetrail-inline-primary');
  assert.equal((switchEvent as any).to, 'forgetrail-inline-fallback');
});

test('runWithFallback: handles 429 rate limit backoff and fallback switch', async () => {
  const sleeps: number[] = [];
  const executedAgents: string[] = [];

  const mockSleep = async (ms: number) => {
    sleeps.push(ms);
  };

  const mockExecutor = async (agent: string, req: RunRequest, extra?: string): Promise<RunResult> => {
    executedAgents.push(agent);
    if (agent === 'forgetrail-agent-primary') {
      return { status: 'error', message: '429 Rate limit exceeded', appliedCount: 0 };
    }
    return { status: 'done', message: 'Fallback succeeded', appliedCount: 2 };
  };

  const req: RunRequest = { kind: 'agent', instruction: 'test', workspaceRoot: '.' };
  const result = await runWithFallback(req, {
    executor: mockExecutor,
    sleepFn: mockSleep,
    backoffMs: [1000, 2000],
  });

  assert.equal(result.status, 'done');
  // 1 initial try + 2 backoff retries on primary, then 1 on fallback
  assert.deepEqual(executedAgents, [
    'forgetrail-agent-primary',
    'forgetrail-agent-primary',
    'forgetrail-agent-primary',
    'forgetrail-agent-fallback',
  ]);
  assert.deepEqual(sleeps, [1000, 2000]);
});

test('runWithFallback: applies STRICT addendum on proposal failure before fallback', async () => {
  const executedPrompts: string[] = [];
  const executedAgents: string[] = [];

  const mockExecutor = async (agent: string, req: RunRequest, extra?: string): Promise<RunResult> => {
    executedAgents.push(agent);
    executedPrompts.push(extra || '');
    if (executedAgents.length < 3) {
      return { status: 'error', errorKind: 'tool-mismatch', message: 'Auto-deny limit reached', appliedCount: 0 };
    }
    return { status: 'done', message: 'Done', appliedCount: 1 };
  };

  const req: RunRequest = { kind: 'agent', instruction: 'test', workspaceRoot: '.' };
  const result = await runWithFallback(req, { executor: mockExecutor });

  assert.equal(result.status, 'done');
  assert.deepEqual(executedAgents, [
    'forgetrail-agent-primary',
    'forgetrail-agent-primary',
    'forgetrail-agent-fallback',
  ]);
  assert.equal(executedPrompts[0], '');
  assert.equal(executedPrompts[1], STRICT_ADDENDUM);
  assert.equal(executedPrompts[2], STRICT_ADDENDUM);
});

test('runWithFallback: returns no-fallback error when fallback agent also fails', async () => {
  const mockExecutor = async (agent: string, req: RunRequest, extra?: string): Promise<RunResult> => {
    return { status: 'error', message: 'Request failed (401)', appliedCount: 0 };
  };

  const req: RunRequest = { kind: 'inline', instruction: 'test', workspaceRoot: '.' };
  const result = await runWithFallback(req, { executor: mockExecutor });

  assert.equal(result.status, 'error');
  assert.equal(result.errorKind, 'no-fallback');
});

test('classifyError: invalid API key messages without a status code count as auth', () => {
  assert.equal(classifyError('[Model Error] API key not valid. Please pass a valid API key.'), 'auth');
  assert.equal(classifyError('[Model Error] Request failed (400): API_KEY_INVALID'), 'auth');
  assert.equal(classifyError('Invalid API Key'), 'auth');
});

test('runWithFallback: tells the fallback agent which hunks were already applied', async () => {
  const extras: string[] = [];
  const mockExecutor = async (agent: string, _req: RunRequest, extra?: string): Promise<RunResult> => {
    extras.push(extra || '');
    if (agent === 'forgetrail-agent-primary') {
      return { status: 'error', message: 'Request failed (401)', appliedCount: 1, appliedSummaries: ['src/a.py lines 1-2 — first change'] };
    }
    return { status: 'done', message: 'ok', appliedCount: 1, appliedSummaries: ['src/b.py lines 3-4 — second change'] };
  };
  const result = await runWithFallback({ kind: 'agent', instruction: 't', workspaceRoot: '.' }, { executor: mockExecutor });
  assert.equal(result.status, 'done');
  assert.equal(result.appliedCount, 2);
  assert.match(extras[1], /ALREADY APPLIED:\nsrc\/a\.py lines 1-2 — first change/);
});

test('runWithFallback: backs off on fallback rate limits before giving up', async () => {
  const sleeps: number[] = [];
  let fallbackCalls = 0;
  const mockExecutor = async (agent: string): Promise<RunResult> => {
    if (agent === 'forgetrail-inline-primary') return { status: 'error', message: 'Request failed (401)', appliedCount: 0 };
    fallbackCalls++;
    return fallbackCalls < 3
      ? { status: 'error', message: 'Request failed (429): Rate limit reached', appliedCount: 0 }
      : { status: 'done', message: 'ok', appliedCount: 1 };
  };
  const result = await runWithFallback({ kind: 'inline', instruction: 't', workspaceRoot: '.' }, {
    executor: mockExecutor, sleepFn: async (ms) => { sleeps.push(ms); }, backoffMs: [10, 20],
  });
  assert.equal(result.status, 'done');
  assert.deepEqual(sleeps, [10, 20]);
});

test('runWithFallback: no-fallback result carries the user-facing message', async () => {
  const result = await runWithFallback({ kind: 'inline', instruction: 't', workspaceRoot: '.' }, {
    executor: async () => ({ status: 'error', message: 'NotFoundError\nStatus code: 404\nBody: {...}', appliedCount: 0 }),
  });
  assert.equal(result.errorKind, 'no-fallback');
  assert.match(result.message, /^ForgeTrail: the model could not be reached\. Nothing was changed\./);
  assert.doesNotMatch(result.message, /Body:/);
});
