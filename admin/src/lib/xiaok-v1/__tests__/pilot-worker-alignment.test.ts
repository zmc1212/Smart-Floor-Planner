import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPilotWorkerAlignment } from '../pilot-worker-alignment';

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

// A. Both workers are unscoped enterprise workers.
test('A. both enterprise ids empty stay aligned', () => {
  const result = checkPilotWorkerAlignment({});
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'enterprise', null, null, null]);
});

// B. Both workers name the same enterprise.
test('B. identical enterprise ids stay aligned', () => {
  const result = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'enterprise', '1454', null, null]);
});

// C. Only the reminder worker is enterprise-scoped.
test('C. a reminder-only enterprise id is a mismatch', () => {
  const result = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['mismatch', 'enterprise', '1454', null, 'pilot_worker_enterprise_mismatch']);
});

// D. Only the weekly-report worker is enterprise-scoped.
test('D. a weekly-report-only enterprise id is a mismatch', () => {
  const result = checkPilotWorkerAlignment({ XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['mismatch', 'enterprise', '1454', null, 'pilot_worker_enterprise_mismatch']);
});

// E. The two enterprise workers name different enterprises.
test('E. different enterprise ids are a mismatch', () => {
  const result = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.errorCode],
    ['mismatch', 'enterprise', '1454', 'pilot_worker_enterprise_mismatch']);
});

// F. Identical pilot configurations are still aligned.
test('F. identical pilot configurations stay aligned', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'pilot', '1454', 'first-pilot', null]);
});

test('F2. mixed pilot and enterprise modes remain a mismatch', () => {
  const reminderPilot = checkPilotWorkerAlignment({ ...stagePilot });
  assert.deepEqual([reminderPilot.status, reminderPilot.errorCode, reminderPilot.mode],
    ['mismatch', 'pilot_worker_mode_mismatch', 'pilot']);
  assert.deepEqual([reminderPilot.enterpriseId, reminderPilot.pilotId], ['1454', 'first-pilot']);

  const weeklyPilotOnly = checkPilotWorkerAlignment({ ...weeklyPilot });
  assert.deepEqual([weeklyPilotOnly.status, weeklyPilotOnly.errorCode, weeklyPilotOnly.mode],
    ['mismatch', 'pilot_worker_mode_mismatch', 'pilot']);
});

// G. The pilot ids differ.
test('G. different pilot ids are a mismatch', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'second-pilot' });
  assert.deepEqual([result.status, result.errorCode, result.enterpriseId, result.pilotId],
    ['mismatch', 'pilot_worker_pilot_mismatch', '1454', 'first-pilot']);
});

// H. Invalid configurations fail closed and never become enterprise.
test('H. invalid configurations fail closed', () => {
  const reminderInvalid = checkPilotWorkerAlignment({ ...weeklyPilot,
    XIAOK_STAGE_REMINDER_MODE: 'tenant' });
  assert.deepEqual([reminderInvalid.status, reminderInvalid.mode, reminderInvalid.enterpriseId,
    reminderInvalid.pilotId, reminderInvalid.errorCode],
    ['invalid', null, null, null, 'stage_reminder_mode_invalid']);

  const weeklyInvalid = checkPilotWorkerAlignment({ ...stagePilot,
    XIAOK_WEEKLY_REPORT_MODE: 'enterprise,pilot' });
  assert.deepEqual([weeklyInvalid.status, weeklyInvalid.mode, weeklyInvalid.errorCode],
    ['invalid', null, 'weekly_report_mode_invalid']);

  const missingPilot = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_PILOT_ID: '' });
  assert.deepEqual([missingPilot.status, missingPilot.errorCode],
    ['invalid', 'weekly_report_pilot_required']);

  const missingEnterprise = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '' });
  assert.deepEqual([missingEnterprise.status, missingEnterprise.errorCode],
    ['invalid', 'stage_reminder_enterprise_required']);

  for (const result of [reminderInvalid, weeklyInvalid, missingPilot, missingEnterprise]) {
    assert.notEqual(result.status, 'aligned');
    assert.notEqual(result.mode, 'enterprise');
  }
});

// I. The Worker route gates all four reminder/report entries.
test('I. the worker route skips all four pilot workers when alignment fails', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/internal/assistant/jobs/run/route.ts'), 'utf8');
  const gate = source.indexOf('const pilotWorkersEnabled');
  assert.ok(gate > 0);
  for (const call of ['advanceConfiguredConstructionReports({ now', 'advanceConfiguredStageReminders({ now',
    'deliverConfiguredConstructionReports({ now', 'deliverConfiguredStageReminders({ now']) {
    const index = source.indexOf(call);
    assert.ok(index > gate, call + ' must run after the alignment gate');
  }
  assert.match(source, /const pilotScopeAlignment = checkPilotWorkerAlignment\(\)/);
  assert.match(source, /skipped: true, reason: 'pilot_worker_alignment'/);
  assert.match(source, /pilotScopeAlignment, nativeWorkflowSchedule/);
});

// J. Other Assistant jobs and the 401 guard remain outside the gate.
test('J. other assistant jobs remain unaffected', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/internal/assistant/jobs/run/route.ts'), 'utf8');
  assert.match(source, /if \(!authorized\(request\)\)[\s\S]*status: 401/);
  assert.match(source, /const knowledgeBatchChecks=await advanceKnowledgeBatches\(\)/);
  assert.match(source, /const data = await processAssistantJob\(processAssistantRun\)/);
  assert.match(source, /deliverSiteNotifications\(\) \+ await deliverPublicConsents\(\)/);
  assert.match(source, /runNativeWorkflowScheduleTick/);
});
