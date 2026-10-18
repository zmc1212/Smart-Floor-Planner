import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import {
  RETENTION_CITATION_MARKER,
  RETENTION_MARKER,
} from '@/lib/assistant/retention/contract';
import { runAssistantRetention } from '@/lib/assistant/retention/service';

/**
 * This suite intentionally refuses the shared evaluation database. The parent
 * acceptance runner supplies a separate clone through this variable.
 */
const prefix = `retention-test-${process.pid}-${randomUUID()}`;
const fixedNow = new Date('2026-10-15T00:00:00.000Z');
const oldUpdatedAt = new Date('2026-08-01T00:00:00.000Z');
const tenants: string[] = [];
const admins: string[] = [];
const users: string[] = [];
let actor: ActorContext;
let retentionAdminId = '';
let sharedEventId = '';
let knowledgeVersionId = '';
let knowledgeDocumentId = '';
let connectedToIsolatedDb = false;

const textContent = (text: string) => ({
  version: 1 as const,
  blocks: [{ type: 'text' as const, text }],
});

before(async () => {
  loadEnvConfig(process.cwd());
  const isolatedUrl = process.env.ASSISTANT_RETENTION_DATABASE_URL?.trim();
  assert.ok(isolatedUrl, 'ASSISTANT_RETENTION_DATABASE_URL is required for this suite');
  const parsed = new URL(isolatedUrl);
  assert.ok(['localhost', '127.0.0.1'].includes(parsed.hostname), 'retention DB must be local');
  assert.equal(parsed.port, '55432', 'retention DB must use the isolated PostgreSQL port');
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (process.env.ASSISTANT_OPERATIONS_ACCEPTANCE === '1') {
    assert.ok(
      databaseName === 'xiaok_embedding_eval' || /^xiaok_retention_eval(?:$|[_-])/.test(databaseName),
      'acceptance DB must be the verified evaluation database or a retention clone'
    );
  } else {
    assert.match(databaseName, /^xiaok_retention_eval(?:$|[_-])/, 'retention suite must use a named retention clone');
  }
  process.env.DATABASE_URL = isolatedUrl;

  await withPlatformTransaction(async (tx) => {
    const enterprise = (await one(tx, sql`insert into app.enterprises(name,code,status)
      values(${prefix},${prefix},'active') returning id`))!;
    const enterpriseId = String(enterprise.id);
    tenants.push(enterpriseId);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(
      enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
      values(${enterpriseId},true,1000,12000000,1000000000,30)`);
    const admin = (await one(tx, sql`insert into app.admin_users(
      enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${prefix + '-retention-admin'},'test-only','enterprise_admin','active',
        ARRAY['assistant-retention'],false) returning id`))!;
    retentionAdminId = String(admin.id);
    admins.push(retentionAdminId);
    const denied = (await one(tx, sql`insert into app.admin_users(
      enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${enterpriseId},${prefix + '-denied-admin'},'test-only','enterprise_admin','active',
        ARRAY['assistant-knowledge'],false) returning id`))!;
    admins.push(String(denied.id));
    const user = (await one(tx, sql`insert into app.users(nickname,context_version)
      values(${prefix},1) returning id`))!;
    users.push(String(user.id));
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid)
      values(${String(user.id)},${prefix + '-openid'})`);
    actor = {
      enterpriseId,
      principal: { kind: 'user', userId: String(user.id) },
      contextVersion: 1,
      capabilities: ['assistant.chat.self'],
    };
  });
  connectedToIsolatedDb = true;
});

after(async () => {
  if (connectedToIsolatedDb && tenants.length) {
    await withPlatformTransaction(async (tx) => {
      for (const enterpriseId of tenants) {
        await deleteAssistantData(tx, BigInt(enterpriseId));
        await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterpriseId}`);
        await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`);
      }
      for (const userId of users) await tx.execute(sql`delete from app.users where id=${userId}`);
    });
  }
  await closePostgresPool();
});

async function makeArchived(label: string, body: string, includeRetry = false) {
  const service = new ConversationService(actor);
  const createKey = `${label}-create`;
  const sendKey = `${label}-send`;
  const cancelKey = `${label}-cancel`;
  const conversation = await service.create(createKey);
  const conversationId = String(conversation.id);
  const sent = await service.send(conversationId, sendKey, textContent(body));
  const runId = String((sent as Row).runId);
  await service.run(runId, 'cancel', cancelKey);
  let retryRunId: string | undefined;
  let retryKey: string | undefined;
  if (includeRetry) {
    retryKey = `${label}-retry`;
    const retry = (await service.run(runId, 'retry', retryKey)) as Row;
    retryRunId = String(retry.runId);
    await service.run(retryRunId, 'cancel', `${label}-retry-cancel`);
  }
  const detail = await service.detail(conversationId);
  await service.archive(conversationId, Number(detail.version), `${label}-archive`);
  await withTenantTransaction(actor.enterpriseId, (tx) => tx.execute(sql`update app.assistant_conversations
    set updated_at=${oldUpdatedAt} where enterprise_id=${actor.enterpriseId} and id=${conversationId}`));
  return { conversationId, runId, messageId: String((sent as Row).messageId), createKey, sendKey, retryRunId, retryKey };
}

test('retention uses tenant admin auth, dry-run, bounded redaction, replay-safe tombstones, and protected data', async () => {
  const deniedAdminId = admins[1];
  await assert.rejects(
    runAssistantRetention({ enterpriseId: actor.enterpriseId, adminId: deniedAdminId, mode: 'dry-run', now: fixedNow }),
    /assistant_capability_forbidden/
  );

  const first = await makeArchived('first', 'PRIVATE_MESSAGE_FIRST', true);
  const second = await makeArchived('second', 'PRIVATE_MESSAGE_SECOND');
  const active = await makeArchived('active', 'PRIVATE_MESSAGE_ACTIVE');
  const unknownCost = await makeArchived('unknown-cost', 'PRIVATE_MESSAGE_UNKNOWN_COST');
  await withTenantTransaction(actor.enterpriseId, (tx) => tx.execute(sql`insert into app.assistant_run_steps(
    enterprise_id,run_id,step_seq,kind,capability_name,capability_version,input_summary,source_refs,status,private_checkpoint)
    values(${actor.enterpriseId},${first.runId},1,'retrieval','assistant.knowledge',1,
      '{"private":"PRIVATE_STEP_SUMMARY"}'::jsonb,'[{"private":"PRIVATE_STEP_REF"}]'::jsonb,'succeeded','{"text":"PRIVATE_AGENT_CHECKPOINT"}'::jsonb)`));

  const service = new ConversationService(actor);
  const retryRunId = first.retryRunId!;

  // A knowledge source is deliberately private and old, but retention must not
  // remove or mutate it. Citation projection uses the locator tombstone instead.
  const knowledge = await withTenantTransaction(actor.enterpriseId, async (tx) => {
    const document = (await one(tx, sql`insert into app.assistant_knowledge_documents(
      enterprise_id,title,category,source_type,audience,status,version,created_by,updated_by)
      values(${actor.enterpriseId},'KNOWLEDGE_TITLE_SECRET','test','manual_text','customer_public','draft',1,
        ${admins[1]},${admins[1]}) returning id`))!;
    const version = (await one(tx, sql`insert into app.assistant_knowledge_versions(
      enterprise_id,document_id,version_number,body,faq,content_hash,edit_version,index_status,chunk_count,
      effective_from,created_by)
      values(${actor.enterpriseId},${String(document.id)},1,'KNOWLEDGE_BODY_SECRET','[]','knowledge-hash',1,'pending',0,
        ${fixedNow},${admins[1]}) returning id`))!;
    return { documentId: String(document.id), versionId: String(version.id) };
  });
  knowledgeDocumentId = knowledge.documentId;
  knowledgeVersionId = knowledge.versionId;
  await withTenantTransaction(actor.enterpriseId, (tx) => tx.execute(sql`insert into app.assistant_message_citations(
    enterprise_id,conversation_id,message_id,run_id,source_kind,resource_type,resource_id,resource_version,
    document_id,document_version_id,chunk_id,source_hash,quote_snapshot,locator,is_draft)
    values(${actor.enterpriseId},${first.conversationId},${first.messageId},${first.runId},'knowledge','knowledge_chunk',
      'missing-chunk',${knowledgeVersionId},${knowledgeDocumentId},${knowledgeVersionId},null,'knowledge-hash',
      'PRIVATE_CITATION_QUOTE','{"page":1}'::jsonb,false)`));

  // The same source event is referenced by two messages. It belongs to a
  // separate domain aggregate and must remain untouched by either redaction.
  sharedEventId = String((await withTenantTransaction(actor.enterpriseId, (tx) => one(tx, sql`insert into app.domain_event_outbox(
    enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${actor.enterpriseId},'test.shared.source.v1','shared_source','shared-resource',1,'{"kind":"system"}',
      ${randomUUID()},'{"private":"SHARED_EVENT_SECRET"}'::jsonb) returning id`)))!.id);
  await withTenantTransaction(actor.enterpriseId, async (tx) => {
    await tx.execute(sql`update app.assistant_messages set source_event_id=${sharedEventId}
      where enterprise_id=${actor.enterpriseId} and id in (${first.messageId},${second.messageId})`);
    await tx.execute(sql`update app.assistant_idempotency_records
      set result=result || '{"private":"PRIVATE_IDEMPOTENCY_RESPONSE"}'::jsonb
      where enterprise_id=${actor.enterpriseId} and key in (${first.createKey},${first.retryKey!})`);
  });

  // Make one candidate active and one financially unknown after their normal
  // archive flow. Both must stay readable and retain all durable IDs.
  await withTenantTransaction(actor.enterpriseId, async (tx) => {
    await tx.execute(sql`update app.assistant_conversations set status='archived',updated_at=${oldUpdatedAt}
      where enterprise_id=${actor.enterpriseId} and id=${active.conversationId}`);
    await tx.execute(sql`update app.assistant_conversations set updated_at=${oldUpdatedAt}
      where enterprise_id=${actor.enterpriseId} and id=${unknownCost.conversationId}`);
    await tx.execute(sql`update app.assistant_quota_reservations q set status='reconciling'
      where q.enterprise_id=${actor.enterpriseId} and q.run_id in
        (select id from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${unknownCost.conversationId})`);
    // Re-open the active run after archive only for the safety fixture. The
    // retention query must block it by run/job state, not by conversation text.
    await tx.execute(sql`update app.assistant_runs set status='running',updated_at=now()
      where enterprise_id=${actor.enterpriseId} and conversation_id=${active.conversationId}`);
    await tx.execute(sql`update app.assistant_jobs set status='running',lease_expires_at=now()+interval '10 minutes',updated_at=now()
      where enterprise_id=${actor.enterpriseId} and run_id in
        (select id from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${active.conversationId})`);
  });

  const beforeDryRun = (await withTenantTransaction(actor.enterpriseId, (tx) => one(tx, sql`select content
    from app.assistant_messages where enterprise_id=${actor.enterpriseId} and id=${first.messageId}`)))!;
  const dryRun = await runAssistantRetention({
    enterpriseId: actor.enterpriseId,
    adminId: retentionAdminId,
    mode: 'dry-run',
    now: fixedNow,
  });
  assert.equal(dryRun.status, 'ready');
  assert.equal(dryRun.plan?.hasMore, false);
  assert.equal(dryRun.candidates.filter((candidate) => candidate.eligible).length, 2);
  assert.ok(dryRun.candidates.find((candidate) => candidate.conversationId === active.conversationId)?.reasons.includes('active_run'));
  assert.ok(dryRun.candidates.find((candidate) => candidate.conversationId === unknownCost.conversationId)?.reasons.includes('unknown_cost'));
  assert.deepEqual(beforeDryRun.content, (await withTenantTransaction(actor.enterpriseId, (tx) => one(tx, sql`select content
    from app.assistant_messages where enterprise_id=${actor.enterpriseId} and id=${first.messageId}`)))!.content);

  const applied = await runAssistantRetention({
    enterpriseId: actor.enterpriseId,
    adminId: retentionAdminId,
    mode: 'apply',
    now: fixedNow,
  });
  assert.equal(applied.applied.conversations, 2);
  assert.equal(applied.applied.messages, 2);
  assert.equal(applied.applied.citations, 1);
  assert.ok(applied.applied.runs >= 3);
  assert.ok(applied.applied.runSteps >= 0);
  assert.ok(applied.applied.outboxPayloads >= 3);
  assert.ok(applied.applied.idempotencyResults >= 5);
  assert.equal(applied.applied.auditEvents, 2);
  assert.equal(applied.preserved.knowledgeSources, true);
  assert.equal(applied.preserved.idempotencyRecords, true);

  const redacted = await withTenantTransaction(actor.enterpriseId, async (tx) => ({
    conversation: await one(tx, sql`select title,entry_snapshot from app.assistant_conversations
      where enterprise_id=${actor.enterpriseId} and id=${first.conversationId}`),
    message: await one(tx, sql`select content from app.assistant_messages
      where enterprise_id=${actor.enterpriseId} and id=${first.messageId}`),
    citation: await one(tx, sql`select quote_snapshot,locator from app.assistant_message_citations
      where enterprise_id=${actor.enterpriseId} and message_id=${first.messageId}`),
    steps: await rows(tx, sql`select input_summary,source_refs,private_checkpoint from app.assistant_run_steps
      where enterprise_id=${actor.enterpriseId} and run_id=${first.runId}`),
    runs: await rows(tx, sql`select id,policy_snapshot from app.assistant_runs
      where enterprise_id=${actor.enterpriseId} and conversation_id=${first.conversationId}`),
    event: await one(tx, sql`select payload from app.domain_event_outbox
      where enterprise_id=${actor.enterpriseId} and id=${sharedEventId}`),
    idempotency: await rows(tx, sql`select operation,result from app.assistant_idempotency_records
      where enterprise_id=${actor.enterpriseId} and principal_key=${'user:' + (actor.principal.kind === 'user' ? actor.principal.userId : '')}
        and (key like 'first-%' or key=${'first-retry'}) order by id`),
    source: await one(tx, sql`select d.title,v.body from app.assistant_knowledge_documents d
      join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.document_id=d.id
      where d.enterprise_id=${actor.enterpriseId} and d.id=${knowledgeDocumentId} and v.id=${knowledgeVersionId}`),
    durable: await one(tx, sql`select
      (select count(*) from app.assistant_jobs where enterprise_id=${actor.enterpriseId} and run_id in
        (select id from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${first.conversationId})) as jobs,
      (select count(*) from app.assistant_quota_reservations where enterprise_id=${actor.enterpriseId} and run_id in
        (select id from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${first.conversationId})) as reservations`),
  }));
  assert.equal(redacted.conversation!.title, '');
  assert.equal((redacted.conversation!.entry_snapshot as Row).retentionRedacted, true);
  assert.equal((redacted.message!.content as Row).retentionRedacted, true);
  assert.equal((redacted.message!.content as Row).marker, RETENTION_MARKER);
  assert.doesNotMatch(JSON.stringify(redacted.message!.content), /PRIVATE_MESSAGE_FIRST/);
  assert.equal(redacted.citation!.quote_snapshot, '[redacted by retention policy]');
  assert.equal((redacted.citation!.locator as Row).marker, RETENTION_CITATION_MARKER);
  assert.equal((redacted.steps[0]?.input_summary as Row).retentionRedacted, true);
  assert.deepEqual(redacted.steps[0]?.source_refs, []);
  assert.equal(redacted.steps[0]?.private_checkpoint, null);
  assert.ok(redacted.runs.every((run) => (run.policy_snapshot as Row).retentionRedacted === true));
  assert.equal((redacted.event!.payload as Row).private, 'SHARED_EVENT_SECRET');
  assert.ok(redacted.idempotency.length >= 5);
  assert.equal(redacted.idempotency.some((item) => JSON.stringify(item.result).includes('PRIVATE_IDEMPOTENCY_RESPONSE')), false);
  assert.equal(redacted.source!.title, 'KNOWLEDGE_TITLE_SECRET');
  assert.equal(redacted.source!.body, 'KNOWLEDGE_BODY_SECRET');
  assert.ok(Number(redacted.durable!.jobs) >= 2);
  assert.ok(Number(redacted.durable!.reservations) >= 2);

  // Replay returns the original durable IDs after redaction and does not
  // restore the message/citation bodies or create another run.
  const replayCreate = await service.create(first.createKey);
  const replaySend = await service.send(first.conversationId, first.sendKey, textContent('PRIVATE_MESSAGE_FIRST'));
  const replayRetry = await service.run(first.runId, 'retry', first.retryKey!);
  assert.equal(String(replayCreate.id), first.conversationId);
  assert.equal(String((replaySend as Row).runId), first.runId);
  assert.equal(String((replayRetry as Row).runId), retryRunId);
  assert.equal(JSON.stringify(replayCreate).includes('PRIVATE_IDEMPOTENCY_RESPONSE'), false);
  assert.equal(JSON.stringify(replayRetry).includes('PRIVATE_IDEMPOTENCY_RESPONSE'), false);
  const afterReplay = await withTenantTransaction(actor.enterpriseId, (tx) => one(tx, sql`select count(*) as n
    from app.assistant_runs where enterprise_id=${actor.enterpriseId} and conversation_id=${first.conversationId}`));
  assert.equal(Number(afterReplay!.n), redacted.runs.length);
  assert.equal(JSON.stringify((await service.messages(first.conversationId)).items).includes('PRIVATE_MESSAGE_FIRST'), false);

  const secondApply = await runAssistantRetention({
    enterpriseId: actor.enterpriseId,
    adminId: retentionAdminId,
    mode: 'apply',
    now: fixedNow,
  });
  assert.equal(secondApply.applied.conversations, 0);
  assert.equal(secondApply.candidates.some((candidate) => candidate.conversationId === first.conversationId), false);
  assert.equal(secondApply.candidates.some((candidate) => candidate.conversationId === active.conversationId), true);
  assert.equal(secondApply.candidates.some((candidate) => candidate.conversationId === unknownCost.conversationId), true);

  const untouched = await withTenantTransaction(actor.enterpriseId, (tx) => rows(tx, sql`select c.id::text, m.content
    from app.assistant_conversations c join app.assistant_messages m on m.enterprise_id=c.enterprise_id and m.conversation_id=c.id
    where c.enterprise_id=${actor.enterpriseId} and c.id in (${active.conversationId},${unknownCost.conversationId})`));
  assert.equal(untouched.length, 2);
  assert.ok(untouched.every((row) => JSON.stringify(row.content).includes('PRIVATE_MESSAGE_')));
});
