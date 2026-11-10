// BUILD.md Section 5 Shared Contracts (C6, C7, C8, C9, C11)

// C6 — Standard Messages
export const E_PATH_OUTSIDE = (path: string): string =>
  `ERROR PATH_OUTSIDE_WORKSPACE: ${path} is outside the workspace.`;

export const E_PATH_IGNORED = (path: string): string =>
  `ERROR PATH_IGNORED: ${path} is in an ignored folder.`;

export const E_NOT_FOUND = (path: string): string =>
  `ERROR FILE_NOT_FOUND: ${path}`;

export const E_BINARY = (path: string): string =>
  `ERROR BINARY_FILE: ${path}`;

export const E_BUDGET = (used: number, max: number): string =>
  `ERROR BUDGET_EXHAUSTED: used ${used} of ${max} tokens. Stop reading. Use what you have or request a narrower range.`;

export const E_FILE_EXISTS = (path: string): string =>
  `ERROR FILE_EXISTS: ${path}. Use old_text to edit it.`;

export const E_TIMEOUT = (ms: number): string =>
  `ERROR COMMAND_TIMEOUT after ${ms} ms.`;

export const E_CANCELLED = 'CANCELLED: run was cancelled; nothing applied.';

export const D_NOT_FOUND = (path: string): string =>
  `REJECTED_AUTO: old_text was not found in ${path}. Call read_file for the exact lines and retry with exact text.`;

export const D_AMBIGUOUS = (n: number, path: string): string =>
  `REJECTED_AUTO: old_text matched ${n} places in ${path}. Include more surrounding lines so it matches once.`;

export const D_OUTSIDE_REGION = (s: number, e: number): string =>
  `REJECTED_AUTO: edit is outside the selected region (lines ${s}-${e}). Edit only inside it.`;

export const D_STALE = (path: string): string =>
  `REJECTED_AUTO: ${path} changed since you read it. Re-read it and retry.`;

export const D_FORMAT = 'REJECTED_AUTO: old_text contains line numbers or a header line. Send the raw file text only.';

export const D_USER = (feedback?: string): string =>
  `REJECTED_BY_USER: ${feedback ? feedback : 'no reason given'}`;

export const R_APPLIED = (path: string, s: number, e: number, id: string): string =>
  `APPLIED ${path} lines ${s}-${e} (hunk ${id}).`;

// C7 — Review Contract (Core <-> UI)
export interface ReviewRequest {
  id: string;
  runId: string;
  threadId: string;
  path: string;
  kind: 'replace' | 'create';
  oldText: string;
  newText: string;
  startLine: number;
  endLine: number;
  reason: string;
  sources: string[];
  index: number;
  total: number;
  baseVersion: number;
}

export interface ReviewDecision {
  id: string;
  decision: 'accept' | 'reject';
  feedback?: string;
}

export interface ReviewPresenter {
  present(request: ReviewRequest): Promise<ReviewDecision>;
  dispose(runId: string): void;
}

// C8 — Agent Event Contract
export type AgentEvent =
  | { type: 'run.started'; runId: string; kind: 'inline' | 'agent'; instruction: string; agentName: string }
  | { type: 'text.delta'; runId: string; threadId: string; text: string }
  | { type: 'tool.started'; runId: string; threadId: string; toolName: string; argsSummary: string }
  | { type: 'tool.finished'; runId: string; toolName: string; ok: boolean; resultSummary: string }
  | { type: 'context.report'; runId: string; items: Array<{ path: string; reason: string; tokens: number }>; used: number; max: number }
  | { type: 'budget.update'; runId: string; used: number; max: number }
  | { type: 'review.requested'; request: ReviewRequest }
  | { type: 'review.resolved'; id: string; decision: 'accept' | 'reject' }
  | { type: 'model.switched'; runId: string; from: string; to: string; reason: string }
  | { type: 'run.cancelled'; runId: string; applied: number; discarded: number }
  | { type: 'run.finished'; runId: string; summary: string; applied: number }
  | { type: 'run.error'; runId: string; kind: 'model' | 'tool' | 'network' | 'no-fallback' | 'no-edit'; message: string };

// C9 — Run Request / Result Contract
export interface RunSelection {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface RunRequest {
  kind: 'inline' | 'agent';
  instruction: string;
  workspaceRoot: string;
  selection?: RunSelection;
  mentions?: string[];
  appliedSoFar?: string[];
}

export interface RunResult {
  status: 'done' | 'error' | 'cancelled';
  errorKind?: 'model' | 'tool' | 'network' | 'no-fallback' | 'tool-mismatch' | 'no-edit' | 'region';
  message: string;
  appliedCount: number;
}

// C11 — Run State Machine
export type RunState = 'idle' | 'running' | 'awaiting_review' | 'finishing' | 'cancelling';

