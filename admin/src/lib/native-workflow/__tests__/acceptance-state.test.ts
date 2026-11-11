import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agentSettingsSnapshot,
  reportPlanSnapshot,
  restoreAgentSettings,
  restoreReportPlan,
  runRestorations,
  verifyAgentSettings,
  verifyReportPlan,
  type Queryable,
} from '../live/acceptance-state';

class RecordingQueryable implements Queryable {
  readonly calls: Array<{ text: string; values: readonly unknown[] | undefined }> = [];
  private rows: unknown[];

  constructor(rows: unknown[] = []) {
    this.rows = rows;
  }

  async query<T = unknown>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }> {
    this.calls.push({ text, values });
    return { rows: this.rows as T[] };
  }
}

const DAILY_AT = new Date('2026-11-02T12:00:00.000Z');
const WEEKLY_AT = new Date('2026-11-07T00:00:00.000Z');

test('reportPlanSnapshot keeps false and null instead of normalizing them', () => {
  const snapshot = reportPlanSnapshot({
    enabled: false,
    stage_enabled: false,
    next_daily_at: null,
    next_weekly_at: WEEKLY_AT,
    stage_cursor: '0',
    project_ids: [],
    audiences: ['customer'],
  });
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.stage_enabled, false);
  assert.equal(snapshot.next_daily_at, null);
  assert.equal(snapshot.next_weekly_at, WEEKLY_AT);
  assert.equal(snapshot.stage_cursor, '0');
  assert.deepEqual(snapshot.project_ids, []);
  assert.deepEqual(snapshot.audiences, ['customer']);

  const numericCursor = reportPlanSnapshot({
    enabled: true,
    stage_enabled: true,
    next_daily_at: DAILY_AT,
    next_weekly_at: WEEKLY_AT,
    stage_cursor: 12,
    project_ids: ['1454000004'],
    audiences: ['customer'],
  });
  assert.equal(numericCursor.stage_cursor, '12');
});

test('agentSettingsSnapshot keeps a null config and false enabled flag', () => {
  assert.deepEqual(agentSettingsSnapshot({ agent_config: null, enabled: false }), {
    agent_config: null,
    enabled: false,
  });
  assert.deepEqual(agentSettingsSnapshot(undefined), {
    agent_config: null,
    enabled: null,
  });
  assert.deepEqual(agentSettingsSnapshot({ agent_config: {} }), {
    agent_config: {},
    enabled: null,
  });
});

test('restoreReportPlan passes explicit nulls and the original JSON arrays', async () => {
  const pool = new RecordingQueryable();
  await restoreReportPlan(pool, '1454', {
    enabled: false,
    stage_enabled: null,
    next_daily_at: null,
    next_weekly_at: null,
    stage_cursor: null,
    project_ids: ['1454000004'],
    audiences: ['customer'],
  });

  assert.equal(pool.calls.length, 1);
  const values = pool.calls[0].values;
  assert.ok(values);
  assert.equal(values[0], false);
  assert.equal(values[1], null);
  assert.equal(values[2], null);
  assert.equal(values[3], null);
  assert.equal(values[4], null);
  assert.equal(values[5], JSON.stringify(['1454000004']));
  assert.equal(values[6], JSON.stringify(['customer']));
  assert.equal(values[7], '1454');
});

test('restoreAgentSettings passes null for a null agent_config and false for enabled', async () => {
  const pool = new RecordingQueryable();
  await restoreAgentSettings(pool, '1454', { agent_config: null, enabled: false });

  assert.equal(pool.calls.length, 1);
  const values = pool.calls[0].values;
  assert.ok(values);
  assert.equal(values[0], null);
  assert.equal(values[1], false);
  assert.equal(values[2], '1454');

  const jsonPool = new RecordingQueryable();
  await restoreAgentSettings(jsonPool, '1454', {
    agent_config: { runtime: 'langgraph-v1' },
    enabled: true,
  });
  const jsonValues = jsonPool.calls[0].values;
  assert.ok(jsonValues);
  assert.equal(jsonValues[0], JSON.stringify({ runtime: 'langgraph-v1' }));
});

test('runRestorations continues after a failing step and records the error', async () => {
  const executed: string[] = [];
  const outcomes = await runRestorations([
    {
      name: 'first',
      run: async () => {
        executed.push('first');
        throw new Error('boom');
      },
    },
    {
      name: 'second',
      run: async () => {
        executed.push('second');
      },
    },
    {
      name: 'third',
      run: async () => {
        executed.push('third');
      },
    },
  ]);

  assert.deepEqual(executed, ['first', 'second', 'third']);
  assert.equal(outcomes.length, 3);
  assert.equal(outcomes[0].name, 'first');
  assert.equal(outcomes[0].restored, false);
  assert.equal(outcomes[0].error, 'boom');
  assert.deepEqual(outcomes[0].mismatches, []);
  assert.equal(outcomes[1].restored, true);
  assert.equal(outcomes[1].error, null);
  assert.equal(outcomes[2].restored, true);
});

test('runRestorations marks a verify mismatch as not restored without throwing', async () => {
  const outcomes = await runRestorations([
    {
      name: 'report_plan',
      run: async () => undefined,
      verify: async () => ['enabled expected false got true'],
    },
  ]);

  assert.equal(outcomes[0].restored, false);
  assert.equal(outcomes[0].error, null);
  assert.deepEqual(outcomes[0].mismatches, ['enabled expected false got true']);
});

test('verifyReportPlan re-reads every restored field', async () => {
  const snapshot = reportPlanSnapshot({
    enabled: false,
    stage_enabled: true,
    next_daily_at: DAILY_AT,
    next_weekly_at: WEEKLY_AT,
    stage_cursor: '0',
    project_ids: ['1454000004'],
    audiences: ['customer'],
  });
  const matching = new RecordingQueryable([{
    enabled: false,
    stage_enabled: true,
    next_daily_at: DAILY_AT,
    next_weekly_at: WEEKLY_AT,
    stage_cursor: '0',
    project_ids: ['1454000004'],
    audiences: ['customer'],
  }]);
  assert.deepEqual(await verifyReportPlan(matching, '1454', snapshot), []);

  const mismatching = new RecordingQueryable([{
    enabled: true,
    stage_enabled: false,
    next_daily_at: null,
    next_weekly_at: WEEKLY_AT,
    stage_cursor: null,
    project_ids: [],
    audiences: [],
  }]);
  const mismatches = await verifyReportPlan(mismatching, '1454', snapshot);
  assert.ok(mismatches.some((entry) => entry.startsWith('enabled')));
  assert.ok(mismatches.some((entry) => entry.startsWith('stage_enabled')));
  assert.ok(mismatches.some((entry) => entry.startsWith('next_daily_at')));
  assert.ok(mismatches.some((entry) => entry.startsWith('stage_cursor')));
  assert.ok(mismatches.some((entry) => entry.startsWith('project_ids')));
  assert.ok(mismatches.some((entry) => entry.startsWith('audiences')));

  const missing = await verifyReportPlan(new RecordingQueryable(), '1454', snapshot);
  assert.deepEqual(missing, ['report settings row is missing']);
});

test('verifyAgentSettings re-reads the config and the enabled flag', async () => {
  const snapshot = agentSettingsSnapshot({ agent_config: null, enabled: false });
  const matching = new RecordingQueryable([{ agent_config: null, enabled: false }]);
  assert.deepEqual(await verifyAgentSettings(matching, '1454', snapshot), []);

  const mismatching = new RecordingQueryable([{
    agent_config: { runtime: 'langgraph-v1' },
    enabled: true,
  }]);
  const mismatches = await verifyAgentSettings(mismatching, '1454', snapshot);
  assert.ok(mismatches.some((entry) => entry.startsWith('agent_config')));
  assert.ok(mismatches.some((entry) => entry.startsWith('enabled')));
});
