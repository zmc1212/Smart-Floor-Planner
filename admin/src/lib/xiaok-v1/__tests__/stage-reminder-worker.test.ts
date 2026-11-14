import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { advanceConfiguredStageReminders } from '../stage-reminder-worker';

const now = new Date('2026-11-15T10:00:00+08:00');
const pilotEnv = {
  XIAOK_STAGE_REMINDER_MODE: 'pilot',
  XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
  XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot',
};
type Call = [Date, string | undefined, string | undefined];

// A. 默认 enterprise 模式仍调用原企业级 Worker。
test('A. an unset mode runs the enterprise worker', async () => {
  const calls: Call[] = [];
  const checks = await advanceConfiguredStageReminders({ now, env: {},
    advance: async (at, enterpriseId, pilotId) => {
      calls.push([at, enterpriseId, pilotId]);
      return { created: 2, errors: [] };
    } });

  assert.deepEqual(calls, [[now, undefined, undefined]]);
  assert.deepEqual(checks, { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
    scannedProjects: null, skippedProjects: null, created: 2, errors: [] });
});

// B. 显式 enterprise 模式按配置的企业范围运行，不切换为试点。
test('B. an explicit enterprise mode runs the enterprise worker', async () => {
  const calls: Call[] = [];
  const checks = await advanceConfiguredStageReminders({
    now,
    env: { XIAOK_STAGE_REMINDER_MODE: 'enterprise',
      XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
      XIAOK_STAGE_REMINDER_PILOT_ID: 'first-pilot' },
    advance: async (at, enterpriseId, pilotId) => {
      calls.push([at, enterpriseId, pilotId]);
      return { created: 1, errors: [] };
    },
  });

  assert.deepEqual(calls, [[now, '1454', undefined]]);
  assert.deepEqual(checks, { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
    scannedProjects: null, skippedProjects: null, created: 1, errors: [] });
});

// C. pilot 模式把明确的企业 ID 和试点 ID 传入提醒服务，并回传范围结果。
test('C. a pilot mode passes both ids and records the scope result', async () => {
  const calls: Call[] = [];
  const checks = await advanceConfiguredStageReminders({ now, env: pilotEnv,
    advance: async (at, enterpriseId, pilotId) => {
      calls.push([at, enterpriseId, pilotId]);
      return { created: 3, errors: [], pilotId: 'first-pilot', scopeVersion: 2,
        scopeStatus: 'active', scannedProjects: 2, skippedProjects: 0 };
    } });

  assert.deepEqual(calls, [[now, '1454', 'first-pilot']]);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: 2,
    scopeStatus: 'active', scannedProjects: 2, skippedProjects: 0, created: 3, errors: [] });
});

// D. pilot 配置错误时不调用提醒服务，也不回退 enterprise。
test('D. an invalid pilot configuration never calls the reminder service', async () => {
  let calls = 0;
  const checks = await advanceConfiguredStageReminders({
    now,
    env: { XIAOK_STAGE_REMINDER_MODE: 'pilot', XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' },
    advance: async () => { calls += 1; return { created: 99, errors: [] }; },
  });

  assert.equal(calls, 0);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: null, scopeVersion: null, scopeStatus: null,
    scannedProjects: 0, skippedProjects: 0, created: 0,
    errors: [{ enterpriseId: '', projectId: '', code: 'stage_reminder_pilot_required' }] });
});

// E. Resolver 不可用时保留试点失败结果，不再发起企业扫描。
test('E. an unavailable resolver never falls back to the enterprise scan', async () => {
  const calls: Call[] = [];
  const checks = await advanceConfiguredStageReminders({ now, env: pilotEnv,
    advance: async (at, enterpriseId, pilotId) => {
      calls.push([at, enterpriseId, pilotId]);
      return { created: 0, errors: [{ enterpriseId: '1454', projectId: '',
        code: 'pilot_scope_unavailable' }], pilotId: 'first-pilot', scopeVersion: null,
        scopeStatus: 'unavailable', scannedProjects: 0, skippedProjects: 0 };
    } });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [now, '1454', 'first-pilot']);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: null,
    scopeStatus: 'unavailable', scannedProjects: 0, skippedProjects: 0, created: 0,
    errors: [{ enterpriseId: '1454', projectId: '', code: 'pilot_scope_unavailable' }] });
});

// F/G. Worker Route 只替换提醒推进入口；其余 Job、401 守卫和投递调用保持原样。
test('F/G. the worker route keeps the other jobs, auth guard and delivery flow', () => {
  const source = readFileSync(join(process.cwd(), 'src/app/api/internal/assistant/jobs/run/route.ts'), 'utf8');

  assert.match(source, /if \(!authorized\(request\)\)[\s\S]*status: 401/);
  assert.match(source, /advanceConfiguredStageReminders\(\{ now: new Date\(\) \}\)/);
  assert.doesNotMatch(source, /advanceStageReminders\(/);
  assert.match(source, /try \{ stageReminderChecks = await advanceConfiguredStageReminders[\s\S]*catch[\s\S]*const data = await processAssistantJob\(processAssistantRun\)/);
  assert.match(source, /const knowledgeBatchChecks=await advanceKnowledgeBatches\(\)/);
  assert.match(source, /const constructionReportChecks = await advanceConstructionReports\(\)/);
  assert.match(source, /const inAppDeliveries = [\s\S]*deliverStageReminders\(\)/);
  assert.ok(source.indexOf('advanceConfiguredStageReminders({ now') < source.indexOf('processAssistantJob(processAssistantRun)'));
  assert.ok(source.indexOf('processAssistantJob(processAssistantRun)') < source.indexOf('deliverStageReminders()'));
});
