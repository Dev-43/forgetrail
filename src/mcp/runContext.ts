import { RUN_RETRIEVAL_MAX_TOKENS } from '../shared/limits';

export interface SelectionRegion {
  path: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface AppliedHunk {
  id: string;
  path: string;
  startLine: number;
  endLine: number;
  reason: string;
}

/**
 * Singleton managing the active run's runtime state:
 * - active runId & single-run concurrency check (C11)
 * - cancellation flag (synchronously checked before applies and tool executions)
 * - retrieval budget tracking (used vs RUN_RETRIEVAL_MAX_TOKENS)
 * - inline selection region for bounding inline edits
 * - list of hunks applied during the run
 */
export class RunContextManager {
  private static instance: RunContextManager;

  public activeRunId: string | null = null;
  public workspaceRoot: string = process.cwd();
  public cancelled = false;
  public budgetUsed = 0;
  public readonly budgetMax = RUN_RETRIEVAL_MAX_TOKENS;
  public selectionRegion?: SelectionRegion;
  public appliedHunks: AppliedHunk[] = [];
  public autoDeniesPerFile = new Map<string, number>();

  private constructor() {}

  public static getInstance(): RunContextManager {
    if (!RunContextManager.instance) {
      RunContextManager.instance = new RunContextManager();
    }
    return RunContextManager.instance;
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = root;
  }

  public startRun(runId: string, workspaceRoot?: string, selection?: SelectionRegion): void {
    this.activeRunId = runId;
    if (workspaceRoot) {
      this.workspaceRoot = workspaceRoot;
    }
    this.cancelled = false;
    this.budgetUsed = 0;
    this.selectionRegion = selection;
    this.appliedHunks = [];
    this.autoDeniesPerFile.clear();
  }

  public cancel(): void {
    this.cancelled = true;
  }

  public reset(): void {
    this.activeRunId = null;
    this.cancelled = false;
    this.budgetUsed = 0;
    this.selectionRegion = undefined;
    this.appliedHunks = [];
    this.autoDeniesPerFile.clear();
  }

  public consumeBudget(tokens: number): { exhausted: boolean; used: number; remaining: number } {
    this.budgetUsed += tokens;
    const remaining = Math.max(0, this.budgetMax - this.budgetUsed);
    return {
      exhausted: this.budgetUsed >= this.budgetMax,
      used: this.budgetUsed,
      remaining,
    };
  }

  public recordAutoDeny(path: string): number {
    const current = (this.autoDeniesPerFile.get(path) ?? 0) + 1;
    this.autoDeniesPerFile.set(path, current);
    return current;
  }

  public recordApplied(hunk: AppliedHunk): void {
    this.appliedHunks.push(hunk);
  }
}

export const runContext = RunContextManager.getInstance();
