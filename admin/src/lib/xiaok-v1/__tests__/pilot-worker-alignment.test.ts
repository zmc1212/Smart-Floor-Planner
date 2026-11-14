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

// A. 两边均 enterprise、均未指定企业。
test('F4 A. both enterprise without an enterprise id stay aligned', () => {
  const result = checkPilotWorkerAlignment({});
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'enterprise', null, null, null]);
});

// B. 两边均 enterprise、企业 ID 相同。
test('F4 B. identical enterprise ids stay aligned', () => {
  const result = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'enterprise', '1454', null, null]);
});

// C. 两边均 pilot、enterpriseId 和 pilotId 相同。
test('F4 C. identical pilot configurations stay aligned', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['aligned', 'pilot', '1454', 'first-pilot', null]);
});

// D. 提醒 pilot、周报 enterprise。
test('F4 D. a pilot reminder with an enterprise report is a mismatch', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['mismatch', 'pilot', '1454', 'first-pilot', 'pilot_worker_mode_mismatch']);
});

// E. 提醒 enterprise、周报 pilot。
test('F4 E. an enterprise reminder with a pilot report is a mismatch', () => {
  const result = checkPilotWorkerAlignment({ ...weeklyPilot, XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['mismatch', 'pilot', '1454', 'first-pilot', 'pilot_worker_mode_mismatch']);
});

// F. 两边 enterpriseId 不同。
test('F4 F. different enterprise ids are a mismatch', () => {
  const result = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' });
  assert.deepEqual([result.status, result.mode, result.enterpriseId, result.pilotId, result.errorCode],
    ['mismatch', 'enterprise', '1454', null, 'pilot_worker_enterprise_mismatch']);

  const pilotSide = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' });
  assert.deepEqual([pilotSide.status, pilotSide.errorCode, pilotSide.mode],
    ['mismatch', 'pilot_worker_enterprise_mismatch', 'pilot']);
});

// G. 两边 pilotId 不同。
test('F4 G. different pilot ids are a mismatch', () => {
  const result = checkPilotWorkerAlignment({ ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'second-pilot' });
  assert.deepEqual([result.status, result.errorCode, result.enterpriseId, result.pilotId],
    ['mismatch', 'pilot_worker_pilot_mismatch', '1454', 'first-pilot']);
});

// H. 任意一边配置非法。
test('F4 H. any invalid side fails closed and never becomes enterprise', () => {
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

// A one-sided enterprise id is not an implicit default.
test('parse. one-sided enterprise ids are mismatches', () => {
  const reminderOnly = checkPilotWorkerAlignment({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' });
  assert.deepEqual([reminderOnly.status, reminderOnly.errorCode],
    ['mismatch', 'pilot_worker_enterprise_mismatch']);

  const weeklyOnly = checkPilotWorkerAlignment({ XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  assert.deepEqual([weeklyOnly.status, weeklyOnly.errorCode],
    ['mismatch', 'pilot_worker_enterprise_mismatch']);
});

// The Worker tick gates all four reminder/report entries behind alignment.
test('W. the worker tick skips all four pilot workers when alignment fails', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/assistant/infrastructure/jobs-tick.ts'), 'utf8');
  const gate = source.indexOf('const pilotWorkersEnabled');
  assert.ok(gate > 0);
  for (const call of ['advanceReports({ now, env })', 'deliverReports({ now, env })',
    'advanceReminders({ now, env })', 'deliverReminders({ now, env })']) {
    const index = source.indexOf(call);
    assert.ok(index > gate, call + ' must run after the alignment gate');
  }
  assert.match(source, /const pilotScopeAlignment = alignmentOf\(env\)/);
  assert.match(source, /skipped: true, reason: 'pilot_worker_alignment'/);
  assert.match(source, /pilotScopeAlignment,/);
});

// Other Assistant jobs and the 401 guard remain outside the gate.
test('W2. the route authenticates before the tick and keeps other jobs independent', () => {
  const route = readFileSync(join(process.cwd(), 'src/app/api/internal/assistant/jobs/run/route.ts'), 'utf8');
  assert.match(route, /if \(!authorized\(request\)\)[\s\S]*status: 401/);
  assert.match(route, /return assistantJobsPost\(request\)/);

  const tick = readFileSync(join(process.cwd(), 'src/lib/assistant/infrastructure/jobs-tick.ts'), 'utf8');
  assert.match(tick, /const knowledgeBatchChecks = await knowledgeBatches\(\)/);
  assert.match(tick, /const data = await assistantJob\(assistantRun\)/);
  assert.match(tick, /siteNotifications\(\) \+ await publicConsents\(\)/);
  assert.match(tick, /runNativeWorkflowScheduleTick/);
});
