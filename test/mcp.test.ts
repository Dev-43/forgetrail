import test from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import { validateWorkspacePath, normalizePath } from '../src/mcp/pathGuard';
import { executeReadFile } from '../src/mcp/tools/readFile';
import { executeSearchWorkspace } from '../src/mcp/tools/searchWorkspace';
import { runContext } from '../src/mcp/runContext';
import { startMcpServer, stopMcpServer } from '../src/mcp/server';
import { E_PATH_OUTSIDE, E_PATH_IGNORED, E_NOT_FOUND } from '../src/shared/contracts';

const workspaceRoot = path.resolve(__dirname, '..');

test('pathGuard: normalizePath', () => {
  assert.equal(normalizePath('./src/extension.ts'), 'src/extension.ts');
  assert.equal(normalizePath('src\\shared\\limits.ts'), 'src/shared/limits.ts');
  assert.equal(normalizePath('  ./src/mcp/server.ts  '), 'src/mcp/server.ts');
});

test('pathGuard: inside workspace succeeds', () => {
  const result = validateWorkspacePath('package.json', workspaceRoot);
  assert.equal(result.ok, true);
  assert.equal(result.relativePath, 'package.json');
});

test('pathGuard: outside workspace returns E_PATH_OUTSIDE', () => {
  const result = validateWorkspacePath('../outside.txt', workspaceRoot);
  assert.equal(result.ok, false);
  assert.equal(result.error, E_PATH_OUTSIDE('../outside.txt'));
});

test('pathGuard: ignored folder returns E_PATH_IGNORED', () => {
  const result = validateWorkspacePath('.git/config', workspaceRoot);
  assert.equal(result.ok, false);
  assert.equal(result.error, E_PATH_IGNORED('.git/config'));
});

test('readFile: reads lines and formats standard header', async () => {
  runContext.reset();
  runContext.setWorkspaceRoot(workspaceRoot);

  const output = await executeReadFile(
    { path: 'package.json', start_line: 1, end_line: 5 },
    workspaceRoot
  );

  assert.match(output, /^\[package\.json \| lines 1-5 of \d+ \| ~\d+ tokens \| budget left \d+\]/);
  assert.match(output, /"name": "forgetrail"/);
});

test('readFile: non-existent file returns E_NOT_FOUND', async () => {
  runContext.reset();
  const output = await executeReadFile(
    { path: 'non_existent_file.xyz' },
    workspaceRoot
  );
  assert.equal(output, E_NOT_FOUND('non_existent_file.xyz'));
});

test('searchWorkspace: finds query and formats header', async () => {
  runContext.reset();
  runContext.setWorkspaceRoot(workspaceRoot);

  const output = await executeSearchWorkspace(
    { query: 'forgetrail', case_sensitive: false },
    workspaceRoot
  );

  assert.match(output, /^\[search: forgetrail \| \d+ matches \| ~\d+ tokens \| budget left \d+\]/);
  assert.match(output, /BUILD\.md:/);
});

test('runContext: budget tracking and cancellation flag', () => {
  runContext.reset();
  assert.equal(runContext.budgetUsed, 0);
  assert.equal(runContext.cancelled, false);

  const res1 = runContext.consumeBudget(500);
  assert.equal(res1.used, 500);
  assert.equal(res1.remaining, 11500);

  runContext.cancel();
  assert.equal(runContext.cancelled, true);

  runContext.reset();
  assert.equal(runContext.cancelled, false);
});

test('MCP HTTP server: starts, responds to health check, stops cleanly', async () => {
  const testPort = 3334;
  const server = await startMcpServer(testPort, '127.0.0.1');
  assert.ok(server);

  const res = await fetch(`http://127.0.0.1:${testPort}/health`);
  assert.equal(res.status, 200);
  const data = await res.json() as any;
  assert.equal(data.status, 'ok');

  await stopMcpServer();
});
