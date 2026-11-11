import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advance,
  compileDefinition,
  createRunState,
  createStageReminderDefinition,
  WorkflowRuntimeError,
  type WorkflowEvent,
  type WorkflowValue,
} from '../index';
import { stageReminderFixtures, stageReminderScenario } from '../fixtures/stage-reminder';

const at = '2026-11-11T09:00:05.000Z';
const plan = compileDefinition(createStageReminderDefinition());
const startEvent = stageReminderScenario.events[0]!;

function fixtureOutputs(nodeId: string): Record<string, WorkflowValue> {
  const fixture = stageReminderFixtures.nodes[nodeId];
  if (!fixture || fixture.status !== 'ok') throw new Error(`missing fixture ${nodeId}`);
  return { ...fixture.outputs };
}

function observation(nodeId: string, outputs: Record<string, WorkflowValue>): WorkflowEvent {
  return { type: 'observation', at, nodeId, status: 'succeeded', outputs };
}

function newState() {
  return createRunState(plan, { runId: 'run-advance-1', mode: 'simulation' });
}

test('start stops at the first read and reports a descriptive pending operation', () => {
  const result = advance(plan, newState(), { type: 'start', at, event: startEvent });
  assert.equal(result.state.status, 'waiting');
  assert.equal(result.state.pendingNodeId, 'read-context');
  assert.equal(result.pending.length, 1);
  const operation = result.pending[0]!;
  assert.equal(operation.nodeId, 'read-context');
  assert.equal(operation.effect, 'read');
  assert.equal(operation.mode, 'simulation');
  assert.equal(operation.simulation, true);
  assert.equal(operation.nodeVersion, 'read_materials@1/read.project_context');
  assert.deepEqual(operation.input, { stageKey: 'plumbing' });
  assert.ok(operation.idempotencyKey.includes(plan.digest));
  assert.deepEqual(result.trace.map((entry) => entry.kind), ['run_started', 'node_succeeded', 'node_started', 'node_pending']);
});

test('a duplicate trigger event is ignored without repeating operations', () => {
  const first = advance(plan, newState(), { type: 'start', at, event: startEvent });
  const duplicate = advance(plan, first.state, { type: 'start', at, event: startEvent });
  assert.equal(duplicate.pending.length, 0);
  assert.equal(duplicate.state.status, first.state.status);
  assert.deepEqual(duplicate.state.outputs, first.state.outputs);
  assert.deepEqual(duplicate.state.processedEventIds, [startEvent.eventId]);
  assert.equal(duplicate.trace[0]?.kind, 'event_duplicate_ignored');
});

test('advance never mutates the state it is given', () => {
  const first = advance(plan, newState(), { type: 'start', at, event: startEvent });
  const before = structuredClone(first.state);
  advance(plan, first.state, observation('read-context', fixtureOutputs('read-context')));
  assert.deepEqual(first.state, before);
});

test('knowledge enabled routes through the model compose branch', () => {
  let result = advance(plan, newState(), { type: 'start', at, event: startEvent });
  result = advance(plan, result.state, observation('read-context', fixtureOutputs('read-context')));
  assert.equal(result.pending[0]?.nodeId, 'read-craft');

  result = advance(plan, result.state, observation('read-craft', fixtureOutputs('read-craft')));
  assert.equal(result.pending[0]?.nodeId, 'compose-model');
  assert.deepEqual(result.pending[0]?.input, {
    stageLabel: '水电施工',
    craftSummary: stageReminderFixtures.nodes['read-craft']?.status === 'ok'
      ? stageReminderFixtures.nodes['read-craft'].outputs.craftSummary
      : undefined,
  });
  assert.ok(result.trace.some((entry) => entry.kind === 'branch_selected' && entry.detail?.result === true));

  result = advance(plan, result.state, observation('compose-model', fixtureOutputs('compose-model')));
  assert.equal(result.pending[0]?.nodeId, 'save-model');
  result = advance(plan, result.state, observation('save-model', fixtureOutputs('save-model')));
  assert.equal(result.pending[0]?.nodeId, 'deliver-model');
  result = advance(plan, result.state, observation('deliver-model', fixtureOutputs('deliver-model')));
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.outcome, 'delivered');
  assert.equal(result.pending.length, 0);
});

test('knowledge disabled keeps the deterministic branch with no compose operation', () => {
  let result = advance(plan, newState(), { type: 'start', at, event: startEvent });
  result = advance(plan, result.state, observation('read-context', fixtureOutputs('read-context')));
  result = advance(plan, result.state, observation('read-craft', { craftEnabled: false, craftSummary: '' }));
  assert.equal(result.pending[0]?.nodeId, 'save-deterministic');
  assert.equal(result.pending.some((operation) => operation.effect === 'compose'), false);
  assert.ok(result.trace.some((entry) => entry.kind === 'branch_selected' && entry.detail?.result === false));
  assert.equal(result.state.outputs['compose-deterministic']?.body, '「模拟项目」当前施工已进入水电施工阶段。\n到现场重点看：线管固定、打压记录。');

  result = advance(plan, result.state, observation('save-deterministic', fixtureOutputs('save-deterministic')));
  assert.equal(result.pending[0]?.nodeId, 'deliver-deterministic');
  result = advance(plan, result.state, observation('deliver-deterministic', fixtureOutputs('deliver-deterministic')));
  assert.equal(result.state.outcome, 'delivered');
});

test('an unknown stage halts instead of guessing', () => {
  let result = advance(plan, newState(), { type: 'start', at, event: startEvent });
  result = advance(plan, result.state, observation('read-context', {
    ...fixtureOutputs('read-context'),
    stageKnown: false,
  }));
  assert.equal(result.state.status, 'halted');
  assert.equal(result.state.outcome, 'halted:condition-stage:false');
  assert.equal(result.pending.length, 0);
  assert.ok(result.trace.some((entry) => entry.kind === 'run_halted'));
});

test('failed reads fail the run and terminal runs reject further events', () => {
  const first = advance(plan, newState(), { type: 'start', at, event: startEvent });
  const failed = advance(plan, first.state, {
    type: 'observation',
    at,
    nodeId: 'read-context',
    status: 'failed',
    error: { code: 'read_denied', path: 'fixtures.read-context', message: 'permission revoked' },
  });
  assert.equal(failed.state.status, 'failed');
  assert.equal(failed.state.error?.code, 'read_denied');
  assert.equal(failed.pending.length, 0);
  assert.ok(failed.trace.some((entry) => entry.kind === 'node_failed'));

  assert.throws(
    () => advance(plan, failed.state, { type: 'start', at, event: { ...startEvent, eventId: 'evt-other' } }),
    (error: unknown) => error instanceof WorkflowRuntimeError && error.code === 'run_terminal',
  );
});

test('observations must match the pending node', () => {
  const first = advance(plan, newState(), { type: 'start', at, event: startEvent });
  assert.throws(
    () => advance(plan, first.state, observation('read-craft', {})),
    (error: unknown) => error instanceof WorkflowRuntimeError && error.code === 'observation_node_mismatch',
  );
});
