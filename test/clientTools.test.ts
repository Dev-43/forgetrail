import test from 'node:test';
import assert from 'node:assert/strict';
import { answerClientTool, parseQuestions, NO_ANSWER, unsupportedClientTool } from '../src/trueforge/clientTools';
import { buildCommandEnv, commandShellNote } from '../src/mcp/tools/runCommand';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// --- R8: client-side tool calls must be answered, or TrueForge rejects the whole decision batch ---

// Arguments exactly as Mistral sent them in the UI test (session 01m79x99777h4zps9knjshtpjw)
const recordedArgs = {
  question: 'The code hunk was rejected with the note "dpn". Which implementation should I use for the return line?',
  options: [
    'Extract to a local variable first',
    'Use a tuple instead of a set inline',
    'Split into two conditions',
  ],
};

test('clientTools R8: ask_user_question shows the model options and returns the picked answer', async () => {
  let seen: { q: string; o: string[] } | undefined;
  const answer = await answerClientTool('ask_user_question', recordedArgs, async (q, o) => {
    seen = { q, o };
    return o[1];
  });
  assert.equal(answer, 'Use a tuple instead of a set inline');
  assert.equal(seen?.o.length, 3);
  assert.match(seen!.q, /dpn/);
});

test('clientTools R8: a dismissed question and headless runs still produce an answer (never leave the call open)', async () => {
  assert.equal(await answerClientTool('ask_user_question', recordedArgs, async () => undefined), NO_ANSWER);
  assert.equal(await answerClientTool('ask_user_question', recordedArgs), NO_ANSWER);
  assert.equal(await answerClientTool('ask_user_question', {}), NO_ANSWER);
});

test('clientTools R8: unknown client-side tools get an explicit error answer', async () => {
  assert.equal(await answerClientTool('render_widget', { x: 1 }), unsupportedClientTool('render_widget'));
});

test('clientTools R8: parses several questions and option objects', () => {
  const qs = parseQuestions({ questions: [{ question: 'A?', options: [{ label: 'x' }, 'y'] }, { text: 'B?' }] });
  assert.deepEqual(qs, [{ question: 'A?', options: ['x', 'y'] }, { question: 'B?', options: [] }]);
});

// --- C3 / C2: run_command environment and shell note ---

test('runCommand C3: on Windows the venv is prepended to the existing "Path" key, not a second PATH', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-venv-'));
  fs.mkdirSync(path.join(ws, '.venv', 'Scripts'), { recursive: true });
  try {
    const env = buildCommandEnv(ws, { Path: 'C:\\Windows\\system32', OTHER: '1' }, 'win32');
    assert.equal(env.PATH, undefined, 'no duplicate PATH key that Windows would ignore');
    assert.ok(env.Path!.startsWith(path.join(ws, '.venv', 'Scripts') + ';'));
    assert.ok(env.Path!.endsWith('C:\\Windows\\system32'));
    assert.equal(env.VIRTUAL_ENV, path.join(ws, '.venv'));
    assert.equal(env.OTHER, '1');
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('runCommand C3: without a .venv the environment is unchanged', () => {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-novenv-'));
  try {
    assert.deepEqual(buildCommandEnv(ws, { PATH: '/usr/bin' }, 'linux'), { PATH: '/usr/bin' });
  } finally {
    fs.rmSync(ws, { recursive: true, force: true });
  }
});

test('runCommand C2: the tool description names the shell', () => {
  assert.match(commandShellNote('win32'), /cmd\.exe/);
  assert.match(commandShellNote('win32'), /never ;/);
  assert.match(commandShellNote('linux'), /\/bin\/sh/);
});
