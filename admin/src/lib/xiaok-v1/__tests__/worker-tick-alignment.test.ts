import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runAssistantJobsTick, type AssistantJobsTickDependencies } from '@/lib/assistant/infrastructure/jobs-tick';
import { checkPilotWorkerAlignment } from '../pilot-worker-alignment';

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

type Counts = ReturnType<typeof harness>['counts'];

function harness(env: Record<string, string | undefined>, extra: AssistantJobsTickDependencies = {}) {
  const counts = {
    advanceReports: 0, deliverReports: 0, advanceReminders: 0, deliverReminders: 0,
    knowledge: 0, assistant: 0, siteNotifications: 0, publicConsents: 0, portfolioCopy: 0,
    schedule: 0, delegations: 0, durableTools: 0,
  };
  const received: Date[] = [];
  const tick = () => runAssistantJobsTick({
    now,
    env,
    checkPilotWorkerAlignment,
    advanceKnowledgeBatches: async () => { counts.knowledge += 1; return 0; },
    processAssistantJob: async () => { counts.assistant += 1; return { claimed: false }; },
    processAssistantRun: async () => undefined,
    deliverSiteNotifications: async () => { counts.siteNotifications += 1; return 0; },
    deliverPublicConsents: async () => { counts.publicConsents += 1; return 0; },
    processPortfolioCopy: async () => { counts.portfolioCopy += 1; return false; },
    advanceConfiguredConstructionReports: async input => {
      counts.advanceReports += 1; received.push(input.now);
      return { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scopedProjects: 1, queued: 1, errors: [] };
    },
    deliverConfiguredConstructionReports: async input => {
      counts.deliverReports += 1; received.push(input.now);
      return { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scopedProjects: 1, delivered: 1, errors: [] };
    },
    advanceConfiguredStageReminders: async input => {
      counts.advanceReminders += 1; received.push(input.now);
      return { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scannedProjects: 1, skippedProjects: 0, created: 1, errors: [] };
    },
    deliverConfiguredStageReminders: async input => {
      counts.deliverReminders += 1; received.push(input.now);
      return { mode: 'pilot', pilotId: 'first-pilot', scopeVersion: 3, scopeStatus: 'active',
        scannedProjects: 1, skippedProjects: 0, delivered: 1, paused: 0, cancelled: 0, failed: 0, errors: [] };
    },
    runNativeWorkflowScheduleTick: async () => { counts.schedule += 1; return { enabled: true }; },
    runNativeDelegationTick: async () => { counts.delegations += 1; return { enabled: true }; },
    runNativeDurableToolTick: async () => { counts.durableTools += 1; return { enabled: true }; },
    ...extra,
  });
  return { counts, received, tick };
}

const four = (counts: Counts) => [counts.advanceReports, counts.deliverReports,
  counts.advanceReminders, counts.deliverReminders];

function assertFourCalls(counts: Counts, expected: number) {
  assert.deepEqual(four(counts), [expected, expected, expected, expected]);
}

function assertOtherJobsRan(counts: Counts) {
  assert.equal(counts.knowledge, 1);
  assert.equal(counts.assistant, 1);
  assert.equal(counts.siteNotifications, 1);
  assert.equal(counts.publicConsents, 1);
}

// A. Both workers are unscoped enterprise workers.
test('F4 A. both enterprise workers run once', async () => {
  const { counts, received, tick } = harness({});
  const data = await tick();
  assert.equal(data.pilotScopeAlignment.status, 'aligned');
  assert.equal(data.pilotScopeAlignment.mode, 'enterprise');
  assertFourCalls(counts, 1);
  assertOtherJobsRan(counts);
  assert.deepEqual(received, [now, now, now, now]);
});

// B. Both workers name the same enterprise.
test('F4 B. identical enterprise ids run all four once', async () => {
  const { counts, tick } = harness({ XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' });
  const data = await tick();
  assert.equal(data.pilotScopeAlignment.status, 'aligned');
  assert.deepEqual([data.pilotScopeAlignment.mode, data.pilotScopeAlignment.enterpriseId], ['enterprise', '1454']);
  assertFourCalls(counts, 1);
  assertOtherJobsRan(counts);
});

// C. Both workers share the same pilot.
test('F4 C. identical pilot configurations run all four once', async () => {
  const { counts, tick } = harness({ ...stagePilot, ...weeklyPilot });
  const data = await tick();
  assert.equal(data.pilotScopeAlignment.status, 'aligned');
  assert.deepEqual([data.pilotScopeAlignment.mode, data.pilotScopeAlignment.enterpriseId,
    data.pilotScopeAlignment.pilotId], ['pilot', '1454', 'first-pilot']);
  assertFourCalls(counts, 1);
  assertOtherJobsRan(counts);
});

// D/E/F/G/H. Any mismatch or invalid configuration skips all four entries.
const mismatches: Array<[string, Record<string, string | undefined>, string]> = [
  ['F4 D. reminder pilot with enterprise report', { ...stagePilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
    'pilot_worker_mode_mismatch'],
  ['F4 E. enterprise reminder with pilot report', { ...weeklyPilot, XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454' },
    'pilot_worker_mode_mismatch'],
  ['F4 F. different enterprise ids', { XIAOK_STAGE_REMINDER_ENTERPRISE_ID: '1454',
    XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1455' }, 'pilot_worker_enterprise_mismatch'],
  ['F4 G. different pilot ids', { ...stagePilot, ...weeklyPilot,
    XIAOK_WEEKLY_REPORT_PILOT_ID: 'second-pilot' }, 'pilot_worker_pilot_mismatch'],
  ['F4 H. invalid reminder mode', { ...weeklyPilot, XIAOK_STAGE_REMINDER_MODE: 'tenant' },
    'stage_reminder_mode_invalid'],
  ['F4 H. invalid weekly mode', { ...stagePilot, XIAOK_WEEKLY_REPORT_MODE: 'tenant' },
    'weekly_report_mode_invalid'],
  ['F4 H. missing pilot id', { ...stagePilot, ...weeklyPilot, XIAOK_WEEKLY_REPORT_PILOT_ID: '' },
    'weekly_report_pilot_required'],
];

for (const [name, env, errorCode] of mismatches) {
  test(name + ' skips all four workers', async () => {
    const { counts, tick } = harness(env);
    const data = await tick();
    assert.notEqual(data.pilotScopeAlignment.status, 'aligned');
    assert.equal(data.pilotScopeAlignment.errorCode, errorCode);
    assertFourCalls(counts, 0);
    assertOtherJobsRan(counts);
    for (const entry of [data.constructionReportChecks, data.stageReminderChecks,
      data.constructionReportDeliveries, data.stageReminderDeliveries]) {
      const value = entry as Record<string, unknown>;
      assert.equal(value.skipped, true);
      assert.equal(value.reason, 'pilot_worker_alignment');
      assert.equal(value.errorCode, errorCode);
    }
  });
}

// The invalid configuration never becomes a silent enterprise run.
test('F4 H. an invalid configuration has no enterprise mode', async () => {
  const { counts, tick } = harness({ ...stagePilot, ...weeklyPilot, XIAOK_WEEKLY_REPORT_MODE: 'tenant' });
  const data = await tick();
  assert.equal(data.pilotScopeAlignment.status, 'invalid');
  assert.equal(data.pilotScopeAlignment.mode, null);
  assertFourCalls(counts, 0);
});

// A reminder failure is contained and does not skip independent jobs.
test('worker failures do not skip independent jobs', async () => {
  const { counts, tick } = harness({ ...stagePilot, ...weeklyPilot }, {
    advanceConfiguredStageReminders: async () => { throw new Error('reminder_down'); },
  });
  const data = await tick();
  assert.deepEqual(data.stageReminderChecks, { error: 'stage_reminder_unavailable' });
  assert.equal(counts.advanceReminders, 0);
  assert.equal(counts.deliverReminders, 1);
  assert.equal(counts.advanceReports, 1);
  assert.equal(counts.deliverReports, 1);
  assertOtherJobsRan(counts);

  const reportHarness = harness({ ...stagePilot, ...weeklyPilot }, {
    advanceConfiguredConstructionReports: async () => { throw new Error('report_down'); },
    deliverConfiguredConstructionReports: async () => { throw new Error('delivery_down'); },
  });
  const reportData = await reportHarness.tick();
  assert.deepEqual(reportData.constructionReportChecks, { error: 'construction_report_unavailable' });
  assert.deepEqual(reportData.constructionReportDeliveries, { error: 'construction_report_delivery_unavailable' });
  assert.equal(reportData.inAppDeliveries, 0);
  assert.equal(reportHarness.counts.assistant, 1);
  assert.equal(reportHarness.counts.advanceReminders, 1);
  assert.equal(reportHarness.counts.deliverReminders, 1);
  assertOtherJobsRan(reportHarness.counts);
});

// Native Workflow keeps its own explicit enable conditions.
test('native workflow enable conditions are unchanged', async () => {
  const disabled = harness({});
  const disabledData = await disabled.tick();
  assert.equal(disabled.counts.schedule, 0);
  assert.equal(disabled.counts.delegations, 0);
  assert.equal(disabled.counts.durableTools, 0);
  assert.equal(disabledData.nativeWorkflowSchedule, null);
  assert.equal(disabledData.nativeWorkflowDelegations, null);
  assert.equal(disabledData.nativeWorkflowTools, null);

  const enabled = harness({
    NATIVE_WORKFLOW_SCHEDULE_ENABLED: '1',
    NATIVE_WORKFLOW_DELEGATION_ENABLED: '1',
    NATIVE_WORKFLOW_DURABLE_TOOL_ENABLED: '1',
  });
  await enabled.tick();
  assert.deepEqual([enabled.counts.schedule, enabled.counts.delegations, enabled.counts.durableTools], [1, 1, 1]);

  const recovery = harness({ NATIVE_WORKFLOW_TASK_RECOVERY_ENABLED: '1' });
  await recovery.tick();
  assert.equal(recovery.counts.schedule, 1);
  assert.equal(recovery.counts.delegations, 0);
});

// The route handler keeps authentication, validation and failure semantics.
test('the route handler rejects unauthorized, invalid and failing ticks', async () => {
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
      env: { ...stagePilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
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
test('an injected route handler runs the tick with a fixed clock', async () => {
  const { createAssistantJobsPost } = await import('@/lib/assistant/infrastructure/jobs-post-handler');
  const previous = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'f4-worker-secret';
  const counts = { knowledge: 0, assistant: 0 };
  try {
    const post = createAssistantJobsPost({
      now,
      env: { ...stagePilot, XIAOK_WEEKLY_REPORT_ENTERPRISE_ID: '1454' },
      advanceKnowledgeBatches: async () => { counts.knowledge += 1; return 0; },
      processAssistantJob: async () => { counts.assistant += 1; return { claimed: false }; },
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
    assert.equal((payload.data.pilotScopeAlignment as Record<string, unknown>).status, 'mismatch');
    for (const key of ['constructionReportChecks', 'stageReminderChecks',
      'constructionReportDeliveries', 'stageReminderDeliveries']) {
      assert.equal((payload.data[key] as Record<string, unknown>).skipped, true);
    }
    assert.deepEqual(counts, { knowledge: 1, assistant: 1 });
  } finally {
    if (previous === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previous;
  }
});
