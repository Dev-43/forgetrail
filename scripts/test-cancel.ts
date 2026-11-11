import * as path from 'path';
import { execSync } from 'child_process';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';
import { runController, cancelRun, setReviewPresenter, getRunState } from '../src/trueforge/runController';
import { ReviewPresenter, ReviewRequest, ReviewDecision, RunRequest } from '../src/shared/contracts';

const flaskDir = path.resolve(process.cwd(), 'dev/forge-spike/flask');

class HangingReviewPresenter implements ReviewPresenter {
  public receivedReview = false;
  async present(request: ReviewRequest): Promise<ReviewDecision> {
    this.receivedReview = true;
    console.log(`[ReviewPresenter] Diff review opened for ${request.path} (waiting for user)...`);
    // Hang until cancelled by test
    return new Promise(() => {});
  }
  dispose(_runId: string): void {
    console.log('[ReviewPresenter] Active review tabs disposed cleanly on cancel.');
  }
}

async function testCancelDuringReview(): Promise<boolean> {
  console.log('\n========================================');
  console.log('Testing Cancel During Open Review (C-19 / C-23)');
  console.log('========================================');

  execSync('npm run reset:flask', { stdio: 'inherit' });

  const presenter = new HangingReviewPresenter();
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

  let cancelEventEmitted = false;
  const unsub = runController.subscribe((ev) => {
    if (ev.type === 'run.cancelled') {
      console.log(`[Event] run.cancelled: ${ev.applied} applied, ${ev.discarded} discarded`);
      cancelEventEmitted = true;
    }
  });

  // Launch run in background promise
  const runPromise = runController.executeRun('forgetrail-inline-primary', request);

  // Poll until review presenter is reached or timeout
  const startWait = Date.now();
  while (!presenter.receivedReview && Date.now() - startWait < 30000) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // Trigger cancel
  console.log('Triggering cancelRun()...');
  const cancelStart = Date.now();
  await cancelRun();
  const cancelDuration = Date.now() - cancelStart;

  console.log(`cancelRun() executed in ${cancelDuration}ms`);

  const runResult = await runPromise;
  unsub.dispose();

  console.log(`Run completed with status: ${runResult.status}`);

  // Check 1: cancel duration < 1000ms
  if (cancelDuration > 1000) {
    console.error(`FAIL: cancel took ${cancelDuration}ms (> 1000ms limit)`);
    return false;
  }

  // Check 2: state returned to idle
  if (getRunState() !== 'idle') {
    console.error(`FAIL: runState is not idle after cancel (${getRunState()})`);
    return false;
  }

  // Check 3: workspace unchanged
  try {
    execSync('npm run verify:c', { stdio: 'inherit' });
    console.log('PASS: workspace clean after cancel');
  } catch (err: any) {
    console.error(`FAIL: workspace modified after cancel: ${err.message}`);
    return false;
  }

  return true;
}

async function main() {
  console.log('Starting Cancel Verification Harness...');

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

  let passed = false;
  try {
    passed = await testCancelDuringReview();
  } finally {
    if (startedMcp) {
      await stopMcpServer().catch(() => {});
    }
  }

  console.log('\n========================================');
  console.log(`Cancel Verification Summary: ${passed ? 'PASS' : 'FAIL'}`);
  console.log('========================================');
  process.exit(passed ? 0 : 1);
}

if (process.argv[1] && process.argv[1].includes('test-cancel')) {
  main().catch(console.error);
}

export { testCancelDuringReview };
