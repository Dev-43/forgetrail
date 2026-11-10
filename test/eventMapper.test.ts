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
