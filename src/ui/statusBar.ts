import * as vscode from 'vscode';
import { AgentEvent } from '../shared/contracts';
import { subscribe } from '../trueforge/runController';
import {
  S_CANCELLED,
  S_NO_FALLBACK,
  S_REVIEW,
  S_RUNNING,
  S_SWITCHED,
} from './notifications';

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private subscription: vscode.Disposable;
  private pendingReviewsCount = 0;
  private activeModel = '';
  private switchedMessage: string | null = null;
  private resetTimeout: NodeJS.Timeout | undefined;

  constructor() {
    this.item = vscode.window.createStatusBarItem(
      'forgetrail.status',
      vscode.StatusBarAlignment.Left,
      100
    );
    this.subscription = subscribe((event) => this.handleEvent(event));
  }

  private handleEvent(event: AgentEvent): void {
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
      this.resetTimeout = undefined;
    }

    switch (event.type) {
      case 'run.started':
        this.activeModel = event.agentName;
        this.switchedMessage = null;
        this.pendingReviewsCount = 0;
        this.item.command = 'forgetrail.cancelRun';
        this.item.text = `$(sync~spin) ${S_RUNNING(this.activeModel)}`;
        this.item.tooltip = 'ForgeTrail run in progress — click to cancel';
        this.item.show();
        break;

      case 'model.switched':
        this.switchedMessage = S_SWITCHED(event.from, event.to);
        this.activeModel = event.to;
        this.item.command = 'forgetrail.cancelRun';
        this.item.text = `$(arrow-swap) ${this.switchedMessage}`;
        this.item.tooltip = `Model switched from ${event.from} to ${event.to}: ${event.reason}`;
        this.item.show();
        break;

      case 'review.requested':
        this.pendingReviewsCount++;
        this.item.command = 'forgetrail.review.show';
        this.item.text = `$(git-pull-request) ${S_REVIEW(this.pendingReviewsCount)}`;
        this.item.tooltip = 'Click to show pending review diff';
        this.item.show();
        break;

      case 'review.resolved':
        if (this.pendingReviewsCount > 0) {
          this.pendingReviewsCount--;
        }
        if (this.pendingReviewsCount > 0) {
          this.item.command = 'forgetrail.review.show';
          this.item.text = `$(git-pull-request) ${S_REVIEW(this.pendingReviewsCount)}`;
        } else {
          this.item.command = 'forgetrail.cancelRun';
          if (this.switchedMessage) {
            this.item.text = `$(arrow-swap) ${this.switchedMessage}`;
          } else if (this.activeModel) {
            this.item.text = `$(sync~spin) ${S_RUNNING(this.activeModel)}`;
          } else {
            this.item.hide();
          }
        }
        break;

      case 'run.cancelled':
        this.pendingReviewsCount = 0;
        this.item.command = undefined;
        this.item.text = `$(circle-slash) ${S_CANCELLED(event.applied, event.discarded)}`;
        this.item.tooltip = 'Run was cancelled';
        this.item.show();
        this.resetTimeout = setTimeout(() => {
          this.resetToIdle();
        }, 3000);
        break;

      case 'run.finished':
        this.pendingReviewsCount = 0;
        this.item.command = undefined;
        this.item.text = `$(check) ForgeTrail: done (${event.applied} applied)`;
        this.item.tooltip = event.summary;
        this.item.show();
        this.resetTimeout = setTimeout(() => {
          this.resetToIdle();
        }, 3000);
        break;

      case 'run.error':
        this.pendingReviewsCount = 0;
        this.item.command = undefined;
        if (event.kind === 'no-fallback') {
          this.item.text = `$(error) ${S_NO_FALLBACK}`;
          this.item.tooltip = event.message;
          this.item.show();
          this.resetTimeout = setTimeout(() => {
            this.resetToIdle();
          }, 10000);
        } else {
          this.item.text = `$(error) ForgeTrail error: ${event.kind}`;
          this.item.tooltip = event.message;
          this.item.show();
          this.resetTimeout = setTimeout(() => {
            this.resetToIdle();
          }, 5000);
        }
        break;
    }
  }

  public setPendingCount(count: number): void {
    this.pendingReviewsCount = count;
    if (count > 0) {
      this.item.command = 'forgetrail.review.show';
      this.item.text = `$(git-pull-request) ${S_REVIEW(count)}`;
      this.item.tooltip = 'Click to show pending review diff';
      this.item.show();
    } else {
      this.resetToIdle();
    }
  }

  private resetToIdle(): void {
    this.activeModel = '';
    this.switchedMessage = null;
    this.pendingReviewsCount = 0;
    this.item.command = undefined;
    this.item.hide();
  }

  dispose(): void {
    if (this.resetTimeout) {
      clearTimeout(this.resetTimeout);
    }
    this.subscription.dispose();
    this.item.dispose();
  }
}

