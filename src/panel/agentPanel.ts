import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runController } from '../trueforge/runController';
import { runWithFallback } from '../fallback/runWithFallback';
import { resolveMentions } from '../context/mentions';
import { AgentEvent } from '../shared/contracts';

export class AgentPanel {
  public static currentPanel: AgentPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];

  public static createOrShow(extensionUri: vscode.Uri): AgentPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (AgentPanel.currentPanel) {
      AgentPanel.currentPanel.panel.reveal(column);
      return AgentPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      'forgetrail.agentPanel',
      'ForgeTrail Agent',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(extensionUri.fsPath, 'src', 'panel', 'webview')),
          vscode.Uri.file(path.join(extensionUri.fsPath, 'out', 'panel', 'webview')),
        ],
      }
    );

    AgentPanel.currentPanel = new AgentPanel(panel, extensionUri);
    return AgentPanel.currentPanel;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.extensionUri = extensionUri;

    // Set HTML content
    this.panel.webview.html = this.getHtmlForWebview();

    // Listen to messages from webview
    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      null,
      this.disposables
    );

    // Forward run events to webview
    const sub = runController.subscribe((event: AgentEvent) => {
      this.panel.webview.postMessage(event);
    });
    this.disposables.push(sub);

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private async handleMessage(message: any): Promise<void> {
    if (!message || !message.type) return;

    switch (message.type) {
      case 'startRun': {
        const rawInstruction = message.instruction || '';
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders && workspaceFolders.length > 0
          ? workspaceFolders[0].uri.fsPath
          : process.cwd();

        // Resolve explicit @file and @symbol mentions (C-12)
        const mentionResult = resolveMentions(rawInstruction, workspaceRoot);

        let finalInstruction = rawInstruction;
        if (mentionResult.attachedContextText) {
          finalInstruction = `${rawInstruction}\n\n${mentionResult.attachedContextText}`;
        }

        // Emit initial context report for mentioned files if any
        if (mentionResult.mentions.length > 0) {
          const validMentions = mentionResult.mentions.filter((m) => m.found && m.path);
          if (validMentions.length > 0) {
            this.panel.webview.postMessage({
              type: 'context.report',
              items: validMentions.map((m) => ({
                path: m.path!,
                reason: 'mentioned by user',
                tokens: m.estimatedTokens,
              })),
              used: 0,
              max: 12000,
            });
          }
        }

        // Launch agent run with fallback routing (C-20)
        try {
          await runWithFallback({
            kind: 'agent',
            instruction: finalInstruction,
            workspaceRoot,
          });
        } catch (err: any) {
          this.panel.webview.postMessage({
            type: 'run.error',
            kind: 'tool',
            message: err.message || 'Run execution failed',
          });
        }
        break;
      }

      case 'cancelRun': {
        await runController.cancelRun();
        break;
      }

      case 'undoRun': {
        await vscode.commands.executeCommand('forgetrail.undoRun');
        break;
      }

      case 'openFile': {
        const relPath = message.path;
        if (!relPath) break;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const root = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : process.cwd();
        const absPath = path.resolve(root, relPath);
        if (fs.existsSync(absPath)) {
          const doc = await vscode.workspace.openTextDocument(absPath);
          await vscode.window.showTextDocument(doc, { preview: true });
        }
        break;
      }
    }
  }

  private getHtmlForWebview(): string {
    const webviewDir = path.join(this.extensionUri.fsPath, 'src', 'panel', 'webview');
    const htmlPath = path.join(webviewDir, 'index.html');
    const cssPath = path.join(webviewDir, 'style.css');
    const jsPath = path.join(webviewDir, 'main.js');

    let htmlContent = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf-8') : '<h1>ForgeTrail Agent</h1>';
    const cssContent = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf-8') : '';
    const jsContent = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, 'utf-8') : '';

    // Inline CSS and JS into HTML
    htmlContent = htmlContent.replace('<link rel="stylesheet" href="style.css">', `<style>${cssContent}</style>`);
    htmlContent = htmlContent.replace('<script src="main.js"></script>', `<script>${jsContent}</script>`);

    return htmlContent;
  }

  public dispose(): void {
    AgentPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      const d = this.disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }
}
