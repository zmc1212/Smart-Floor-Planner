import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from '@/db/repositories/assistant-repository';
import { resolvePilotScope } from '@/lib/xiaok-v1/pilot-scope-resolver';
import type { PilotProjectScope } from '@/lib/xiaok-v1/pilot-project-scope';
import { reportAudienceEnabled } from '../report-scope';
import { advanceConfiguredConstructionReports, queueDueReports,
  type ReportQueuePeriod, type ReportQueueRuntime } from '../report-worker';

const now = new Date('2026-11-15T20:00:00+08:00');
const due = new Date('2026-11-15T19:00:00+08:00');
const later = new Date('2026-11-17T20:00:00+08:00');
const pilotEnv = {
  XIAOK_WEEKLY_REPORT_MODE: 'pilot',
  XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454',
  XIAOK_WEEKLY_REPORT_PILOT_ID: 'first-pilot',
};

const settings = (overrides: Partial<Row> = {}): Row => ({
  enterprise_id: '1454',
  project_ids: [],
  stage_keys: [],
  audiences: ['customer', 'boss'],
  stage_enabled: true,
  next_daily_at: due,
  next_weekly_at: later,
  daily_time: '20:00',
  weekly_time: '20:00',
  weekly_day: 1,
  stage_cursor: '0',
  ...overrides,
});
const pilotScope = (overrides: Partial<PilotProjectScope> = {}): PilotProjectScope => ({
  enterpriseId: '1454', pilotId: 'first-pilot', projectIds: ['101', '205'],
  createdBy: '9001', createdAt: '2026-11-14T09:00:00+08:00', scopeVersion: 1, status: 'active',
  ...overrides,
});
const binding = (id: string, audience: string, projectIds: string[]): Row =>
  ({ id, audience, project_ids: projectIds });

function queueFake(input: {
  bindings: Row[];
  events?: Row[];
  current?: (eventId: unknown) => boolean;
}) {
  const calls = {
    discovered: [] as Row[],
    enqueued: [] as Array<{ binding: Row; settings: Row; period: ReportQueuePeriod }>,
    current: [] as unknown[],
    cursors: [] as string[],
    next: [] as Array<{ kind: 'daily' | 'weekly'; at: Date }>,
    supplements: 0,
    succeeded: 0,
  };
  const seen = new Set<string>();
  const runtime: ReportQueueRuntime = {
    discoverBindings: async scoped => {
      calls.discovered.push(scoped);
      const projectIds = scoped.project_ids as string[];
      return input.bindings.filter(item => reportAudienceEnabled(scoped, item)
        && (projectIds.length === 0 || (item.project_ids as string[]).some(id => projectIds.includes(id))));
    },
    enqueue: async (item, scoped, period) => {
      calls.enqueued.push({ binding: item, settings: scoped, period });
      const key = [String(item.id), period.kind, period.start.toISOString(), period.stageEventId ?? ''].join(':');
      if (seen.has(key)) return null;
      seen.add(key); calls.succeeded++;
      return { key };
    },
    supplementDaily: async () => { calls.supplements++; return 0; },
    stageEvents: async () => input.events ?? [],
    currentStageEvent: async eventId => {
      calls.current.push(eventId);
      return input.current?.(eventId) === false ? undefined : { id: eventId };
    },
    advanceNext: async (kind, at) => { calls.next.push({ kind, at }); },
    advanceStageCursor: async cursor => { calls.cursors.push(cursor); },
  };
  return { runtime, calls };
}

// A. enterprise 模式仍调用原企业级周报 Worker。
test('A. enterprise mode keeps the existing report worker', async () => {
  const calls: Array<[Date, string | undefined, readonly string[] | undefined]> = [];
  const checks = await advanceConfiguredConstructionReports({ now, env: {},
    advance: async (at, enterpriseId, pilotProjectIds) => {
      calls.push([at, enterpriseId, pilotProjectIds]);
      return { queued: 2, errors: [] };
    } });

  assert.deepEqual(calls, [[now, undefined, undefined]]);
  assert.deepEqual(checks, { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
    scopedProjects: null, queued: 2, errors: [] });
});

// B. pilot 范围 101、205，企业报告不限项目时只生成 101、205。
test('B. a pilot run with no enterprise filter queues only the pilot projects', async () => {
  const { runtime, calls } = queueFake({
    bindings: [binding('1', 'customer', ['101']), binding('2', 'customer', ['205']),
      binding('3', 'customer', ['306'])],
  });

  const result = await queueDueReports({ enterpriseId: '1454', now, settings: settings(), nativeWeekly: new Set(),
    pilotProjectIds: ['101', '205'], runtime });

  assert.deepEqual(result, { queued: 2, scopedProjects: 2 });
  assert.deepEqual(calls.discovered[0].project_ids, ['101', '205']);
  assert.equal(calls.enqueued.length, 2);
  assert.ok(calls.enqueued.every(item => (item.settings.project_ids as string[]).join(',') === '101,205'));
  assert.ok(calls.enqueued.every(item => !(item.binding.project_ids as string[]).includes('306')));
  assert.equal(calls.supplements, 0);
});

// C. 企业限制 205、306 时最终只生成 205。
test('C. the enterprise report filter narrows the pilot scope', async () => {
  const { runtime, calls } = queueFake({
    bindings: [binding('1', 'customer', ['205']), binding('2', 'customer', ['306'])],
  });

  const result = await queueDueReports({ enterpriseId: '1454', now,
    settings: settings({ project_ids: ['205', '306'] }), nativeWeekly: new Set(),
    pilotProjectIds: ['101', '205'], runtime });

  assert.deepEqual(result, { queued: 1, scopedProjects: 1 });
  assert.deepEqual(calls.enqueued.map(item => item.settings.project_ids), [['205']]);
});

// D. 交集为空时不发现 binding、不创建报告。
test('D. an empty intersection queues no report', async () => {
  const { runtime, calls } = queueFake({ bindings: [binding('1', 'customer', ['306'])] });

  const result = await queueDueReports({ enterpriseId: '1454', now,
    settings: settings({ project_ids: ['306'] }), nativeWeekly: new Set(),
    pilotProjectIds: ['101', '205'], runtime });

  assert.deepEqual(result, { queued: 0, scopedProjects: 0 });
  assert.deepEqual(calls.discovered, []);
  assert.deepEqual(calls.enqueued, []);
});

// E. pilot 不存在或停用时零生成。
test('E. a missing or inactive pilot queues nothing', async () => {
  for (const record of [null, pilotScope({ status: 'inactive', scopeVersion: 4 })]) {
    let advanced = 0;
    const checks = await advanceConfiguredConstructionReports({ now, env: pilotEnv,
      resolveScope: async (enterpriseId, pilotId, at) => resolvePilotScope({ enterpriseId, pilotId,
        context: { read: async () => record, now: at } }),
      advance: async () => { advanced++; return { queued: 9, errors: [] }; } });

    assert.equal(advanced, 0);
    assert.deepEqual([checks.mode, checks.scopeStatus, checks.queued, checks.scopedProjects],
      ['pilot', record ? 'inactive' : 'not_found', 0, 0]);
  }
});

// F. Resolver 故障时不回退企业全量。
test('F. an unavailable resolver queues nothing and never falls back', async () => {
  let advanced = 0;
  const checks = await advanceConfiguredConstructionReports({ now, env: pilotEnv,
    resolveScope: async () => { throw new Error('database unavailable'); },
    advance: async () => { advanced++; return { queued: 99, errors: [] }; } });

  assert.equal(advanced, 0);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: null,
    scopeStatus: 'unavailable', scopedProjects: 0, queued: 0,
    errors: [{ enterpriseId: '1454', code: 'pilot_scope_unavailable' }] });
});

// G. 范围外的 stage event 只推进游标，不创建报告。
test('G. an out-of-scope stage event never queues a report', async () => {
  const { runtime, calls } = queueFake({
    bindings: [binding('1', 'customer', ['101']), binding('2', 'boss', ['101', '306'])],
    events: [
      { id: '11', aggregate_id: '101', created_at: '2026-11-15T10:00:00+08:00' },
      { id: '12', aggregate_id: '306', created_at: '2026-11-15T11:00:00+08:00' },
    ],
  });

  const result = await queueDueReports({ enterpriseId: '1454', now,
    settings: settings({ next_daily_at: later }), nativeWeekly: new Set(),
    pilotProjectIds: ['101'], runtime });

  assert.deepEqual(result, { queued: 2, scopedProjects: 1 });
  assert.deepEqual(calls.current, ['11']);
  assert.deepEqual(calls.enqueued.map(item => item.period.stageEventId), ['11', '11']);
  assert.deepEqual(calls.cursors, ['12']);
});

// H. 角色权限和报告受众过滤仍然有效。
test('H. pilot scope keeps the existing audience filter', async () => {
  const { runtime, calls } = queueFake({
    bindings: [binding('1', 'customer', ['101']), binding('2', 'boss', ['101'])],
  });

  const result = await queueDueReports({ enterpriseId: '1454', now,
    settings: settings({ audiences: ['boss'] }), nativeWeekly: new Set(),
    pilotProjectIds: ['101'], runtime });

  assert.deepEqual(result, { queued: 1, scopedProjects: 1 });
  assert.deepEqual(calls.discovered[0].audiences, ['boss']);
  assert.deepEqual(calls.discovered[0].stage_keys, []);
  assert.deepEqual(calls.enqueued.map(item => item.binding.audience), ['boss']);
});

// I. 原企业 settings.project_ids 不被 Worker 修改。
test('I. the saved enterprise project ids are not modified', async () => {
  const original = settings({ project_ids: ['205', '306'] });
  const { runtime } = queueFake({ bindings: [binding('1', 'customer', ['205'])] });

  await queueDueReports({ enterpriseId: '1454', now, settings: original, nativeWeekly: new Set(),
    pilotProjectIds: ['101', '205'], runtime });

  assert.deepEqual(original.project_ids, ['205', '306']);
});

// J. 重复 tick 保持报告幂等。
test('J. a repeated tick keeps report idempotency', async () => {
  const original = settings();
  const { runtime, calls } = queueFake({ bindings: [binding('1', 'customer', ['101'])] });

  const first = await queueDueReports({ enterpriseId: '1454', now, settings: original,
    nativeWeekly: new Set(), pilotProjectIds: ['101'], runtime });
  const second = await queueDueReports({ enterpriseId: '1454', now, settings: original,
    nativeWeekly: new Set(), pilotProjectIds: ['101'], runtime });

  assert.deepEqual([first.queued, first.scopedProjects], [1, 1]);
  assert.equal(second.queued, 0);
  assert.equal(calls.succeeded, 1);
});

// 配置错误时跳过周报生成，不回退 enterprise。
test('an invalid weekly configuration skips report generation', async () => {
  let advanced = 0;
  const checks = await advanceConfiguredConstructionReports({ now,
    env: { XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
    advance: async () => { advanced++; return { queued: 9, errors: [] }; } });

  assert.equal(advanced, 0);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: null, scopeVersion: null, scopeStatus: null,
    scopedProjects: 0, queued: 0, errors: [{ enterpriseId: '', code: 'weekly_report_pilot_required' }] });
});
