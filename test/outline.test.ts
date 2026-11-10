import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { extractKeywords } from '../src/context/keywords';
import { buildRepoOutline } from '../src/context/outline';
import { executeRepoOutline } from '../src/mcp/tools/repoOutline';
import { resetBudget } from '../src/mcp/budget';
import { OUTLINE_MAX_TOKENS } from '../src/shared/limits';

test('keywords: extracts tokens, drops stopwords, deduplicates', () => {
  const query = 'Please update the CLI command config in flask and make sure it works with python';
  const kws = extractKeywords(query);

  // 'please', 'update', 'the', 'and', 'make', 'with' are stopwords
  // 'it' < 3 chars
  assert.ok(kws.includes('cli'), 'cli included');
  assert.ok(kws.includes('command'), 'command included');
  assert.ok(kws.includes('config'), 'config included');
  assert.ok(kws.includes('flask'), 'flask included');
  assert.ok(kws.includes('python'), 'python included');
  assert.ok(!kws.includes('the'), 'the excluded');
  assert.ok(!kws.includes('update'), 'update excluded');
  assert.ok(!kws.includes('it'), 'it (<3 chars) excluded');
});

test('outline: buildRepoOutline extracts symbols on TypeScript files', () => {
  const root = path.resolve(__dirname, '..');
  const res = buildRepoOutline('budget tokens estimate', root, 1000, 'src/mcp');

  assert.ok(res.outlines.length > 0, 'Finds files in src/mcp');
  const budgetFile = res.outlines.find((o) => o.path.includes('budget.ts'));
  assert.ok(budgetFile, 'Found budget.ts in outline');
  assert.ok(budgetFile!.score > 0, 'budget.ts has positive score');
  assert.ok(res.tokens <= 1000, 'Tokens within budget limit');
});

test('outline: ranks src/flask/cli.py first on Flask repo for cli command config', () => {
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const res = buildRepoOutline('cli command config', flaskRoot, OUTLINE_MAX_TOKENS);

  assert.ok(res.outlines.length > 0, 'Found outlines in flask repo');
  const topFile = res.outlines[0];
  assert.equal(
    topFile.path.replace(/\\/g, '/'),
    'src/flask/cli.py',
    `Expected top file to be src/flask/cli.py, got ${topFile.path}`
  );
  assert.ok(topFile.score >= 10, `Expected high score for cli.py, got ${topFile.score}`);
  assert.ok(res.tokens <= OUTLINE_MAX_TOKENS, `Tokens (${res.tokens}) must be <= ${OUTLINE_MAX_TOKENS}`);
  assert.ok(res.formattedText.includes('## src/flask/cli.py'), 'Formatted text has cli.py header');
});

test('outline: executeRepoOutline formats header and tracks budget', async () => {
  resetBudget();
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const result = await executeRepoOutline({ query: 'cli command' }, flaskRoot);

  assert.ok(result.startsWith('[repo_outline | ~'), 'Header starts with [repo_outline | ~');
  assert.ok(result.includes('budget left'), 'Header includes budget left');
  assert.ok(result.includes('## src/flask/cli.py'), 'Includes scored outline for cli.py');
});
