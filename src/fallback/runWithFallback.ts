import { RunRequest, RunResult } from '../shared/contracts';
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
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? [15000, 30000];
  const sleep = options.sleepFn ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const execute = options.executor ?? ((agent, req, extra) => runController.executeRun(agent, req, extra));

  let currentAgent = primaryAgent;
  let attempts = 0;
  let rateLimitRetries = 0;
  let transientRetries = 0;
  let extraPrompt = '';
  let lastResult: RunResult = {
    status: 'error',
    errorKind: 'no-fallback',
    message: S_NO_FALLBACK,
    appliedCount: 0,
  };

  const appliedHistory: string[] = request.appliedSoFar ? [...request.appliedSoFar] : [];

  while (attempts < maxAttempts) {
    attempts++;

    // Prepare request with already-applied hunks if switching/restarting
    const currentRequest: RunRequest = {
      ...request,
      appliedSoFar: [...appliedHistory],
    };

    if (appliedHistory.length > 0 && currentAgent === fallbackAgent) {
      const alreadyAppliedNotice = `\nALREADY APPLIED:\n${appliedHistory.join('\n')}\nDo not re-apply these changes.`;
      extraPrompt = extraPrompt ? `${extraPrompt}\n${alreadyAppliedNotice}` : alreadyAppliedNotice;
    }

    const result = await execute(currentAgent, currentRequest, extraPrompt);
    lastResult = result;

    if (result.status === 'done') {
      return result;
    }

    if (result.status === 'cancelled') {
      return result;
    }

    // Classify error condition
    const errorType = classifyError(result.message, result.errorKind, result.status);

    if (errorType === 'cancelled') {
      return result;
    }

    // If fallback agent itself failed on a model error, terminate with no-fallback
    if (currentAgent === fallbackAgent) {
      return {
        status: 'error',
        errorKind: 'no-fallback',
        message: result.message || S_NO_FALLBACK,
        appliedCount: result.appliedCount,
      };
    }

    // Handle primary agent failures
    switch (errorType) {
      case 'unreachable':
      case 'auth':
      case 'model-not-found': {
        // Immediate switch to fallback agent with normal prompt
        runController.emitEvent({
          type: 'model.switched',
          runId: runController.getActiveRunId() ?? 'fallback',
          from: currentAgent,
          to: fallbackAgent,
          reason: `Primary model unavailable: ${errorType}`,
        });
        currentAgent = fallbackAgent;
        extraPrompt = '';
        continue;
      }

      case 'rate-limit': {
        // Backoff retries on same agent before switching
        if (rateLimitRetries < backoffMs.length) {
          const waitTime = backoffMs[rateLimitRetries];
          rateLimitRetries++;
          attempts--; // rate-limit retries do not consume attempt budget
          await sleep(waitTime);
          continue;
        }

        // Exhausted rate limit retries -> switch to fallback
        runController.emitEvent({
          type: 'model.switched',
          runId: runController.getActiveRunId() ?? 'fallback',
          from: currentAgent,
          to: fallbackAgent,
          reason: 'Rate limit exhausted on primary model',
        });
        currentAgent = fallbackAgent;
        extraPrompt = '';
        continue;
      }

      case 'transient': {
        // Retry once on transient error before switching
        if (transientRetries < 1) {
          transientRetries++;
          attempts--; // transient retries do not consume attempt budget
          await sleep(backoffMs[0]);
          continue;
        }

        // Switch to fallback
        runController.emitEvent({
          type: 'model.switched',
          runId: runController.getActiveRunId() ?? 'fallback',
          from: currentAgent,
          to: fallbackAgent,
          reason: 'Transient errors on primary model',
        });
        currentAgent = fallbackAgent;
        extraPrompt = '';
        continue;
      }

      case 'tool-mismatch':
      case 'region':
      case 'no-edit':
      case 'unknown':
      default: {
        if (attempts === 1) {
          // Attempt 2: retry same agent with STRICT addendum
          extraPrompt = STRICT_ADDENDUM;
          continue;
        } else if (attempts === 2) {
          // Attempt 3: switch to fallback agent with STRICT addendum
          runController.emitEvent({
            type: 'model.switched',
            runId: runController.getActiveRunId() ?? 'fallback',
            from: currentAgent,
            to: fallbackAgent,
            reason: `Repeated proposal failure (${errorType})`,
          });
          currentAgent = fallbackAgent;
          extraPrompt = STRICT_ADDENDUM;
          continue;
        }
        break;
      }
    }
  }

  return {
    status: 'error',
    errorKind: 'no-fallback',
    message: lastResult.message || S_NO_FALLBACK,
    appliedCount: lastResult.appliedCount,
  };
}
