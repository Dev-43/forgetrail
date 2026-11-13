import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { EventMapper } from '../src/trueforge/eventMapper';

const samplesPath = path.resolve(__dirname, 'fixtures/event-samples.json');
const spikeSamples = JSON.parse(fs.readFileSync(samplesPath, 'utf-8'));

test('eventMapper: maps model.message.delta text content', () => {
  const mapper = new EventMapper('test-run-1');
  const delta = {
    type: 'model.message.delta',
    content: 'Hello, world!',
    threadId: 'main',
  };

  const events = mapper.mapEvent(delta);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'text.delta');
  if (events[0].type === 'text.delta') {
    assert.equal(events[0].text, 'Hello, world!');
    assert.equal(events[0].threadId, 'main');
    assert.equal(events[0].runId, 'test-run-1');
  }
});

test('eventMapper: maps model.message.delta with toolCalls from spike sample', () => {
  const mapper = new EventMapper('test-run-2');
  const rawSample = spikeSamples['model.message.delta'];

  const events = mapper.mapEvent(rawSample);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tool.started');
  if (events[0].type === 'tool.started') {
    assert.equal(events[0].toolName, 'search_workspace');
    assert.equal(events[0].threadId, 'main');
  }

  const pending = mapper.getPendingCall('call_16388427314343380977');
  assert.ok(pending);
  assert.equal(pending.name, 'search_workspace');
});

test('eventMapper: maps tool.response from spike sample', () => {
  const mapper = new EventMapper('test-run-3');
  const rawSample = spikeSamples['tool.response'];

  const events = mapper.mapEvent(rawSample);
  // The call's start was never seen in this stream, so its row is added before it is closed
  assert.deepEqual(events.map((e) => e.type), ['tool.started', 'tool.finished']);
  const finished = events[1];
  if (finished.type === 'tool.finished') {
    assert.equal(finished.ok, true);
    assert.equal(finished.toolCallId, 'call_16388427314343380977');
    assert.match(finished.resultSummary, /get_debug_flag/);
  }
});

// --- P1: tool trail, as TrueForge 0.184 really streams calls (recorded 2026-11-13) ---

test('eventMapper P1: a call streamed in fragments gets ONE row with its arguments, closed by toolCallId', () => {
  const mapper = new EventMapper('p1');
  const first = mapper.mapEvent({
    type: 'model.message.delta', threadId: 'main',
    toolCalls: [{ toolInfo: { type: 'mcp', name: 'read_file' }, index: 0, id: '0e0caccad', type: 'function', function: { name: 'read_file', arguments: '' } }],
  });
  assert.equal(first.filter((e) => e.type === 'tool.started').length, 0, 'no row while arguments are empty');

  const second = mapper.mapEvent({
    type: 'model.message.delta', threadId: 'main',
    toolCalls: [{ index: 0, function: { arguments: '{"path": "src/flask/helpers.py", "start_line": 28, "end_line": 34}' } }],
  });
  const started = second.filter((e) => e.type === 'tool.started');
  assert.equal(started.length, 1);
  if (started[0].type === 'tool.started') {
    assert.equal(started[0].toolName, 'read_file');
    assert.equal(started[0].toolCallId, '0e0caccad');
    assert.equal(started[0].argsSummary, 'src/flask/helpers.py:28-34');
  }

  const done = mapper.mapEvent({
    type: 'tool.response', threadId: 'main', toolCallId: '0e0caccad',
    content: '[src/flask/helpers.py | lines 28-34 of 642 | ~60 tokens | budget left 11940]\ndef get_debug_flag() -> bool:',
  });
  assert.deepEqual(done.map((e) => e.type), ['tool.finished'], 'no second row for the same call');
  if (done[0].type === 'tool.finished') {
    assert.equal(done[0].toolName, 'read_file', 'name comes from the recorded call (tool.response has none)');
    assert.equal(done[0].toolCallId, '0e0caccad');
    assert.equal(done[0].ok, true);
  }
});

test('eventMapper P1: run_command rows show the command; non-zero exit and denials count as failed', () => {
  const mapper = new EventMapper('p1b');
  const ev = mapper.mapEvent({
    type: 'model.message.delta', threadId: 'main',
    toolCalls: [{ index: 0, id: 'c1', function: { name: 'run_command', arguments: '{"command": "python -m pytest -q"}' } }],
  });
  const row = ev.find((e) => e.type === 'tool.started');
  assert.ok(row && row.type === 'tool.started' && row.argsSummary === 'python -m pytest -q');

  const failed = mapper.mapEvent({ type: 'tool.response', toolCallId: 'c1', content: 'EXIT 1\n2 failed' });
  assert.ok(failed[0].type === 'tool.finished' && failed[0].ok === false);

  mapper.mapEvent({ type: 'model.message.delta', toolCalls: [{ index: 1, id: 'c2', function: { name: 'propose_edit', arguments: '{"path":"a.py"}' } }] });
  const denied = mapper.mapEvent({ type: 'tool.response', toolCallId: 'c2', content: '{"error":[{"type":"text","text":"User denied tool call"}]}' });
  const last = denied[denied.length - 1];
  assert.ok(last.type === 'tool.finished' && last.ok === false);
});

// --- P2: context card ---

test('eventMapper P2: CONTEXT glued to the previous message, split across deltas, still parsed whole', () => {
  const mapper = new EventMapper('p2');
  const all: any[] = [];
  // Message 1 ends without a newline; TrueForge then sends a tool call and message 2
  all.push(...mapper.mapEvent({ type: 'model.message.delta', threadId: 'main', content: 'Let me check, then state my plan.' }));
  all.push(...mapper.mapEvent({ type: 'model.message', threadId: 'main' }));
  for (const piece of ['CONTEXT: src/flask/cli.py — defines the built-in com', 'mands (run, shell, routes)\nCONTEXT: docs/cli.rst — documents ', 'the built-in commands\n']) {
    all.push(...mapper.mapEvent({ type: 'model.message.delta', threadId: 'main', content: piece }));
  }
  const items = mapper.getContextItems();
  assert.deepEqual(items.map((i) => i.path), ['src/flask/cli.py', 'docs/cli.rst']);
  assert.equal(items[0].reason, 'defines the built-in commands (run, shell, routes)', 'reason not cut mid-stream');
  assert.equal(items[1].reason, 'documents the built-in commands');
  assert.ok(all.some((e) => e.type === 'text.delta' && e.text === '\n'), 'transcript gets the missing line break');
});

test('eventMapper P2: last CONTEXT line without a trailing newline is parsed when the message ends', () => {
  const mapper = new EventMapper('p2b');
  mapper.mapEvent({ type: 'model.message.delta', content: 'CONTEXT: `tests/test-cli.py` - existing CLI tests' });
  assert.equal(mapper.getContextItems().length, 0, 'not yet: the line may still grow');
  mapper.mapEvent({ type: 'tool.approval_required', toolCalls: [] });
  assert.deepEqual(mapper.getContextItems().map((i) => [i.path, i.reason]), [['tests/test-cli.py', 'existing CLI tests']]);
});

test('eventMapper P2: context card shows real read_file token counts, not a ~100 placeholder', () => {
  const mapper = new EventMapper('p2c');
  mapper.mapEvent({ type: 'model.message.delta', toolCalls: [{ index: 0, id: 'r1', function: { name: 'read_file', arguments: '{"path":"src/flask/cli.py","start_line":1,"end_line":80}' } }] });
  mapper.mapEvent({ type: 'tool.response', toolCallId: 'r1', content: '[src/flask/cli.py | lines 1-80 of 1136 | ~700 tokens | budget left 11300]' });
  mapper.mapEvent({ type: 'model.message.delta', toolCalls: [{ index: 1, id: 'r2', function: { name: 'read_file', arguments: '{"path":"src/flask/cli.py","start_line":560,"end_line":620}' } }] });
  mapper.mapEvent({ type: 'tool.response', toolCallId: 'r2', content: '[src/flask/cli.py | lines 560-620 of 1136 | ~559 tokens | budget left 10741]' });
  mapper.mapEvent({ type: 'model.message.delta', content: 'CONTEXT: src/flask/cli.py — built-in commands\nCONTEXT: docs/cli.rst — docs, not read yet\n' });
  const items = mapper.getContextItems();
  assert.equal(items.find((i) => i.path === 'src/flask/cli.py')?.tokens, 1259, 'sum of both reads');
  assert.equal(items.find((i) => i.path === 'docs/cli.rst')?.tokens, 0, 'unknown, shown without a number');
});

test('eventMapper: tool.approval_required does not emit review.requested (the run controller does)', () => {
  const mapper = new EventMapper('test-run-4');
  mapper.recordPendingCall('call_approval_1', 'propose_edit', { path: 'src/flask/helpers.py', old_text: 'a', new_text: 'b', reason: 'r' });
  const events = mapper.mapEvent({ type: 'tool.approval_required', threadId: 'main', toolCalls: [{ id: 'call_approval_1' }] });
  assert.equal(events.filter((e) => e.type === 'review.requested').length, 0);
});

test('eventMapper: turn.done emits no final run events (approval pauses also end with turn.done)', () => {
  const mapper = new EventMapper('test-run-5');
  assert.equal(mapper.mapEvent(spikeSamples['turn.done']).length, 0);
  assert.equal(mapper.mapEvent({ type: 'turn.done', state: { status: 'cancelled' } }).length, 0);
  assert.equal(mapper.mapEvent({ type: 'turn.done', state: { status: 'error', message: '[Model Error] Request failed (401)' } }).length, 0);
});

test('eventMapper: parses CONTEXT and PLAN lines and emits context.report', () => {
  const mapper = new EventMapper('test-run-6');
  const delta = {
    type: 'model.message.delta',
    content:
      'I will inspect the workspace.\nCONTEXT: src/flask/cli.py — Implements core CLI commands\nPLAN: 1. Add config command to cli.py\nPLAN: 2. Add tests in test_cli.py\n',
  };

  const events = mapper.mapEvent(delta);
  const reportEvent = events.find((e) => e.type === 'context.report');
  assert.ok(reportEvent, 'Emitted context.report event');
  if (reportEvent && reportEvent.type === 'context.report') {
    assert.equal(reportEvent.items.length, 1);
    assert.equal(reportEvent.items[0].path, 'src/flask/cli.py');
    assert.equal(reportEvent.items[0].reason, 'Implements core CLI commands');
  }

  const planEvent = events.find((e) => e.type === 'plan.update');
  assert.ok(planEvent, 'Emitted plan.update event');
  const plans = mapper.getPlanSteps();
  assert.equal(plans.length, 2);
  assert.equal(plans[0], '1. Add config command to cli.py');
  assert.equal(plans[1], '2. Add tests in test_cli.py');
});

test('eventMapper: falls back to read_file calls before propose_edit if CONTEXT omitted', () => {
  const mapper = new EventMapper('test-run-7');
  // Record read_file tool call
  mapper.recordPendingCall('call_read_1', 'read_file', { path: 'src/flask/config.py' });
  mapper.mapEvent({
    type: 'tool.response',
    tool_name: 'read_file',
    toolCallId: 'call_read_1',
    content: '[src/flask/config.py | 100 lines | ~400 tokens | budget left 11600]',
  });

  // Now propose_edit occurs without any CONTEXT lines
  mapper.recordPendingCall('call_edit_1', 'propose_edit', {
    path: 'src/flask/cli.py',
    old_text: 'pass',
    new_text: 'print("hello")',
    reason: 'Add feature',
  });

  const approvalEvents = mapper.mapEvent({
    type: 'tool.approval_required',
    toolCalls: [{ id: 'call_edit_1' }],
  });

  const reportEvent = approvalEvents.find((e) => e.type === 'context.report');
  assert.ok(reportEvent, 'Fallback emitted context.report');
  if (reportEvent && reportEvent.type === 'context.report') {
    assert.equal(reportEvent.items.length, 1);
    assert.equal(reportEvent.items[0].path, 'src/flask/config.py');
    assert.equal(reportEvent.items[0].reason, 'read by agent');
  }
});
