import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { EventMapper } from '../src/trueforge/eventMapper';

const samplesPath = path.resolve(__dirname, '../dev/forge-spike/results/logs/05-event-samples.json');
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

test('eventMapper: maps tool.approval_required to review.requested', () => {
  const mapper = new EventMapper('test-run-4');
  // First record pending propose_edit tool call
  mapper.recordPendingCall('call_approval_1', 'propose_edit', {
    path: 'src/flask/helpers.py',
    old_text: 'def get_debug_flag',
    new_text: 'def get_debug_flag_modified',
    reason: 'Refactor debug flag',
    sources: ['src/flask/app.py'],
  });

  const rawApproval = {
    type: 'tool.approval_required',
    threadId: 'main',
    toolCalls: [{ id: 'call_approval_1' }],
  };

  const events = mapper.mapEvent(rawApproval);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'review.requested');
  if (events[0].type === 'review.requested') {
    assert.equal(events[0].request.id, 'call_approval_1');
    assert.equal(events[0].request.path, 'src/flask/helpers.py');
    assert.equal(events[0].request.reason, 'Refactor debug flag');
    assert.equal(events[0].request.kind, 'replace');
  }
});

test('eventMapper: maps turn.done done, cancelled, and error', () => {
  const mapper = new EventMapper('test-run-5');

  // Done from spike sample
  const doneSample = spikeSamples['turn.done'];
  const doneEvents = mapper.mapEvent(doneSample);
  assert.equal(doneEvents.length, 1);
  assert.equal(doneEvents[0].type, 'run.finished');

  // Cancelled
  const cancelEvents = mapper.mapEvent({
    type: 'turn.done',
    state: { status: 'cancelled' },
  });
  assert.equal(cancelEvents.length, 1);
  assert.equal(cancelEvents[0].type, 'run.cancelled');

  // Error
  const errorEvents = mapper.mapEvent({
    type: 'turn.done',
    state: { status: 'error', error: { message: '[Model Error] 401 Unauthorized' } },
  });
  assert.equal(errorEvents.length, 1);
  assert.equal(errorEvents[0].type, 'run.error');
  if (errorEvents[0].type === 'run.error') {
    assert.equal(errorEvents[0].kind, 'model');
    assert.match(errorEvents[0].message, /401/);
  }
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
