// C4 — Limits (Initial values, strictly governed by limits.ts)

export const OUTLINE_MAX_TOKENS = 1500;
export const READ_MAX_LINES = 200;
export const SEARCH_MAX_MATCHES = 30;
export const SEARCH_LINE_MAX_CHARS = 200;
export const SUGGEST_MAX_FILES = 8;
export const RUN_RETRIEVAL_MAX_TOKENS = 12000;
export const COMMAND_TIMEOUT_MS = 120000;
export const COMMAND_OUTPUT_MAX_LINES = 200;
export const MAX_ATTEMPTS = 3;
export const AGENT_ITERATION_LIMIT = 40;
export const AUTO_DENY_LIMIT_PER_FILE = 3;
// Rate-limit backoff. Raised from the initial 2 s / 4 s: free-tier per-minute quotas (observed
// "retry in ~8-15 s" from two providers during testing) are not cleared by a 2 s wait.
export const BACKOFF_MS = [15000, 30000] as const;
