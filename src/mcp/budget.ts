import { RUN_RETRIEVAL_MAX_TOKENS } from '../shared/limits';
import { runContext } from './runContext';
import { emitEvent } from '../trueforge/runController';

/**
 * Estimates token count from text using standard chars / 4 heuristic.
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

export interface BudgetStatus {
  exhausted: boolean;
  used: number;
  remaining: number;
  max: number;
}

/**
 * Records tokens consumed by a retrieval result or injected mention,
 * deducts from RUN_RETRIEVAL_MAX_TOKENS, and emits budget.update.
 */
export function recordRetrievalTokens(tokens: number): BudgetStatus {
  const result = runContext.consumeBudget(tokens);
  const status: BudgetStatus = {
    exhausted: result.used >= RUN_RETRIEVAL_MAX_TOKENS,
    used: result.used,
    remaining: Math.max(0, RUN_RETRIEVAL_MAX_TOKENS - result.used),
    max: RUN_RETRIEVAL_MAX_TOKENS,
  };

  if (runContext.activeRunId) {
    emitEvent({
      type: 'budget.update',
      runId: runContext.activeRunId,
      used: status.used,
      max: status.max,
    });
  }

  return status;
}

/**
 * Checks current budget state without consuming additional tokens.
 */
export function getBudgetStatus(): BudgetStatus {
  return {
    exhausted: runContext.budgetUsed >= RUN_RETRIEVAL_MAX_TOKENS,
    used: runContext.budgetUsed,
    remaining: Math.max(0, RUN_RETRIEVAL_MAX_TOKENS - runContext.budgetUsed),
    max: RUN_RETRIEVAL_MAX_TOKENS,
  };
}

/**
 * Resets budget counter (called at run start).
 */
export function resetBudget(): void {
  runContext.budgetUsed = 0;
}
