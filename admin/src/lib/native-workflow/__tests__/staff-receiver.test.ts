import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantError } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent } from '../types';
import { prepareStaffPeriodReport } from '../live/staff-receiver';

const ENTERPRISE_ID = '1454';
const ACTOR_ADMIN = '1454000007';
const WORKER_ADMIN = '1454000008';
const DESIGNER_ADMIN = '1454000011';
const PROJECT_ID = '1455';

const actor: ConstructionActor = { enterpriseId: ENTERPRISE_ID, adminId: ACTOR_ADMIN };

/** Fixed Shanghai day 2026-11-10, right-open end at 2026-11-10T16:00Z. */
const event: TriggerEvent = {
  eventId: 'b5-period-daily-2026-11-10',
  eventType: 'period_report',
  occurredAt: '2026-11-11T02:00:00.000Z',
  periodKind: 'daily',
  periodStart: '2026-11-10',
  periodEnd: '2026-11-10',
};

/** Complete Shanghai week 2026-11-02..2026-11-09, right-open. */
const weeklyEvent: TriggerEvent = {
  eventId: 'b5-period-weekly-2026-11-02',
  eventType: 'period_report',
  occurredAt: '2026-11-09T02:00:00.000Z',
  periodKind: 'weekly',
  periodStart: '2026-11-02',
  periodEnd: '2026-11-09',
};

/** Exclusive end of that week. */
const WEEKLY_END = new Date('2026-11-08T16:00:00.000Z');

const AFTER_PERIOD = new Date('2026-11-11T02:00:00.000Z');

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
  actorAccess?: unknown[];
  actorMember?: unknown[];
  admin?: unknown[];
  member?: unknown[];
  binding?: unknown[];
} = {}): Responder {
  return (query) => {
    const text = query.text;
    if (text.includes('from app.enterprises')) return [enterpriseRow];
    if (text.includes('construction_actor_access')) {
      return overrides.actorAccess ?? [{ role: 'manager' }];
    }
    if (text.includes('from app.construction_projects')) return [projectRow];
    if (text.includes('select role from app.construction_members')) {
      return overrides.actorMember ?? [{ role: 'manager' }];
    }
    if (text.includes('select id,role,status,must_change_password')) {
      return overrides.admin ?? [workerAdminRow];
    }
    if (text.includes('select role,active from app.construction_members')) {
      return overrides.member ?? [workerMemberRow];
    }
    if (text.includes('construction_followup_staff_access')) return [{ role: 'worker' }];
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

const FORBIDDEN_TABLES = [
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

function rejectedStaffWrite(
  calls: readonly RecordedQuery[],
  transactions: { count: number },
): void {
  for (const table of WRITE_TABLES) {
    assert.equal(writesTo(calls, table).length, 0, `${table} must not be written`);
  }
  for (const table of FORBIDDEN_TABLES) {
    assert.equal(queriesOn(calls, table).length, 0, `${table} must not be touched`);
  }
  // The rejection happened inside the leased transaction, never by enqueue.
  assert.equal(transactions.count, 1);
}

function isAssistantForbidden(error: unknown): boolean {
  return error instanceof AssistantError && error.code === 'construction_forbidden';
}

function workerInput() {
  return {
    enterpriseId: ENTERPRISE_ID,
    actor,
    projectId: PROJECT_ID,
    receiverKind: 'worker' as const,
    adminId: WORKER_ADMIN,
    event,
  };
}

function designerInput(eventValue: TriggerEvent = event) {
  return {
    enterpriseId: ENTERPRISE_ID,
    actor,
    projectId: PROJECT_ID,
    receiverKind: 'designer' as const,
    adminId: DESIGNER_ADMIN,
    event: eventValue,
  };
}

test('an observer executor is rejected before any worker binding write', async () => {
  const database = fakeDatabase(responder({
    actorAccess: [{ role: 'observer' }],
    actorMember: [{ role: 'observer' }],
  }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareStaffPeriodReport(workerInput(), { transaction, now: () => AFTER_PERIOD }),
    isAssistantForbidden,
  );

  // The project row was locked before the management rule was applied.
  assert.ok(queriesOn(database.calls, 'construction_projects').length >= 1);
  assert.match(
    queriesOn(database.calls, 'construction_projects')[0]!.text,
    /for update/,
  );
  rejectedStaffWrite(database.calls, transactions);
});

test('an unavailable executor is rejected with no worker binding write', async () => {
  const database = fakeDatabase(responder({ actorAccess: [] }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareStaffPeriodReport(workerInput(), { transaction, now: () => AFTER_PERIOD }),
    isAssistantForbidden,
  );

  rejectedStaffWrite(database.calls, transactions);
  // The enterprise was active, so the failure is the actor's access row.
  assert.ok(queriesOn(database.calls, 'enterprises').length >= 1);
  assert.ok(queriesOn(database.calls, 'construction_actor_access').length >= 1);
  assert.equal(queriesOn(database.calls, 'assistant_conversations').length, 0);
});

test('a period that has not ended fails before the transaction opens', async () => {
  const database = fakeDatabase(responder());
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareStaffPeriodReport(
      { ...workerInput(), event: weeklyEvent },
      { transaction, now: () => new Date(WEEKLY_END.getTime() - 1) },
    ),
    (error: unknown) => error instanceof WorkflowOperationError && error.code === 'period_not_ended',
  );

  assert.equal(transactions.count, 0);
  assert.equal(database.calls.length, 0);
});

test('a successful prepare creates the enterprise worker binding after the project lock', async () => {
  const database = fakeDatabase(responder());
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  const result = await prepareStaffPeriodReport(workerInput(), {
    transaction,
    now: () => AFTER_PERIOD,
  });

  assert.equal(result.period.kind, 'daily');
  assert.equal(result.period.start.toISOString(), '2026-11-09T16:00:00.000Z');
  assert.equal(result.period.end.toISOString(), '2026-11-10T16:00:00.000Z');
  assert.deepEqual(result.staff, {
    receiverKind: 'worker',
    adminId: WORKER_ADMIN,
    adminRole: 'construction_staff',
    memberRole: 'worker',
    accessRole: 'worker',
    bindingId: '9002',
    conversationId: '7002',
    principalKey: `admin:${WORKER_ADMIN}`,
    scopeKey: 'enterprise',
    projectId: null,
    status: 'enabled',
  });

  assert.equal(transactions.count, 1);
  for (const table of FORBIDDEN_TABLES) {
    assert.equal(queriesOn(database.calls, table).length, 0, `${table} must not be touched`);
  }

  // The real ensureFollowupBinding created conversation + binding + participant.
  const conversationInserts = writesTo(database.calls, 'assistant_conversations');
  const bindingInserts = writesTo(database.calls, 'construction_followup_bindings');
  const participantInserts = writesTo(database.calls, 'assistant_participants');
  assert.equal(conversationInserts.length, 1);
  assert.equal(bindingInserts.length, 1);
  assert.equal(participantInserts.length, 1);

  // Lock order: project row first, then the staff checks, then the binding write.
  const projectLock = database.calls.findIndex((call) =>
    /from app\.construction_projects/.test(call.text) && /for update/.test(call.text));
  const workerAdminCheck = database.calls.findIndex((call) =>
    /select id,role,status,must_change_password/.test(call.text));
  const workerMemberCheck = database.calls.findIndex((call) =>
    /select role,active from app\.construction_members/.test(call.text));
  const bindingInsert = database.calls.findIndex((call) =>
    /insert into app\.construction_followup_bindings/.test(call.text));

  assert.ok(projectLock >= 0);
  assert.ok(projectLock < workerAdminCheck);
  assert.ok(workerAdminCheck < workerMemberCheck);
  assert.ok(workerMemberCheck < bindingInsert);
  assert.ok(database.calls.indexOf(conversationInserts[0]!) > projectLock);
  assert.ok(database.calls.indexOf(participantInserts[0]!) > bindingInsert);
});

test('a successful prepare creates the enterprise designer binding after the project lock', async () => {
  const database = fakeDatabase(responder({
    admin: [designerAdminRow],
    member: [designerMemberRow],
    binding: [designerBindingRow],
  }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  const result = await prepareStaffPeriodReport(designerInput(), {
    transaction,
    now: () => AFTER_PERIOD,
  });

  assert.deepEqual(result.staff, {
    receiverKind: 'designer',
    adminId: DESIGNER_ADMIN,
    adminRole: 'designer',
    memberRole: 'designer',
    accessRole: 'worker',
    bindingId: '9003',
    conversationId: '7003',
    principalKey: `admin:${DESIGNER_ADMIN}`,
    scopeKey: 'enterprise',
    projectId: null,
    status: 'enabled',
  });

  const bindingInsert = database.calls.findIndex((call) =>
    /insert into app\.construction_followup_bindings/.test(call.text));
  assert.ok(bindingInsert >= 0);
  // The binding is enterprise-scoped and carries the designer audience.
  assert.match(database.calls[bindingInsert]!.params.join(' '), /admin:1454000011.*designer/u);
  for (const table of FORBIDDEN_TABLES) {
    assert.equal(queriesOn(database.calls, table).length, 0, `${table} must not be touched`);
  }
});

test('a designer receiver needs an active designer admin, never a worker account', async () => {
  const database = fakeDatabase(responder({ admin: [workerAdminRow] }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareStaffPeriodReport(designerInput(), { transaction, now: () => AFTER_PERIOD }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'designer_receiver_unavailable',
  );

  rejectedStaffWrite(database.calls, transactions);
  assert.equal(queriesOn(database.calls, 'assistant_conversations').length, 0);
});

test('a designer without a project member row is rejected before the binding write', async () => {
  const database = fakeDatabase(responder({
    admin: [designerAdminRow],
    member: [],
  }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareStaffPeriodReport(designerInput(), { transaction, now: () => AFTER_PERIOD }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'designer_receiver_unavailable',
  );

  rejectedStaffWrite(database.calls, transactions);
});
