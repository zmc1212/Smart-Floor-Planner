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

// A. Both workers stay in enterprise mode.
test('A. enterprise + enterprise keeps the existing behavior', () => {
  const unset = checkPilotWorkerAlignment({});
  assert.equal(unset.status, 'aligned');
  assert.equal(unset.mode, 'enterprise');
  assert.equal(unset.enterpriseId, null);
  assert.equal(unset.pilotId, null);
  assert.equal(unset.errorCode, null);

  const same = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  assert.deepEqual([same.status, same.mode, same.enterpriseId, same.pilotId, same.errorCode],
    ['aligned', 'enterprise', '1454', null, null]);

  const oneSided = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' });
  assert.deepEqual([oneSided.status, oneSided.mode, oneSided.enterpriseId, oneSided.pilotId],
    ['aligned', 'enterprise', '1454', null]);
});

// B. Both workers use the same pilot.
test('B. identical pilot configurations are aligned', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'pilot', '1454', 'first-pilot', null]);
  assert.equal(result.reminderConfig.ok, true);
  assert.equal(result.weeklyReportConfig.ok, true);
});

// C. One worker is pilot and the other is enterprise.
test('C. mixed pilot and enterprise modes are rejected', () => {
  const reminderPilot = checkPilotWorkerAlignment({ ...stagePilot });
  assert.deepEqual([reminderPilot.status, reminderPilot.errorCode, reminderPilot.mode],
    ['mismatch', 'pilot_worker_mode_mismatch', 'pilot']);
  assert.deepEqual([reminderPilot.enterpriseId, reminderPilot.pilotId], ['1454', 'first-pilot']);

  const weeklyPilotOnly = checkPilotWorkerAlignment({ XIAOK_WEEKLY_REPORT_MODE: 'pilot',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454', XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot' });
  assert.deepEqual([weeklyPilotOnly.status, weeklyPilotOnly.errorCode, weeklyPilotOnly.mode],
    ['mismatch', 'pilot_worker_mode_mismatch', 'pilot']);
});

// D. Different enterprise ids are rejected.
test('D. different enterprise ids are rejected', () => {
  const enterprise = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' });
  assert.deepEqual([enterprise.status, enterprise.errorCode, enterprise.mode],
    ['mismatch', 'pilot_worker_enterprise_mismatch', 'enterprise']);

  const pilot = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' });
  assert.deepEqual([pilot.status, pilot.errorCode, pilot.enterpriseId],
    ['mismatch', 'pilot_worker_enterprise_mismatch', '1454']);
});

// E. Different pilot ids are rejected.
test('E. different pilot ids are rejected', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'second-pilot' });
  assert.deepEqual([result.status, result.errorCode, result.enterpriseId, result.pilotId],
    ['mismatch', 'pilot_worker_pilot_mismatch', '1454', 'first-pilot']);
});

// F. Any invalid configuration is invalid and never aligned.
test('F. an invalid worker configuration is never executable', () => {
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
});

// G. Invalid or mismatched results never fall back to enterprise.
test('G. no failed alignment silently becomes enterprise', () => {
  for (const env of [
    { ...stagePilot, XIAOK_WEEKLY_REPORT_MODE: 'enterprise' },
    { ...stagePilot, ...weeklyPilot, XIAOK_WEEKLY_REPORT_PILOT_ID: 'other' },
    { ...stagePilot, XIAOK_WEEKLY_REPORT_MODE: 'unknown' },
  ]) {
    const result = checkPilotWorkerAlignment(env);
    assert.notEqual(result.status, 'aligned');
    assert.notEqual(result.mode, 'enterprise');
  }
});

// Route gating: the four pilot workers are skipped unless aligned, while other
// Assistant jobs and the 401 guard remain outside the alignment gate.
test('the worker route skips all four pilot workers when alignment fails', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/internal/assistant/jobs/run/route.ts'), 'utf8');
  const gate = source.indexOf('const pilotWorkersEnabled');
  assert.ok(gate > 0);
  for (const call of ['advanceConfiguredConstructionReports({ now', 'advanceConfiguredStageReminders({ now',
    'deliverConfiguredConstructionReports({ now', 'deliverConfiguredStageReminders({ now']) {
    const index = source.indexOf(call);
    assert.ok(index > gate, call + ' must run after the alignment gate');
  }
  assert.match(source, /if \(!authorized\(request\)\)[\s\S]*status: 401/);
  assert.match(source, /const pilotScopeAlignment = checkPilotWorkerAlignment\(\)/);
  assert.match(source, /skipped: true, reason: 'pilot_worker_alignment'/);
  assert.match(source, /const knowledgeBatchChecks=await advanceKnowledgeBatches\(\)/);
  assert.match(source, /const data = await processAssistantJob\(processAssistantRun\)/);
  assert.match(source, /deliverSiteNotifications\(\) \+ await deliverPublicConsents\(\)/);
  assert.match(source, /pilotScopeAlignment, nativeWorkflowSchedule/);
});
