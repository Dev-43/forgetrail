import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand('forgetrail.hello', () => {
    vscode.window.showInformationMessage('Hello from ForgeTrail!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {
  // Cleanup on extension deactivation
}
