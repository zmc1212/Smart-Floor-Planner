import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAssistantJobsTick, type AssistantJobsTickDependencies } from '@/lib/assistant/infrastructure/jobs-tick';
import { checkPilotWorkerAlignment } from '../pilot-worker-alignment';
import { evaluateWorkerSafetyGate } from '../worker-safety-gate';

const now = new Date('2026-11-16T20:00:00+08:00');
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
const pilotEnv = { ...stagePilot, ...weeklyPilot };

type Counts = ReturnType<typeof harness>['counts'];

function harness(env: Record<string, string | undefined>, extra: AssistantJobsTickDependencies = {}) {
  const counts = {
    advanceReports: 0, deliverReports: 0, advanceReminders: 0, deliverReminders: 0,
    knowledge: 0, assistant: 0, siteNotifications: 0, publicConsents: 0, portfolioCopy: 0,
    schedule: 0, delegations: 0, durableTools: 0,
  };
  const scopes: Record<string, unknown[]> = {
    knowledge: [], assistant: [], siteNotifications: [], publicConsents: [], portfolioCopy: [],
  };
  const tick = () => runAssistantJobsTick({
    now,
    env,
    checkPilotWorkerAlignment,
    evaluateWorkerSafetyGate,
    advanceKnowledgeBatches: async scope => {
      counts.knowledge += 1; scopes.knowledge.push(scope); return 0;
    },
    processAssistantJob: async (_run, _limit, scope) => {
      counts.assistant += 1; scopes.assistant.push(scope); return { claimed: false };
    },
    processAssistantRun: async () => undefined,
    deliverSiteNotifications: async scope => {
      counts.siteNotifications += 1; scopes.siteNotifications.push(scope); return 0;
    },
    deliverPublicConsents: async enterpriseId => {
      counts.publicConsents += 1; scopes.publicConsents.push(enterpriseId); return 0;
    },
    processPortfolioCopy: async scope => {
      counts.portfolioCopy += 1; scopes.portfolioCopy.push(scope); return false;
    },
    advanceConfiguredConstructionReports: async () => {
      counts.advanceReports += 1;
      return { mode: 'pilot' as const, pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scopedProjects: 1, queued: 1, errors: [] };
    },
    deliverConfiguredConstructionReports: async () => {
      counts.deliverReports += 1;
      return { mode: 'pilot' as const, pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scopedProjects: 1, delivered: 1, errors: [] };
    },
    advanceConfiguredStageReminders: async () => {
      counts.advanceReminders += 1;
      return { mode: 'pilot' as const, pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scannedProjects: 1, skippedProjects: 0, candidates: 1, created: 1, errors: [] };
    },
    deliverConfiguredStageReminders: async () => {
      counts.deliverReminders += 1;
      return { mode: 'pilot' as const, pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scannedProjects: 1, skippedProjects: 0, delivered: 1, no_inbox: 0, paused: 0, cancelled: 0, failed: 0, errors: [] };
    },
    runNativeWorkflowScheduleTick: async () => { counts.schedule += 1; return { enabled: true }; },
    runNativeDelegationTick: async () => { counts.delegations += 1; return { enabled: true }; },
    runNativeDurableToolTick: async () => { counts.durableTools += 1; return { enabled: true }; },
    ...extra,
  });
  return { counts, scopes, tick };
}

const four = (counts: Counts) => [counts.advanceReports, counts.deliverReports,
  counts.advanceReminders, counts.deliverReminders];

function assertFourCalls(counts: Counts, expected: number) {
  assert.deepEqual(four(counts), [expected, expected, expected, expected]);
}

function assertAllSideEffectTasks(counts: Counts, expected: number) {
  assert.deepEqual([counts.knowledge, counts.assistant, counts.siteNotifications,
    counts.publicConsents, counts.portfolioCopy], [expected, expected, expected, expected, expected]);
}

function assertNoBusinessTask(counts: Counts) {
  assertFourCalls(counts, 0);
  assertAllSideEffectTasks(counts, 0);
  assert.deepEqual([counts.schedule, counts.delegations, counts.durableTools], [0, 0, 0]);
}

// A. No explicit pilot scope: every side-effect task stays closed.
test('I7.5.9 A. an unconfigured deployment skips every business task', async () => {
  const { counts, scopes, tick } = harness({});
  const data = await tick();
  assert.deepEqual([data.workerSafetyGate.status, data.workerSafetyGate.reason],
    ['closed', 'pilot_scope_missing']);
  assert.deepEqual(data.workerExecution, {
    businessTasksEnabled: false, mode: 'enterprise', enterpriseId: null,
    pilotId: null, taskScope: 'none',
  });
  assertNoBusinessTask(counts);
  assert.deepEqual(scopes, {
    knowledge: [], assistant: [], siteNotifications: [], publicConsents: [], portfolioCopy: [],
  });
});

// B. Enterprise ids without a pilot are still closed.
test('I7.5.9 B. enterprise ids without a pilot skip every business task', async () => {
  const { counts, tick } = harness({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  const data = await tick();
  assert.deepEqual([data.workerSafetyGate.status, data.workerSafetyGate.reason],
    ['closed', 'enterprise_scope_not_allowed']);
  assertNoBusinessTask(counts);
});

// C. The queue also handles user-initiated replies from authorized tenants.
test('an aligned pilot keeps its background scope and enables shared customer replies', async () => {
  const { counts, scopes, tick } = harness(pilotEnv);
  const data = await tick();
  assert.deepEqual([data.workerSafetyGate.status, data.workerExecution.businessTasksEnabled,
    data.workerExecution.enterpriseId, data.workerExecution.taskScope],
  ['open', true, '1454', 'pilot_enterprise']);
  assertFourCalls(counts, 1);
  assertAllSideEffectTasks(counts, 1);
  assert.deepEqual(scopes.knowledge, [{ enterpriseId: '1454' }]);
  assert.deepEqual(scopes.assistant, [{ enterpriseId: '1454', includeSharedConsultations: true }]);
  assert.deepEqual(scopes.siteNotifications, [{ enterpriseId: '1454' }]);
  assert.deepEqual(scopes.publicConsents, ['1454']);
  assert.deepEqual(scopes.portfolioCopy, [{ enterpriseId: '1454' }]);
});

// D–H. Any mismatch or invalid configuration closes every task.
const mismatches: Array<[string, Record<string, string | undefined>, string]> = [
  ['D. reminder pilot with enterprise report', { ...stagePilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
    'pilot_worker_mode_mismatch'],
  ['E. enterprise reminder with pilot report', { ...weeklyPilot, XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' },
    'pilot_worker_mode_mismatch'],
  ['F. different enterprise ids', { ...pilotEnv, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' },
    'pilot_worker_enterprise_mismatch'],
  ['G. different pilot ids', { ...pilotEnv, XIAOK_WEEKLY_REPORT_PILOT_ID: 'second-pilot' },
    'pilot_worker_pilot_mismatch'],
  ['H. invalid reminder mode', { ...pilotEnv, XIAOK_STAGE_REMINDER_MODE: 'tenant' },
    'stage_reminder_mode_invalid'],
  ['H. invalid weekly mode', { ...pilotEnv, XIAOK_WEEKLY_REPORT_MODE: 'tenant' },
    'weekly_report_mode_invalid'],
  ['H. missing pilot id', { ...pilotEnv, XIAOK_WEEKLY_REPORT_PILOT_ID: '' },
    'weekly_report_pilot_required'],
];

for (const [name, env, errorCode] of mismatches) {
  test('I7.5.9 ' + name + ' skips every business task', async () => {
    const { counts, tick } = harness(env);
    const data = await tick();
    assert.notEqual(data.pilotScopeAlignment.status, 'aligned');
    assert.equal(data.pilotScopeAlignment.errorCode, errorCode);
    assert.deepEqual([data.workerSafetyGate.status, data.workerSafetyGate.reason,
      data.workerSafetyGate.errorCode], ['closed', 'pilot_worker_alignment', errorCode]);
    assertNoBusinessTask(counts);
    for (const entry of [data.constructionReportChecks, data.stageReminderChecks,
      data.constructionReportDeliveries, data.stageReminderDeliveries]) {
      const value = entry as Record<string, unknown>;
      assert.equal(value.skipped, true);
      assert.equal(value.reason, 'worker_safety_gate');
      assert.equal(value.gateReason, 'pilot_worker_alignment');
      assert.equal(value.errorCode, errorCode);
    }
    assert.equal((data.knowledgeBatchChecks as Record<string, unknown>).reason, 'worker_safety_gate');
  });
}

// The invalid configuration never becomes a silent enterprise run.
test('I7.5.9 H. an invalid configuration has no enterprise mode', async () => {
  const { counts, tick } = harness({ ...pilotEnv, XIAOK_WEEKLY_REPORT_MODE: 'tenant' });
  const data = await tick();
  assert.equal(data.pilotScopeAlignment.status, 'invalid');
  assert.equal(data.pilotScopeAlignment.mode, null);
  assert.equal(data.workerSafetyGate.mode, null);
  assertNoBusinessTask(counts);
});

// A reminder failure is contained and does not skip independent tasks.
test('I7.5.9 worker failures do not skip independent tasks', async () => {
  const { counts, tick } = harness(pilotEnv, {
    advanceConfiguredStageReminders: async () => { throw new Error('reminder_down'); },
  });
  const data = await tick();
  assert.deepEqual(data.stageReminderChecks, { error: 'stage_reminder_unavailable' });
  assert.equal(counts.advanceReminders, 0);
  assert.equal(counts.deliverReminders, 1);
  assert.equal(counts.advanceReports, 1);
  assert.equal(counts.deliverReports, 1);
  assertAllSideEffectTasks(counts, 1);
});

// Native workflow keeps its explicit allowlists and is narrower in pilot mode.
test('I7.5.9 native workflow needs an explicit pilot-only allowlist', async () => {
  const disabled = harness(pilotEnv);
  const disabledData = await disabled.tick();
  assert.deepEqual([disabled.counts.schedule, disabled.counts.delegations, disabled.counts.durableTools], [0, 0, 0]);
  assert.equal(disabledData.nativeWorkflowSchedule, null);
  assert.equal(disabledData.nativeWorkflowScopes.schedule.reason, 'not_enabled');

  const enabled = harness({
    ...pilotEnv,
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1',
    NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: '1454',
    NATIVE_WORKFLOW_DELEGATION_ENABLED: '1',
    NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS: '1454',
    NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED: '1',
  });
  const enabledData = await enabled.tick();
  assert.deepEqual([enabled.counts.schedule, enabled.counts.delegations, enabled.counts.durableTools], [1, 1, 1]);
  assert.deepEqual(enabledData.nativeWorkflowScopes.schedule.reason, 'pilot_enterprise');

  const outside = harness({
    ...pilotEnv,
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1',
    NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS: '1454,1455',
    NATIVE_WORKFLOW_DELEGATION_ENABLED: '1',
    NATIVE_WORKFLOW_DELEGATION_ENTERPRISE_IDS: '1455',
    NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED: '1',
  });
  const outsideData = await outside.tick();
  assert.deepEqual([outside.counts.schedule, outside.counts.delegations, outside.counts.durableTools], [0, 0, 0]);
  assert.deepEqual(outsideData.nativeWorkflowScopes.schedule.reason, 'pilot_scope_override');
  assert.deepEqual(outsideData.nativeWorkflowScopes.delegations.reason, 'pilot_scope_override');
  assert.deepEqual(outsideData.nativeWorkflowScopes.durableTools.reason, 'pilot_scope_override');
  assert.deepEqual(outsideData.nativeWorkflowSchedule, { skipped: true, reason: 'pilot_scope_override' });

  const empty = harness({ ...pilotEnv, NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1' });
  const emptyData = await empty.tick();
  assert.equal(empty.counts.schedule, 0);
  assert.equal(emptyData.nativeWorkflowScopes.schedule.reason, 'pilot_scope_not_configured');
});

// The route handler keeps authentication, validation and failure semantics.
test('I7.5.9 the route handler rejects unauthorized, invalid and failing ticks', async () => {
  const { POST } = await import('@/app/api/internal/assistant/jobs/run/route');
  const { createAssistantJobsPost } = await import('@/lib/assistant/infrastructure/jobs-post-handler');
  const previous = process.env.CRON_SECRET;
  try {
    delete process.env.CRON_SECRET;
    const unauthorized = await POST(new Request('http://localhost/api/internal/assistant/jobs/run', { method: 'POST' }));
    assert.equal(unauthorized.status, 401);

    process.env.CRON_SECRET = 'f4-worker-secret';
    const invalid = await POST(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', body: 'unexpected', headers: { 'x-cron-secret': 'f4-worker-secret' },
    }));
    assert.equal(invalid.status, 422);

    const failing = createAssistantJobsPost({
      now,
      env: pilotEnv,
      advanceKnowledgeBatches: async () => { throw new Error('knowledge_down'); },
    });
    const unavailable = await failing(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', headers: { 'x-cron-secret': 'f4-worker-secret' },
    }));
    assert.equal(unavailable.status, 503);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});

// A test handler can fix the clock/environment and replace non-pilot jobs
// without exposing those parameters over HTTP.
test('I7.5.9 an injected route handler runs the tick with a fixed clock and pilot scope', async () => {
  const { createAssistantJobsPost } = await import('@/lib/assistant/infrastructure/jobs-post-handler');
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'f4-worker-secret';
  const counts = { knowledge: 0, assistant: 0 };
  const scopes: unknown[] = [];
  try {
    const post = createAssistantJobsPost({
      now,
      env: pilotEnv,
      advanceKnowledgeBatches: async scope => { counts.knowledge += 1; scopes.push(scope); return 0; },
      processAssistantJob: async (_run, _limit, scope) => {
        counts.assistant += 1; scopes.push(scope); return { claimed: false };
      },
      processAssistantRun: async () => undefined,
      deliverSiteNotifications: async () => 0,
      deliverPublicConsents: async () => 0,
      processPortfolioCopy: async () => false,
    });
    const response = await post(new Request('http://localhost/api/internal/assistant/jobs/run', {
      method: 'POST', headers: { 'x-cron-secret': 'f4-worker-secret' },
    }));
    assert.equal(response.status, 200);
    const payload = await response.json() as { success: boolean; requestId: string;
      data: Record<string, unknown> };
    assert.equal(payload.success, true);
    assert.ok(payload.requestId);
    assert.equal((payload.data.pilotScopeAlignment as Record<string, unknown>).status, 'aligned');
    assert.deepEqual(payload.data.workerExecution, {
      businessTasksEnabled: true, mode: 'pilot', enterpriseId: '1454',
      pilotId: 'first-pilot', taskScope: 'pilot_enterprise',
    });
    assert.deepEqual(counts, { knowledge: 1, assistant: 1 });
    assert.deepEqual(scopes, [{ enterpriseId: '1454' }, { enterpriseId: '1454', includeSharedConsultations: true }]);
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
