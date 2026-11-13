import type * as vscodeTypes from 'vscode';

function getVscode(): typeof vscodeTypes | null {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

// U-4 Canonical Strings
export const S_SELECT = 'Select code first.';
export const S_RUNNING = (model: string): string => `ForgeTrail: running (${model})`;
export const S_REVIEW = (n: number): string => `ForgeTrail: review ${n} pending`;
export const S_SWITCHED = (from: string, to: string): string => `ForgeTrail: ${from} failed, switched to ${to}`;
export const S_NO_FALLBACK = 'ForgeTrail: the model could not be reached. Nothing was changed. Check your model settings.';
export const S_CANCELLED = (applied: number, discarded: number): string =>
  `ForgeTrail: cancelled — ${applied} applied, ${discarded} discarded`;
export const S_APPLIED = (n: number): string => `ForgeTrail: applied ${n} hunk(s)`;
export const S_UNDO_DONE = (path: string): string => `ForgeTrail: undone ${path}`;
export const S_UNDO_BLOCKED = (path: string): string => `ForgeTrail: cannot undo ${path} because it changed since.`;
export const S_BUSY = 'ForgeTrail: a run is already active.';
export const S_STALE_SKIP = (path: string): string => `ForgeTrail: skipped a hunk because ${path} changed.`;

/**
 * Shows an information notification after hunks are applied, offering "Undo last" and "Undo run" buttons.
 */
export async function showAppliedNotification(count: number): Promise<void> {
  const vscode = getVscode();
  if (!vscode) return;

  const message = S_APPLIED(count);
  if (count <= 0) {
    // Nothing was applied, so there is nothing to undo: no Undo buttons
    vscode.window.showInformationMessage(message);
    return;
  }
  const actionUndoLast = 'Undo last';
  const actionUndoRun = 'Undo run';

  const choice = await vscode.window.showInformationMessage(message, actionUndoLast, actionUndoRun);
  if (choice === actionUndoLast) {
    await vscode.commands.executeCommand('forgetrail.undoLast');
  } else if (choice === actionUndoRun) {
    await vscode.commands.executeCommand('forgetrail.undoRun');
  }
}

export function showStaleSkipNotification(path: string): void {
  const vscode = getVscode();
  vscode?.window.showWarningMessage(S_STALE_SKIP(path));
}

export function showUndoDoneNotification(path: string): void {
  const vscode = getVscode();
  vscode?.window.showInformationMessage(S_UNDO_DONE(path));
}

export function showUndoBlockedNotification(path: string): void {
  const vscode = getVscode();
  vscode?.window.showWarningMessage(S_UNDO_BLOCKED(path));
}

export function showNoFallbackNotification(): void {
  const vscode = getVscode();
  vscode?.window.showErrorMessage(S_NO_FALLBACK);
}

export function showCancelledNotification(applied: number, discarded: number): void {
  const vscode = getVscode();
  vscode?.window.showInformationMessage(S_CANCELLED(applied, discarded));
}

export function showSelectCodeNotification(): void {
  const vscode = getVscode();
  vscode?.window.showWarningMessage(S_SELECT);
}

export function showBusyNotification(): void {
  const vscode = getVscode();
  vscode?.window.showWarningMessage(S_BUSY);
}
