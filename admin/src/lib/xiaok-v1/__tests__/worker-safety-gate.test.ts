import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateWorkerSafetyGate } from '../worker-safety-gate';

const stagePilot = {
  XIAOK_STAGE_REMINDER_MODE: 'pilot',
  XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
  XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
};
const weeklyPilot = {
  XIAOK_WEEKLY_REPORT_MODE: 'pilot',
  XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
  XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot',
};
const stageEnterprise = {
  XIAOK_STAGE_REMINDER_MODE: 'enterprise',
  XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
};
const weeklyEnterprise = {
  XIAOK_WEEKLY_REPORT_MODE: 'enterprise',
  XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
};

test('I7.5.8 no pilot configuration keeps both business workers closed', () => {
  const gate = evaluateWorkerSafetyGate({});
  assert.deepEqual([gate.status, gate.reason, gate.deliveryScope, gate.errorCode],
    ['closed', 'pilot_scope_missing', 'none', 'worker_pilot_scope_missing']);
  assert.equal(gate.mode, 'enterprise');
  assert.equal(gate.enterpriseId, null);
});

test('I7.5.8 an enterprise mode is never opened without a pilot', () => {
  for (const env of [
    { ...stageEnterprise, ...weeklyEnterprise },
    { XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
    { XIAOK_STAGE_REMINDER_MODE: 'enterprise', XIAOK_WEEKLY_REPORT_MODE: 'enterprise' },
  ]) {
    const gate = evaluateWorkerSafetyGate(env);
    assert.deepEqual([gate.status, gate.reason, gate.deliveryScope, gate.errorCode],
      ['closed', 'enterprise_scope_not_allowed', 'none', 'worker_enterprise_scope_not_allowed']);
  }
});

test('I7.5.8 an explicitly saved pilot scope opens the gate', () => {
  const gate = evaluateWorkerSafetyGate({ ...stagePilot, ...weeklyPilot });
  assert.deepEqual([gate.status, gate.reason, gate.deliveryScope, gate.mode,
    gate.enterpriseId, gate.pilotId], ['open', 'pilot_scope_configured', 'pilot', 'pilot', '1454', 'first-pilot']);
});

test('I7.5.8 a reminder-only pilot configuration is still a mismatch', () => {
  const gate = evaluateWorkerSafetyGate(stagePilot);
  assert.deepEqual([gate.status, gate.reason, gate.errorCode],
    ['closed', 'pilot_worker_alignment', 'pilot_worker_mode_mismatch']);
});

test('I7.5.8 mode, enterprise and pilot mismatches stay closed', () => {
  const cases: Array<[Record<string, string | undefined>, string]> = [
    [{ ...stagePilot, XIAOK_WEEKLY_REPORT_MODE: 'enterprise', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
      'pilot_worker_mode_mismatch'],
    [{ ...stagePilot, ...weeklyPilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' },
      'pilot_worker_enterprise_mismatch'],
    [{ ...stagePilot, ...weeklyPilot, XIAOK_WEEKLY_REPORT_PILOT_ID: 'second-pilot' },
      'pilot_worker_pilot_mismatch'],
    [{ ...stagePilot, ...weeklyPilot, XIAOK_STAGE_REMINDER_MODE: 'tenant' },
      'stage_reminder_mode_invalid'],
    [{ ...stagePilot, ...weeklyPilot, XIAOK_WEEKLY_REPORT_PILOT_ID: '' },
      'weekly_report_pilot_required'],
  ];
  for (const [env, errorCode] of cases) {
    const gate = evaluateWorkerSafetyGate(env);
    assert.equal(gate.status, 'closed');
    assert.equal(gate.reason, 'pilot_worker_alignment');
    assert.equal(gate.errorCode, errorCode);
    assert.equal(gate.deliveryScope, 'none');
  }
});
