import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Row } from '@/db/repositories/assistant-repository';
import { resolvePilotScope } from '@/lib/xiaok-v1/pilot-scope-resolver';
import type { PilotProjectScope } from '@/lib/xiaok-v1/pilot-project-scope';
import { validatePilotReportDelivery } from '@/lib/xiaok-v1/pilot-report-scope';
import { reportAudienceEnabled, type ReportFacts } from '../report-scope';
import { advanceConfiguredConstructionReports, deliverConfiguredConstructionReports, deliverReportBatch,
  queueDueReports, type ReportDeliveryRuntime, type ReportQueuePeriod, type ReportQueueRuntime } from '../report-worker';

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

type DeliveryRow = Row & {
  event_id: string; report_id: string; revision: number; binding_id: string; kind: string;
  stage_event_id: string | null; state: 'pending' | 'held' | 'delivered' | 'revoked';
  facts: unknown; generated_at: string; generation_context_revision: number;
  generation_conversation_id: string; policy_snapshot: Row; message_id: string | null;
};
type DeliveryBinding = Row & { id: string; conversation_id: string; status: string; list_hidden?: boolean };
type DeliveryConversation = Row & { id: string; context_revision: number; mode: string;
  status: string; entry_snapshot: Row };

const delivery = (overrides: Partial<DeliveryRow> = {}): DeliveryRow => ({
  event_id: '1', report_id: '8', revision: 1, binding_id: '1', kind: 'daily',
  stage_event_id: null, state: 'pending', facts: { projects: [{ id: '101' }] },
  generated_at: '2026-11-15T10:00:00+08:00', generation_context_revision: 3,
  generation_conversation_id: '11', policy_snapshot: { reportDispatchEpoch: 1 },
  message_id: null, ...overrides,
});
const deliveryBinding = (overrides: Partial<DeliveryBinding> = {}): DeliveryBinding => ({
  id: '1', audience: 'customer', status: 'enabled', conversation_id: '11', ...overrides,
});
const deliveryConversation = (overrides: Partial<DeliveryConversation> = {}): DeliveryConversation => ({
  id: '11', context_revision: 3, mode: 'ai', status: 'open', entry_snapshot: {}, ...overrides,
});

function deliveryFake(input: {
  deliveries: DeliveryRow[];
  bindings?: DeliveryBinding[];
  conversations?: DeliveryConversation[];
  permissionRevoked?: string[];
  active?: Record<string, string[]>;
  newer?: (item: Row) => DeliveryRow | undefined;
  reportCreatedBefore?: boolean;
}) {
  const messages: Array<{ id: string; conversationId: string; eventId: string }> = [];
  const attempts: Array<{ bindingId: string; reportId: string; revision: number }> = [];
  const runtime: ReportDeliveryRuntime = {
    binding: async item => input.bindings?.find(binding => binding.id === String(item.binding_id)),
    stageEventValid: async () => true,
    revalidatedFacts: async (item, binding) => input.permissionRevoked?.includes(String(binding.id))
      ? null : structuredClone(item.facts) as ReportFacts,
    activeProjects: async (binding, projectIds) => new Set((input.active?.[String(binding.id)] ?? projectIds)
      .map(String)),
    identity: async () => undefined,
    conversation: async binding => input.conversations!.find(item => item.id === String(binding.conversation_id))!,
    reportCreatedBefore: async () => input.reportCreatedBefore ?? false,
    newerDelivery: async item => input.newer?.(item),
    reopenConversation: async conversationId => {
      const conversation = input.conversations?.find(item => item.id === conversationId);
      if (conversation) conversation.status = 'open';
    },
    unhideBinding: async binding => { binding.list_hidden = false; },
    append: async (binding, item, conversationId) => {
      const message = { id: 'msg-' + (messages.length + 1), conversationId, eventId: String(item.event_id) };
      messages.push(message);
      return { id: message.id };
    },
    markDelivered: async (item, binding, messageId) => {
      attempts.push({ bindingId: String(binding.id), reportId: String(item.report_id), revision: Number(item.revision) });
      item.state = 'delivered'; item.message_id = messageId;
    },
    setState: async (item, state) => { item.state = state; },
  };
  return { runtime, messages, attempts, deliveries: input.deliveries };
}

// A. enterprise 模式仍调用原企业级投递。
test('A. enterprise delivery keeps the existing delivery worker', async () => {
  const calls: Array<[string | undefined, readonly string[] | undefined, number | null | undefined]> = [];
  const deliver = async (enterpriseId?: string, pilotProjectIds?: readonly string[],
    scopeVersion?: number | null) => {
    calls.push([enterpriseId, pilotProjectIds, scopeVersion]);
    return 2;
  };
  const checks = await deliverConfiguredConstructionReports({ now, env: {}, deliver });
  const explicit = await deliverConfiguredConstructionReports({ now,
    env: { XIAOK_WEEKLY_REPORT_MODE: 'enterprise', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' }, deliver });

  assert.deepEqual(calls, [[undefined, undefined, undefined], ['1454', undefined, undefined]]);
  assert.deepEqual(checks, { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
    scopedProjects: null, delivered: 2, errors: [] });
  assert.deepEqual(explicit, { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
    scopedProjects: null, delivered: 2, errors: [] });
});

// B. pilot 模式只投递范围内的业主报告。
test('B. pilot mode delivers an in-scope owner report', async () => {
  const state = deliveryFake({ deliveries: [delivery()], bindings: [deliveryBinding()],
    conversations: [deliveryConversation()] });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: state.deliveries, pilotProjectIds: ['101', '205'], pilotScopeVersion: 3, runtime: state.runtime });

  assert.equal(count, 1);
  assert.equal(state.deliveries[0].state, 'delivered');
  assert.equal(state.messages.length, 1);
  assert.equal(state.attempts.length, 1);
});

// C. 老板报告全部项目在范围内时允许投递。
test('C. a boss report with every project in scope is deliverable', async () => {
  const state = deliveryFake({
    deliveries: [delivery({ kind: 'weekly', facts: { projects: [{ id: '101' }, { id: '205' }] } })],
    bindings: [deliveryBinding({ audience: 'boss' })], conversations: [deliveryConversation()],
  });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: state.deliveries, pilotProjectIds: ['101', '205'], runtime: state.runtime });

  assert.equal(count, 1);
});

// D. 老板报告混入范围外项目时撤销投递，事实快照不变。
test('D. a boss report with an out-of-scope project is revoked', async () => {
  const facts = { projects: [{ id: '101' }, { id: '306' }] };
  const version = { facts_hash: 'hash-1', facts: structuredClone(facts) };
  const state = deliveryFake({ deliveries: [delivery({ kind: 'weekly', facts })],
    bindings: [deliveryBinding({ audience: 'boss' })], conversations: [deliveryConversation()] });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: state.deliveries, pilotProjectIds: ['101', '205'], runtime: state.runtime });

  assert.equal(count, 0);
  assert.equal(state.deliveries[0].state, 'revoked');
  assert.equal(state.messages.length, 0);
  assert.deepEqual(state.deliveries[0].facts, facts);
  assert.deepEqual([version.facts_hash, version.facts], ['hash-1', facts]);
});

// E. 历史 pending 报告超出新范围时撤销。
test('E. a pending report outside the new scope is revoked', async () => {
  const state = deliveryFake({ deliveries: [delivery({ facts: { projects: [{ id: '101' }] } })],
    bindings: [deliveryBinding()], conversations: [deliveryConversation()] });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: state.deliveries, pilotProjectIds: ['205'], runtime: state.runtime });

  assert.equal(count, 0);
  assert.equal(state.deliveries[0].state, 'revoked');
  assert.equal(state.messages.length, 0);
});

// F. held 报告超出新范围时撤销。
test('F. a held report outside the new scope is revoked', async () => {
  const state = deliveryFake({ deliveries: [delivery({ state: 'held', facts: { projects: [{ id: '306' }] } })],
    bindings: [deliveryBinding()], conversations: [deliveryConversation()] });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: state.deliveries, pilotProjectIds: ['101'], runtime: state.runtime });

  assert.equal(count, 0);
  assert.equal(state.deliveries[0].state, 'revoked');
});

// G. 范围版本更新后按最新范围重新验证。
test('G. a scope version change is revalidated before delivery', async () => {
  const first = deliveryFake({ deliveries: [delivery()], bindings: [deliveryBinding()],
    conversations: [deliveryConversation()] });
  const firstCount = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: first.deliveries, pilotProjectIds: ['101', '205'], pilotScopeVersion: 1, runtime: first.runtime });

  const second = deliveryFake({ deliveries: [delivery({ facts: { projects: [{ id: '205' }] } })],
    bindings: [deliveryBinding()], conversations: [deliveryConversation()] });
  const secondCount = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: second.deliveries, pilotProjectIds: ['101'], pilotScopeVersion: 2, runtime: second.runtime });

  assert.deepEqual([firstCount, secondCount, second.deliveries[0].state], [1, 0, 'revoked']);
  assert.deepEqual(validatePilotReportDelivery({ pilotProjectIds: ['101'], reportProjectIds: ['205'],
    scopeVersion: 2 }), { scopeStatus: 'active', scopeVersion: 2, reportProjectIds: ['205'],
    allowedProjectIds: [], excludedProjectIds: ['205'], deliverable: false });
});

// H. Pilot 不存在或 inactive 时零投递。
test('H. a missing or inactive pilot delivers nothing', async () => {
  for (const record of [null, pilotScope({ status: 'inactive', scopeVersion: 4 })]) {
    let called = 0;
    const checks = await deliverConfiguredConstructionReports({ now, env: pilotEnv,
      resolveScope: async (enterpriseId, pilotId, at) => resolvePilotScope({ enterpriseId, pilotId,
        context: { read: async () => record, now: at } }),
      deliver: async () => { called++; return 9; } });

    assert.equal(called, 0);
    assert.deepEqual([checks.mode, checks.scopeStatus, checks.delivered, checks.scopedProjects],
      ['pilot', record ? 'inactive' : 'not_found', 0, 0]);
  }
});

// I. Resolver 不可用时零投递，不回退企业全量。
test('I. an unavailable resolver delivers nothing', async () => {
  let called = 0;
  const checks = await deliverConfiguredConstructionReports({ now, env: pilotEnv,
    resolveScope: async () => { throw new Error('database unavailable'); },
    deliver: async () => { called++; return 9; } });

  assert.equal(called, 0);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: null,
    scopeStatus: 'unavailable', scopedProjects: 0, delivered: 0,
    errors: [{ enterpriseId: '1454', code: 'pilot_scope_unavailable' }] });
});

// J. facts 缺失或项目归属无法确认时禁止投递。
test('J. missing or unconfirmable facts are not deliverable', async () => {
  for (const facts of [null, {}, { projects: [] }, { projects: [{}] }, { projects: [{ id: 101 }] }]) {
    const state = deliveryFake({ deliveries: [delivery({ facts })], bindings: [deliveryBinding()],
      conversations: [deliveryConversation()] });

    const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
      pending: state.deliveries, pilotProjectIds: ['101'], runtime: state.runtime });

    assert.equal(count, 0);
    assert.equal(state.deliveries[0].state, 'revoked');
    assert.equal(state.messages.length, 0);
  }
});

// K. 已 delivered 历史报告保持不变。
test('K. delivered history is not modified', async () => {
  const history = delivery({ event_id: '9', report_id: '8', state: 'delivered', message_id: 'msg-old' });
  const pending = delivery({ event_id: '10', report_id: '9' });
  const state = deliveryFake({ deliveries: [history, pending], bindings: [deliveryBinding()],
    conversations: [deliveryConversation()] });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: [pending], pilotProjectIds: ['101'], runtime: state.runtime });

  assert.equal(count, 1);
  assert.deepEqual([history.state, history.message_id], ['delivered', 'msg-old']);
  assert.equal(state.messages.length, 1);
});

// L. 原收件人权限撤销机制保持有效。
test('L. revoked recipient permission still blocks delivery', async () => {
  const revoked = deliveryFake({ deliveries: [delivery()], bindings: [deliveryBinding()],
    conversations: [deliveryConversation()], permissionRevoked: ['1'] });
  const membership = deliveryFake({ deliveries: [delivery()], bindings: [deliveryBinding()],
    conversations: [deliveryConversation()], active: { '1': [] } });

  const first = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: revoked.deliveries, pilotProjectIds: ['101'], runtime: revoked.runtime });
  const second = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: membership.deliveries, pilotProjectIds: ['101'], runtime: membership.runtime });

  assert.deepEqual([first, second], [0, 0]);
  assert.deepEqual([revoked.deliveries[0].state, membership.deliveries[0].state], ['revoked', 'revoked']);
  assert.deepEqual([revoked.messages.length, membership.messages.length], [0, 0]);
});

// M. 同一报告重复 Worker tick 不重复投递。
test('M. repeated delivery ticks do not duplicate a delivery', async () => {
  const state = deliveryFake({ deliveries: [delivery()], bindings: [deliveryBinding()],
    conversations: [deliveryConversation()] });
  const pending = () => state.deliveries.filter(item => item.state === 'pending' || item.state === 'held');

  const first = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: pending(), pilotProjectIds: ['101'], runtime: state.runtime });
  const second = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: pending(), pilotProjectIds: ['101'], runtime: state.runtime });

  assert.deepEqual([first, second, state.messages.length, state.attempts.length], [1, 0, 1, 1]);
});

// N. 周报配置错误时不回退 enterprise 投递。
test('N. an invalid weekly configuration never falls back to enterprise delivery', async () => {
  let called = 0;
  const checks = await deliverConfiguredConstructionReports({ now,
    env: { XIAOK_WEEKLY_REPORT_MODE: 'pilot', XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
    deliver: async () => { called++; return 9; } });

  assert.equal(called, 0);
  assert.deepEqual(checks, { mode: 'pilot', pilotId: null, scopeVersion: null, scopeStatus: null,
    scopedProjects: 0, delivered: 0,
    errors: [{ enterpriseId: '', code: 'weekly_report_pilot_required' }] });
});

// O. 撤销待发送投递时，原 report version、facts hash 和历史消息保持不变。
test('O. revoking a pending delivery keeps the version, facts hash and history message', async () => {
  const facts = { projects: [{ id: '101' }, { id: '306' }] };
  const version = { facts_hash: 'hash-1', facts: structuredClone(facts) };
  const history = delivery({ event_id: '9', report_id: '8', state: 'delivered',
    message_id: 'msg-old', facts });
  const pending = delivery({ event_id: '10', report_id: '8', binding_id: '2', facts });
  const state = deliveryFake({ deliveries: [history, pending],
    bindings: [deliveryBinding(), deliveryBinding({ id: '2', conversation_id: '12' })],
    conversations: [deliveryConversation(), deliveryConversation({ id: '12' })] });

  const count = await deliverReportBatch({ enterpriseId: '1454', settings: settings(),
    pending: [pending], pilotProjectIds: ['101', '205'], runtime: state.runtime });

  assert.equal(count, 0);
  assert.equal(pending.state, 'revoked');
  assert.deepEqual([version.facts_hash, version.facts], ['hash-1', facts]);
  assert.deepEqual([history.state, history.message_id], ['delivered', 'msg-old']);
  assert.equal(state.messages.length, 0);
});
