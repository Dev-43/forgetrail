import { ReviewDecision, ReviewPresenter, ReviewRequest } from '../shared/contracts';

function getVscode(): any {
  try {
    return require('vscode');
  } catch {
    return null;
  }
}

/**
 * Minimal modal presenter for M1.
 * Shows a modal dialog with path, line range, reason, and preview text.
 * Provides fallback for headless and test environments.
 */
export class ModalReviewPresenter implements ReviewPresenter {
  public async present(request: ReviewRequest): Promise<ReviewDecision> {
    const vscode = getVscode();

    if (vscode && vscode.window && vscode.window.showWarningMessage) {
      const oldPreview = request.oldText.split('\n').slice(0, 20).join('\n');
      const newPreview = request.newText.split('\n').slice(0, 20).join('\n');
      const detail = `Reason: ${request.reason}\n\n--- OLD TEXT ---\n${oldPreview}\n\n--- NEW TEXT ---\n${newPreview}`;

      const choice = await vscode.window.showWarningMessage(
        `ForgeTrail Review [${request.index}/${request.total}] ${request.path} (lines ${request.startLine}-${request.endLine})`,
        { modal: true, detail },
        'Accept',
        'Reject'
      );

      const decision: 'accept' | 'reject' = choice === 'Accept' ? 'accept' : 'reject';
      return {
        id: request.id,
        decision,
        feedback: '',
      };
    }

    // Default auto-accept in headless test environment
    return {
      id: request.id,
      decision: 'accept',
      feedback: '',
    };
  }

  public dispose(_runId: string): void {
    // No-op for modal presenter
  }
}

export const modalReviewPresenter = new ModalReviewPresenter();
