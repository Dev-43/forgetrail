import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { estimateTokens, recordRetrievalTokens, getBudgetStatus, resetBudget } from '../src/mcp/budget';
import { runContext } from '../src/mcp/runContext';
import { executeReadFile } from '../src/mcp/tools/readFile';
import { RUN_RETRIEVAL_MAX_TOKENS } from '../src/shared/limits';
import { E_BUDGET, AgentEvent } from '../src/shared/contracts';
import { subscribe } from '../src/trueforge/runController';

const workspaceRoot = path.resolve(__dirname, '..');

test('budget: estimateTokens calculates ceil(chars/4)', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(estimateTokens('123456789'), 3);
});

test('budget: tracks consumption and remaining tokens', () => {
  resetBudget();
  assert.equal(getBudgetStatus().used, 0);
  assert.equal(getBudgetStatus().remaining, RUN_RETRIEVAL_MAX_TOKENS);
  assert.equal(getBudgetStatus().exhausted, false);

  const s1 = recordRetrievalTokens(1000);
  assert.equal(s1.used, 1000);
  assert.equal(s1.remaining, RUN_RETRIEVAL_MAX_TOKENS - 1000);
  assert.equal(s1.exhausted, false);

  const s2 = recordRetrievalTokens(5000);
  assert.equal(s2.used, 6000);
  assert.equal(s2.remaining, 6000);
  assert.equal(s2.exhausted, false);

  resetBudget();
  assert.equal(getBudgetStatus().used, 0);
});

test('budget: triggers exhaustion and E_BUDGET cutoff', async () => {
  resetBudget();
  runContext.setWorkspaceRoot(workspaceRoot);

  // Consume near limit
  recordRetrievalTokens(RUN_RETRIEVAL_MAX_TOKENS - 10);
  assert.equal(getBudgetStatus().exhausted, false);

  // Now read a file that requires more than 10 tokens
  const output = await executeReadFile({ path: 'package.json' }, workspaceRoot);
  assert.match(output, /ERROR BUDGET_EXHAUSTED/);
  assert.equal(getBudgetStatus().exhausted, true);
});

test('budget: emits budget.update event during active run', () => {
  resetBudget();
  const runId = 'test-budget-run-123';
  runContext.startRun(runId, workspaceRoot);

  const emittedEvents: AgentEvent[] = [];
  const sub = subscribe((evt) => {
    if (evt.type === 'budget.update') {
      emittedEvents.push(evt);
    }
  });

  recordRetrievalTokens(500);

  sub.dispose();
  runContext.reset();

  assert.equal(emittedEvents.length, 1);
  assert.equal(emittedEvents[0].type, 'budget.update');
  if (emittedEvents[0].type === 'budget.update') {
    assert.equal(emittedEvents[0].runId, runId);
    assert.equal(emittedEvents[0].used, 500);
    assert.equal(emittedEvents[0].max, RUN_RETRIEVAL_MAX_TOKENS);
  }
});
