import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantError } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '@/lib/construction/contracts';
import { WorkflowOperationError } from '../errors';
import type { TriggerEvent } from '../types';
import { prepareBossPeriodReport } from '../live/boss-receiver';

const ENTERPRISE_ID = '1454';
const ACTOR_ADMIN = '1454000007';
const BOSS_ADMIN = '1454000013';
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
const AFTER_PERIOD = new Date('2026-11-10T02:00:00.000Z');

const enterpriseRow = { id: ENTERPRISE_ID };
const projectRow = { id: PROJECT_ID, name: '测试项目', status: 'active' };
const bossAdminRow = {
  id: BOSS_ADMIN,
  role: 'enterprise_admin',
  status: 'active',
  must_change_password: false,
};
const workerAdminRow = {
  id: WORKER_ADMIN,
  role: 'construction_staff',
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

function responder(overrides: {
  actorAccess?: unknown[];
  actorMember?: unknown[];
  admin?: unknown[];
  access?: unknown[];
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
      return overrides.admin ?? [bossAdminRow];
    }
    if (text.includes('construction_followup_staff_access')) {
      return overrides.access ?? [{ role: 'owner' }];
    }
    if (text.includes('pg_advisory_xact_lock')) return [];
    if (text.includes('select * from app.construction_followup_bindings')) return [];
    if (text.includes('insert into app.assistant_conversations')) return [{ id: '7004' }];
    if (text.includes('insert into app.construction_followup_bindings')) {
      return overrides.binding ?? [bossBindingRow];
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

function rejectedBossWrite(
  calls: readonly RecordedQuery[],
  transactions: { count: number },
): void {
  for (const table of WRITE_TABLES) {
    assert.equal(writesTo(calls, table).length, 0, `${table} must not be written`);
  }
  for (const table of FORBIDDEN_TABLES) {
    assert.equal(queriesOn(calls, table).length, 0, `${table} must not be touched`);
  }
  assert.equal(transactions.count, 1);
}

function bossInput(adminId = BOSS_ADMIN) {
  return {
    enterpriseId: ENTERPRISE_ID,
    actor,
    projectId: PROJECT_ID,
    adminId,
    event: weeklyEvent,
  };
}

test('an observer executor is rejected before any boss binding write', async () => {
  const database = fakeDatabase(responder({
    actorAccess: [{ role: 'observer' }],
    actorMember: [{ role: 'observer' }],
  }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareBossPeriodReport(bossInput(), { transaction, now: () => AFTER_PERIOD }),
    (error: unknown) => error instanceof AssistantError && error.code === 'construction_forbidden',
  );

  assert.ok(queriesOn(database.calls, 'construction_projects').length >= 1);
  assert.match(
    queriesOn(database.calls, 'construction_projects')[0]!.text,
    /for update/,
  );
  rejectedBossWrite(database.calls, transactions);
});

test('a period that has not ended fails before the transaction opens', async () => {
  const database = fakeDatabase(responder());
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareBossPeriodReport(bossInput(), {
      transaction,
      now: () => new Date(WEEKLY_END.getTime() - 1),
    }),
    (error: unknown) => error instanceof WorkflowOperationError && error.code === 'period_not_ended',
  );

  assert.equal(transactions.count, 0);
  assert.equal(database.calls.length, 0);
});

test('a successful prepare creates the enterprise boss binding without a member row', async () => {
  const database = fakeDatabase(responder());
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  const result = await prepareBossPeriodReport(bossInput(), {
    transaction,
    now: () => AFTER_PERIOD,
  });

  assert.equal(result.period.kind, 'weekly');
  assert.equal(result.period.periodStart, '2026-10-26');
  assert.equal(result.period.periodEnd, '2026-11-02');
  assert.deepEqual(result.boss, {
    receiverKind: 'boss',
    adminId: BOSS_ADMIN,
    adminRole: 'enterprise_admin',
    accessRole: 'owner',
    memberRequired: false,
    bindingId: '9004',
    conversationId: '7004',
    principalKey: `admin:${BOSS_ADMIN}`,
    scopeKey: 'enterprise',
    projectId: null,
    status: 'enabled',
  });

  // A boss uses the existing owner/followup rule, never project membership and
  // never the customer link. The executor's own manager lookup is unrelated:
  // only the receiver's `select role,active` member check must be absent.
  assert.equal(
    database.calls.filter((call) => /select role,active from app\.construction_members/.test(call.text)).length,
    0,
  );
  assert.equal(queriesOn(database.calls, 'construction_projects').filter(
    (call) => /customer_access/.test(call.text),
  ).length, 0);
  for (const table of FORBIDDEN_TABLES) {
    assert.equal(queriesOn(database.calls, table).length, 0, `${table} must not be touched`);
  }

  const conversationInserts = writesTo(database.calls, 'assistant_conversations');
  const bindingInserts = writesTo(database.calls, 'construction_followup_bindings');
  const participantInserts = writesTo(database.calls, 'assistant_participants');
  assert.equal(conversationInserts.length, 1);
  assert.equal(bindingInserts.length, 1);
  assert.equal(participantInserts.length, 1);
  assert.match(bindingInserts[0]!.params.join(' '), /admin:1454000013.*boss/u);

  // Lock order: project row first, then the owner checks, then the binding.
  const projectLock = database.calls.findIndex((call) =>
    /from app\.construction_projects/.test(call.text) && /for update/.test(call.text));
  const bossAdminCheck = database.calls.findIndex((call) =>
    /select id,role,status,must_change_password/.test(call.text));
  const ownerCheck = database.calls.findIndex((call) =>
    /construction_followup_staff_access/.test(call.text));
  const bindingInsert = database.calls.findIndex((call) =>
    /insert into app\.construction_followup_bindings/.test(call.text));
  assert.ok(projectLock >= 0);
  assert.ok(projectLock < bossAdminCheck);
  assert.ok(bossAdminCheck < ownerCheck);
  assert.ok(ownerCheck < bindingInsert);
});

test('a non-owner account is rejected before the boss binding write', async () => {
  const database = fakeDatabase(responder({
    admin: [workerAdminRow],
    access: [{ role: 'member' }],
  }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareBossPeriodReport(bossInput(WORKER_ADMIN), { transaction, now: () => AFTER_PERIOD }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'boss_receiver_unavailable',
  );

  rejectedBossWrite(database.calls, transactions);
  assert.equal(queriesOn(database.calls, 'assistant_conversations').length, 0);
});

test('platform admin and super_admin roles are rejected even with owner access', async () => {
  for (const role of ['admin', 'super_admin']) {
    const database = fakeDatabase(responder({
      admin: [{ ...bossAdminRow, role }],
      // The permission function alone would return owner for these accounts.
      access: [{ role: 'owner' }],
    }));
    const transactions = { count: 0 };
    const transaction = fakeTransaction(transactions, database.tx);

    await assert.rejects(
      () => prepareBossPeriodReport(bossInput(), { transaction, now: () => AFTER_PERIOD }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'boss_receiver_unavailable',
    );

    rejectedBossWrite(database.calls, transactions);
    // The role check happens before the owner lookup and before any binding.
    assert.equal(queriesOn(database.calls, 'construction_followup_staff_access').length, 0);
    assert.equal(queriesOn(database.calls, 'assistant_conversations').length, 0);
    assert.equal(queriesOn(database.calls, 'construction_followup_bindings').length, 0);
    assert.equal(queriesOn(database.calls, 'assistant_participants').length, 0);
  }
});

test('a missing boss account is rejected before the binding write', async () => {
  const database = fakeDatabase(responder({ admin: [] }));
  const transactions = { count: 0 };
  const transaction = fakeTransaction(transactions, database.tx);

  await assert.rejects(
    () => prepareBossPeriodReport(bossInput(), { transaction, now: () => AFTER_PERIOD }),
    (error: unknown) => error instanceof WorkflowOperationError
      && error.code === 'boss_receiver_unavailable',
  );

  rejectedBossWrite(database.calls, transactions);
});

test('an inactive or password-blocked boss account is rejected', async () => {
  for (const admin of [
    { ...bossAdminRow, status: 'disabled' },
    { ...bossAdminRow, must_change_password: true },
  ]) {
    const database = fakeDatabase(responder({ admin: [admin] }));
    const transactions = { count: 0 };
    const transaction = fakeTransaction(transactions, database.tx);
    await assert.rejects(
      () => prepareBossPeriodReport(bossInput(), { transaction, now: () => AFTER_PERIOD }),
      (error: unknown) => error instanceof WorkflowOperationError
        && error.code === 'boss_receiver_unavailable',
    );
    rejectedBossWrite(database.calls, transactions);
  }
});
