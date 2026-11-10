import * as vscode from 'vscode';
import { AgentEvent } from '../shared/contracts';

type EventListener = (event: AgentEvent) => void;
const listeners = new Set<EventListener>();

/**
 * Subscribes to C8 AgentEvents emitted by the runController.
 */
export function subscribe(listener: EventListener): vscode.Disposable {
  listeners.add(listener);
  return new vscode.Disposable(() => {
    listeners.delete(listener);
  });
}

/**
 * Internal event emitter to publish events to subscribers.
 */
export function emitEvent(event: AgentEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.error('Error in AgentEvent listener:', err);
    }
  }
}
