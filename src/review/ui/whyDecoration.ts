import * as vscode from 'vscode';

let whyDecorationType: vscode.TextEditorDecorationType | undefined;

/**
 * Creates or retrieves the TextEditorDecorationType for the "why" explanation.
 * Uses ThemeColor('descriptionForeground') for optimal contrast in both light and dark themes.
 */
function getDecorationType(): vscode.TextEditorDecorationType {
  if (!whyDecorationType) {
    whyDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      after: {
        margin: '0 0 0 2em',
        color: new vscode.ThemeColor('descriptionForeground'),
        fontStyle: 'italic',
      },
    });
  }
  return whyDecorationType;
}

/**
 * Formats the inline why description according to BUILD_ui.md U-2 step 5 and BUILD.md C12 M3.
 * Example: " ◀ why: reason text (from fileA.py, fileB.py)"
 */
export function formatWhyText(reason?: string, sources?: string[]): string {
  const displayReason = reason && reason.trim() ? reason.trim() : '(no reason given)';
  const sourcesPart = sources && sources.length > 0 ? ` (from ${sources.join(', ')})` : '';
  return ` ◀ why: ${displayReason}${sourcesPart}`;
}

/**
 * Attaches the "why" decoration after the specified 0-based line on the right side of the diff.
 */
export function applyWhyDecoration(
  editor: vscode.TextEditor,
  line0Based: number,
  reason?: string,
  sources?: string[]
): void {
  const doc = editor.document;
  const targetLine = Math.min(Math.max(0, line0Based), Math.max(0, doc.lineCount - 1));
  const line = doc.lineAt(targetLine);

  const text = formatWhyText(reason, sources);
  const decoration: vscode.DecorationOptions = {
    range: new vscode.Range(line.range.end, line.range.end),
    renderOptions: {
      after: {
        contentText: text,
      },
    },
  };

  const decType = getDecorationType();
  editor.setDecorations(decType, [decoration]);
}

/**
 * Clears all active why decorations across editors and disposes the decoration type.
 */
export function clearWhyDecorations(): void {
  if (whyDecorationType) {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(whyDecorationType, []);
    }
    whyDecorationType.dispose();
    whyDecorationType = undefined;
  }
}

