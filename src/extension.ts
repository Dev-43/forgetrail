import * as vscode from 'vscode';
import { startMcpServer, stopMcpServer } from './mcp/server';
import { runContext } from './mcp/runContext';
import { undoStore } from './apply/undoStore';
import { setReviewPresenter } from './trueforge/runController';
import { modalReviewPresenter } from './review/modalPresenter';
import { executeInlineEdit } from './inline/inlineEdit';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    runContext.setWorkspaceRoot(folders[0].uri.fsPath);
  }

  // Set default modal review presenter for M1 (swappable to native diff in M2)
  setReviewPresenter(modalReviewPresenter);

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

  context.subscriptions.push(helloCmd);
  context.subscriptions.push(inlineEditCmd);
  context.subscriptions.push(undoLastCmd);
  context.subscriptions.push(undoRunCmd);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      stopMcpServer().catch(console.error);
    })
  );
}

export async function deactivate(): Promise<void> {
  await stopMcpServer();
}
