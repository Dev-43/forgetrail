import * as vscode from 'vscode';

export const PROPOSED_SCHEME = 'forgetrail-proposed';
export const EMPTY_SCHEME = 'forgetrail-empty';

/**
 * Serves virtual document contents for diffing proposed changes.
 * Handles both the proposed modified file (PROPOSED_SCHEME) and
 * an empty document representation for newly created files (EMPTY_SCHEME).
 */
export class ProposedDocProvider implements vscode.TextDocumentContentProvider {
  private _onDidChange = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

  // Key: uri.toString() -> string content
  private documents = new Map<string, string>();
  // Key: runId -> Set of uri strings
  private runDocuments = new Map<string, Set<string>>();

  provideTextDocumentContent(uri: vscode.Uri): string {
    if (uri.scheme === EMPTY_SCHEME) {
      return '';
    }
    return this.documents.get(uri.toString()) ?? '';
  }

  setProposedContent(uri: vscode.Uri, content: string, runId: string): void {
    const key = uri.toString();
    this.documents.set(key, content);

    let runSet = this.runDocuments.get(runId);
    if (!runSet) {
      runSet = new Set<string>();
      this.runDocuments.set(runId, runSet);
    }
    runSet.add(key);

    this._onDidChange.fire(uri);
  }

  getProposedContent(uri: vscode.Uri): string | undefined {
    return this.documents.get(uri.toString());
  }

  deleteProposedContent(uri: vscode.Uri): void {
    const key = uri.toString();
    this.documents.delete(key);
    this._onDidChange.fire(uri);
  }

  disposeRun(runId: string): void {
    const runSet = this.runDocuments.get(runId);
    if (runSet) {
      for (const uriStr of runSet) {
        this.documents.delete(uriStr);
        try {
          this._onDidChange.fire(vscode.Uri.parse(uriStr));
        } catch {
          // ignore parsing error during disposal
        }
      }
      this.runDocuments.delete(runId);
    }
  }

  dispose(): void {
    this.documents.clear();
    this.runDocuments.clear();
    this._onDidChange.dispose();
  }
}
