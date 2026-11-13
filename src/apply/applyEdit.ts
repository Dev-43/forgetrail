import * as fs from 'fs';
import * as path from 'path';

function getVscode(): any {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}
import {
  ReviewRequest,
  E_CANCELLED,
  D_NOT_FOUND,
  D_AMBIGUOUS,
  E_FILE_EXISTS,
  R_APPLIED,
} from '../shared/contracts';
import { validateWorkspacePath } from '../mcp/pathGuard';
import { runContext } from '../mcp/runContext';
import { undoStore } from './undoStore';

/**
 * Returns the file text with the proposed hunk applied.
 * Adheres to EOL rules (CRLF matching if original file is CRLF).
 */
export function computeProposedText(currentText: string, request: ReviewRequest): string {
  if (request.kind === 'create') {
    return request.newText;
  }

  const isCrlf = currentText.includes('\r\n');
  const normalizedOld = isCrlf
    ? request.oldText.replace(/\r?\n/g, '\r\n')
    : request.oldText.replace(/\r\n/g, '\n');
  const normalizedNew = isCrlf
    ? request.newText.replace(/\r?\n/g, '\r\n')
    : request.newText.replace(/\r\n/g, '\n');

  if (!normalizedOld) {
    return currentText + normalizedNew;
  }

  const index = currentText.indexOf(normalizedOld);
  if (index === -1) {
    return currentText;
  }

  return currentText.slice(0, index) + normalizedNew + currentText.slice(index + normalizedOld.length);
}

/**
 * Per-file apply queue. TrueForge executes every approved propose_edit of one approval batch
 * in parallel; without this, two hunks for the same file both read the old text, each replaced
 * the whole document, and the last write won: an accepted hunk vanished, VS Code reported
 * "Failed to save … the content of the file is newer", and undo snapshots no longer chained.
 */
const applyQueues = new Map<string, Promise<unknown>>();

export function withFileLock<T>(absPath: string, task: () => Promise<T>): Promise<T> {
  const key = path.resolve(absPath).toLowerCase();
  const previous = applyQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const settled = run.then(() => undefined, () => undefined);
  applyQueues.set(key, settled);
  settled.then(() => {
    if (applyQueues.get(key) === settled) applyQueues.delete(key);
  });
  return run;
}

/** The open editor document for a path, if VS Code has it open. */
function findOpenDocument(vscode: any, absPath: string): any | undefined {
  if (!vscode?.workspace?.textDocuments) return undefined;
  const target = path.resolve(absPath).toLowerCase();
  return vscode.workspace.textDocuments.find(
    (d: any) => d.uri?.scheme === 'file' && path.resolve(d.uri.fsPath).toLowerCase() === target
  );
}

/**
 * Applies a single approved hunk to disk atomically via WorkspaceEdit and saves.
 * Precondition: executed only after user allow or auto-allow.
 * Hunks for the same file are applied one at a time (see withFileLock).
 */
export async function applyHunk(
  request: ReviewRequest,
  workspaceRoot = runContext.workspaceRoot
): Promise<string> {
  const guard = validateWorkspacePath(request.path, workspaceRoot);
  if (!guard.ok) {
    return guard.error!;
  }
  return withFileLock(guard.absolutePath!, () => applyHunkUnlocked(request, workspaceRoot));
}

async function applyHunkUnlocked(
  request: ReviewRequest,
  workspaceRoot: string
): Promise<string> {
  // Cancel guard check: if run cancelled, write NOTHING
  if (runContext.cancelled) {
    return E_CANCELLED;
  }

  const guard = validateWorkspacePath(request.path, workspaceRoot);
  if (!guard.ok) {
    return guard.error!;
  }

  const absPath = guard.absolutePath!;
  const relPath = guard.relativePath!;

  let currentText = '';
  const existedBefore = fs.existsSync(absPath);
  if (request.kind === 'create') {
    // Re-validate: a create never overwrites an existing file
    if (existedBefore) {
      return E_FILE_EXISTS(relPath);
    }
  } else {
    if (!fs.existsSync(absPath)) {
      return D_NOT_FOUND(relPath);
    }
    // The open document is what the user sees and what the WorkspaceEdit below replaces,
    // so it is the base text; the disk is used only when the file is not open.
    const openDoc = findOpenDocument(getVscode(), absPath);
    currentText = openDoc ? openDoc.getText() : fs.readFileSync(absPath, 'utf-8');

    // Single occurrence check
    const isCrlf = currentText.includes('\r\n');
    const normalizedOld = isCrlf
      ? request.oldText.replace(/\r?\n/g, '\r\n')
      : request.oldText.replace(/\r\n/g, '\n');
    const occurrences = currentText.split(normalizedOld).length - 1;
    if (occurrences === 0) {
      return D_NOT_FOUND(relPath);
    }
    if (occurrences > 1) {
      return D_AMBIGUOUS(occurrences, relPath);
    }
  }

  // Re-check cancel right before writing
  if (runContext.cancelled) {
    return E_CANCELLED;
  }

  const proposedText = computeProposedText(currentText, request);

  // Take snapshot in undoStore
  undoStore.recordSnapshot({
    hunkId: request.id,
    runId: request.runId,
    path: relPath,
    fullTextBefore: currentText,
    fullTextAfter: proposedText,
    createdFile: !existedBefore,
    timestamp: Date.now(),
  });

  // Apply change via VS Code WorkspaceEdit
  try {
    const vscode = getVscode();
    if (vscode && vscode.workspace && vscode.Uri) {
      const uri = vscode.Uri.file(absPath);
      const edit = new vscode.WorkspaceEdit();

      if (request.kind === 'create' && !fs.existsSync(absPath)) {
        edit.createFile(uri, { overwrite: true, ignoreIfExists: false });
        edit.insert(uri, new vscode.Position(0, 0), proposedText);
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        const fullRange = new vscode.Range(
          doc.positionAt(0),
          doc.positionAt(doc.getText().length)
        );
        edit.replace(uri, fullRange, proposedText);
      }

      const applied = await vscode.workspace.applyEdit(edit);
      if (applied) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const saved = await doc.save();
        const onDisk = fs.readFileSync(absPath, 'utf-8').replace(/^﻿/, '');
        if (!saved || onDisk !== proposedText) {
          // VS Code refused the save (e.g. "the content of the file is newer"). The buffer
          // already holds proposedText, so write the same text to disk: disk and editor agree
          // and the undo snapshot (fullTextAfter) matches what is on disk.
          fs.writeFileSync(absPath, proposedText, 'utf-8');
        }
      } else {
        // Fallback to disk write if applyEdit failed
        fs.writeFileSync(absPath, proposedText, 'utf-8');
      }
    } else {
      // Direct file write for headless tests
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, proposedText, 'utf-8');
    }
  } catch (err: any) {
    return `ERROR APPLY_FAILED: ${err?.message}`;
  }

  // Calculate applied line range from where the old text matched (EOL-normalised), not by
  // searching for new_text, which can be absent after CRLF conversion or occur earlier.
  let startLine = 1;
  let newLinesCount = request.newText.split(/\r?\n/).length;
  if (request.kind === 'replace') {
    const isCrlf = currentText.includes('\r\n');
    const normalizedOld = isCrlf
      ? request.oldText.replace(/\r?\n/g, '\r\n')
      : request.oldText.replace(/\r\n/g, '\n');
    const matchIndex = currentText.indexOf(normalizedOld);
    startLine = currentText.slice(0, Math.max(0, matchIndex)).split(/\r?\n/).length;
  } else {
    newLinesCount = proposedText.split(/\r?\n/).length;
  }
  const endLine = startLine + newLinesCount - 1;

  runContext.recordApplied({
    id: request.id,
    path: relPath,
    startLine,
    endLine,
    reason: request.reason,
  });

  return R_APPLIED(relPath, startLine, endLine, request.id);
}
