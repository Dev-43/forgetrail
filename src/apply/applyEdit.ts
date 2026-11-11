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
 * Applies a single approved hunk to disk atomically via WorkspaceEdit and saves.
 * Precondition: executed only after user allow or auto-allow.
 */
export async function applyHunk(
  request: ReviewRequest,
  workspaceRoot = runContext.workspaceRoot
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
    currentText = fs.readFileSync(absPath, 'utf-8');

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
        await doc.save();
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
