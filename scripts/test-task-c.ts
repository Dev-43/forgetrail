import * as path from 'path';
import { execSync } from 'child_process';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';
import { runWithFallback } from '../src/fallback/runWithFallback';
import { runController, setReviewPresenter } from '../src/trueforge/runController';
import { ReviewPresenter, ReviewRequest, ReviewDecision, RunRequest } from '../src/shared/contracts';

const flaskDir = path.resolve(process.cwd(), 'dev/forge-spike/flask');

class AutoRejectPresenter implements ReviewPresenter {
  public presentedCount = 0;
  async present(request: ReviewRequest): Promise<ReviewDecision> {
    this.presentedCount++;
    console.log(`[ReviewPresenter] Received proposal for ${request.path} (lines ${request.startLine}-${request.endLine})`);
    console.log(`  Decision -> REJECT (verifying clean workspace)`);
    return {
      id: request.id,
      decision: 'reject',
      feedback: 'Task C rejection test',
    };
  }
  dispose(_runId: string): void {}
}

async function runTaskCCase1(): Promise<boolean> {
  console.log('\n========================================');
  console.log('Task C - Case 1: --break-primary (fallback enabled)');
  console.log('========================================');

  // 1. Reset Flask and setup with break-primary
  execSync('npm run reset:flask', { stdio: 'inherit' });
  execSync('npm run setup -- --break-primary', { stdio: 'inherit' });

  let switchedModel = false;
  const unsub = runController.subscribe((ev) => {
    if (ev.type === 'model.switched') {
      console.log(`[Event] Model switched: ${ev.from} -> ${ev.to} (${ev.reason})`);
      switchedModel = true;
    }
  });

  const presenter = new AutoRejectPresenter();
  setReviewPresenter(presenter);

  const request: RunRequest = {
    kind: 'inline',
    instruction: "Treat 'off' and 'n' as false, and update docstring.",
    workspaceRoot: flaskDir,
    selection: {
      path: 'src/flask/helpers.py',
      startLine: 28,
      endLine: 33,
      text: "    value = os.environ.get(FLASK_DEBUG, None)\r\n\r\n    if not value:\r\n        return False\r\n\r\n    return value.lower() not in {\"0\", \"false\", \"no\"}",
    },
  };

  const startTime = Date.now();
  const result = await runWithFallback(request);
  const duration = Date.now() - startTime;
  unsub.dispose();

  console.log(`Case 1 finished in ${duration}ms with status: ${result.status}`);

  // Verify workspace is completely clean
  try {
    execSync('npm run verify:c', { stdio: 'inherit' });
    console.log('PASS Case 1: workspace unchanged');
  } catch (err: any) {
    console.error(`FAIL Case 1: workspace was modified: ${err.message}`);
    return false;
  }

  return true;
}

async function runTaskCCase2(): Promise<boolean> {
  console.log('\n========================================');
  console.log('Task C - Case 2: --break-primary --no-fallback');
  console.log('========================================');

  // 1. Reset Flask and setup with break-primary and no-fallback
  execSync('npm run reset:flask', { stdio: 'inherit' });
  execSync('npm run setup -- --break-primary --no-fallback', { stdio: 'inherit' });

  const request: RunRequest = {
    kind: 'inline',
    instruction: "Treat 'off' and 'n' as false, and update docstring.",
    workspaceRoot: flaskDir,
    selection: {
      path: 'src/flask/helpers.py',
      startLine: 28,
      endLine: 33,
      text: "    value = os.environ.get(FLASK_DEBUG, None)\r\n\r\n    if not value:\r\n        return False\r\n\r\n    return value.lower() not in {\"0\", \"false\", \"no\"}",
    },
  };

  const startTime = Date.now();
  const result = await runWithFallback(request);
  const duration = Date.now() - startTime;

  console.log(`Case 2 finished in ${duration}ms with status: ${result.status}, errorKind: ${result.errorKind}`);

  if (result.status !== 'error' || result.errorKind !== 'no-fallback') {
    console.error(`FAIL Case 2: expected error kind no-fallback, got: ${result.status} / ${result.errorKind}`);
    return false;
  }

  if (duration > 15000) {
    console.error(`FAIL Case 2: took ${duration}ms (expected under 15s)`);
    return false;
  }

  // Verify workspace is completely clean
  try {
    execSync('npm run verify:c', { stdio: 'inherit' });
    console.log('PASS Case 2: workspace unchanged');
  } catch (err: any) {
    console.error(`FAIL Case 2: workspace was modified: ${err.message}`);
    return false;
  }

  return true;
}

async function main() {
  console.log('Starting Milestone M3 Task C Verification Runner...');

  // Start local MCP server
  let startedMcp = false;
  try {
    const health = await fetch('http://127.0.0.1:3333/health').catch(() => null);
    if (!health || !health.ok) {
      runContext.setWorkspaceRoot(flaskDir);
      await startMcpServer(3333, '127.0.0.1');
      startedMcp = true;
    }
  } catch {
    runContext.setWorkspaceRoot(flaskDir);
    await startMcpServer(3333, '127.0.0.1');
    startedMcp = true;
  }

  let case1Passed = false;
  let case2Passed = false;

  try {
    case1Passed = await runTaskCCase1();
    case2Passed = await runTaskCCase2();
  } finally {
    // Restore primary configuration
    console.log('\nRestoring primary provider configuration...');
    try {
      execSync('npm run setup -- --restore', { stdio: 'inherit' });
    } catch (err: any) {
      console.warn(`Warning during restore: ${err.message}`);
    }

    if (startedMcp) {
      await stopMcpServer().catch(() => {});
    }
  }

  console.log('\n========================================');
  console.log('Task C Verification Summary:');
  console.log('========================================');
  console.log(`Case 1 (--break-primary fallback): ${case1Passed ? 'PASS' : 'FAIL'}`);
  console.log(`Case 2 (--no-fallback clean exit): ${case2Passed ? 'PASS' : 'FAIL'}`);

  if (case1Passed && case2Passed) {
    console.log('\nOVERALL TASK C: PASS');
    process.exit(0);
  } else {
    console.log('\nOVERALL TASK C: FAIL');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('test-task-c')) {
  main().catch(console.error);
}

export { runTaskCCase1, runTaskCCase2 };
