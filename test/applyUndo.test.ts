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

test('runCommand: allowlist refuses chained, piped or redirected commands', () => {
  assert.equal(isCommandAutoAllowed('pytest && rm -rf /'), false);
  assert.equal(isCommandAutoAllowed('pytest; curl http://x'), false);
  assert.equal(isCommandAutoAllowed('git status | sh'), false);
  assert.equal(isCommandAutoAllowed('git diff > out.txt'), false);
  assert.equal(isCommandAutoAllowed('pytest $(whoami)'), false);
  assert.equal(isCommandAutoAllowed('pytestevil'), false);
  assert.equal(isCommandAutoAllowed('pytest tests/test_cli.py -q'), true);
});

test('applyEdit: create refuses to overwrite an existing file (E_FILE_EXISTS)', async () => {
  const filePath = path.join(tempDir, 'exists.py');
  fs.writeFileSync(filePath, 'keep me\n', 'utf-8');
  const req: ReviewRequest = {
    id: 'hunk_create_existing', runId: 'run_c', threadId: 'main', path: 'exists.py', kind: 'create',
    oldText: '', newText: 'overwritten\n', startLine: 1, endLine: 1, reason: 't', sources: [], index: 1, total: 1, baseVersion: 0,
  };
  const res = await applyHunk(req, tempDir);
  assert.match(res, /^ERROR FILE_EXISTS: exists\.py/);
  assert.equal(fs.readFileSync(filePath, 'utf-8'), 'keep me\n');
});

test('applyEdit: undo of a created file deletes it', async () => {
  const req: ReviewRequest = {
    id: 'hunk_create_new', runId: 'run_new', threadId: 'main', path: 'new_dir/new.py', kind: 'create',
    oldText: '', newText: 'print(1)\n', startLine: 1, endLine: 1, reason: 't', sources: [], index: 1, total: 1, baseVersion: 0,
  };
  const res = await applyHunk(req, tempDir);
  assert.match(res, /^APPLIED new_dir\/new\.py/);
  assert.equal(fs.existsSync(path.join(tempDir, 'new_dir/new.py')), true);
  const undo = await undoStore.undoLast(tempDir);
  assert.equal(undo.success, true);
  assert.equal(fs.existsSync(path.join(tempDir, 'new_dir/new.py')), false);
});

test('applyEdit: reported line range is correct on CRLF files', async () => {
  const filePath = path.join(tempDir, 'crlf.py');
  fs.writeFileSync(filePath, 'a = 1\r\nb = 2\r\nc = 3\r\n', 'utf-8');
  const req: ReviewRequest = {
    id: 'hunk_crlf', runId: 'run_crlf', threadId: 'main', path: 'crlf.py', kind: 'replace',
    oldText: 'b = 2\nc = 3', newText: 'b = 20\nc = 30', startLine: 1, endLine: 1, reason: 't', sources: [], index: 1, total: 1, baseVersion: 0,
  };
  const res = await applyHunk(req, tempDir);
  assert.equal(res, 'APPLIED crlf.py lines 2-3 (hunk hunk_crlf).');
  assert.equal(fs.readFileSync(filePath, 'utf-8'), 'a = 1\r\nb = 20\r\nc = 30\r\n');
});
