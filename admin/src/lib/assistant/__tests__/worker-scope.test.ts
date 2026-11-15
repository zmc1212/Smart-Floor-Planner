import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nativeWorkflowScope, workerTaskScope } from '../infrastructure/worker-scope';
import { evaluateWorkerSafetyGate } from '@/lib/xiaok-v1/worker-safety-gate';

const pilotGate = evaluateWorkerSafetyGate({
  XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
  XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
  XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
  XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot',
});

test('I7.5.9 a closed gate has no task scope', () => {
  const execution = workerTaskScope(evaluateWorkerSafetyGate({}));
  assert.deepEqual(execution, { enabled: false, enterpriseId: null, pilotId: null, scope: undefined });
});

test('I7.5.9 an open pilot gate scopes every task to one enterprise', () => {
  assert.deepEqual(workerTaskScope(pilotGate), {
    enabled: true, enterpriseId: '1454', pilotId: 'first-pilot',
    scope: { enterpriseId: '1454' },
  });
});

test('I7.5.9 native workflow is disabled unless its own switch is on', () => {
  assert.deepEqual(nativeWorkflowScope(['1454'], '1454', false),
    { allowed: false, reason: 'not_enabled', enterpriseIds: ['1454'] });
});

test('I7.5.9 native workflow in pilot mode accepts only the same enterprise', () => {
  assert.deepEqual(nativeWorkflowScope(['1454'], '1454', true),
    { allowed: true, reason: 'pilot_enterprise', enterpriseIds: ['1454'] });
  assert.deepEqual(nativeWorkflowScope(['1454', '1455'], '1454', true),
    { allowed: false, reason: 'pilot_scope_override', enterpriseIds: ['1454', '1455'] });
  assert.deepEqual(nativeWorkflowScope(['1455'], '1454', true),
    { allowed: false, reason: 'pilot_scope_override', enterpriseIds: ['1455'] });
  assert.deepEqual(nativeWorkflowScope([], '1454', true),
    { allowed: false, reason: 'pilot_scope_not_configured', enterpriseIds: [] });
});

test('I7.5.9 native workflow keeps its original enterprise list outside pilot', () => {
  assert.deepEqual(nativeWorkflowScope(['1454', '1455'], null, true),
    { allowed: true, reason: 'pilot_enterprise', enterpriseIds: ['1454', '1455'] });
});
