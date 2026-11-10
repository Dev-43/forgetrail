import * as vscode from 'vscode';
import {
  EMPTY_SCHEME,
  PROPOSED_SCHEME,
  ProposedDocProvider,
} from './review/ui/proposedDocProvider';
import { ReviewController } from './review/ui/reviewController';
import { StatusBarManager } from './ui/statusBar';
import { registerMockReview } from './review/ui/mockReview';
import { registerSelectionHighlight } from './ui/selectionHighlight';
import { showSelectCodeNotification } from './ui/notifications';

let proposedDocProvider: ProposedDocProvider | undefined;
let reviewController: ReviewController | undefined;
let statusBarManager: StatusBarManager | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Initialize virtual document provider
  proposedDocProvider = new ProposedDocProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, proposedDocProvider),
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, proposedDocProvider)
  );

  // Initialize review controller
  reviewController = new ReviewController(proposedDocProvider);
  context.subscriptions.push({
    dispose: () => reviewController?.destroy(),
  });

  // Initialize status bar manager
  statusBarManager = new StatusBarManager();
  context.subscriptions.push({
    dispose: () => statusBarManager?.dispose(),
  });

  // Register mock review command (U-2 harness)
  registerMockReview(context, reviewController);

  // Register selection highlight on inline edit runs (U-3)
  registerSelectionHighlight(context);

  // Hello command from C-0
  const helloCommand = vscode.commands.registerCommand('forgetrail.hello', () => {
    vscode.window.showInformationMessage('Hello from ForgeTrail!');
  });
  context.subscriptions.push(helloCommand);

  // Stub command for inline edit (Core replaces with C-6)
  const inlineEditCommand = vscode.commands.registerCommand('forgetrail.inlineEdit', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      showSelectCodeNotification();
      return;
    }
    vscode.window.showInformationMessage('ForgeTrail: Inline Edit triggered (waiting for Core engine integration).');
  });
  context.subscriptions.push(inlineEditCommand);

  // Stub commands for undo (Core replaces with C-4)
  const undoLastCommand = vscode.commands.registerCommand('forgetrail.undoLast', async () => {
    vscode.window.showInformationMessage('ForgeTrail: Undo last hunk.');
  });
  const undoRunCommand = vscode.commands.registerCommand('forgetrail.undoRun', async () => {
    vscode.window.showInformationMessage('ForgeTrail: Undo entire run.');
  });
  context.subscriptions.push(undoLastCommand, undoRunCommand);
}

export function deactivate(): void {
  statusBarManager?.dispose();
  reviewController?.destroy();
  proposedDocProvider?.dispose();
}
