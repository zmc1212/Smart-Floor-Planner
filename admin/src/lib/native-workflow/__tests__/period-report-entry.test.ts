import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostgresTransaction } from '@/db/transaction';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '../errors';
import { runPeriodReportEntry } from '../live/period-report-entry';
import { createMemoryWorkflowRunStore } from '../live/run-store';
import {
  LiveOperationFailure,
  type LiveOperationPorts,
  type LiveRunStore,
} from '../live/types';
import { createWorkflowService } from '../service';
import { createMemoryWorkflowStore } from '../store/memory-store';
import type { PublishedWorkflowVersion } from '../store/types';
import type { TriggerEvent } from '../types';

const ENTERPRISE_ID = '1454';
const ACTOR_ADMIN = '1454000007';
const WORKER_ADMIN = '1454000008';
const PROJECT_ID = '1455';

const actor: ConstructionActor = { enterpriseId: ENTERPRISE_ID, adminId: ACTOR_ADMIN };

/** Complete Shanghai week 2026-10-26..2026-11-02, right-open. */
const weeklyEvent: TriggerEvent = {
  eventId: 'b5-period-weekly-2026-10-26',
  eventType: 'period_report',
  occurredAt: '2026-11-02T10:00:00.000Z',
  periodKind: 'weekly',
  periodStart: '2026-10-26',
  periodEnd: '2026-11-02',
};

/** Exclusive end of that week. */
const WEEKLY_END = new Date('2026-11-01T16:00:00.000Z');

/** Trusted clock after the week ended. */
const AFTER_PERIOD = new Date('2026-11-10T02:00:00.000Z');

const enterpriseRow = { id: ENTERPRISE_ID };
const projectRow = { id: PROJECT_ID, name: '测试项目', status: 'active' };
const workerAdminRow = {
  id: WORKER_ADMIN,
  role: 'construction_staff',
  status: 'active',
  must_change_password: false,
};
const workerMemberRow = { role: 'worker', active: true };
const workerBindingRow = {
  id: '9002',
  audience: 'worker',
  admin_id: WORKER_ADMIN,
  user_id: null,
  project_id: null,
  scope_key: 'enterprise',
  status: 'enabled',
  conversation_id: '7002',
  principal_key: `admin:${WORKER_ADMIN}`,
};
const BOSS_ADMIN = '1454000013';
const bossAdminRow = {
  id: BOSS_ADMIN,
  role: 'enterprise_admin',
  status: 'active',
  must_change_password: false,
};
const bossBindingRow = {
  id: '9004',
  audience: 'boss',
  admin_id: BOSS_ADMIN,
  user_id: null,
  project_id: null,
  scope_key: 'enterprise',
  status: 'enabled',
  conversation_id: '7004',
  principal_key: `admin:${BOSS_ADMIN}`,
};
const DESIGNER_ADMIN = '1454000011';
const designerAdminRow = {
  id: DESIGNER_ADMIN,
  role: 'designer',
  status: 'active',
  must_change_password: false,
};
const designerMemberRow = { role: 'designer', active: true };
const designerBindingRow = {
  id: '9003',
  audience: 'designer',
  admin_id: DESIGNER_ADMIN,
  user_id: null,
  project_id: null,
  scope_key: 'enterprise',
  status: 'enabled',
  conversation_id: '7003',
  principal_key: `admin:${DESIGNER_ADMIN}`,
};

interface RecordedQuery {
  readonly text: string;
  readonly params: readonly unknown[];
}

type Responder = (query: RecordedQuery) => unknown[] | undefined;

/** Offline tenant transaction: records SQL text/params and returns canned rows. */
function fakeDatabase(respond: Responder) {
  const calls: RecordedQuery[] = [];
  const tx = {
    execute(query: { queryChunks?: unknown[] }) {
      let text = '';
      const params: unknown[] = [];
      const append = (chunk: unknown) => {
        if (
          typeof chunk === 'string'
          || typeof chunk === 'number'
          || typeof chunk === 'bigint'
          || typeof chunk === 'boolean'
        ) {
          text += `$${params.length + 1}`;
          params.push(chunk);
        } else if (Array.isArray((chunk as { value?: unknown[] })?.value)) {
          text += (chunk as { value: string[] }).value.join('');
        } else if (Array.isArray((chunk as { queryChunks?: unknown[] })?.queryChunks)) {
          for (const nested of (chunk as { queryChunks: unknown[] }).queryChunks) append(nested);
        } else {
          text += '?';
        }
      };
      for (const chunk of query.queryChunks ?? []) append(chunk);
      const call: RecordedQuery = { text, params };
      calls.push(call);
      return Promise.resolve({ rows: respond(call) ?? [] });
    },
  } as unknown as PostgresTransaction;
  return { tx, calls };
}

function fakeTransaction(transactions: { count: number }, tx: PostgresTransaction) {
  return <T>(
    _enterpriseId: bigint | number | string,
    callback: (transaction: PostgresTransaction) => Promise<T>,
  ): Promise<T> => {
    transactions.count += 1;
    return callback(tx);
  };
}

/** Real authorization/binding SQL, with only the database boundary faked. */
function responder(overrides: {
  admin?: unknown[];
  member?: unknown[];
  access?: unknown[];
  binding?: unknown[];
} = {}): Responder {
  return (query) => {
    const text = query.text;
    if (text.includes('from app.enterprises')) return [enterpriseRow];
    if (text.includes('construction_actor_access')) return [{ role: 'manager' }];
    if (text.includes('from app.construction_projects')) return [projectRow];
    if (text.includes('select role from app.construction_members')) return [{ role: 'manager' }];
    if (text.includes('select id,role,status,must_change_password')) {
      return overrides.admin ?? [workerAdminRow];
    }
    if (text.includes('select role,active from app.construction_members')) {
      return overrides.member ?? [workerMemberRow];
    }
    if (text.includes('construction_followup_staff_access')) {
      return overrides.access ?? [{ role: 'worker' }];
    }
    if (text.includes('pg_advisory_xact_lock')) return [];
    // No staff binding exists yet: the real ensureFollowupBinding creates it.
    if (text.includes('select * from app.construction_followup_bindings')) return [];
    if (text.includes('insert into app.assistant_conversations')) return [{ id: '7002' }];
    if (text.includes('insert into app.construction_followup_bindings')) {
      return overrides.binding ?? [workerBindingRow];
    }
    if (text.includes('insert into app.assistant_participants')) return [];
    return undefined;
  };
}

const WRITE_TABLES = [
  'assistant_conversations',
  'construction_followup_bindings',
  'assistant_participants',
] as const;

const ENQUEUE_TABLES = [
  'construction_reports',
  'assistant_jobs',
  'assistant_usage_records',
  'ai_provider_attempts',
] as const;

function writesTo(calls: readonly RecordedQuery[], table: string): RecordedQuery[] {
  const pattern = new RegExp(`(insert\\s+into|update)\\s+app\\.${table}\\b`, 'i');
  return calls.filter((call) => pattern.test(call.text));
}

function queriesOn(calls: readonly RecordedQuery[], table: string): RecordedQuery[] {
  return calls.filter((call) => new RegExp(`app\\.${table}\\b`, 'i').test(call.text));
}

/** Ports that stop on the first operation; any execution is visible. */
function stoppingPorts() {
  const calls: string[] = [];
  const ports: LiveOperationPorts = {
    async execute(operation) {
      calls.push(operation.capabilityRef);
      throw new LiveOperationFailure({
        code: 'construction_forbidden',
        path: `nodes.${operation.nodeId}`,
        message: 'the test stops before the first real read',
      });
    },
  };
  return { calls, ports };
}

function countingRunStore() {
  const inner = createMemoryWorkflowRunStore();
  let creates = 0;
  const store: LiveRunStore = {
    create(record) {
      creates += 1;
      return inner.create(record);
    },
    update: (record) => inner.update(record),
    get: (runId) => inner.get(runId),
    list: (limit) => inner.list(limit),
  };
  return { store, creates: () => creates };
}

async function publish(kind: 'daily' | 'weekly'): Promise<PublishedWorkflowVersion> {
  const definitionId = kind === 'daily' ? 'period-report-daily' : 'period-report-weekly';
  const service = createWorkflowService({
    store: createMemoryWorkflowStore(),
    now: () => '2026-11-11T12:00:00.000Z',
  });
  await service.createFromTemplate(definitionId);
  const published = await service.publishDraft({ definitionId, expectedDraftRevision: 1 });
  return published.version;
}

interface EntryHarness {
  readonly database: ReturnType<typeof fakeDatabase>;
  readonly transactions: { count: number };
  readonly ports: ReturnType<typeof stoppingPorts>;
  readonly runs: ReturnType<typeof countingRunStore>;
  readonly loads: { count: number };
}

function harness(): EntryHarness {
  return {
    database: fakeDatabase(responder()),
    transactions: { count: 0 },
    ports: stoppingPorts(),
    runs: countingRunStore(),
    loads: { count: 0 },
  };
}

function entryInput(
  state: EntryHarness,
  published: PublishedWorkflowVersion,
  event: TriggerEvent = weeklyEvent,
) {
  return {
    loadPublished: async () => {
      state.loads.count += 1;
      return published;
    },
    enterpriseId: ENTERPRISE_ID,
    projectId: PROJECT_ID,
    actor,
    event,
    receiver: { kind: 'worker', adminId: WORKER_ADMIN } as const,
    ports: state.ports.ports,
    store: state.runs.store,
    runId: 'entry-run-1',
  };
}

function entryDependencies(state: EntryHarness, now: Date = AFTER_PERIOD) {
  return {
    now: () => now,
    staff: {
      transaction: fakeTransaction(state.transactions, state.database.tx),
      now: () => now,
    },
    boss: {
      transaction: fakeTransaction(state.transactions, state.database.tx),
      now: () => now,
    },
  };
}

/** The rejection contract: no transaction, no binding, no enqueue, no run. */
function assertRejectedBeforeAnyBusinessWrite(state: EntryHarness): void {
  assert.equal(state.transactions.count, 0, 'the worker transaction must not open');
  assert.equal(state.database.calls.length, 0, 'no authorization or binding query may run');
  for (const table of WRITE_TABLES) {
    assert.equal(writesTo(state.database.calls, table).length, 0, `${table} must not be written`);
  }
  for (const table of ENQUEUE_TABLES) {
    assert.equal(queriesOn(state.database.calls, table).length, 0, `${table} must not be touched`);
  }
  assert.deepEqual(state.ports.calls, [], 'no port operation (enqueue) may run');
  assert.equal(state.runs.creates(), 0, 'no live run may be created');
}

test('weekly event with a daily published template is rejected before the worker binding', async () => {
  const state = harness();
  const daily = await publish('daily');

  await assert.rejects(
    () => runPeriodReportEntry(entryInput(state, daily), entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'live_event_type_unsupported',
  );

  assert.equal(state.loads.count, 1);
  assertRejectedBeforeAnyBusinessWrite(state);
});

test('a published digest that no longer compiles is rejected before the worker binding', async () => {
  const state = harness();
  const weekly = await publish('weekly');
  const tampered: PublishedWorkflowVersion = { ...weekly, digest: 'tampered-digest' };

  await assert.rejects(
    () => runPeriodReportEntry(entryInput(state, tampered), entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'published_version_invalid',
  );

  assertRejectedBeforeAnyBusinessWrite(state);
});

test('recorded node versions that no longer match are rejected before the worker binding', async () => {
  const state = harness();
  const weekly = await publish('weekly');
  const tampered: PublishedWorkflowVersion = {
    ...weekly,
    nodeVersions: { ...weekly.nodeVersions, 'save-report': 'save_result@9/unknown' },
  };

  await assert.rejects(
    () => runPeriodReportEntry(entryInput(state, tampered), entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'published_version_invalid',
  );

  assertRejectedBeforeAnyBusinessWrite(state);
});

test('a matching weekly template and event proceeds through authorization, binding and the runner', async () => {
  const state = harness();
  const weekly = await publish('weekly');

  const entry = await runPeriodReportEntry(entryInput(state, weekly), entryDependencies(state));

  // The real authorization order still holds: project lock, staff checks, binding.
  assert.equal(state.transactions.count, 1);
  const projectLock = state.database.calls.findIndex((call) =>
    /from app\.construction_projects/.test(call.text) && /for update/.test(call.text));
  const workerAdminCheck = state.database.calls.findIndex((call) =>
    /select id,role,status,must_change_password/.test(call.text));
  const bindingInsert = state.database.calls.findIndex((call) =>
    /insert into app\.construction_followup_bindings/.test(call.text));
  assert.ok(projectLock >= 0);
  assert.ok(projectLock < workerAdminCheck);
  assert.ok(workerAdminCheck < bindingInsert);
  assert.equal(writesTo(state.database.calls, 'construction_followup_bindings').length, 1);
  assert.equal(writesTo(state.database.calls, 'assistant_conversations').length, 1);
  assert.equal(writesTo(state.database.calls, 'assistant_participants').length, 1);
  for (const table of ENQUEUE_TABLES) {
    assert.equal(queriesOn(state.database.calls, table).length, 0, `${table} must not be touched`);
  }

  assert.equal(entry.staff?.bindingId, '9002');
  assert.equal(entry.staff?.receiverKind, 'worker');
  assert.equal(entry.period.kind, 'weekly');
  assert.equal(entry.period.periodStart, '2026-10-26');
  assert.equal(entry.period.periodEnd, '2026-11-02');
  assert.deepEqual(entry.businessEvent, {
    outboxEventId: null,
    progressRevision: 0,
    stageKey: '',
    settingsVersion: 0,
    source: 'current_project_revision',
    periodKind: 'weekly',
    periodStart: '2026-10-26',
    periodEnd: '2026-11-02',
    receiver: { kind: 'worker', adminId: WORKER_ADMIN },
  });

  // The same selected revision and event reach the runner.
  assert.equal(entry.record.binding.definitionId, 'period-report-weekly');
  assert.equal(entry.record.binding.revision, weekly.revision);
  assert.equal(entry.record.binding.digest, weekly.digest);
  assert.deepEqual(entry.record.binding.event, weeklyEvent);
  assert.equal(entry.record.status, 'failed');
  assert.deepEqual(state.ports.calls, ['read.period_records']);
  assert.equal(state.runs.creates(), 1);
});

test('an unfinished period is rejected before the published target is loaded', async () => {
  const state = harness();
  const weekly = await publish('weekly');

  await assert.rejects(
    () => runPeriodReportEntry(
      entryInput(state, weekly),
      entryDependencies(state, new Date(WEEKLY_END.getTime() - 1)),
    ),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'period_not_ended',
  );

  assert.equal(state.loads.count, 0);
  assertRejectedBeforeAnyBusinessWrite(state);
});

function designerHarness(overrides: Parameters<typeof responder>[0] = {}): EntryHarness {
  return {
    database: fakeDatabase(responder({
      admin: [designerAdminRow],
      member: [designerMemberRow],
      binding: [designerBindingRow],
      ...overrides,
    })),
    transactions: { count: 0 },
    ports: stoppingPorts(),
    runs: countingRunStore(),
    loads: { count: 0 },
  };
}

function designerEntryInput(
  state: EntryHarness,
  published: PublishedWorkflowVersion,
) {
  return {
    ...entryInput(state, published),
    receiver: { kind: 'designer', adminId: DESIGNER_ADMIN } as const,
  };
}

test('a designer receiver binds the enterprise designer binding and reaches the runner', async () => {
  const state = designerHarness();
  const weekly = await publish('weekly');

  const entry = await runPeriodReportEntry(
    designerEntryInput(state, weekly),
    entryDependencies(state),
  );

  assert.equal(state.transactions.count, 1);
  const bindingInsert = state.database.calls.findIndex((call) =>
    /insert into app\.construction_followup_bindings/.test(call.text));
  assert.ok(bindingInsert >= 0);
  assert.match(
    state.database.calls[bindingInsert]!.params.join(' '),
    /admin:1454000011.*designer/u,
  );
  assert.equal(entry.staff?.receiverKind, 'designer');
  assert.equal(entry.staff?.bindingId, '9003');
  assert.equal(entry.staff?.conversationId, '7003');
  assert.deepEqual(entry.businessEvent.receiver, {
    kind: 'designer',
    adminId: DESIGNER_ADMIN,
  });
  assert.equal(entry.record.binding.definitionId, 'period-report-weekly');
  assert.equal(state.runs.creates(), 1);
});

test('a designer receiver with a non-designer admin role is rejected before the binding write', async () => {
  const state = designerHarness({ admin: [workerAdminRow] });
  const weekly = await publish('weekly');

  await assert.rejects(
    () => runPeriodReportEntry(designerEntryInput(state, weekly), entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'designer_receiver_unavailable',
  );

  assert.equal(state.transactions.count, 1);
  assert.equal(writesTo(state.database.calls, 'construction_followup_bindings').length, 0);
  assert.equal(writesTo(state.database.calls, 'assistant_conversations').length, 0);
  assert.equal(writesTo(state.database.calls, 'assistant_participants').length, 0);
  for (const table of ENQUEUE_TABLES) {
    assert.equal(queriesOn(state.database.calls, table).length, 0, `${table} must not be touched`);
  }
  assert.deepEqual(state.ports.calls, []);
  assert.equal(state.runs.creates(), 0);
});

function bossHarness(overrides: Parameters<typeof responder>[0] = {}): EntryHarness {
  return {
    database: fakeDatabase(responder({
      admin: [bossAdminRow],
      access: [{ role: 'owner' }],
      binding: [bossBindingRow],
      ...overrides,
    })),
    transactions: { count: 0 },
    ports: stoppingPorts(),
    runs: countingRunStore(),
    loads: { count: 0 },
  };
}

function bossEntryInput(
  state: EntryHarness,
  published: PublishedWorkflowVersion,
) {
  return {
    ...entryInput(state, published),
    receiver: { kind: 'boss', adminId: BOSS_ADMIN } as const,
  };
}

test('a boss receiver binds the enterprise boss binding and reaches the runner', async () => {
  const state = bossHarness();
  const weekly = await publish('weekly');

  const entry = await runPeriodReportEntry(
    bossEntryInput(state, weekly),
    entryDependencies(state),
  );

  assert.equal(state.transactions.count, 1);
  // A boss is the enterprise owner: no receiver membership query may run. The
  // executor's own manager lookup is unrelated.
  assert.equal(
    state.database.calls.filter((call) =>
      /select role,active from app\.construction_members/.test(call.text)).length,
    0,
  );
  const bindingInsert = state.database.calls.findIndex((call) =>
    /insert into app\.construction_followup_bindings/.test(call.text));
  assert.ok(bindingInsert >= 0);
  assert.match(
    state.database.calls[bindingInsert]!.params.join(' '),
    /admin:1454000013.*boss/u,
  );
  assert.equal(entry.staff, null);
  assert.equal(entry.boss?.receiverKind, 'boss');
  assert.equal(entry.boss?.adminId, BOSS_ADMIN);
  assert.equal(entry.boss?.accessRole, 'owner');
  assert.equal(entry.boss?.memberRequired, false);
  assert.equal(entry.boss?.bindingId, '9004');
  assert.equal(entry.boss?.conversationId, '7004');
  assert.deepEqual(entry.businessEvent.receiver, {
    kind: 'boss',
    adminId: BOSS_ADMIN,
  });
  assert.equal(entry.record.binding.definitionId, 'period-report-weekly');
  assert.equal(state.runs.creates(), 1);
});

test('a boss receiver without the enterprise owner role is rejected before the binding write', async () => {
  const state = bossHarness({ access: [{ role: 'member' }] });
  const weekly = await publish('weekly');

  await assert.rejects(
    () => runPeriodReportEntry(bossEntryInput(state, weekly), entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'boss_receiver_unavailable',
  );

  assert.equal(state.transactions.count, 1);
  assert.equal(writesTo(state.database.calls, 'construction_followup_bindings').length, 0);
  assert.equal(writesTo(state.database.calls, 'assistant_conversations').length, 0);
  assert.equal(writesTo(state.database.calls, 'assistant_participants').length, 0);
  for (const table of ENQUEUE_TABLES) {
    assert.equal(queriesOn(state.database.calls, table).length, 0, `${table} must not be touched`);
  }
  assert.deepEqual(state.ports.calls, []);
  assert.equal(state.runs.creates(), 0);
});

test('a boss receiver with a worker admin role is rejected', async () => {
  const state = bossHarness({
    admin: [workerAdminRow],
    access: [{ role: 'member' }],
  });
  const weekly = await publish('weekly');

  await assert.rejects(
    () => runPeriodReportEntry(bossEntryInput(state, weekly), entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'boss_receiver_unavailable',
  );
  assert.equal(writesTo(state.database.calls, 'construction_followup_bindings').length, 0);
  assert.deepEqual(state.ports.calls, []);
});

test('an unknown receiver kind is rejected before the period or published target', async () => {
  const state = harness();
  const weekly = await publish('weekly');

  await assert.rejects(
    () => runPeriodReportEntry({
      ...entryInput(state, weekly),
      receiver: { kind: 'service' } as unknown as { kind: 'customer' },
    }, entryDependencies(state)),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'receiver_kind_invalid',
  );

  assert.equal(state.loads.count, 0);
  assertRejectedBeforeAnyBusinessWrite(state);
});
