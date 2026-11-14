import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PilotProjectScope } from '../pilot-project-scope';
import { resolvePilotScope } from '../pilot-scope-resolver';
import { advanceStageReminders, type ReminderAdvanceRuntime } from '../reminder-service';

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
      return dependencies.createdByProject?.[projectId] ?? 1;
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

  assert.deepEqual(result, { created: 2,
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

  assert.deepEqual(result, { created: 3, errors: [], pilotId: 'first-pilot', scopeVersion: 1,
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

  assert.deepEqual(result, { created: 0, errors: [], pilotId: 'missing-pilot', scopeVersion: null,
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

  assert.deepEqual(result, { created: 0, errors: [], pilotId: 'first-pilot', scopeVersion: 4,
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

  assert.deepEqual(result, { created: 0, errors: [], pilotId: 'first-pilot', scopeVersion: 1,
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

  assert.deepEqual(result, { created: 0, errors: [{ enterpriseId: '1454', projectId: '',
    code: 'pilot_scope_unavailable' }], pilotId: 'first-pilot', scopeVersion: null,
    scopeStatus: 'unavailable', scannedProjects: 0, skippedProjects: 0 });
  assert.deepEqual(calls.requested, []);
  assert.deepEqual(calls.synced, []);
});
