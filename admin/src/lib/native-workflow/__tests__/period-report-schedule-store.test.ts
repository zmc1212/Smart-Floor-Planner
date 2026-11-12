import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WorkflowOperationError } from '../errors';
import {
  createFilePeriodReportScheduleStore,
  createMemoryPeriodReportScheduleStore,
} from '../live/period-report-schedule-store';
import {
  SCHEDULE_RUN_VERSION,
  emptyCounts,
  scheduleRunId,
  type PeriodReportScheduleRun,
} from '../live/period-report-schedule-types';

const ENTERPRISE_ID = '1454';
const PROJECT_ID = '1454000004';

function runFixture(periodStart = '2026-11-02'): PeriodReportScheduleRun {
  return {
    runVersion: SCHEDULE_RUN_VERSION,
    runId: scheduleRunId(ENTERPRISE_ID, periodStart),
    enterpriseId: ENTERPRISE_ID,
    period: {
      kind: 'weekly',
      periodStart,
      periodEnd: '2026-11-09',
      startAt: '2026-11-01T16:00:00.000Z',
      endAt: '2026-11-08T16:00:00.000Z',
    },
    weeklyClaim: null,
    published: {
      definitionId: 'period-report-weekly',
      revision: 1,
      digest: 'digest',
      nodeVersions: { trigger: 'v1' },
    },
    status: 'discovered',
    queue: [],
    projects: {},
    counts: emptyCounts(),
    startedAt: '2026-11-12T02:00:00.000Z',
    updatedAt: '2026-11-12T02:00:00.000Z',
    finishedAt: null,
    lastError: null,
    audit: [],
  };
}

test('file schedule store is exclusive and refuses a different identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-schedule-'));
  try {
    const store = createFilePeriodReportScheduleStore({ rootDir: root });
    const run = runFixture();
    const created = await store.create(run);
    assert.equal(created.created, true);
    const repeated = await store.create(run);
    assert.equal(repeated.created, false);
    assert.equal(repeated.run.runId, run.runId);

    // A concurrent creator's startedAt/published is the winner; the loser
    // adopts the stored run instead of failing on non-scope fields.
    const concurrent = await store.create({
      ...run,
      startedAt: '2026-11-12T02:00:01.000Z',
      published: {
        definitionId: 'period-report-weekly',
        revision: 2,
        digest: 'other',
        nodeVersions: { trigger: 'v2' },
      },
    });
    assert.equal(concurrent.created, false);
    assert.equal(concurrent.run.startedAt, run.startedAt);
    assert.equal(concurrent.run.published?.revision, 1);
    await assert.rejects(
      () => store.update({
        ...created.run,
        published: {
          definitionId: 'period-report-weekly',
          revision: 2,
          digest: 'other',
          nodeVersions: { trigger: 'v2' },
        },
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'period_report_schedule_conflict',
    );

    await assert.rejects(
      () => store.create({
        ...runFixture('2026-11-09'),
        runId: run.runId,
      }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'period_report_schedule_conflict',
    );

    const updated = await store.update({
      ...created.run,
      status: 'completed',
      updatedAt: '2026-11-12T03:00:00.000Z',
    });
    assert.equal(updated.status, 'completed');
    assert.equal(updated.startedAt, run.startedAt);
    const read = await store.get(run.runId);
    assert.equal(read?.status, 'completed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the weekly claim receipt is immutable once recorded', async () => {
  const store = createMemoryPeriodReportScheduleStore();
  const base = runFixture();
  const claim = {
    periodStart: base.period.periodStart,
    claimedAt: '2026-11-11T16:00:00.000Z',
    previousNextWeeklyAt: '2026-11-08T16:00:00.000Z',
    nextWeeklyAt: '2026-11-15T16:00:00.000Z',
  };
  const created = await store.create({ ...base, weeklyClaim: claim });
  assert.deepEqual(created.run.weeklyClaim, claim);
  await assert.rejects(
    () => store.update({ ...created.run, weeklyClaim: null }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_report_schedule_conflict',
  );
  await assert.rejects(
    () => store.update({
      ...created.run,
      weeklyClaim: { ...claim, nextWeeklyAt: '2026-11-22T16:00:00.000Z' },
    }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_report_schedule_conflict',
  );
  const updated = await store.update({ ...created.run, status: 'observing' });
  assert.deepEqual(updated.weeklyClaim, claim);
  // A claim always belongs to the run's own period.
  await assert.rejects(
    () => store.update({
      ...created.run,
      weeklyClaim: { ...claim, periodStart: '2026-10-26' },
    }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_report_schedule_conflict',
  );
});

test('file schedule store persists control and issue ledger', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-schedule-'));
  try {
    const store = createFilePeriodReportScheduleStore({ rootDir: root });
    const initial = await store.control(ENTERPRISE_ID);
    assert.equal(initial.paused, false);
    const paused = await store.setControl(ENTERPRISE_ID, {
      paused: true,
      updatedBy: '1454000001',
      reason: 'manual hold',
      now: () => new Date('2026-11-12T03:00:00.000Z'),
    });
    assert.equal(paused.paused, true);
    assert.equal((await store.control(ENTERPRISE_ID)).reason, 'manual hold');

    const empty = await store.ledger(ENTERPRISE_ID, PROJECT_ID);
    assert.deepEqual(empty.items, []);
    const saved = await store.saveLedger({
      ...empty,
      items: [{
        issueId: '9001',
        sourceRecordId: '5001',
        status: 'awaiting_review',
        ownerId: '1454000011',
        ownerName: 'Designer',
        lastResult: 'waiting',
        targetKind: 'designer',
        firstPeriod: '2026-11-02',
        lastPeriod: '2026-11-02',
        periods: ['2026-11-02'],
        updatedAt: '2026-11-08T01:00:00.000Z',
      }],
      updatedAt: '2026-11-12T03:00:00.000Z',
    });
    assert.equal(saved.items.length, 1);
    const read = await store.ledger(ENTERPRISE_ID, PROJECT_ID);
    assert.equal(read.items[0]!.issueId, '9001');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('file schedule lease expires only after its TTL and never releases another owner', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sfp-schedule-'));
  try {
    const store = createFilePeriodReportScheduleStore({ rootDir: root });
    const runId = scheduleRunId(ENTERPRISE_ID, '2026-11-02');
    let now = new Date('2026-11-12T02:00:00.000Z');
    assert.equal(await store.acquire(runId, { owner: 'a', now: () => now, ttlMs: 60_000 }), true);
    assert.equal(await store.acquire(runId, { owner: 'b', now: () => now, ttlMs: 60_000 }), false);
    now = new Date('2026-11-12T02:00:30.000Z');
    assert.equal(await store.acquire(runId, { owner: 'b', now: () => now, ttlMs: 60_000 }), false);
    now = new Date('2026-11-12T02:01:01.000Z');
    assert.equal(await store.acquire(runId, { owner: 'b', now: () => now, ttlMs: 60_000 }), true);
    // The stale owner's release must not free the new owner's lease.
    await store.release(runId, 'a');
    assert.equal(await store.acquire(runId, { owner: 'c', now: () => now, ttlMs: 60_000 }), false);
    await store.release(runId, 'b');
    assert.equal(await store.acquire(runId, { owner: 'c', now: () => now, ttlMs: 60_000 }), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('memory schedule store mirrors identity, control, ledger and lease semantics', async () => {
  const store = createMemoryPeriodReportScheduleStore();
  const run = runFixture();
  assert.equal((await store.create(run)).created, true);
  await assert.rejects(
    () => store.create({ ...run, enterpriseId: '9999' }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_report_schedule_conflict',
  );
  const control = await store.setControl(ENTERPRISE_ID, {
    paused: true,
    updatedBy: 'tester',
    reason: null,
    now: () => new Date('2026-11-12T03:00:00.000Z'),
  });
  assert.equal(control.paused, true);
  const now = new Date('2026-11-12T03:00:00.000Z');
  assert.equal(await store.acquire(run.runId, { owner: 'a', now: () => now, ttlMs: 60_000 }), true);
  assert.equal(await store.acquire(run.runId, { owner: 'b', now: () => now, ttlMs: 60_000 }), false);
  await store.release(run.runId, 'a');
  assert.equal(await store.acquire(run.runId, { owner: 'b', now: () => now, ttlMs: 60_000 }), true);
  const listed = await store.list({ enterpriseId: ENTERPRISE_ID });
  assert.equal(listed.length, 1);
  assert.equal((await store.list({ enterpriseId: '9999' })).length, 0);
});
