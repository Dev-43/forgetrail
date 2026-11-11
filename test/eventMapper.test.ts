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
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'tool.finished');
  if (events[0].type === 'tool.finished') {
    assert.equal(events[0].ok, true);
    assert.match(events[0].resultSummary, /get_debug_flag/);
  }
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
