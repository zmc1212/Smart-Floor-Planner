import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService, content } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { chunkDocument } from '@/lib/assistant/knowledge/chunk-gateway';
import { retrieveKnowledge, type RetrievalDiagnostic } from '@/lib/assistant/knowledge/retrieval';
import { resolveEvidence } from '@/lib/assistant/knowledge/sources';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { knowledgeSynthesisSources, unresolvedSynthesisConflict } from '@/lib/assistant/agent/synthesis';
import type { ActorContext, EmbeddingGateway, Evidence } from '@/lib/assistant/contracts';
import { professionalEntry } from '../../../scripts/assistant-professional-cases';
import { coverageCases } from '../../../scripts/assistant-knowledge-coverage-cases';

type Document = { documentId: string; versionId: string; expectedVersion: number; expectedEditVersion: number; chunks: Row[] };
type Fixture = { enterpriseId: string; adminId: string; userId: string; actor: ActorContext; conversationId: string;
  knowledge: KnowledgeService; documents: Document[] };
type Call = { purpose: 'query' | 'document'; status: 'started' | 'succeeded' | 'unknown'; inputTokens: number | null };
const prefix = 'synthetic-kb-coverage-' + randomUUID(), tenants: string[] = [], admins: string[] = [], users: string[] = [];
const fixtures: Fixture[] = [], calls: Call[] = [], forbidden: string[] = [], traces: RetrievalDiagnostic[] = [];
const evidence = new Map<string, Evidence[]>();
let gateway: EmbeddingGateway;
const op = (f: Fixture, action: string, input: Row) => f.knowledge.execute(action, input, randomUUID());
const epoch = async (f: Fixture) => Number((await withTenantTransaction(f.enterpriseId, tx => one(tx,
  sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${f.enterpriseId}`)))!.knowledge_epoch);

async function document(f: Fixture, title: string, body: string, claim: { key: string; value: string } | null = null, audience = 'customer_public', publish = true) {
  const created = await op(f, 'create', { title, sourceType: 'manual_text', audience, body, professional: professionalEntry({
    kind: 'explanation', topics: ['合成书房办公'], prerequisites: ['现场尺寸、完整点位资料和团队核对均待确认'],
    conditions: claim ? [{ field: 'material', operator: 'in', values: ['合成板材'] }] : [], claim,
  }) });
  const v = created.draft as Row, d: Document = { documentId: String((created.document as Row).id), versionId: String(v.id),
    expectedVersion: 1, expectedEditVersion: 1, chunks: [] };
  const queued = await op(f, 'index', d), lease = await claimKnowledgeJob();
  assert.ok(lease); assert.equal(lease.jobId, queued.jobId, 'Only this serialized fixture job may be claimed');
  await runKnowledgeJob(lease, { embedding: gateway, chunk: chunkDocument });
  assert.equal((await op(f, 'job', { jobId: lease.jobId })).status, 'succeeded');
  d.chunks = await withTenantTransaction(f.enterpriseId, tx => rows(tx,
    sql`select id::text,document_version_id::text,text,text_hash,locator from app.assistant_knowledge_chunks
      where enterprise_id=${f.enterpriseId} and document_version_id=${d.versionId} order by ordinal`));
  const original = Array.from(content('manual_text', v).rendered);
  for (const c of d.chunks) {
    const locator = c.locator as { start: number; end: number };
    assert.equal(original.slice(locator.start, locator.end).join(''), c.text, 'Real chunk offsets still address the exact source');
  }
  if (publish) await op(f, 'publish', d);
  return d;
}

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname)); assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  const real = embeddingGateway();
  gateway = { profile: real.profile, embed: async (texts, purpose) => {
    const call: Call = { purpose, status: 'started', inputTokens: null }; calls.push(call);
    try { const result = await real.embed(texts, purpose); call.status = 'succeeded'; call.inputTokens = result.usage?.inputTokens ?? null; return result; }
    catch (error) { call.status = 'unknown'; throw error; }
  } };
  for (const [i, spec] of coverageCases.entries()) {
    const f = await withPlatformTransaction(async tx => {
      const enterpriseId = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix + i},${prefix + i},'active') returning id`))!.id); tenants.push(enterpriseId);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${enterpriseId},true,1000,12000000,1000000000,30)`);
      const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${enterpriseId},${prefix + i},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id); admins.push(adminId);
      const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!.id); users.push(userId);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix + i})`);
      return { enterpriseId, adminId, userId };
    });
    const leadId = String((await withTenantTransaction(f.enterpriseId, tx => one(tx, sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source)
      values(${f.enterpriseId},${f.userId},'合成知识覆盖业主','13800000000','natural') returning id`)))!.id);
    const actor: ActorContext = { enterpriseId: f.enterpriseId, principal: { kind: 'user', userId: f.userId }, contextVersion: 1,
      capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: leadId } };
    const fixture: Fixture = { ...f, actor, conversationId: String((await new ConversationService(actor).create(randomUUID())).id),
      knowledge: new KnowledgeService({ enterpriseId: f.enterpriseId, adminId: f.adminId }), documents: [] };
    fixtures.push(fixture);
    for (const entry of spec.documents) fixture.documents.push(await document(fixture, entry.title, entry.body, 'claim' in entry ? entry.claim : null));
    assert.ok(fixture.documents.slice(0, 2).every(d => d.chunks.length >= 2), 'Both crowding documents must really have multiple chunks');
    assert.ok(fixture.documents.reduce((n, d) => n + d.chunks.length, 0) < 30, 'All pressure chunks fit the existing candidate branch budget');
  }
  for (const [audience, published] of [['staff_internal', true], ['customer_public', false]] as const) {
    const d = await document(fixtures[0], '合成不可公开资料', coverageCases[0].question, null, audience, published); forbidden.push(d.documentId);
  }
  console.log('KB_COVERAGE_MANIFEST ' + JSON.stringify({ prefix, fixedCases: coverageCases.map((c, i) => ({ key: c.key, question: c.question,
    enterpriseId: fixtures[i].enterpriseId, required: fixtures[i].documents.map(d => ({ documentId: d.documentId, versionId: d.versionId,
      chunks: d.chunks.length })), forbiddenDocumentIds: [...forbidden, ...fixtures[1 - i].documents.map(d => d.documentId)] })),
    rounds: 2, scope: 'Synthetic source coverage and existing explicit-claim guard, not professional semantic correctness or C01 acceptance' }));
});

// Historical v3 replay is diagnostic evidence only; the fixed required source list is the assertion oracle.
function previousSelection(d: RetrievalDiagnostic) {
  const selected: string[] = [], counts = new Map<string, number>();
  const eligible = d.candidates.filter(c => c.similarity >= 0.3);
  for (const group of [eligible.filter(c => c.applicability?.status !== 'not_applicable'), eligible.filter(c => c.applicability?.status === 'not_applicable')]) {
    for (const cap of [2, Infinity]) for (const c of group) {
      if (selected.length === 5) return selected;
      if (selected.includes(c.ref.id) || (counts.get(c.documentId) || 0) >= cap) continue;
      selected.push(c.ref.id); counts.set(c.documentId, (counts.get(c.documentId) || 0) + 1);
    }
  }
  return selected;
}

for (const [i, spec] of coverageCases.entries()) for (const round of [1, 2]) {
  test(`K03/04 ${spec.key} round ${round}: all four fixed sources survive the five-chunk budget`, async () => {
    const f = fixtures[i], result = await retrieveKnowledge(f.conversationId, f.actor, spec.question, await epoch(f), gateway);
    traces.push(result.diagnostic); evidence.set(spec.key, result.evidence);
    const selectedDocuments = new Set(result.diagnostic.candidates.filter(c => c.disposition === 'selected').map(c => c.documentId));
    for (const d of f.documents) assert.ok(selectedDocuments.has(d.documentId), `Required source ${d.documentId} was crowded out`);
    assert.equal(result.evidence.length, 5); assert.equal(result.diagnostic.configuration.version, 'professional-hybrid-v4');
    assert.equal(result.diagnostic.configuration.maxPerDocumentFirstPass, 1);
    const denied = new Set([...forbidden, ...fixtures[1 - i].documents.map(d => d.documentId)]);
    assert.ok(result.diagnostic.candidates.every(c => !denied.has(c.documentId)), 'Internal, unpublished and other-tenant candidates stay outside ranking');
    const original = new Map(f.documents.flatMap(d => d.chunks.map(c => [String(c.id), c] as const)));
    for (const e of result.evidence) {
      const c = original.get(e.ref.id); assert.ok(c); assert.equal(e.text, c.text); assert.equal(e.hash, c.text_hash); assert.equal(e.ref.version, c.document_version_id);
    }
    if (i === 1) {
      assert.ok(result.evidence.filter(e => e.professional?.entry.claim).every(e => e.professional?.applicability.status === 'unknown'));
      assert.equal(unresolvedSynthesisConflict(knowledgeSynthesisSources(result.evidence)), true, 'Both registered claims reach the unchanged uncertainty guard');
    }
    const oldChunks = previousSelection(result.diagnostic), oldDocuments = new Set(result.diagnostic.candidates.filter(c => oldChunks.includes(c.ref.id)).map(c => c.documentId));
    console.log('KB_COVERAGE_ROUND ' + JSON.stringify({ key: spec.key, round, enterpriseId: f.enterpriseId, configuration: result.diagnostic.configuration,
      required: f.documents.map(d => d.documentId), selected: [...selectedDocuments], previousPolicyMissing: f.documents.filter(d => !oldDocuments.has(d.documentId)).map(d => d.documentId),
      elapsedMs: result.diagnostic.elapsedMs, inputTokens: result.diagnostic.embeddingUsage?.inputTokens ?? null, costMicros: null,
      candidates: result.diagnostic.candidates, originalSelectedLocators: result.evidence.map(e => ({ ref: e.ref, locator: original.get(e.ref.id)!.locator })) }));
  });
}

test('K07 another tenant conversation is refused before Embedding dispatch', async () => {
  const before = calls.length;
  await assert.rejects(retrieveKnowledge(fixtures[0].conversationId, fixtures[1].actor, coverageCases[0].question, await epoch(fixtures[1]), gateway), /assistant_resource_not_found|assistant_capability_forbidden/);
  assert.equal(calls.length, before);
  await withTenantTransaction(fixtures[1].enterpriseId, async tx => assert.equal((await rows(tx,
    sql`select id from app.assistant_knowledge_chunks where document_version_id=${fixtures[0].documents[0].versionId}`)).length, 0));
});

test('K08 retirement during real query Embedding invalidates the snapshot and all old source resolution', async () => {
  const f = fixtures[0], d = f.documents[3], oldEpoch = await epoch(f);
  const old = evidence.get(coverageCases[0].key)!.find(e => e.ref.version === d.versionId)!; assert.ok(old);
  await assert.rejects(retrieveKnowledge(f.conversationId, f.actor, coverageCases[0].question, oldEpoch, { profile: gateway.profile,
    embed: async (...args) => { const result = await gateway.embed(...args); await op(f, 'retire', { documentId: d.documentId, expectedVersion: 2 }); return result; },
  }), /context_changed/);
  await withTenantTransaction(f.enterpriseId, async tx => {
    const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${f.enterpriseId} and id=${f.conversationId}`); assert.ok(c);
    assert.equal(await resolveEvidence(tx, f.actor, c, old), undefined);
  });
  const current = await retrieveKnowledge(f.conversationId, f.actor, coverageCases[0].question, await epoch(f), gateway);
  assert.ok(current.evidence.every(e => e.ref.version !== d.versionId)); assert.ok(current.diagnostic.candidates.every(c => c.documentId !== d.documentId));
});

after(async () => {
  try {
    try {
      const items = await withPlatformTransaction(async tx => {
        const result = [];
        for (const enterpriseId of tenants) result.push({ enterpriseId,
          indexAttempts: await rows(tx, sql`select operation,status,count(*)::int calls,sum(input_tokens)::text known_input_tokens,
            count(*) filter(where input_tokens is null)::int unknown_input_calls from app.assistant_knowledge_attempts
            where enterprise_id=${enterpriseId} group by operation,status order by operation,status`),
          usageRecords: await rows(tx, sql`select category,measurement_kind,count(*)::int calls from app.assistant_usage_records
            where enterprise_id=${enterpriseId} group by category,measurement_kind order by category,measurement_kind`),
        });
        return result;
      });
      console.log('KB_COVERAGE_AUDIT ' + JSON.stringify({ fixturePrefix: prefix, tenantIds: tenants, adminIds: admins, userIds: users, items,
        embeddingCalls: calls, costMicros: null, directQueryAccounting: 'Audited test gateway calls; no chat run or synthetic usage records created', traces: traces.length }));
    } finally {
      await withPlatformTransaction(async tx => {
        for (const enterpriseId of tenants) { await deleteAssistantData(tx, BigInt(enterpriseId)); await tx.execute(sql`delete from app.leads where enterprise_id=${enterpriseId}`);
          await tx.execute(sql`delete from app.admin_users where enterprise_id=${enterpriseId}`); await tx.execute(sql`delete from app.enterprises where id=${enterpriseId}`); }
        for (const user of users) await tx.execute(sql`delete from app.users where id=${user}`);
      });
    }
    const audit = await withPlatformTransaction(async tx => {
      const tables = await rows(tx, sql`select table_name from information_schema.columns where table_schema='app' and column_name='enterprise_id' order by table_name`);
      const remaining: Row[] = [];
      for (const t of tenants.length ? tables : []) {
        const r = await one(tx, sql`select count(*)::int n from app.${sql.identifier(String(t.table_name))} where enterprise_id in (${sql.join(tenants.map(id => sql`${id}::bigint`), sql`,`)})`);
        if (Number(r!.n)) remaining.push({ table: t.table_name, rows: r!.n });
      }
      const identities = [];
      for (const [table, ids] of [['enterprises', tenants], ['admin_users', admins], ['users', users]] as const) if (ids.length) identities.push({ table,
        rows: Number((await one(tx, sql`select count(*)::int n from app.${sql.identifier(table)} where id in (${sql.join(ids.map(id => sql`${id}::bigint`), sql`,`)})`))!.n) });
      return { tablesChecked: tables.length, remaining, identities };
    });
    console.log('KB_COVERAGE_CLEANUP ' + JSON.stringify(audit)); assert.deepEqual(audit.remaining, []); assert.ok(audit.identities.every(i => i.rows === 0));
  } finally { await closePostgresPool(); }
});
