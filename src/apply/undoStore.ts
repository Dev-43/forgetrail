import * as fs from 'fs';
import * as path from 'path';

function getVscode(): any {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

export interface HunkSnapshot {
  hunkId: string;
  runId: string;
  path: string;
  fullTextBefore: string;
  fullTextAfter: string;
  timestamp: number;
}

export class UndoStore {
  private static instance: UndoStore;
  private snapshots: HunkSnapshot[] = [];

  private constructor() {}

  public static getInstance(): UndoStore {
    if (!UndoStore.instance) {
      UndoStore.instance = new UndoStore();
    }
    return UndoStore.instance;
  }

  public recordSnapshot(snapshot: HunkSnapshot): void {
    this.snapshots.push(snapshot);
  }

  public getSnapshots(): ReadonlyArray<HunkSnapshot> {
    return this.snapshots;
  }

  public clear(): void {
    this.snapshots = [];
  }

  /**
   * Reverts the most recent snapshot only if the file's current text equals snapshot.fullTextAfter.
   */
  public async undoLast(workspaceRoot = process.cwd()): Promise<{ success: boolean; message: string }> {
    if (this.snapshots.length === 0) {
      return { success: false, message: 'Nothing to undo.' };
    }

    const last = this.snapshots[this.snapshots.length - 1];
    const absPath = path.isAbsolute(last.path) ? last.path : path.resolve(workspaceRoot, last.path);

    // Read current content
    let currentText = '';
    try {
      if (fs.existsSync(absPath)) {
        currentText = fs.readFileSync(absPath, 'utf-8');
      }
    } catch (err: any) {
      return { success: false, message: `Failed to read ${last.path}: ${err?.message}` };
    }

    if (currentText !== last.fullTextAfter) {
      return {
        success: false,
        message: `Cannot undo: ${last.path} was modified after this edit was applied.`,
      };
    }

    // Apply revert
    try {
      const vscode = getVscode();
      if (vscode && vscode.workspace && vscode.Uri) {
        const uri = vscode.Uri.file(absPath);
        const edit = new vscode.WorkspaceEdit();
        if (last.fullTextBefore === '' && !fs.existsSync(absPath)) {
          // Was a create, delete file
          edit.deleteFile(uri, { ignoreIfNotExists: true });
        } else {
          const doc = await vscode.workspace.openTextDocument(uri);
          const fullRange = new vscode.Range(
            doc.positionAt(0),
            doc.positionAt(doc.getText().length)
          );
          edit.replace(uri, fullRange, last.fullTextBefore);
        }
        const applied = await vscode.workspace.applyEdit(edit);
        if (applied) {
          const doc = await vscode.workspace.openTextDocument(uri);
          await doc.save();
        }
      } else {
        // Fallback for headless / tests
        if (last.fullTextBefore === '') {
          if (fs.existsSync(absPath)) {
            fs.unlinkSync(absPath);
          }
        } else {
          fs.writeFileSync(absPath, last.fullTextBefore, 'utf-8');
        }
      }

      this.snapshots.pop();
      return { success: true, message: `Reverted hunk ${last.hunkId} in ${last.path}.` };
    } catch (err: any) {
      return { success: false, message: `Undo failed: ${err?.message}` };
    }
  }

  /**
   * Reverts all snapshots of a given run in reverse order, stopping at the first mismatch.
   */
  public async undoRun(runId?: string, workspaceRoot = process.cwd()): Promise<{ success: boolean; revertedCount: number; message: string }> {
    if (this.snapshots.length === 0) {
      return { success: false, revertedCount: 0, message: 'Nothing to undo.' };
    }

    const targetRunId = runId ?? this.snapshots[this.snapshots.length - 1].runId;
    let revertedCount = 0;

    while (this.snapshots.length > 0) {
      const top = this.snapshots[this.snapshots.length - 1];
      if (top.runId !== targetRunId) {
        break;
      }

      const res = await this.undoLast(workspaceRoot);
      if (!res.success) {
        return {
          success: false,
          revertedCount,
          message: `Stopped undo after ${revertedCount} hunks: ${res.message}`,
        };
      }
      revertedCount++;
    }

    return {
      success: true,
      revertedCount,
      message: `Reverted ${revertedCount} hunk(s) from run ${targetRunId}.`,
    };
  }
}

export const undoStore = UndoStore.getInstance();
