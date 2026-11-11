import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PostgresTransaction } from '@/db/transaction';
import type { ActorContext } from '@/lib/assistant/contracts';
import { deliverStageReminderToConversation, recordStageReminder } from '../reminders';
import type { ConstructionStage } from '../stages';

const dialect = new PgDialect();
type CompiledQuery = { sql: string; params: unknown[] };

function fakeTx(respond: (query: CompiledQuery) => unknown) {
  const queries: CompiledQuery[] = [];
  const tx = { execute: async (query: unknown) => {
    const compiled = dialect.sqlToQuery(query as never);
    queries.push(compiled);
    const row = respond(compiled);
    return { rows: row === undefined ? [] : [row] };
  } } as unknown as PostgresTransaction;
  return { tx, queries };
}

const actor: ActorContext = { enterpriseId: '9', contextVersion: 1, capabilities: [], principal: { kind: 'user', userId: '5' } };
const project = { id: '42', progress_revision: 7, current_stage_key: 'utilities', customer_access: true, status: 'active', name: '工地', lead_id: '3' };
const conversation = { id: '77', status: 'open', mode: 'ai', purpose: 'customer_consultation' };
const stage: ConstructionStage = { key: 'utilities', name: '水电', visitReminder: true, visitReason: '到现场', watchPoints: '看点' };
const settings = { stages: [stage], version: 3 };
const stageEvent = { id: '55', aggregate_id: '42', aggregate_version: 7, type: 'construction.stage.updated.v1',
  project_stage_key: 'utilities', project_progress_revision: 7, project_status: 'active',
  payload: { stageKey: 'utilities', text: '正文', settingsVersion: 3 } };

function deliveryTx(options: {
  project?: Record<string, unknown>; assistantEnabled?: boolean; existing?: string;
  message?: Record<string, unknown> | null;
}) {
  return fakeTx(query => {
    const text = query.sql.toLowerCase();
    if (text.includes('insert into app.domain_event_deliveries')) return options.existing === undefined ? { id: '900' } : undefined;
    if (text.includes('select id,status from app.domain_event_deliveries'))
      return options.existing === undefined ? undefined : { id: '900', status: options.existing };
    if (text.includes('select * from app.construction_projects')) return options.project ?? project;
    if (text.includes('assistant_enterprise_settings')) return (options.assistantEnabled ?? true) ? { enterprise_id: '9' } : undefined;
    if (text.includes('from app.domain_event_outbox e join app.construction_projects')) return stageEvent;
    if (text.includes('aggregate_version>')) return undefined;
    if (text.includes('from app.assistant_conversations')) return { status: 'open', mode: 'ai', purpose: 'customer_consultation' };
    if (text.includes('from app.assistant_messages')) return options.message === undefined ? { id: '700' } : options.message;
    if (text.includes('insert into app.construction_links') || text.includes('update app.domain_event_deliveries')) return undefined;
    throw new Error('unexpected query: ' + query.sql);
  });
}

const params = (query: CompiledQuery) =>
  query.params.filter((value): value is string => typeof value === 'string' && value.includes('"settingsVersion"'));
const writes = (queries: CompiledQuery[]) =>
  queries.filter(query => /insert into app\.(assistant_messages|construction_links|domain_event_deliveries)/.test(query.sql));

test('stage reminders only add an optional source event key to the outbox payload', async () => {
  const { tx, queries } = fakeTx(() => ({ id: '101' }));
  await recordStageReminder(tx, actor, project, 3, '正文', { sourceEventKey: 'run:abc' });
  await recordStageReminder(tx, actor, project, 3, '正文');
  assert.equal(queries.length, 2);
  assert.deepEqual(JSON.parse(String(params(queries[0])[0])),
    { projectId: '42', stageKey: 'utilities', settingsVersion: 3, text: '正文', sourceEventKey: 'run:abc' });
  assert.deepEqual(JSON.parse(String(params(queries[1])[0])),
    { projectId: '42', stageKey: 'utilities', settingsVersion: 3, text: '正文' });
  for (const query of queries) {
    assert.match(query.sql, /'construction\.stage\.updated\.v1'/);
    assert.match(query.sql, /'construction_project'/);
  }
});

test('delivery re-checks project access, assistant settings and the saved settings version before writing', async () => {
  const revoked = deliveryTx({ project: { ...project, customer_access: false } });
  assert.deepEqual(await deliverStageReminderToConversation(revoked.tx, actor, project, stageEvent, conversation, settings),
    { delivered: false, deliveryId: null, messageId: null, reason: 'customer_access_revoked' });
  assert.equal(writes(revoked.queries).length, 0);

  const paused = deliveryTx({ project: { ...project, status: 'paused' } });
  assert.equal((await deliverStageReminderToConversation(paused.tx, actor, project, stageEvent, conversation, settings)).reason, 'project_inactive');
  assert.equal(writes(paused.queries).length, 0);

  const disabled = deliveryTx({ assistantEnabled: false });
  assert.equal((await deliverStageReminderToConversation(disabled.tx, actor, project, stageEvent, conversation, settings)).reason, 'assistant_disabled');
  assert.equal(writes(disabled.queries).length, 0);

  const stale = deliveryTx({});
  assert.equal((await deliverStageReminderToConversation(stale.tx, actor, project, stageEvent, conversation, { ...settings, version: 4 })).reason,
    'settings_version_mismatch');
  assert.equal(writes(stale.queries).length, 0);

  const missing = deliveryTx({});
  const withoutVersion = { ...stageEvent, payload: { stageKey: 'utilities', text: '正文' } };
  assert.equal((await deliverStageReminderToConversation(missing.tx, actor, project, withoutVersion, conversation, settings)).reason,
    'settings_version_mismatch');
  assert.equal(writes(missing.queries).length, 0);
});

test('an already delivered notice keeps follow-up and link behaviour without a second stage message', async () => {
  const delivered = deliveryTx({ existing: 'delivered' });
  assert.deepEqual(await deliverStageReminderToConversation(delivered.tx, actor, project, stageEvent, conversation, settings),
    { delivered: true, deliveryId: '900', messageId: '700' });
  assert.ok(!delivered.queries.some(query => query.sql.includes('insert into app.assistant_messages')));
  assert.ok(delivered.queries.some(query => query.sql.includes('insert into app.construction_links')));
  const lookup = delivered.queries.find(query => query.sql.includes('from app.assistant_messages'));
  assert.ok(lookup);
  assert.ok(!lookup.sql.includes('conversation_id'));

  for (const [status, reason] of [['processing', 'delivery_in_progress'], ['pending', 'delivery_already_claimed']] as const) {
    const claimed = deliveryTx({ existing: status });
    assert.deepEqual(await deliverStageReminderToConversation(claimed.tx, actor, project, stageEvent, conversation, settings),
      { delivered: false, deliveryId: '900', messageId: null, reason });
    assert.ok(!claimed.queries.some(query => query.sql.includes('insert into app.construction_links')));
    assert.ok(!claimed.queries.some(query => query.sql.includes('from app.assistant_messages')));
  }
});

test('a newly claimed notice writes the link before marking the delivery complete', async () => {
  const claimed = deliveryTx({});
  const result = await deliverStageReminderToConversation(claimed.tx, actor, project, stageEvent, conversation,
    { stages: [{ ...stage, visitReminder: false }], version: 3 });
  assert.deepEqual(result, { delivered: true, deliveryId: '900', messageId: null });
  const link = claimed.queries.findIndex(query => query.sql.includes('insert into app.construction_links'));
  const complete = claimed.queries.findIndex(query => query.sql.includes("set status='delivered'"));
  assert.ok(link >= 0 && complete > link);
});
