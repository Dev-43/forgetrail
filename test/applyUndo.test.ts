import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { computeProposedText, applyHunk } from '../src/apply/applyEdit';
import { undoStore } from '../src/apply/undoStore';
import { runContext } from '../src/mcp/runContext';
import { isCommandAutoAllowed } from '../src/mcp/tools/runCommand';
import { ReviewRequest, E_CANCELLED } from '../src/shared/contracts';

const tempDir = path.resolve(__dirname, 'temp_apply_test');

test.beforeEach(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempDir, { recursive: true });
  runContext.reset();
  runContext.setWorkspaceRoot(tempDir);
  undoStore.clear();
});

test.afterEach(() => {
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('applyEdit: computeProposedText replaces text preserving CRLF', () => {
  const crlfOriginal = 'line1\r\nline2\r\nline3';
  const req: ReviewRequest = {
    id: 'req1',
    runId: 'run1',
    threadId: 'main',
    path: 'sample.txt',
    kind: 'replace',
    oldText: 'line2',
    newText: 'line2_modified',
    startLine: 2,
    endLine: 2,
    reason: 'test',
    sources: [],
    index: 1,
    total: 1,
    baseVersion: 0,
  };

  const result = computeProposedText(crlfOriginal, req);
  assert.equal(result, 'line1\r\nline2_modified\r\nline3');
});

test('applyEdit: applyHunk and undoLast roundtrip', async () => {
  const filePath = path.join(tempDir, 'test.py');
  const initialText = 'def hello():\n    return "world"\n';
  fs.writeFileSync(filePath, initialText, 'utf-8');

  const req: ReviewRequest = {
    id: 'hunk_1',
    runId: 'run_roundtrip',
    threadId: 'main',
    path: 'test.py',
    kind: 'replace',
    oldText: 'return "world"',
    newText: 'return "universe"',
    startLine: 2,
    endLine: 2,
    reason: 'expand scope',
    sources: [],
    index: 1,
    total: 1,
    baseVersion: 0,
  };

  const applyRes = await applyHunk(req, tempDir);
  assert.match(applyRes, /^APPLIED test\.py lines \d+-\d+ \(hunk hunk_1\)/);

  const appliedText = fs.readFileSync(filePath, 'utf-8');
  assert.equal(appliedText, 'def hello():\n    return "universe"\n');

  // Verify undoLast restores byte-for-byte
  const undoRes = await undoStore.undoLast(tempDir);
  assert.equal(undoRes.success, true);

  const restoredText = fs.readFileSync(filePath, 'utf-8');
  assert.equal(restoredText, initialText);
});

test('applyEdit: cancel guard prevents file write', async () => {
  const filePath = path.join(tempDir, 'guard.txt');
  fs.writeFileSync(filePath, 'original content', 'utf-8');

  runContext.cancel();

  const req: ReviewRequest = {
    id: 'hunk_cancelled',
    runId: 'run_cancel',
    threadId: 'main',
    path: 'guard.txt',
    kind: 'replace',
    oldText: 'original content',
    newText: 'should not be written',
    startLine: 1,
    endLine: 1,
    reason: 'test',
    sources: [],
    index: 1,
    total: 1,
    baseVersion: 0,
  };

  const res = await applyHunk(req, tempDir);
  assert.equal(res, E_CANCELLED);

  const diskText = fs.readFileSync(filePath, 'utf-8');
  assert.equal(diskText, 'original content');
});

test('applyEdit: undoLast refuses if file was modified externally', async () => {
  const filePath = path.join(tempDir, 'stale.txt');
  fs.writeFileSync(filePath, 'version 1', 'utf-8');

  const req: ReviewRequest = {
    id: 'hunk_stale',
    runId: 'run_stale',
    threadId: 'main',
    path: 'stale.txt',
    kind: 'replace',
    oldText: 'version 1',
    newText: 'version 2',
    startLine: 1,
    endLine: 1,
    reason: 'bump',
    sources: [],
    index: 1,
    total: 1,
    baseVersion: 0,
  };

  await applyHunk(req, tempDir);

  // Simulate external user edit
  fs.writeFileSync(filePath, 'version 2 modified by user', 'utf-8');

  const undoRes = await undoStore.undoLast(tempDir);
  assert.equal(undoRes.success, false);
  assert.match(undoRes.message, /modified after this edit was applied/);
});

test('runCommand: isCommandAutoAllowed recognizes allowlist', () => {
  assert.equal(isCommandAutoAllowed('pytest tests/test_cli.py -q'), true);
  assert.equal(isCommandAutoAllowed('python -m pytest'), true);
  assert.equal(isCommandAutoAllowed('git status'), true);
  assert.equal(isCommandAutoAllowed('git diff'), true);
  assert.equal(isCommandAutoAllowed('rm -rf /'), false);
  assert.equal(isCommandAutoAllowed('curl http://malicious.com'), false);
});
