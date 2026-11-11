import { RunRequest, RunResult } from '../shared/contracts';
import { BACKOFF_MS, MAX_ATTEMPTS } from '../shared/limits';
import { S_NO_FALLBACK } from '../ui/notifications';
import { classifyError } from './classifyError';
import { runController } from '../trueforge/runController';

export const STRICT_ADDENDUM =
  '\nCRITICAL: Your previous edit proposal failed or was rejected. You MUST call read_file on the exact lines before proposing. Do not guess line numbers. Do not include diff markers or line numbers in old_text. Exactly match the original text.';

export interface FallbackOptions {
  primaryAgent?: string;
  fallbackAgent?: string;
  maxAttempts?: number;
  backoffMs?: number[];
  sleepFn?: (ms: number) => Promise<void>;
  executor?: (agentName: string, request: RunRequest, extraInstruction?: string) => Promise<RunResult>;
}

/** First line of a provider/harness error, trimmed, for the user-facing message. */
function shortDetail(message: string): string {
  const firstLine = (message || '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  return firstLine.trim().slice(0, 200);
}

/**
 * Runs an agent or inline instruction with resilient retry and fallback model switching per A-5 and C-20.
 */
export async function runWithFallback(
  request: RunRequest,
  options: FallbackOptions = {}
): Promise<RunResult> {
  const isInline = request.kind === 'inline';
  const primaryAgent = options.primaryAgent ?? (isInline ? 'forgetrail-inline-primary' : 'forgetrail-agent-primary');
  const fallbackAgent = options.fallbackAgent ?? (isInline ? 'forgetrail-inline-fallback' : 'forgetrail-agent-fallback');
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? [...BACKOFF_MS];
  const sleep = options.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const execute = options.executor ?? ((agent, req, extra) => runController.executeRun(agent, req, extra));

  let currentAgent = primaryAgent;
  let attempts = 0;
  let rateLimitRetries = 0;
  let transientRetries = 0;
  let fallbackRateLimitRetries = 0;
  let strict = false;
  let lastResult: RunResult = {
    status: 'error',
    errorKind: 'no-fallback',
    message: S_NO_FALLBACK,
    appliedCount: 0,
  };

  // Hunks already written by earlier attempts; the next attempt is told not to redo them (C-20)
  const appliedHistory: string[] = request.appliedSoFar ? [...request.appliedSoFar] : [];
  let totalApplied = 0;

  const switchToFallback = (reason: string): void => {
    runController.emitEvent({
      type: 'model.switched',
      runId: runController.getActiveRunId() ?? 'fallback',
      from: currentAgent,
      to: fallbackAgent,
      reason,
    });
    currentAgent = fallbackAgent;
  };

  const giveUp = (result: RunResult): RunResult => {
    const detail = shortDetail(result.message);
    const message = detail ? `${S_NO_FALLBACK} (${detail})` : S_NO_FALLBACK;
    runController.emitEvent({
      type: 'run.error',
      runId: runController.getActiveRunId() ?? 'fallback',
      kind: 'no-fallback',
      message,
    });
    return { status: 'error', errorKind: 'no-fallback', message, appliedCount: totalApplied, appliedSummaries: [...appliedHistory] };
  };

  while (attempts < maxAttempts) {
    attempts++;

    const currentRequest: RunRequest = { ...request, appliedSoFar: [...appliedHistory] };

    let extraPrompt = strict ? STRICT_ADDENDUM : '';
    if (appliedHistory.length > 0) {
      extraPrompt += `\nALREADY APPLIED:\n${appliedHistory.join('\n')}\nDo not re-apply these changes.`;
    }

    const result = await execute(currentAgent, currentRequest, extraPrompt || undefined);
    lastResult = result;
    totalApplied += result.appliedCount ?? 0;
    if (Array.isArray(result.appliedSummaries)) {
      appliedHistory.push(...result.appliedSummaries);
    }

    if (result.status === 'done') {
      return { ...result, appliedCount: totalApplied, appliedSummaries: [...appliedHistory] };
    }
    if (result.status === 'cancelled') {
      return { ...result, appliedCount: totalApplied, appliedSummaries: [...appliedHistory] };
    }

    const errorType = classifyError(result.message, result.errorKind, result.status);
    if (errorType === 'cancelled') {
      return result;
    }

    // Failures on the fallback agent: back off on rate limits, otherwise there is nothing left to try
    if (currentAgent === fallbackAgent) {
      if ((errorType === 'rate-limit' || errorType === 'transient') && fallbackRateLimitRetries < backoffMs.length) {
        const waitTime = backoffMs[fallbackRateLimitRetries];
        fallbackRateLimitRetries++;
        attempts--; // rate-limit retries do not consume attempt budget
        await sleep(waitTime);
        continue;
      }
      return giveUp(result);
    }

    switch (errorType) {
      case 'unreachable':
      case 'auth':
      case 'model-not-found':
        switchToFallback(`Primary model unavailable: ${errorType}`);
        strict = false;
        continue;

      case 'rate-limit':
        if (rateLimitRetries < backoffMs.length) {
          const waitTime = backoffMs[rateLimitRetries];
          rateLimitRetries++;
          attempts--;
          await sleep(waitTime);
          continue;
        }
        switchToFallback('Rate limit exhausted on primary model');
        strict = false;
        continue;

      case 'transient':
        if (transientRetries < 1) {
          transientRetries++;
          attempts--;
          await sleep(backoffMs[0]);
          continue;
        }
        switchToFallback('Transient errors on primary model');
        strict = false;
        continue;

      case 'tool-mismatch':
      case 'region':
      case 'no-edit':
      case 'unknown':
      default:
        if (attempts === 1) {
          strict = true; // attempt 2: same agent, STRICT addendum
          continue;
        }
        if (attempts === 2) {
          switchToFallback(`Repeated proposal failure (${errorType})`);
          strict = true; // attempt 3: fallback agent, STRICT addendum
          continue;
        }
        break;
    }
  }

  return giveUp(lastResult);
}
