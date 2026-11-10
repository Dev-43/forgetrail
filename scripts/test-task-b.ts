import * as path from 'path';
import * as fs from 'fs';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';
import { executeRun, setReviewPresenter } from '../src/trueforge/runController';
import { undoStore } from '../src/apply/undoStore';
import { ReviewRequest, ReviewDecision, ReviewPresenter, RunRequest } from '../src/shared/contracts';
import { execSync } from 'child_process';

const flaskDir = path.resolve(process.cwd(), 'dev/forge-spike/flask');

class AutoAcceptPresenter implements ReviewPresenter {
  async present(request: ReviewRequest): Promise<ReviewDecision> {
    console.log(`[ReviewPresenter] Received proposal for ${request.path} (lines ${request.startLine}-${request.endLine}):`);
    console.log(`  Reason: ${request.reason}`);
    console.log(`  Old text: ${JSON.stringify(request.oldText.slice(0, 80))}`);
    console.log(`  New text: ${JSON.stringify(request.newText.slice(0, 80))}`);
    console.log(`  Decision -> ACCEPT`);
    return {
      id: request.id,
      decision: 'accept',
    };
  }
  dispose(_runId: string): void {}
}

async function runTaskBIteration(
  iteration: number
): Promise<{ success: boolean; durationMs: number; retries: number; error?: string }> {
  console.log(`\n========================================`);
  console.log(`Starting Task B - Iteration ${iteration}`);
  console.log(`========================================`);

  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    attempts++;
    if (attempts > 1) {
      console.log(`Retry attempt ${attempts} for iteration ${iteration} after backoff...`);
      await new Promise((r) => setTimeout(r, 3000));
    }

    // 1. Reset Flask to clean state
    execSync('npm run reset:flask', { stdio: 'inherit' });

    // 2. Prepare Task B instruction (exact wording from C-17 / prompt)
    const request: RunRequest = {
      kind: 'agent',
      instruction:
        'Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test in tests/test_cli.py, and be documented alongside the other built-in commands.',
      workspaceRoot: flaskDir,
    };

    runContext.setWorkspaceRoot(flaskDir);

    const startTime = Date.now();
    const runResult = await executeRun('forgetrail-agent-primary', request);
    const durationMs = Date.now() - startTime;

    console.log(`Run completed in ${durationMs}ms with status: ${runResult.status}`);
    if (runResult.status !== 'done') {
      console.warn(`Run error: ${runResult.message}`);
      if (
        attempts < maxAttempts &&
        (runResult.message.includes('503') ||
          runResult.message.includes('429') ||
          runResult.message.includes('high demand') ||
          runResult.message.includes('Headers Timeout') ||
          runResult.message.includes('timeout') ||
          runResult.message.includes('fetch failed'))
      ) {
        continue;
      }
      return { success: false, durationMs, retries: attempts - 1, error: `Run failed: ${runResult.message}` };
    }

    // 3. Verify with npm run verify:b
    console.log('Verifying Task B with npm run verify:b...');
    try {
      execSync('npm run verify:b', { stdio: 'inherit' });
    } catch (err: any) {
      console.log(`Verify:b failed: ${err.message}`);
      return { success: false, durationMs, retries: attempts - 1, error: `Verification failed: ${err.message}` };
    }

    // 4. Test Undo (undoRun rolls back all changes)
    console.log('Testing undoRun to restore clean state...');
    const undoResult = await undoStore.undoRun(undefined, flaskDir);
    console.log(`undoRun result: ${undoResult.message}`);
    if (!undoResult.success) {
      return { success: false, durationMs, retries: attempts - 1, error: `UndoRun failed: ${undoResult.message}` };
    }

    // 5. Verify workspace is clean
    try {
      execSync('npm run verify:c', { stdio: 'inherit' });
    } catch (err: any) {
      return { success: false, durationMs, retries: attempts - 1, error: `Workspace not clean after undo: ${err.message}` };
    }

    console.log(`PASS Iteration ${iteration} completed successfully in ${durationMs}ms (retries: ${attempts - 1})`);
    return { success: true, durationMs, retries: attempts - 1 };
  }

  return { success: false, durationMs: 0, retries: maxAttempts - 1, error: 'Max attempts reached' };
}

async function main() {
  let startedMcp = false;
  try {
    const health = await fetch('http://127.0.0.1:3333/health').catch(() => null);
    if (!health || !health.ok) {
      console.log('Starting local MCP server on 127.0.0.1:3333...');
      runContext.setWorkspaceRoot(flaskDir);
      await startMcpServer(3333, '127.0.0.1');
      startedMcp = true;
    }
  } catch (err) {
    console.log('Starting local MCP server...');
    runContext.setWorkspaceRoot(flaskDir);
    await startMcpServer(3333, '127.0.0.1');
    startedMcp = true;
  }

  setReviewPresenter(new AutoAcceptPresenter());

  const results: Array<{ iteration: number; success: boolean; durationMs: number; retries: number; error?: string }> = [];

  for (let i = 1; i <= 3; i++) {
    const res = await runTaskBIteration(i);
    results.push({ iteration: i, ...res });
    const passCount = results.filter((r) => r.success).length;
    if (passCount >= 2 && i >= 2) {
      console.log(`\nMilestone M2 requirement satisfied: ${passCount} of ${i} consecutive runs passed!`);
      break;
    }
  }

  if (startedMcp) {
    await stopMcpServer().catch(() => {});
  }

  console.log('\n========================================');
  console.log('Task B Acceptance Summary:');
  console.log('========================================');
  for (const r of results) {
    console.log(`Iteration ${r.iteration}: ${r.success ? 'PASS' : 'FAIL'} (${(r.durationMs / 1000).toFixed(2)}s, retries: ${r.retries})${r.error ? ` - ${r.error}` : ''}`);
  }

  const passed = results.filter((r) => r.success).length;
  if (passed >= 2) {
    console.log(`\nOVERALL: PASS (${passed} of ${results.length} iterations succeeded)`);
    process.exit(0);
  } else {
    console.error(`\nOVERALL: FAIL (${passed} of ${results.length} iterations succeeded, minimum 2 required)`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error in Task B test runner:', err);
  process.exit(1);
});
