import { ReviewDecision, ReviewPresenter, ReviewRequest } from '../shared/contracts';

/**
 * Manages sequential presentation of ReviewRequests for a single run.
 */
export class ReviewQueue {
  private queue: ReviewRequest[] = [];
  private processing = false;
  private presenter: ReviewPresenter;

  constructor(presenter: ReviewPresenter) {
    this.presenter = presenter;
  }

  public setPresenter(presenter: ReviewPresenter): void {
    this.presenter = presenter;
  }

  public enqueue(request: ReviewRequest): Promise<ReviewDecision> {
    return new Promise((resolve, reject) => {
      this.queue.push(request);
      this.processNext(resolve, reject);
    });
  }

  private async processNext(
    resolve: (val: ReviewDecision) => void,
    reject: (err: any) => void
  ): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    const req = this.queue.shift()!;
    try {
      const decision = await this.presenter.present(req);
      resolve(decision);
    } catch (err) {
      reject(err);
    } finally {
      this.processing = false;
    }
  }

  public clear(runId: string): void {
    this.queue = [];
    this.processing = false;
    this.presenter.dispose(runId);
  }
}
