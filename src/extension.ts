import * as vscode from 'vscode';
import { startMcpServer, stopMcpServer } from './mcp/server';
import { runContext } from './mcp/runContext';
import { undoStore } from './apply/undoStore';
import { cancelRun, getRunState, setReviewPresenter } from './trueforge/runController';
import { executeInlineEdit } from './inline/inlineEdit';
import { AgentPanel } from './panel/agentPanel';
import {
  EMPTY_SCHEME,
  PROPOSED_SCHEME,
  ProposedDocProvider,
} from './review/ui/proposedDocProvider';
import { ReviewController } from './review/ui/reviewController';
import { StatusBarManager } from './ui/statusBar';
import { registerMockReview } from './review/ui/mockReview';
import { registerSelectionHighlight } from './ui/selectionHighlight';

let proposedDocProvider: ProposedDocProvider | undefined;
let reviewController: ReviewController | undefined;
let statusBarManager: StatusBarManager | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    runContext.setWorkspaceRoot(folders[0].uri.fsPath);
  }

  // Initialize virtual document provider for proposed diff views
  proposedDocProvider = new ProposedDocProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, proposedDocProvider),
    vscode.workspace.registerTextDocumentContentProvider(EMPTY_SCHEME, proposedDocProvider)
  );

  // Initialize native diff ReviewController and wire as primary review presenter
  reviewController = new ReviewController(proposedDocProvider);
  setReviewPresenter(reviewController);
  context.subscriptions.push({
    dispose: () => reviewController?.destroy(),
  });

  // Initialize status bar manager
  statusBarManager = new StatusBarManager();
  context.subscriptions.push({
    dispose: () => statusBarManager?.dispose(),
  });

  // Register mock review harness (U-2)
  registerMockReview(context, reviewController);

  // Register selection highlight on inline edit runs (U-3)
  registerSelectionHighlight(context);

  // Start MCP server on fixed port 3333 per C1
  try {
    await startMcpServer(3333, '127.0.0.1');
    console.log('ForgeTrail MCP server running on http://127.0.0.1:3333');
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to start ForgeTrail MCP server: ${err?.message}`);
  }

  const helloCmd = vscode.commands.registerCommand('forgetrail.hello', () => {
    vscode.window.showInformationMessage('Hello from ForgeTrail!');
  });

  const inlineEditCmd = vscode.commands.registerCommand('forgetrail.inlineEdit', async () => {
    await executeInlineEdit();
  });

  const undoLastCmd = vscode.commands.registerCommand('forgetrail.undoLast', async () => {
    const res = await undoStore.undoLast(runContext.workspaceRoot);
    if (res.success) {
      vscode.window.showInformationMessage(res.message);
    } else {
      vscode.window.showWarningMessage(res.message);
    }
  });

  const undoRunCmd = vscode.commands.registerCommand('forgetrail.undoRun', async () => {
    const res = await undoStore.undoRun(undefined, runContext.workspaceRoot);
    if (res.success) {
      vscode.window.showInformationMessage(res.message);
    } else {
      vscode.window.showWarningMessage(res.message);
    }
  });

  const openPanelCmd = vscode.commands.registerCommand('forgetrail.openPanel', () => {
    AgentPanel.createOrShow(context.extensionUri);
  });

  // Cancel any active run (inline or agent); also bound to the status bar item while running
  const cancelRunCmd = vscode.commands.registerCommand('forgetrail.cancelRun', async () => {
    if (getRunState() === 'idle') {
      vscode.window.showInformationMessage('ForgeTrail: no run is active.');
      return;
    }
    await cancelRun();
  });
  context.subscriptions.push(cancelRunCmd);

  context.subscriptions.push(helloCmd);
  context.subscriptions.push(inlineEditCmd);
  context.subscriptions.push(undoLastCmd);
  context.subscriptions.push(undoRunCmd);
  context.subscriptions.push(openPanelCmd);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      stopMcpServer().catch(console.error);
    })
  );
}

export async function deactivate(): Promise<void> {
  statusBarManager?.dispose();
  reviewController?.destroy();
  proposedDocProvider?.dispose();
  await stopMcpServer();
}
