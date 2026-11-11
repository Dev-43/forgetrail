import test from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import { resolveMentions } from '../src/context/mentions';

import { existsSync as flaskExists } from 'node:fs';
// Tests against the Flask 3.1.3 clone (git-ignored) are skipped when it is not present (see docs/flask-setup.md)
const NO_FLASK = !flaskExists(require('node:path').resolve(__dirname, '../dev/forge-spike/flask/src/flask')) && 'Flask 3.1.3 clone not found at dev/forge-spike/flask';

test('mentions: resolves @symbol:get_debug_flag with helpers.py line range', { skip: NO_FLASK }, () => {
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const instruction = 'Check the debug behavior in @symbol:get_debug_flag please';

  const res = resolveMentions(instruction, flaskRoot);

  assert.ok(res.attachedContextText.includes('ATTACHED CONTEXT:'), 'Includes ATTACHED CONTEXT heading');
  assert.equal(res.mentions.length, 1, 'Found 1 mention');

  const symMention = res.mentions[0];
  assert.equal(symMention.found, true, 'Mention marked found');
  assert.equal(symMention.type, 'symbol', 'Type is symbol');
  assert.equal(symMention.target, 'get_debug_flag', 'Target symbol matched');
  assert.equal(symMention.path, 'src/flask/helpers.py', 'Found in helpers.py');
  assert.equal(symMention.reason, 'mentioned by user', 'Reason is mentioned by user');
  assert.ok(symMention.lineRange, 'Has lineRange');
  assert.equal(symMention.lineRange!.start, 28, 'Starts at line 28');
  assert.ok(symMention.content!.includes('def get_debug_flag() -> bool:'), 'Contains function signature');
  assert.ok(symMention.content!.includes('return bool(val'), 'Contains function return');
  assert.ok(res.attachedContextText.includes('src/flask/helpers.py:28-'), 'Block contains file and range');
});

test('mentions: resolves @file:src/flask/cli.py with truncation and outline', { skip: NO_FLASK }, () => {
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const instruction = 'Inspect @file:src/flask/cli.py for CLI commands';

  const res = resolveMentions(instruction, flaskRoot);

  assert.equal(res.mentions.length, 1, 'Found 1 mention');
  const fileMention = res.mentions[0];
  assert.equal(fileMention.found, true, 'File mention found');
  assert.equal(fileMention.type, 'file', 'Type is file');
  assert.equal(fileMention.path, 'src/flask/cli.py', 'Path is src/flask/cli.py');
  assert.equal(fileMention.reason, 'mentioned by user', 'Reason is mentioned by user');
  assert.ok(fileMention.note!.includes('Truncated'), 'Note indicates truncation');
  assert.ok(res.attachedContextText.includes('Outline of symbols in this file:'), 'Includes symbol outline');
  assert.ok(res.attachedContextText.includes('L37: class NoAppException'), 'Outline includes early symbol');
  assert.equal(fileMention.lineRange!.start, 1, 'Starts at line 1');
  assert.equal(fileMention.lineRange!.end, 200, 'Truncated at 200 lines');
});

test('mentions: unknown symbol and file produce Mention not found notices', { skip: NO_FLASK }, () => {
  const flaskRoot = path.resolve(__dirname, '../dev/forge-spike/flask');
  const instruction = 'Check @file:src/flask/nonexistent.py and @symbol:fake_function_xyz';

  const res = resolveMentions(instruction, flaskRoot);

  assert.equal(res.mentions.length, 2, 'Found 2 mentions');
  const fileMention = res.mentions[0];
  assert.equal(fileMention.found, false, 'File mention not found');
  assert.equal(fileMention.note, 'Mention not found: @file:src/flask/nonexistent.py');

  const symMention = res.mentions[1];
  assert.equal(symMention.found, false, 'Symbol mention not found');
  assert.equal(symMention.note, 'Mention not found: @symbol:fake_function_xyz');

  assert.ok(res.attachedContextText.includes('Mention not found: @file:src/flask/nonexistent.py'));
  assert.ok(res.attachedContextText.includes('Mention not found: @symbol:fake_function_xyz'));
});
