import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { executeSuggestContext } from '../src/mcp/tools/suggestContext';
import { resetBudget } from '../src/mcp/budget';
import { SUGGEST_MAX_FILES } from '../src/shared/limits';

test('suggest_context: returns empty message if query is blank', async () => {
  resetBudget();
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const res = await executeSuggestContext({ task: '' }, flaskRoot);
  assert.ok(res.includes('No keywords extracted'), 'Reports no keywords');
});

test('suggest_context: Task B instruction ranks cli.py, test_cli.py, and docs/cli.rst in top results', async () => {
  resetBudget();
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const taskPrompt =
    'Implement a flask config CLI command that outputs JSON configuration with sensitive keys masked as ***. Add unit tests for the command in test_cli.py and update the cli documentation.';

  const res = await executeSuggestContext({ task: taskPrompt }, flaskRoot);

  assert.ok(res.startsWith('[suggest_context |'), 'Starts with standard suggest_context header');
  assert.ok(res.includes('budget left'), 'Displays remaining budget in header');

  // Verify file suggestions
  assert.ok(
    res.includes('src/flask/cli.py') || res.includes('src\\flask\\cli.py'),
    'Includes core CLI implementation file src/flask/cli.py'
  );
  assert.ok(
    res.includes('tests/test_cli.py') || res.includes('tests\\test_cli.py'),
    'Includes test suite file tests/test_cli.py'
  );
  assert.ok(
    res.includes('docs/cli.rst') || res.includes('docs\\cli.rst'),
    'Includes documentation file docs/cli.rst'
  );

  // Verify bounded to SUGGEST_MAX_FILES
  const itemLines = res.split('\n').filter((l) => l.startsWith('- '));
  assert.ok(itemLines.length <= SUGGEST_MAX_FILES, `Item count ${itemLines.length} <= ${SUGGEST_MAX_FILES}`);
  assert.ok(itemLines.length >= 3, `Expected at least 3 relevant files, got ${itemLines.length}`);

  // Verify reasons are populated
  for (const line of itemLines) {
    assert.ok(line.includes(': '), `Line should include reason description: ${line}`);
    assert.ok(line.includes('tokens'), `Line should include token estimate: ${line}`);
  }
});
