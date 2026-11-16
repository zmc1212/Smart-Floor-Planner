import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PilotProjectScope } from '../pilot-project-scope';
import { resolvePilotScope } from '../pilot-scope-resolver';
import { advanceStageReminders, deliverStageReminders, type ReminderAdvanceRuntime,
  type ReminderDeliveryRuntime } from '../reminder-service';

const now = new Date('2026-11-15T10:00:00+08:00');
const enterpriseId = '1454';

function scope(overrides: Partial<PilotProjectScope> = {}): PilotProjectScope {
  return {
    enterpriseId: '1454', pilotId: 'first-pilot', projectIds: ['101', '205'],
    createdBy: '9001', createdAt: '2026-11-14T09:00:00+08:00', scopeVersion: 1, status: 'active',
    ...overrides,
  };
}

type Calls = {
  resolutions: Array<[string, string]>;
  requested: Array<readonly string[] | null>;
  synced: string[];
};

function fake(dependencies: {
  scopes?: Record<string, PilotProjectScope | null>;
  eligible?: Record<string, string[]>;
  createdByProject?: Record<string, number>;
  scopeFailed?: Error;
  syncFailed?: Record<string, Error>;
} = {}) {
  const calls: Calls = { resolutions: [], requested: [], synced: [] };
  const runtime: ReminderAdvanceRuntime = {
    resolveScope: async (eid, pilotId, at) => {
      calls.resolutions.push([eid, pilotId]);
      if (dependencies.scopeFailed) throw dependencies.scopeFailed;
      return resolvePilotScope({ enterpriseId: eid, pilotId,
        context: { read: async () => dependencies.scopes?.[pilotId] ?? null, now: at } });
    },
    listProjects: async (eid, projectIds) => {
      calls.requested.push(projectIds);
      const enterprise = eid ?? enterpriseId;
      const eligible = dependencies.eligible?.[enterprise] ?? [];
      return (projectIds ?? eligible).filter(pid => eligible.includes(pid))
        .map(pid => ({ enterpriseId: enterprise, projectId: pid }));
    },
    syncProject: async (_eid, projectId) => {
      calls.synced.push(projectId);
      const failure = dependencies.syncFailed?.[projectId];
      if (failure) throw failure;
      const created = dependencies.createdByProject?.[projectId] ?? 1;
      return { candidates: created + 1, created };
    },
  };
  return { runtime, calls };
}

// A. 无 pilotId 时保持原企业 Worker 行为与返回结构。
test('without pilotId the enterprise worker keeps its previous behavior', async () => {
  const failure = Object.assign(new Error('project unavailable'), { code: 'construction_not_found' });
  const { runtime, calls } = fake({ eligible: { '1454': ['101', '306'] },
    createdByProject: { '101': 2 }, syncFailed: { '306': failure } });

  const result = await advanceStageReminders(now, '1454', undefined, runtime);

  assert.deepEqual(result, { candidates: 3, created: 2,
    errors: [{ enterpriseId: '1454', projectId: '306', code: 'construction_not_found' }] });
  assert.deepEqual(calls.requested, [null]);
  assert.deepEqual(calls.resolutions, []);
  assert.deepEqual(calls.synced, ['101', '306']);
});

// B. pilotId 只处理项目 101、205。
test('a pilot run only processes the saved scope projects', async () => {
  const { runtime, calls } = fake({
    scopes: { 'first-pilot': scope({ projectIds: ['101', '205'] }) },
    eligible: { '1454': ['101', '205', '306'] },
    createdByProject: { '101': 1, '205': 2 },
  });

  const result = await advanceStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { candidates: 5, created: 3, errors: [], pilotId: 'first-pilot', scopeVersion: 1,
    scopeStatus: 'active', scannedProjects: 2, skippedProjects: 0 });
  assert.deepEqual(calls.requested, [['101', '205']]);
  assert.deepEqual(calls.synced, ['101', '205']);
});

// C. 项目 306 不在范围内（且未被查询）；范围 205 已不可用时计入 skipped。
test('a project outside the scope produces no reminder', async () => {
  const { runtime, calls } = fake({
    scopes: { 'first-pilot': scope({ projectIds: ['101', '205'] }) },
    eligible: { '1454': ['101', '306'] },
  });

  const result = await advanceStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(calls.requested, [['101', '205']]);
  assert.deepEqual(calls.synced, ['101']);
  assert.deepEqual([result.created, result.scannedProjects, result.skippedProjects], [1, 1, 1]);
});

// D. 试点不存在时不处理任何项目。
test('a missing pilot processes no project', async () => {
  const { runtime, calls } = fake({ scopes: {}, eligible: { '1454': ['101', '205'] } });

  const result = await advanceStageReminders(now, '1454', 'missing-pilot', runtime);

  assert.deepEqual(result, { candidates: 0, created: 0, errors: [], pilotId: 'missing-pilot', scopeVersion: null,
    scopeStatus: 'not_found', scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.synced, []);
});

// E. 试点停用时不处理任何项目。
test('an inactive pilot processes no project', async () => {
  const { runtime, calls } = fake({
    scopes: { 'first-pilot': scope({ scopeVersion: 4, status: 'inactive', projectIds: ['101', '205'] }) },
    eligible: { '1454': ['101', '205'] },
  });

  const result = await advanceStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { candidates: 0, created: 0, errors: [], pilotId: 'first-pilot', scopeVersion: 4,
    scopeStatus: 'inactive', scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.synced, []);
});

// F. 空范围时不处理任何项目。
test('an empty pilot scope processes no project', async () => {
  const { runtime, calls } = fake({
    scopes: { 'first-pilot': scope({ projectIds: [] }) },
    eligible: { '1454': ['101', '205'] },
  });

  const result = await advanceStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { candidates: 0, created: 0, errors: [], pilotId: 'first-pilot', scopeVersion: 1,
    scopeStatus: 'empty', scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.synced, []);
});

// G. 修改试点版本后使用最新项目范围。
test('a newer scope version replaces the project set for the next run', async () => {
  const scopes: Record<string, PilotProjectScope | null> = {
    'first-pilot': scope({ scopeVersion: 1, projectIds: ['101'] }),
  };
  const { runtime, calls } = fake({ scopes, eligible: { '1454': ['101', '205', '306'] } });

  const first = await advanceStageReminders(now, '1454', 'first-pilot', runtime);
  scopes['first-pilot'] = scope({ scopeVersion: 2, projectIds: ['205', '306'] });
  const second = await advanceStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual([first.scopeVersion, first.scannedProjects, first.scopeStatus], [1, 1, 'active']);
  assert.deepEqual([second.scopeVersion, second.scannedProjects, second.scopeStatus], [2, 2, 'active']);
  assert.deepEqual(calls.requested, [['101'], ['205', '306']]);
  assert.deepEqual(calls.synced, ['101', '205', '306']);
});

// H. 同一企业不同 pilotId 互不影响。
test('two pilots of one enterprise stay isolated', async () => {
  const { runtime, calls } = fake({
    scopes: {
      'first-pilot': scope({ pilotId: 'first-pilot', projectIds: ['101'], scopeVersion: 1 }),
      'second-pilot': scope({ pilotId: 'second-pilot', projectIds: ['205'], scopeVersion: 7 }),
    },
    eligible: { '1454': ['101', '205', '306'] },
  });

  const first = await advanceStageReminders(now, '1454', 'first-pilot', runtime);
  const second = await advanceStageReminders(now, '1454', 'second-pilot', runtime);

  assert.deepEqual(calls.requested, [['101'], ['205']]);
  assert.deepEqual(calls.synced, ['101', '205']);
  assert.deepEqual([first.pilotId, first.scopeVersion, first.scannedProjects], ['first-pilot', 1, 1]);
  assert.deepEqual([second.pilotId, second.scopeVersion, second.scannedProjects], ['second-pilot', 7, 1]);
});

// I. Resolver 查询失败时 fail closed，不回退全企业。
test('a resolver failure fails closed instead of scanning the enterprise', async () => {
  const { runtime, calls } = fake({ scopeFailed: new Error('database unavailable'),
    eligible: { '1454': ['101', '205'] } });

  const result = await advanceStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { candidates: 0, created: 0, errors: [{ enterpriseId: '1454', projectId: '',
    code: 'pilot_scope_unavailable' }], pilotId: 'first-pilot', scopeVersion: null,
    scopeStatus: 'unavailable', scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.synced, []);
});

type DeliveryReminder = {
  enterpriseId: string; projectId: string; status: 'pending' | 'delivered' | 'failed' | 'cancelled';
  attempts: number; scheduledAt: Date;
};
type DeliveryCalls = {
  resolutions: Array<[string, string]>;
  requested: Array<{ enterpriseId: string | undefined; projectIds: readonly string[] | null }>;
  delivered: string[];
};
const dueAt = (reminder: DeliveryReminder, at: Date) => ['pending', 'failed'].includes(reminder.status)
  && reminder.attempts < 10 && reminder.scheduledAt <= at;
const reminder = (projectId: string, status: DeliveryReminder['status'] = 'pending',
  attempts = 0): DeliveryReminder => ({ enterpriseId, projectId, status, attempts,
  scheduledAt: new Date(now.getTime() - 60_000) });

function deliveryFake(dependencies: {
  scopes?: Record<string, PilotProjectScope | null>;
  reminders?: DeliveryReminder[];
  scopeFailed?: Error;
  targetFailed?: Error;
  failedProjects?: string[];
  permissionRevoked?: string[];
} = {}) {
  const reminders = (dependencies.reminders ?? []).map(item => ({ ...item }));
  const calls: DeliveryCalls = { resolutions: [], requested: [], delivered: [] };
  const runtime: ReminderDeliveryRuntime = {
    resolveScope: async (eid, pilotId, at) => {
      calls.resolutions.push([eid, pilotId]);
      if (dependencies.scopeFailed) throw dependencies.scopeFailed;
      return resolvePilotScope({ enterpriseId: eid, pilotId,
        context: { read: async () => dependencies.scopes?.[pilotId] ?? null, now: at } });
    },
    listTargets: async (eid, projectIds, at) => {
      calls.requested.push({ enterpriseId: eid, projectIds });
      if (dependencies.targetFailed) throw dependencies.targetFailed;
      const keys = new Set(reminders.filter(item => dueAt(item, at) && (!eid || item.enterpriseId === eid)
        && (!projectIds || projectIds.includes(item.projectId)))
        .map(item => item.enterpriseId + ':' + item.projectId));
      return [...keys].map(key => ({ enterpriseId: key.split(':')[0], projectId: key.split(':')[1] }));
    },
    deliverProject: async (eid, pid, at) => {
      if (dependencies.failedProjects?.includes(pid)) throw Object.assign(new Error('transaction rolled back'), { code: '40001' });
      const counts = { delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0 };
      const pending = reminders.filter(item => item.enterpriseId === eid && item.projectId === pid
        && dueAt(item, at));
      if (dependencies.permissionRevoked?.includes(pid)) {
        pending.forEach(item => { item.status = 'cancelled'; });
        counts.cancelled += pending.length;
        return counts;
      }
      calls.delivered.push(pid);
      pending.forEach(item => { item.status = 'delivered'; counts.delivered++; });
      return counts;
    },
  };
  return { runtime, calls, reminders };
}

test('a rolled-back project contributes no deliveries and does not hide a committed project', async () => {
  for (const pilotId of [undefined, 'first-pilot']) {
    const { runtime, reminders } = deliveryFake({
      scopes: { 'first-pilot': scope() }, reminders: [reminder('101'), reminder('205')], failedProjects: ['205'],
    });
    const result = await deliverStageReminders(now, enterpriseId, pilotId, runtime);
    assert.equal(result.delivered, 1);
    assert.deepEqual(result.errors, [{ enterpriseId, projectId: '205', code: '40001' }]);
    assert.equal(reminders[1].status, 'pending');
  }
});

// A. 企业模式保持原投递行为：查询不带项目范围，已 delivered 的历史不重复。
test('A. without pilotId the enterprise delivery keeps its previous behavior', async () => {
  const { runtime, calls, reminders } = deliveryFake({
    reminders: [reminder('101'), reminder('306', 'failed', 2), reminder('101', 'delivered', 1)],
  });

  const result = await deliverStageReminders(now, '1454', undefined, runtime);

  assert.deepEqual(result, { delivered: 2, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [] });
  assert.deepEqual(calls.requested, [{ enterpriseId: '1454', projectIds: null }]);
  assert.deepEqual(calls.resolutions, []);
  assert.deepEqual(calls.delivered, ['101', '306']);
  assert.equal(reminders.filter(item => item.status === 'delivered').length, 3);
});

// B. Pilot 只投递范围项目，范围外项目不进入查询。
test('B. a pilot run only delivers the saved scope projects', async () => {
  const { runtime, calls, reminders } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: ['101', '205'] }) },
    reminders: [reminder('101'), reminder('205', 'failed', 1), reminder('306')],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { delivered: 2, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [],
    pilotId: 'first-pilot', scopeVersion: 1, scopeStatus: 'active',
    scannedProjects: 2, skippedProjects: 0 });
  assert.deepEqual(calls.requested, [{ enterpriseId: '1454', projectIds: ['101', '205'] }]);
  assert.deepEqual(calls.delivered, ['101', '205']);
  assert.equal(reminders.find(item => item.projectId === '306')?.status, 'pending');
});

// C. 范围外 pending 不投递，也不计入扫描数。
test('C. an out-of-scope pending reminder is never delivered', async () => {
  const { runtime, calls, reminders } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: ['101'] }) },
    reminders: [reminder('101'), reminder('306')],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(calls.requested, [{ enterpriseId: '1454', projectIds: ['101'] }]);
  assert.deepEqual(calls.delivered, ['101']);
  assert.deepEqual([result.delivered, result.scannedProjects, result.skippedProjects], [1, 1, 0]);
  assert.equal(reminders.find(item => item.projectId === '306')?.status, 'pending');
});

// D. 范围外 failed 不重试，投递次数不变。
test('D. an out-of-scope failed reminder is never retried', async () => {
  const { runtime, calls, reminders } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: ['101'] }) },
    reminders: [reminder('101'), reminder('306', 'failed', 3)],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(calls.delivered, ['101']);
  assert.deepEqual(result.failed, 0);
  const outside = reminders.find(item => item.projectId === '306');
  assert.deepEqual([outside?.status, outside?.attempts], ['failed', 3]);
});

// E. Pilot 不存在时零投递，且不查询任何项目。
test('E. a missing pilot delivers nothing', async () => {
  const { runtime, calls } = deliveryFake({ scopes: {}, reminders: [reminder('101')] });

  const result = await deliverStageReminders(now, '1454', 'missing-pilot', runtime);

  assert.deepEqual(result, { delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [],
    pilotId: 'missing-pilot', scopeVersion: null, scopeStatus: 'not_found',
    scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.delivered, []);
});

// F. Pilot 停用时零投递，即使历史版本仍有项目。
test('F. an inactive pilot delivers nothing', async () => {
  const { runtime, calls, reminders } = deliveryFake({
    scopes: { 'first-pilot': scope({ scopeVersion: 4, status: 'inactive', projectIds: ['101'] }) },
    reminders: [reminder('101')],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [],
    pilotId: 'first-pilot', scopeVersion: 4, scopeStatus: 'inactive',
    scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.equal(reminders[0].status, 'pending');
});

// G. Resolver 故障时零投递，不回退全企业。
test('G. a resolver failure delivers nothing instead of scanning the enterprise', async () => {
  const { runtime, calls } = deliveryFake({ scopeFailed: new Error('database unavailable'),
    reminders: [reminder('101')] });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0,
    errors: [{ enterpriseId: '1454', projectId: '', code: 'pilot_scope_unavailable' }],
    pilotId: 'first-pilot', scopeVersion: null, scopeStatus: 'unavailable',
    scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.delivered, []);
});

// H. 范围版本更新后使用最新范围。
test('H. a newer scope version replaces the delivery project set', async () => {
  const scopes: Record<string, PilotProjectScope | null> = {
    'first-pilot': scope({ scopeVersion: 1, projectIds: ['101'] }),
  };
  const { runtime, calls } = deliveryFake({ scopes,
    reminders: [reminder('101'), reminder('205')] });

  const first = await deliverStageReminders(now, '1454', 'first-pilot', runtime);
  scopes['first-pilot'] = scope({ scopeVersion: 2, projectIds: ['205'] });
  const second = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual([first.scopeVersion, first.delivered], [1, 1]);
  assert.deepEqual([second.scopeVersion, second.delivered, second.scannedProjects], [2, 1, 1]);
  assert.deepEqual(calls.requested.map(item => item.projectIds), [['101'], ['205']]);
  assert.deepEqual(calls.delivered, ['101', '205']);
});

// I. 历史 delivered 不被修改或重复投递。
test('I. delivered history is never modified', async () => {
  const { runtime, calls, reminders } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: ['101'] }) },
    reminders: [reminder('101'), reminder('101', 'delivered', 1)],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual([result.delivered, calls.delivered], [1, ['101']]);
  assert.deepEqual(reminders.filter(item => item.status === 'delivered')
    .map(item => item.attempts), [0, 1]);
  assert.equal(reminders.filter(item => item.status === 'delivered').length, 2);
});

// J. 收件人权限校验、Outbox 幂等和 delivered 历史保护保持原样。
test('J. the delivery path keeps recipient checks, outbox idempotency and history protection', () => {
  const source = readFileSync(join(process.cwd(), 'src/lib/xiaok-v1/reminder-service.ts'), 'utf8');
  const start = source.indexOf('async function deliverProjectReminders');
  const end = source.indexOf('const reminderDeliveryRuntime');
  assert.ok(start > 0 && end > start);
  const delivery = source.slice(start, end);

  assert.match(delivery, /await principalAccess\(tx/);
  assert.match(delivery, /last_error='permission_revoked'/);
  assert.ok(delivery.indexOf('principalAccess(tx') < delivery.indexOf('deliverOne(tx'));
  assert.match(source, /on conflict \(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version\) do update/);
  assert.match(source, /set status='delivered'[\s\S]*status in \('pending','failed'\)/);
  assert.doesNotMatch(source, /delete from app\.construction_stage_reminders/u);
});

// J2. 范围内收件人撤权仍按原有规则取消，不产生投递。
test('J2. an in-scope revoked recipient is cancelled instead of delivered', async () => {
  const { runtime, reminders } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: ['101'] }) },
    reminders: [reminder('101')],
    permissionRevoked: ['101'],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual([result.delivered, result.cancelled, result.failed], [0, 1, 0]);
  assert.equal(reminders[0].status, 'cancelled');
});

// K. 空范围零投递。
test('K. an empty pilot scope delivers nothing', async () => {
  const { runtime, calls } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: [] }) },
    reminders: [reminder('101')],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [],
    pilotId: 'first-pilot', scopeVersion: 1, scopeStatus: 'empty',
    scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
});

// L. 范围项目查询失败时同样零投递，不回退全企业。
test('L. a failed scope project query delivers nothing', async () => {
  const { runtime, calls } = deliveryFake({
    scopes: { 'first-pilot': scope({ projectIds: ['101', '205'] }) },
    targetFailed: new Error('query unavailable'),
    reminders: [reminder('101')],
  });

  const result = await deliverStageReminders(now, '1454', 'first-pilot', runtime);

  assert.deepEqual(result, { delivered: 0, no_inbox: 0, paused: 0, cancelled: 0, failed: 0,
    errors: [{ enterpriseId: '1454', projectId: '', code: 'pilot_scope_unavailable' }],
    pilotId: 'first-pilot', scopeVersion: 1, scopeStatus: 'active',
    scannedProjects: 0, skippedProjects: 2 });
  assert.deepEqual(calls.delivered, []);
});
