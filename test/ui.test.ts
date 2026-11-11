import { describe, it } from 'node:test';
import * as assert from 'node:assert';
import { formatWhyText } from '../src/review/ui/whyDecoration';
import { computeProposedText } from '../src/apply/applyEdit';
import { ReviewRequest } from '../src/shared/contracts';
import {
  S_APPLIED,
  S_BUSY,
  S_CANCELLED,
  S_NO_FALLBACK,
  S_REVIEW,
  S_RUNNING,
  S_SELECT,
  S_STALE_SKIP,
  S_SWITCHED,
  S_UNDO_BLOCKED,
  S_UNDO_DONE,
} from '../src/ui/notifications';

describe('UI: Why Decoration Text Formatting', () => {
  it('formats why text with reason and sources', () => {
    const text = formatWhyText('Add off and n check', ['src/flask/helpers.py', 'docs/config.rst']);
    assert.strictEqual(
      text,
      ' ◀ why: Add off and n check (from src/flask/helpers.py, docs/config.rst)'
    );
  });

  it('formats why text with reason only', () => {
    const text = formatWhyText('Add off and n check', []);
    assert.strictEqual(text, ' ◀ why: Add off and n check');
  });

  it('formats why text with missing reason as (no reason given)', () => {
    const text = formatWhyText('', ['src/flask/helpers.py']);
    assert.strictEqual(text, ' ◀ why: (no reason given) (from src/flask/helpers.py)');
  });

  it('formats why text with empty arguments', () => {
    const text = formatWhyText(undefined, undefined);
    assert.strictEqual(text, ' ◀ why: (no reason given)');
  });
});

describe('UI: Proposed Text Computation (Stub Integration)', () => {
  it('computes proposed text for replacement hunk', () => {
    const request: ReviewRequest = {
      id: 'hunk-1',
      runId: 'run-1',
      threadId: 'main',
      path: 'test.py',
      kind: 'replace',
      oldText: 'def hello():\n    return False\n',
      newText: 'def hello():\n    return True\n',
      startLine: 1,
      endLine: 2,
      reason: 'test reason',
      sources: [],
      index: 1,
      total: 1,
      baseVersion: 1,
    };

    const current = 'import os\n\ndef hello():\n    return False\n\nprint("done")';
    const result = computeProposedText(current, request);
    assert.ok(result.includes('return True'));
    assert.ok(!result.includes('return False'));
  });

  it('preserves CRLF line endings when current file is CRLF', () => {
    const request: ReviewRequest = {
      id: 'hunk-crlf',
      runId: 'run-1',
      threadId: 'main',
      path: 'crlf.py',
      kind: 'replace',
      oldText: 'val = False\n',
      newText: 'val = True\n',
      startLine: 1,
      endLine: 1,
      reason: 'crlf test',
      sources: [],
      index: 1,
      total: 1,
      baseVersion: 1,
    };

    const current = 'val = False\r\nprint(val)\r\n';
    const result = computeProposedText(current, request);
    assert.strictEqual(result, 'val = True\r\nprint(val)\r\n');
  });

  it('returns newText directly for create hunks', () => {
    const request: ReviewRequest = {
      id: 'hunk-create',
      runId: 'run-1',
      threadId: 'main',
      path: 'new_file.py',
      kind: 'create',
      oldText: '',
      newText: 'print("new file")\n',
      startLine: 1,
      endLine: 1,
      reason: 'create test',
      sources: [],
      index: 1,
      total: 1,
      baseVersion: 1,
    };

    const result = computeProposedText('', request);
    assert.strictEqual(result, 'print("new file")\n');
  });
});

describe('UI: U-4 Canonical Strings Exact Match', () => {
  it('verifies all string templates match spec', () => {
    assert.strictEqual(S_SELECT, 'Select code first.');
    assert.strictEqual(S_RUNNING('gemini-3-1'), 'ForgeTrail: running (gemini-3-1)');
    assert.strictEqual(S_REVIEW(2), 'ForgeTrail: review 2 pending');
    assert.strictEqual(S_SWITCHED('gemini', 'fallback'), 'ForgeTrail: gemini failed, switched to fallback');
    assert.strictEqual(
      S_NO_FALLBACK,
      'ForgeTrail: the model could not be reached. Nothing was changed. Check your model settings.'
    );
    assert.strictEqual(S_CANCELLED(1, 2), 'ForgeTrail: cancelled — 1 applied, 2 discarded');
    assert.strictEqual(S_APPLIED(3), 'ForgeTrail: applied 3 hunk(s)');
    assert.strictEqual(S_UNDO_DONE('app.py'), 'ForgeTrail: undone app.py');
    assert.strictEqual(
      S_UNDO_BLOCKED('app.py'),
      'ForgeTrail: cannot undo app.py because it changed since.'
    );
    assert.strictEqual(S_BUSY, 'ForgeTrail: a run is already active.');
    assert.strictEqual(S_STALE_SKIP('app.py'), 'ForgeTrail: skipped a hunk because app.py changed.');
  });
});

