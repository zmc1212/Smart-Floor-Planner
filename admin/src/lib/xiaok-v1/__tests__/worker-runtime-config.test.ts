import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveWorkerDeployment, workerSafetyGateFromConfig,
  type WorkerRuntimeConfig,
} from '../worker-runtime-config';

const config = (overrides: Partial<WorkerRuntimeConfig> = {}): WorkerRuntimeConfig => ({
  version: 1,
  enabled: true,
  enterpriseId: '1454',
  pilotId: 'first-pilot',
  updatedBy: '7',
  updatedAt: '2026-11-17T00:00:00.000Z',
  ...overrides,
});

const legacyPilotEnv = {
  XIAOK_STAGE_REMINDER_MODE: 'pilot',
  XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
  XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
  XIAOK_WEEKLY_REPORT_MODE: 'pilot',
  XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
  XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot',
};

test('a saved enabled switch opens only the named pilot', () => {
  const gate = workerSafetyGateFromConfig(config());
  assert.deepEqual([gate.status, gate.reason, gate.deliveryScope, gate.mode],
    ['open', 'pilot_scope_configured', 'pilot', 'pilot']);
  assert.deepEqual([gate.enterpriseId, gate.pilotId, gate.errorCode], ['1454', 'first-pilot', null]);
});

test('a saved off switch closes the gate without an enterprise fallback', () => {
  const gate = workerSafetyGateFromConfig(config({ enabled: false }));
  assert.deepEqual([gate.status, gate.reason, gate.deliveryScope, gate.mode],
    ['closed', 'worker_disabled', 'none', null]);
  assert.deepEqual([gate.enterpriseId, gate.pilotId, gate.errorCode], [null, null, 'worker_disabled']);
});

test('a saved switch without ids stays closed', () => {
  const gate = workerSafetyGateFromConfig(config({ enterpriseId: null, pilotId: null }));
  assert.deepEqual([gate.status, gate.reason, gate.errorCode],
    ['closed', 'pilot_scope_missing', 'worker_pilot_scope_missing']);
});

test('the database version overrides legacy environment pairs', async () => {
  const deployment = await resolveWorkerDeployment({
    env: legacyPilotEnv,
    read: async () => config({ enterpriseId: '1500', pilotId: 'second-pilot' }),
  });
  assert.equal(deployment.source, 'database');
  assert.equal(deployment.gate.status, 'open');
  assert.deepEqual([deployment.env.XIAOK_STAGE_REMINDER_ENTERPRISE_ID,
    deployment.env.XIAOK_STAGE_REMINDER_PILOT_ID, deployment.env.XIAOK_WEEKLY_REPORT_ENTERPRISE_ID,
    deployment.env.XIAOK_WEEKLY_REPORT_PILOT_ID], ['1500', 'second-pilot', '1500', 'second-pilot']);
  assert.equal(deployment.env.XIAOK_STAGE_REMINDER_MODE, 'pilot');
});

test('an off switch removes legacy pilot variables from the effective env', async () => {
  const deployment = await resolveWorkerDeployment({
    env: legacyPilotEnv,
    read: async () => config({ enabled: false }),
  });
  assert.equal(deployment.gate.reason, 'worker_disabled');
  for (const key of ['XIAOK_STAGE_REMINDER_MODE', 'XIAOK_STAGE_REMINDER_ENTERPRISE_ID',
    'XIAOK_STAGE_REMINDER_PILOT_ID', 'XIAOK_WEEKLY_REPORT_MODE',
    'XIAOK_WEEKLY_REPORT_ENTERPRISE_ID', 'XIAOK_WEEKLY_REPORT_PILOT_ID']) {
    assert.equal(deployment.env[key], undefined);
  }
});

test('no saved row keeps the legacy environment gate', async () => {
  const deployment = await resolveWorkerDeployment({ env: legacyPilotEnv, read: async () => undefined });
  assert.equal(deployment.source, 'environment');
  assert.equal(deployment.config, null);
  assert.equal(deployment.gate.status, 'open');
  assert.equal(deployment.env, legacyPilotEnv);
});

test('an unreadable configuration falls back to the explicit environment scope', async () => {
  const deployment = await resolveWorkerDeployment({
    env: legacyPilotEnv,
    read: async () => { throw new Error('database_unavailable'); },
  });
  assert.equal(deployment.source, 'environment');
  assert.equal(deployment.gate.status, 'open');
  assert.equal(deployment.gate.enterpriseId, '1454');
});

test('an unreadable configuration without a pilot stays closed', async () => {
  const deployment = await resolveWorkerDeployment({
    env: {},
    read: async () => { throw new Error('database_unavailable'); },
  });
  assert.equal(deployment.gate.status, 'closed');
  assert.equal(deployment.gate.reason, 'pilot_scope_missing');
});
