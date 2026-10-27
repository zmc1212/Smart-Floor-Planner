import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { readOriginal } from '@/lib/assistant/knowledge/file-service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { EMBEDDING_PROFILE } from '@/lib/assistant/infrastructure/embedding-gateway';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { assistantHttp } from '@/lib/assistant/application/http';
import { signMiniProgramToken } from '@/lib/miniprogram-jwt';
import type { ActorContext, EmbeddingGateway, TextModelGateway } from '@/lib/assistant/contracts';
import type { SourceFile } from '@/lib/assistant/contracts/source-file';
import { syntheticDocxNotes, syntheticDocxNotesEntries } from '../../../scripts/assistant-docx-notes-fixture';
import { syntheticDocxOutline, syntheticDocxOutlineEntries } from '../../../scripts/assistant-docx-outline-fixture';
import { syntheticZip } from '../../../scripts/assistant-file-fixtures';

const directOutlines = process.env.ASSISTANT_DOCX_OUTLINE_FIXTURE === '1';
const prefix = (directOutlines ? 'synthetic-d2-docx-outline-' : 'synthetic-d2-docx-notes-') + randomUUID();
type DocumentTarget = { documentId: string; versionId: string; expectedVersion: number; expectedEditVersion: number };
type Fixture = { enterprises: string[]; users: string[]; admins: string[]; conversationId?: string; document?: DocumentTarget; runId?: string };
type Report = { scope: string; started: string; checks: Row[]; fixture: Fixture; providerCalls: number; fetchRequests: string[];
  deterministic: { chunk: number; embedding: number; reply: number }; selected?: { sourceId: string; selections: string[] };
  run?: unknown; cleaned?: boolean; finished?: string };
const fixture: Fixture = { enterprises: [], users: [], admins: [] };
const evidence: Report = { scope: `D2 DOCX ${directOutlines ? 'direct outlines and conditions' : 'conditions'} only; real parser/isolated database/auth; deterministic vectors and extractive reply, no native or configured-model acceptance`,
  started: new Date().toISOString(), checks: [], fixture, providerCalls: 0, fetchRequests: [], deterministic: { chunk: 0, embedding: 0, reply: 0 } };
let service: KnowledgeService, customer: ConversationService, actor: ActorContext, conversationId: string;
let document: DocumentTarget, citationId: string, messageId: string;
const originalFetch = globalThis.fetch;
const save = () => {
  if (process.env.ASSISTANT_DOCX_NOTES_EVIDENCE) fs.writeFileSync(path.join(process.env.ASSISTANT_DOCX_NOTES_EVIDENCE, 'docx-notes-service.json'), JSON.stringify(evidence, null, 2));
};
const gateway: EmbeddingGateway = { profile: EMBEDDING_PROFILE, async embed(texts) {
  evidence.deterministic.embedding++;
  return { vectors: texts.map(() => [1, ...Array(1023).fill(0)]), usage: null };
} };
const dependencies = { embedding: gateway, chunk: async (text: string) => {
  evidence.deterministic.chunk++;
  return [{ text, start: 0, end: Array.from(text).length, tokens: 100 }];
} };
const op = (action: string, input: Row) => service.execute(action, input, randomUUID());
const epoch = async () => Number((await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`)))!.knowledge_epoch);
async function run(jobId: unknown) {
  const lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.jobId, jobId);
  await runKnowledgeJob(lease, dependencies); return op('job', { jobId });
}
async function token(userId: string, enterpriseId = actor.enterpriseId) {
  return signMiniProgramToken({ sub: userId, id: userId, mode: 'customer', role: 'user', enterpriseId, contextVersion: 1, source: 'wechat' });
}
async function citation(auth?: string) {
  const response = await assistantHttp(new Request(`http://localhost/api/miniprogram/assistant/citations/${citationId}`, {
    headers: auth ? { Authorization: 'Bearer ' + auth } : {},
  }), ['citations', citationId]);
  return { status: response.status, body: await response.json() as Row };
}

before(async () => {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(['localhost', '127.0.0.1'].includes(target.hostname));
  assert.equal(target.port, '55432'); assert.equal(target.pathname, '/xiaok_embedding_eval');
  globalThis.fetch = async () => { evidence.fetchRequests.push('forbidden'); throw Error('D2 notes acceptance forbids network model/embedding requests'); };
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) {
      const id = String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${'测试专用 D2 注释 ' + i},${prefix + i},'active') returning id`))!.id);
      fixture.enterprises.push(id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${id},true,100,200000,5000000,30,'{}'::jsonb)`);
    }
    for (let i = 0; i < 3; i++) {
      const userId = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix + i},1) returning id`))!.id);
      fixture.users.push(userId); await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${prefix + i})`);
    }
    const adminId = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
      values(${fixture.enterprises[0]},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
    fixture.admins.push(adminId);
  });
  service = new KnowledgeService({ enterpriseId: fixture.enterprises[0], adminId: fixture.admins[0] });
  actor = { enterpriseId: fixture.enterprises[0], principal: { kind: 'user', userId: fixture.users[0] }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  customer = new ConversationService(actor); conversationId = String((await customer.create(randomUUID())).id);
  fixture.conversationId = conversationId; save();
});

after(async () => {
  try {
    await withPlatformTransaction(async tx => {
      for (const enterpriseId of fixture.enterprises) {
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${enterpriseId}`);
        await tx.execute(sql`update app.assistant_jobs set status='cancelled',lease_token=null,lease_expires_at=null where enterprise_id=${enterpriseId} and status in ('queued','running')`);
      }
      for (const userId of fixture.users) await tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`);
      const attempts = await rows(tx, sql`select id from app.ai_provider_attempts where enterprise_id in (${fixture.enterprises[0] ?? '0'},${fixture.enterprises[1] ?? '0'})`);
      assert.equal(attempts.length, 0); assert.equal(evidence.fetchRequests.length, 0);
    });
    evidence.cleaned = true;
  } finally { globalThis.fetch = originalFetch; evidence.finished = new Date().toISOString(); save(); await closePostgresPool(); }
});

test('real upload/parse/review/index/publication persist complete note conditions and immutable original', async () => {
  const bytes = directOutlines ? syntheticDocxOutline() : syntheticDocxNotes(), input = { title: '合成 D2 注释设备资料', fileName: '合成注释设备.docx', fileBase64: bytes.toString('base64'),
    authorization: 'SYNTHETIC TEST ONLY', audience: 'customer_public' }, key = randomUUID();
  const created = await service.execute('createFile', input, key), duplicate = await service.execute('createFile', input, key);
  assert.equal((duplicate.document as Row).id, (created.document as Row).id);
  document = { documentId: String((created.document as Row).id), versionId: String((created.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
  fixture.document = document;
  assert.equal((await run(created.jobId)).status, 'succeeded'); document.expectedEditVersion = 2;
  await assert.rejects(op('index', document), /knowledge_file_review_required/);
  await op('reviewFile', { ...document, acknowledgeWarnings: true, excludedBlockIds: [] }); document.expectedEditVersion = 3;
  assert.equal((await run((await op('index', document)).jobId)).status, 'succeeded');
  await op('publish', document);
  const originals = await readOriginal(service.actor, document.documentId, document.versionId);
  assert.equal(createHash('sha256').update(originals.data as Buffer).digest('hex'), createHash('sha256').update(bytes).digest('hex'));
  const chunks = await withTenantTransaction(actor.enterpriseId, tx => rows(tx, sql`select text,locator from app.assistant_knowledge_chunks where enterprise_id=${actor.enterpriseId} and document_version_id=${document.versionId}`));
  const row = chunks.find(c => ((c.locator as Row).file as Row).row === 2)!;
  assert.match(String(row.text), /合成章节限定/); assert.match(String(row.text), /潮湿场景/); assert.match(String(row.text), /不得从参考资料推断本项目已具备条件。😀/);
  const detail = await new KnowledgeService(service.actor).execute('detail', { documentId: document.documentId });
  assert.equal((detail.document as Row).published_version_id, document.versionId);
  evidence.checks.push({ name: 'real file pipeline and reentry', passed: true, chunks: chunks.length, parser: ((detail.versions as Row[])[0].source_file as SourceFile).parsed!.parser }); save();
});

test('real retrieval/extractive persistence and authenticated source reopening retain notes and deny other customers/tenants', async () => {
  const result = await retrieveKnowledge(conversationId, actor, '合成底座检查 潮湿场景 厂家适用条件', await epoch(), gateway);
  assert.ok(result.evidence.some(e => e.file?.row === 2 && e.text.includes('合成章节限定')));
  const sent = await customer.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '这份设备资料里的底座检查有什么适用条件？' }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  fixture.runId = lease.runId;
  const model: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false }, async generate(input) {
    evidence.deterministic.reply++;
    const candidates = JSON.parse(input.messages[1].content).evidence as Array<{ sourceId: string; selectionId: string; text: string }>;
    // The maintained extractive protocol offers sentences, not complete chunks.
    // Select the bounded start/end from one actually supplied source; its normal
    // server parser reconstructs the original span and intervening conditions.
    const first = candidates.find(e => e.text.includes('合成底座检查')); assert.ok(first);
    const last = candidates.find(e => e.sourceId === first.sourceId && e.text.includes('不得从参考资料推断')); assert.ok(last);
    evidence.selected = { sourceId: first.sourceId, selections: [first.selectionId, last.selectionId] };
    return { text: JSON.stringify({ selections: evidence.selected.selections }), attemptId: '', usage: null, finishReason: null, providerRequestId: null };
  } };
  await processAnswer(lease, { model, retriever: { async retrieve(current, query, currentEpoch) { return (await retrieveKnowledge(conversationId, current, query, currentEpoch, gateway)).evidence; } } });
  const completed = await customer.run(lease.runId); evidence.run = completed; save();
  assert.equal(completed.status, 'succeeded', JSON.stringify(completed));
  const history = await new ConversationService(actor).messages(conversationId);
  const reply = history.items.find(m => m.authorKind === 'assistant')!; assert.ok(reply?.available);
  messageId = reply.id; citationId = reply.citations[0].id;
  const source = await citation(await token(fixture.users[0])); assert.equal(source.status, 200);
  assert.match(JSON.stringify(source.body), /合成章节限定/); assert.match(JSON.stringify(source.body), /潮湿场景/); assert.match(JSON.stringify(source.body), /表1·第2行/);
  assert.equal((await citation()).status, 401);
  assert.equal((await citation(await token(fixture.users[1]))).status, 404);
  assert.equal((await citation(await token(fixture.users[2], fixture.enterprises[1]))).status, 404);
  evidence.checks.push({ name: 'persisted excerpt/source auth', passed: true, messageId, citationId, statuses: [200, 401, 404, 404], configuredModel: false }); save();
});

test('a broken replacement fails while the prior publication stays valid; withdrawal revokes citation and derived text', async () => {
  const next = await op('newVersion', { documentId: document.documentId, fromVersionId: document.versionId, expectedVersion: 2 });
  const entries = directOutlines ? syntheticDocxOutlineEntries() : syntheticDocxNotesEntries(); delete (entries as Record<string, string>)['word/endnotes.xml'];
  const replacement = await op('replaceFile', { documentId: document.documentId, versionId: String(next.id), expectedVersion: 3, expectedEditVersion: 1,
    fileName: '合成损坏注释.docx', fileBase64: syntheticZip(entries).toString('base64'), authorization: 'SYNTHETIC TEST ONLY' });
  const job = await run(replacement.jobId); assert.equal(job.status, 'failed'); assert.equal(job.last_error, 'knowledge_file_parse_failed');
  const detail = await op('detail', { documentId: document.documentId }); assert.equal((detail.document as Row).published_version_id, document.versionId);
  assert.equal(((await citation(await token(fixture.users[0]))).body.data as Row).available, true);
  await op('retire', { documentId: document.documentId, expectedVersion: 3 });
  const revoked = await citation(await token(fixture.users[0])); assert.equal(revoked.status, 200); assert.equal((revoked.body.data as Row).available, false);
  const reread = await new ConversationService(actor).messages(conversationId); assert.equal(reread.items.find(m => m.id === messageId)?.available, false);
  const evidenceNow = await retrieveKnowledge(conversationId, actor, '合成底座检查', await epoch(), gateway); assert.equal(evidenceNow.evidence.length, 0);
  evidence.checks.push({ name: 'failed replacement and withdrawal', passed: true, priorPublicationPreserved: true, unavailable: true }); save();
});
