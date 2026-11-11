import * as vscode from 'vscode';
import { subscribe } from '../trueforge/runController';

let inlineHighlightType: vscode.TextEditorDecorationType | undefined;
let activeDecorationRange: vscode.Range | undefined;
let activeEditor: vscode.TextEditor | undefined;

function getHighlightType(): vscode.TextEditorDecorationType {
  if (!inlineHighlightType) {
    inlineHighlightType = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.selectionHighlightBackground'),
      isWholeLine: false,
    });
  }
  return inlineHighlightType;
}

/**
 * Manages the visual selection highlight during active inline-edit runs (U-3).
 * Highlights the user's selected range when an inline run starts and removes it on finish, cancel, or error.
 */
export function registerSelectionHighlight(context: vscode.ExtensionContext): void {
  const subscription = subscribe((event) => {
    switch (event.type) {
      case 'run.started':
        if (event.kind === 'inline') {
          const editor = vscode.window.activeTextEditor;
          if (editor && !editor.selection.isEmpty) {
            activeEditor = editor;
            activeDecorationRange = new vscode.Range(
              editor.selection.start,
              editor.selection.end
            );
            editor.setDecorations(getHighlightType(), [activeDecorationRange]);
          }
        }
        break;

      case 'run.finished':
      case 'run.cancelled':
      case 'run.error':
        clearHighlight();
        break;
    }
  });

  context.subscriptions.push(subscription, {
    dispose: () => clearHighlight(),
  });
}

function clearHighlight(): void {
  if (activeEditor && inlineHighlightType) {
    activeEditor.setDecorations(inlineHighlightType, []);
  }
  if (inlineHighlightType) {
    inlineHighlightType.dispose();
    inlineHighlightType = undefined;
  }
  activeEditor = undefined;
  activeDecorationRange = undefined;
}

