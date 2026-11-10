import * as path from 'path';
import * as fs from 'fs';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';
import { executeRun, setReviewPresenter } from '../src/trueforge/runController';
import { undoStore } from '../src/apply/undoStore';
import { ReviewRequest, ReviewDecision, ReviewPresenter, RunRequest } from '../src/shared/contracts';
import { execSync } from 'child_process';

const flaskDir = path.resolve(process.cwd(), 'dev/forge-spike/flask');
const relFilePath = 'src/flask/helpers.py';
const absFilePath = path.join(flaskDir, relFilePath);

class AutoAcceptPresenter implements ReviewPresenter {
  async present(request: ReviewRequest): Promise<ReviewDecision> {
    console.log(`[ReviewPresenter] Received proposal for ${request.path} (lines ${request.startLine}-${request.endLine}):`);
    console.log(`  Reason: ${request.reason}`);
    console.log(`  Old text: ${JSON.stringify(request.oldText)}`);
    console.log(`  New text: ${JSON.stringify(request.newText)}`);
    console.log(`  Decision -> ACCEPT`);
    return {
      id: request.id,
      decision: 'accept'
    };
  }
  dispose(_runId: string): void {}
}

async function runTaskAIteration(iteration: number): Promise<{ success: boolean; durationMs: number; retries: number; error?: string }> {
  console.log(`\n========================================`);
  console.log(`Starting Task A - Iteration ${iteration}`);
  console.log(`========================================`);

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    if (attempts > 1) {
      console.log(`Retry attempt ${attempts} for iteration ${iteration} after transient backoff...`);
      await new Promise((r) => setTimeout(r, 2000));
    }

    // 1. Reset Flask to clean state
    execSync('npm run reset:flask', { stdio: 'inherit' });

    // 2. Read selection region
    const content = fs.readFileSync(absFilePath, 'utf8');
    const lines = content.split('\n');
    const startLine = 28;
    const endLine = 34;
    const selectedText = lines.slice(startLine - 1, endLine).join('\n');

    const request: RunRequest = {
      kind: 'inline',
      instruction: "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.",
      workspaceRoot: flaskDir,
      selection: {
        path: relFilePath,
        startLine,
        endLine,
        text: selectedText
      }
    };

    runContext.setWorkspaceRoot(flaskDir);

    const startTime = Date.now();
    const runResult = await executeRun('forgetrail-inline-primary', request);
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

    // 3. Verify with npm run verify:a
    console.log('Verifying Task A with npm run verify:a...');
    try {
      execSync('npm run verify:a', { stdio: 'inherit' });
    } catch (err: any) {
      return { success: false, durationMs, retries: attempts - 1, error: `Verification failed: ${err.message}` };
    }

    // 4. Test Undo (undoRun reverts all hunks of this run)
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
  // Ensure MCP server is listening
  let startedMcp = false;
  try {
    const health = await fetch('http://127.0.0.1:3333/health').catch(() => null);
    if (!health || !health.ok) {
      runContext.setWorkspaceRoot(flaskDir);
      await startMcpServer(3333, '127.0.0.1');
      startedMcp = true;
    }
  } catch {}

  setReviewPresenter(new AutoAcceptPresenter());

  const results: { iteration: number; success: boolean; durationMs: number; retries: number; error?: string }[] = [];

  for (let i = 1; i <= 3; i++) {
    const res = await runTaskAIteration(i);
    results.push({ iteration: i, ...res });
    if (!res.success) {
      console.error(`Task A failed at iteration ${i}: ${res.error}`);
      break;
    }
    if (i < 3) {
      console.log('Waiting 1s before next iteration...');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (startedMcp) {
    await stopMcpServer().catch(() => {});
  }

  console.log('\n========================================');
  console.log('Task A Acceptance Summary (3 Consecutive Runs):');
  console.log('========================================');
  for (const r of results) {
    console.log(`Iteration ${r.iteration}: ${r.success ? 'PASS' : 'FAIL'} (${(r.durationMs / 1000).toFixed(2)}s, retries: ${r.retries}) ${r.error ?? ''}`);
  }

  const allPassed = results.length === 3 && results.every(r => r.success);
  if (allPassed) {
    console.log('\nALL 3 ITERATIONS PASSED! Milestone M1 Acceptance Achieved.');
    process.exit(0);
  } else {
    console.error('\nAcceptance check did not pass 3 consecutive runs.');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
