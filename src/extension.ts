import * as vscode from 'vscode';
import { startMcpServer, stopMcpServer } from './mcp/server';
import { runContext } from './mcp/runContext';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    runContext.setWorkspaceRoot(folders[0].uri.fsPath);
  }

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

  context.subscriptions.push(helloCmd);
  context.subscriptions.push(
    new vscode.Disposable(() => {
      stopMcpServer().catch(console.error);
    })
  );
}

export async function deactivate(): Promise<void> {
  await stopMcpServer();
}
