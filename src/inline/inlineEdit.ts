import * as path from 'path';
import { RunRequest } from '../shared/contracts';
import { runContext } from '../mcp/runContext';
import { runWithFallback } from '../fallback/runWithFallback';
import { getRunState } from '../trueforge/runController';
import { showBusyNotification, showSelectCodeNotification } from '../ui/notifications';

function getVscode(): any {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

/**
 * Command handler: forgetrail.inlineEdit
 * Steps:
 * 1. Checks for non-empty selection in active editor.
 * 2. Prompts user for natural language instruction.
 * 3. Builds inline RunRequest with selection bounds.
 * 4. Dispatches run through executeRun with forgetrail-inline-primary.
 * 5. Displays completion message with undo actions.
 */
export async function executeInlineEdit(): Promise<void> {
  const vscode = getVscode();
  if (!vscode || !vscode.window) {
    console.error('VS Code window API not available.');
    return;
  }

  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Open a file first.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    showSelectCodeNotification();
    return;
  }

  // C11: one run at a time; refuse here instead of letting the fallback policy retry a "busy" error
  if (getRunState() !== 'idle') {
    showBusyNotification();
    return;
  }

  const instruction = await vscode.window.showInputBox({
    prompt: 'What would you like to change in the selected code?',
    placeHolder: "e.g. Treat 'off' and 'n' as false, and update docstring",
  });

  if (!instruction || instruction.trim().length === 0) {
    return;
  }

  const workspaceRoot = runContext.workspaceRoot;
  const docPath = editor.document.uri.fsPath;
  const relPath = path.relative(workspaceRoot, docPath).replace(/\\/g, '/');

  const selectedText = editor.document.getText(selection);
  const startLine = selection.start.line + 1; // 1-based
  // A selection that ends at column 0 of the next line does not include that line
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line
      : selection.end.line + 1;

  const request: RunRequest = {
    kind: 'inline',
    instruction: instruction.trim(),
    workspaceRoot,
    selection: {
      path: relPath,
      startLine,
      endLine,
      text: selectedText,
    },
  };

  const result = await runWithFallback(request);

  if (result.status === 'done') {
    const action = await vscode.window.showInformationMessage(
      `ForgeTrail: applied ${result.appliedCount} hunk(s)`,
      'Undo last',
      'Undo run'
    );
    if (action === 'Undo last') {
      await vscode.commands.executeCommand('forgetrail.undoLast');
    } else if (action === 'Undo run') {
      await vscode.commands.executeCommand('forgetrail.undoRun');
    }
  } else if (result.status === 'cancelled') {
    vscode.window.showInformationMessage('ForgeTrail: run was cancelled.');
  } else if (result.errorKind === 'no-fallback') {
    // Already a complete user-facing sentence (S_NO_FALLBACK + short detail)
    vscode.window.showErrorMessage(result.message);
  } else {
    const firstLine = (result.message || '').split(/\r?\n/)[0].slice(0, 200);
    vscode.window.showErrorMessage(`ForgeTrail error: ${firstLine}`);
  }
}
