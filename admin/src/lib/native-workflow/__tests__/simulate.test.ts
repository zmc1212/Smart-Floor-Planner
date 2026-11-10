import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createPeriodReportDefinition,
  createStageReminderDefinition,
  simulate,
  type NodeFixture,
  type SimulationFixtures,
  type SimulationResult,
  type SimulationRun,
} from '../index';
import { stageReminderFixtures, stageReminderScenario } from '../fixtures/stage-reminder';
import { dailyReportFixtures, dailyReportScenario, periodReportFixtures, weeklyReportScenario } from '../fixtures/period-report';

function mutableFixtures(base: SimulationFixtures): { nodes: Record<string, NodeFixture> } {
  return structuredClone(base) as { nodes: Record<string, NodeFixture> };
}

function firstRun(result: SimulationResult): SimulationRun {
  const run = result.runs[0];
  assert.ok(run);
  return run;
}

function receiptOf(run: SimulationRun, nodeId: string, key: 'saveReceipt' | 'deliveryReceipt'): Record<string, unknown> {
  const value = run.outputs[nodeId]?.[key];
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
}

test('stage reminder normal branch produces a reproducible simulated trace', () => {
  const result = simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: stageReminderFixtures,
  });
  assert.equal(result.mode, 'simulation');
  assert.equal(result.definitionId, 'stage-reminder');
  assert.equal(result.revision, 1);
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.equal(result.runs.length, 1);
  const run = firstRun(result);
  assert.equal(run.status, 'completed');
  assert.equal(run.outcome, 'delivered');
  assert.equal(run.error, null);
  assert.equal(run.modelComposeCount, 1);
  assert.deepEqual(
    run.proposedOperations.map((operation) => `${operation.effect}:${operation.nodeId}`),
    ['read:read-context', 'read:read-craft', 'compose:compose-model', 'save:save-model', 'deliver:deliver-model'],
  );
  assert.ok(run.proposedOperations.every((operation) => operation.simulation && operation.mode === 'simulation'));
  assert.ok(run.trace.length > 0 && run.trace.every((entry) => entry.mode === 'simulation'));
  assert.equal(receiptOf(run, 'save-model', 'saveReceipt').simulated, true);
  assert.equal(receiptOf(run, 'deliver-model', 'deliveryReceipt').simulated, true);
  assert.equal(run.outputs['deliver-model']?.delivered, true);
});

test('knowledge off keeps the deterministic branch without any model compose', () => {
  const fixtures = mutableFixtures(stageReminderFixtures);
  fixtures.nodes['read-craft'] = { status: 'ok', outputs: { craftEnabled: false, craftSummary: '' } };
  const run = firstRun(simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures,
  }));
  assert.equal(run.status, 'completed');
  assert.equal(run.outcome, 'delivered');
  assert.equal(run.modelComposeCount, 0);
  assert.equal(run.proposedOperations.some((operation) => operation.effect === 'compose'), false);
  assert.ok(run.proposedOperations.some((operation) => operation.nodeId === 'save-deterministic'));
  assert.ok(run.trace.some((entry) => entry.kind === 'branch_selected' && entry.detail?.result === false));
});

test('duplicate trigger events do not repeat proposed operations', () => {
  const event = stageReminderScenario.events[0]!;
  const result = simulate({
    definition: createStageReminderDefinition(),
    scenario: { ...stageReminderScenario, events: [event, event] },
    fixtures: stageReminderFixtures,
  });
  assert.equal(result.runs.length, 1);
  assert.deepEqual(result.duplicateEventIds, [event.eventId]);
  assert.equal(firstRun(result).proposedOperations.length, 5);
});

test('same definition, fixtures and event sequence produce the same result', () => {
  const input = {
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: stageReminderFixtures,
  };
  const first = simulate(input);
  const second = simulate(input);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)));
});

test('read and material failures are injected per fixture and never shown as success', () => {
  const denied = mutableFixtures(stageReminderFixtures);
  denied.nodes['read-context'] = {
    status: 'failed',
    error: { code: 'read_denied', path: 'fixtures.read-context', message: 'permission revoked' },
  };
  const deniedRun = firstRun(simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: denied,
  }));
  assert.equal(deniedRun.status, 'failed');
  assert.equal(deniedRun.error?.code, 'read_denied');
  assert.equal(deniedRun.outcome, null);
  assert.ok(deniedRun.fixtureLog.some((entry) => entry.result === 'failed' && entry.code === 'read_denied'));

  const withdrawn = mutableFixtures(periodReportFixtures);
  withdrawn.nodes['read-photos'] = {
    status: 'failed',
    error: { code: 'material_withdrawn', path: 'fixtures.read-photos', message: 'photos were withdrawn' },
  };
  const withdrawnRun = firstRun(simulate({
    definition: createPeriodReportDefinition('weekly'),
    scenario: weeklyReportScenario,
    fixtures: withdrawn,
  }));
  assert.equal(withdrawnRun.status, 'failed');
  assert.equal(withdrawnRun.error?.code, 'material_withdrawn');
});

test('compose, save and delivery failures stay distinct in the trace', () => {
  const cases: Array<{ nodeId: string; code: string }> = [
    { nodeId: 'compose-report', code: 'compose_failed' },
    { nodeId: 'save-report', code: 'save_failed' },
    { nodeId: 'deliver-report', code: 'deliver_failed' },
  ];
  for (const item of cases) {
    const fixtures = mutableFixtures(periodReportFixtures);
    fixtures.nodes[item.nodeId] = {
      status: 'failed',
      error: { code: item.code, path: `fixtures.${item.nodeId}`, message: 'injected failure' },
    };
    const run = firstRun(simulate({
      definition: createPeriodReportDefinition('weekly'),
      scenario: weeklyReportScenario,
      fixtures,
    }));
    assert.equal(run.status, 'failed');
    assert.equal(run.error?.code, item.code);
    assert.ok(run.fixtureLog.some((entry) => entry.nodeId === item.nodeId && entry.code === item.code));
    assert.equal(run.outputs['deliver-report']?.delivered, undefined);
  }
});

test('a missing fixture fails the run explicitly', () => {
  const fixtures = mutableFixtures(stageReminderFixtures);
  delete fixtures.nodes['save-model'];
  const run = firstRun(simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures,
  }));
  assert.equal(run.status, 'failed');
  assert.equal(run.error?.code, 'fixture_missing');
  assert.ok(run.fixtureLog.some((entry) => entry.result === 'missing'));
});

test('simulated receipts cannot claim real persistence or delivery', () => {
  const rejected = mutableFixtures(stageReminderFixtures);
  rejected.nodes['save-model'] = {
    status: 'ok',
    outputs: { saved: true, saveReceipt: { receiptId: 'sim-1', simulated: false } },
  };
  const rejectedRun = firstRun(simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: rejected,
  }));
  assert.equal(rejectedRun.status, 'failed');
  assert.equal(rejectedRun.error?.code, 'receipt_not_simulated');

  const unconfirmed = mutableFixtures(stageReminderFixtures);
  unconfirmed.nodes['deliver-model'] = {
    status: 'ok',
    outputs: { delivered: false, deliveryReceipt: { receiptId: 'sim-2', simulated: true } },
  };
  const unconfirmedRun = firstRun(simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: unconfirmed,
  }));
  assert.equal(unconfirmedRun.status, 'failed');
  assert.equal(unconfirmedRun.error?.code, 'delivery_not_confirmed');

  const unmarked = mutableFixtures(stageReminderFixtures);
  unmarked.nodes['save-model'] = {
    status: 'ok',
    outputs: { saved: true, saveReceipt: { receiptId: 'sim-3' } },
  };
  const unmarkedRun = firstRun(simulate({
    definition: createStageReminderDefinition(),
    scenario: stageReminderScenario,
    fixtures: unmarked,
  }));
  assert.equal(unmarkedRun.status, 'completed');
  assert.equal(receiptOf(unmarkedRun, 'save-model', 'saveReceipt').simulated, true);
});

test('daily and weekly share the period contract and reject mismatched events', () => {
  const daily = firstRun(simulate({
    definition: createPeriodReportDefinition('daily'),
    scenario: dailyReportScenario,
    fixtures: dailyReportFixtures,
  }));
  assert.equal(daily.status, 'completed');
  assert.equal(daily.outcome, 'delivered');
  const dailyCompose = daily.proposedOperations.find((operation) => operation.nodeId === 'compose-report');
  assert.ok(dailyCompose);
  assert.equal(dailyCompose.input.periodKind, 'daily');
  assert.equal(dailyCompose.input.periodStart, '2026-11-10');
  assert.equal(dailyCompose.input.periodEnd, '2026-11-10');
  assert.equal(daily.outputs['compose-report']?.title, '施工日报（模拟）');
  const dailyRecords = dailyCompose.input.records;
  assert.ok(Array.isArray(dailyRecords));
  for (const record of dailyRecords) {
    assert.ok(record && typeof record === 'object' && !Array.isArray(record));
    assert.equal((record as Record<string, unknown>).occurredAt, '2026-11-10');
  }

  const weekly = firstRun(simulate({
    definition: createPeriodReportDefinition('weekly'),
    scenario: weeklyReportScenario,
    fixtures: periodReportFixtures,
  }));
  const weeklyCompose = weekly.proposedOperations.find((operation) => operation.nodeId === 'compose-report');
  assert.ok(weeklyCompose);
  assert.equal(weekly.outputs['compose-report']?.title, '施工周报（模拟）');
  const records = weeklyCompose.input.records;
  assert.ok(Array.isArray(records));
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.ok(record && typeof record === 'object' && !Array.isArray(record));
    const value = record as Record<string, unknown>;
    assert.equal(value.source, 'construction_record');
    assert.equal(Object.hasOwn(value, 'generatedFromDailyReport'), false);
    const occurredAt = String(value.occurredAt);
    assert.ok(occurredAt >= '2026-11-03' && occurredAt <= '2026-11-09');
  }

  const mismatch = firstRun(simulate({
    definition: createPeriodReportDefinition('daily'),
    scenario: weeklyReportScenario,
    fixtures: periodReportFixtures,
  }));
  assert.equal(mismatch.status, 'failed');
  assert.equal(mismatch.error?.code, 'event_mismatch');
});

test('no receiver scope still saves the report but never proposes delivery', () => {
  const fixtures = mutableFixtures(periodReportFixtures);
  fixtures.nodes['read-receivers'] = {
    status: 'ok',
    outputs: { receivers: { scope: 'project_members', roles: [] }, receiverCount: 0 },
  };
  const run = firstRun(simulate({
    definition: createPeriodReportDefinition('weekly'),
    scenario: weeklyReportScenario,
    fixtures,
  }));
  assert.equal(run.status, 'halted');
  assert.equal(run.outcome, 'halted:condition-receivers:false');
  assert.ok(run.proposedOperations.some((operation) => operation.nodeId === 'save-report'));
  assert.equal(run.proposedOperations.some((operation) => operation.nodeId === 'deliver-report'), false);
  assert.equal(receiptOf(run, 'save-report', 'saveReceipt').simulated, true);
});
