import * as vscode from 'vscode';
import {
  D_STALE,
  ReviewDecision,
  ReviewPresenter,
  ReviewRequest,
} from '../../shared/contracts';
import { computeProposedText } from '../../apply/applyEdit';
import {
  EMPTY_SCHEME,
  PROPOSED_SCHEME,
  ProposedDocProvider,
} from './proposedDocProvider';
import { applyWhyDecoration, clearWhyDecorations } from './whyDecoration';
import { showStaleSkipNotification } from '../../ui/notifications';

interface PendingReview {
  request: ReviewRequest;
  leftUri: vscode.Uri;
  rightUri: vscode.Uri;
  title: string;
  resolve: (decision: ReviewDecision) => void;
  baseDoc?: vscode.TextDocument;
}

export class ReviewController implements ReviewPresenter {
  private activePending: PendingReview | undefined;
  private queue: Array<{ request: ReviewRequest; resolve: (decision: ReviewDecision) => void }> = [];
  private disposables: vscode.Disposable[] = [];

  constructor(private docProvider: ProposedDocProvider) {
    this.registerCommands();
  }

  private registerCommands(): void {
    this.disposables.push(
      vscode.commands.registerCommand('forgetrail.review.accept', () => this.handleAccept()),
      vscode.commands.registerCommand('forgetrail.review.reject', () => this.handleReject()),
      vscode.commands.registerCommand('forgetrail.review.show', () => this.showActiveDiff())
    );
  }

  public async present(request: ReviewRequest): Promise<ReviewDecision> {
    return new Promise<ReviewDecision>((resolve) => {
      this.queue.push({ request, resolve });
      if (!this.activePending) {
        this.processNextInQueue();
      }
    });
  }

  private async processNextInQueue(): Promise<void> {
    if (this.queue.length === 0) {
      this.activePending = undefined;
      return;
    }

    const next = this.queue.shift()!;
    const request = next.request;

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    let leftUri: vscode.Uri;
    let currentText = '';
    let baseDoc: vscode.TextDocument | undefined;

    if (request.kind === 'create') {
      leftUri = vscode.Uri.from({ scheme: EMPTY_SCHEME, path: '/empty' });
      // If file already exists, load current text
      if (workspaceFolder) {
        const targetUri = vscode.Uri.joinPath(workspaceFolder.uri, request.path);
        try {
          const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === targetUri.fsPath);
          if (doc) {
            currentText = doc.getText();
            baseDoc = doc;
          } else {
            const bytes = await vscode.workspace.fs.readFile(targetUri);
            currentText = new TextDecoder('utf-8').decode(bytes);
          }
        } catch {
          currentText = '';
        }
      }
    } else {
      leftUri = workspaceFolder
        ? vscode.Uri.joinPath(workspaceFolder.uri, request.path)
        : vscode.Uri.file(request.path);

      try {
        const doc = vscode.workspace.textDocuments.find(d => d.uri.fsPath === leftUri.fsPath);
        if (doc) {
          currentText = doc.getText();
          baseDoc = doc;
        } else {
          const bytes = await vscode.workspace.fs.readFile(leftUri);
          currentText = new TextDecoder('utf-8').decode(bytes);
        }
      } catch {
        currentText = '';
      }
    }

    const proposedText = computeProposedText(currentText, request);
    const sanitizedPath = request.path.replace(/^\/+/, '');
    const rightUri = vscode.Uri.from({
      scheme: PROPOSED_SCHEME,
      path: `/${sanitizedPath}`,
      query: `runId=${encodeURIComponent(request.runId)}&id=${encodeURIComponent(request.id)}`,
    });

    this.docProvider.setProposedContent(rightUri, proposedText, request.runId);

    const title = `ForgeTrail [${request.index}/${request.total}] ${request.path}`;

    this.activePending = {
      request,
      leftUri,
      rightUri,
      title,
      resolve: next.resolve,
      baseDoc,
    };

    await this.openDiffEditor(this.activePending);
  }

  private async openDiffEditor(pending: PendingReview): Promise<void> {
    const { leftUri, rightUri, title, request } = pending;

    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, {
      preview: true,
      preserveFocus: false,
    });

    // Reveal hunk range and apply why decoration on the proposed side (right side)
    const line0Based = Math.max(0, request.startLine - 1);
    const endLine0Based = Math.max(line0Based, request.endLine - 1);

    setTimeout(() => {
      const editor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.scheme === PROPOSED_SCHEME && e.document.uri.path === rightUri.path
      );

      if (editor) {
        const range = new vscode.Range(line0Based, 0, endLine0Based, 0);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        applyWhyDecoration(editor, line0Based, request.reason, request.sources);
      }
    }, 100);
  }

  public async showActiveDiff(): Promise<void> {
    if (this.activePending) {
      await this.openDiffEditor(this.activePending);
    }
  }

  private async handleAccept(): Promise<void> {
    if (!this.activePending) {
      return;
    }

    const { request, resolve, baseDoc } = this.activePending;

    // Staleness check (U-2 step 6)
    if (baseDoc && request.baseVersion !== undefined && baseDoc.version !== request.baseVersion) {
      showStaleSkipNotification(request.path);
      this.closeCurrentDiffTabs(request.runId);
      this.activePending = undefined;
      resolve({
        id: request.id,
        decision: 'reject',
        feedback: D_STALE(request.path),
      });
      this.processNextInQueue();
      return;
    }

    this.closeCurrentDiffTabs(request.runId);
    this.activePending = undefined;
    resolve({
      id: request.id,
      decision: 'accept',
    });
    this.processNextInQueue();
  }

  private async handleReject(): Promise<void> {
    if (!this.activePending) {
      return;
    }

    const { request, resolve } = this.activePending;

    const feedback = await vscode.window.showInputBox({
      prompt: 'Why? (optional — sent to the agent)',
      placeHolder: 'Reason for rejection',
      ignoreFocusOut: true,
    });

    this.closeCurrentDiffTabs(request.runId);
    this.activePending = undefined;
    resolve({
      id: request.id,
      decision: 'reject',
      feedback: feedback && feedback.trim() ? feedback.trim() : undefined,
    });
    this.processNextInQueue();
  }

  private closeCurrentDiffTabs(runId: string): void {
    clearWhyDecorations();

    const tabGroups = vscode.window.tabGroups?.all;
    if (tabGroups) {
      for (const group of tabGroups) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (input && typeof input === 'object' && 'modified' in input) {
            const modifiedUri = (input as { modified?: vscode.Uri }).modified;
            if (modifiedUri && modifiedUri.scheme === PROPOSED_SCHEME) {
              vscode.window.tabGroups.close(tab);
            }
          }
        }
      }
    }
    this.docProvider.disposeRun(runId);
  }

  public dispose(runId: string): void {
    // Reject any pending or queued requests belonging to this run
    if (this.activePending && this.activePending.request.runId === runId) {
      const { request, resolve } = this.activePending;
      this.activePending = undefined;
      resolve({
        id: request.id,
        decision: 'reject',
        feedback: 'Run was cancelled or disposed.',
      });
    }

    const remainingQueue: typeof this.queue = [];
    for (const item of this.queue) {
      if (item.request.runId === runId) {
        item.resolve({
          id: item.request.id,
          decision: 'reject',
          feedback: 'Run was cancelled or disposed.',
        });
      } else {
        remainingQueue.push(item);
      }
    }
    this.queue = remainingQueue;

    this.closeCurrentDiffTabs(runId);
  }

  public destroy(): void {
    clearWhyDecorations();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

