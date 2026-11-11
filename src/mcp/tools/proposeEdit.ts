import { ReviewRequest } from '../../shared/contracts';
import { runContext } from '../runContext';
import { applyHunk } from '../../apply/applyEdit';

export interface ProposeEditParams {
  path: string;
  old_text: string;
  new_text: string;
  reason: string;
  sources?: string[];
}

/**
 * MCP Tool: propose_edit (core connector)
 * Executed by TrueForge harness AFTER user/harness approval.
 * Performs cancel check, re-validates, records undo snapshot, and applies change atomically.
 */
export async function executeProposeEdit(
  params: ProposeEditParams,
  toolCallId = `call_${Date.now()}`
): Promise<string> {
  const request: ReviewRequest = {
    id: toolCallId,
    runId: runContext.activeRunId ?? 'unknown',
    threadId: 'main',
    path: params.path,
    kind: params.old_text ? 'replace' : 'create',
    oldText: params.old_text,
    newText: params.new_text,
    startLine: 1,
    endLine: 1,
    reason: params.reason || '(no reason given)',
    sources: params.sources ?? [],
    index: 1,
    total: 1,
    baseVersion: 0,
  };

  return applyHunk(request, runContext.workspaceRoot);
}
