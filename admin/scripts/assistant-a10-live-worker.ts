import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import { safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';
import { prepareReview } from './assistant-a10.mjs';

async function main() {
  assert.equal(process.env.ASSISTANT_LIVE_TEXT, '1');
  const output = path.resolve(process.argv[2]);
  const dataset = JSON.parse(await readFile(path.join(output, 'dataset.json'), 'utf8'));
  const snapshot = JSON.parse(await readFile(path.join(output, 'source-snapshot.json'), 'utf8'));
  const selected = new Set((process.env.ASSISTANT_A10_CASES || '').split(',').filter(Boolean));
  if (selected.size) {
    for (const id of selected) assert.ok(dataset.cases.some((c: { id: string }) => c.id === id), 'Unknown selected case');
    for (let changed = true; changed;) {
      changed = false;
      for (const c of dataset.cases) if (selected.has(c.id) && c.previousCaseId && !selected.has(c.previousCaseId)) { selected.add(c.previousCaseId); changed = true; }
    }
  }
  const release = await lockAssistantAcceptance();
  let actor: ActorContext | undefined;
  const results: Row[] = [];
  const setup: Row[] = [];
  const prefix = 'a10-live-' + randomUUID();
  const evidence = { schemaVersion: 1, enterpriseId: dataset.enterpriseId,
    scope: 'Real customer services, pgvector, GPU embeddings and configured text model against a current public-knowledge snapshot in an isolated enterprise; not WeChat login/UI or production execution.',
    executionEnterpriseId: '', sourceSnapshotHash: snapshot.hash, requestedCases: selected.size ? [...selected] : 'all60', results, setup, businessReview: 'pending' };
  const save = async () => writeFile(path.join(output, 'evidence.json'), JSON.stringify(evidence, null, 2));
  try {
    let adminId = '';
    await withPlatformTransaction(async tx => {
      const e = (await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix},${prefix},'active') returning id`))!;
      const eid = String(e.id);
      evidence.executionEnterpriseId = eid;
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days)
        values(${eid},true,200,2400000,200000000,90)`);
      const a = (await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password)
        values(${eid},${prefix},'test-only','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!;
      adminId = String(a.id);
      const u = (await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!;
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${String(u.id)},${prefix})`);
      actor = { enterpriseId: eid, principal: { kind: 'user', userId: String(u.id) }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
    });
    const activeActor = actor!;
    const knowledge = new KnowledgeService({ enterpriseId: activeActor.enterpriseId, adminId });
    const chat = new ConversationService(activeActor);
    const docs = new Map<string, { id: string; versionId: string; source: Row }>();
    const get = async (id: string) => knowledge.execute('detail', { documentId: id });
    const indexPublish = async (id: string, versionId: string) => {
      const detail = await get(id);
      const v = (detail.versions as Row[]).find(v => String(v.id) === versionId)!;
      const input = { documentId: id, versionId, expectedVersion: Number((detail.document as Row).version), expectedEditVersion: Number(v.edit_version) };
      await knowledge.execute('index', input, randomUUID());
      const lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.actor.enterpriseId, activeActor.enterpriseId);
      await runKnowledgeJob(lease);
      assert.equal((await knowledge.execute('job', { jobId: lease.jobId })).status, 'succeeded');
      await knowledge.execute('publish', input, randomUUID());
    };
    const create = async (source: Row) => {
      const d = await knowledge.execute('create', { title: source.title, sourceType: source.sourceType, audience: source.audience ?? 'customer_public', body: source.body, faq: source.faq }, randomUUID());
      const id = String((d.document as Row).id), versionId = String((d.draft as Row).id);
      await indexPublish(id, versionId);
      return { id, versionId, source };
    };
    const retire = async (id: string) => {
      const detail = await get(id);
      await knowledge.execute('retire', { documentId: id, expectedVersion: Number((detail.document as Row).version) }, randomUUID());
    };
    const restore = async (doc: { id: string; versionId: string }) => {
      const detail = await get(doc.id), v = (detail.versions as Row[]).find(v => String(v.id) === doc.versionId)!;
      await knowledge.execute('publish', { documentId: doc.id, versionId: doc.versionId, expectedVersion: Number((detail.document as Row).version), expectedEditVersion: Number(v.edit_version) }, randomUUID());
    };
    const draft = async (key: string, suffix: string) => {
      const doc = docs.get(key)!, detail = await get(doc.id);
      const v = await knowledge.execute('newVersion', { documentId: doc.id, fromVersionId: doc.versionId, expectedVersion: Number((detail.document as Row).version) }, randomUUID());
      const faq = structuredClone(doc.source.faq) as Array<{ question: string; answer: string }>;
      if (doc.source.sourceType === 'faq') faq[0].answer += suffix;
      await knowledge.execute('edit', { documentId: doc.id, versionId: String(v.id), expectedEditVersion: Number(v.edit_version),
        ...(doc.source.sourceType === 'faq' ? { faq } : { body: String(doc.source.body) + suffix }) }, randomUUID());
      return String(v.id);
    };
    for (const source of snapshot.documents) {
      const doc = await create(source); docs.set('S' + source.documentId, doc);
      setup.push({ sourceDocumentId: source.documentId, sourceVersionId: source.versionId, executionDocumentId: doc.id, executionVersionId: doc.versionId });
      console.log(JSON.stringify({ source: source.documentId, indexed: true }));
    }
    await save();
    const conversations = new Map<string, string>();
    for (const c of dataset.cases.filter((c: { id: string }) => !selected.size || selected.has(c.id))) {
      const started = Date.now();
      const scenario: Row = {};
      const temporary: string[] = [];
      if (['A10-35', 'A10-36'].includes(c.id)) {
        for (const doc of docs.values()) await retire(doc.id);
        const bodies = c.id === 'A10-35'
          ? ['厨房点位确认必须先确定设备位置再确认插座位置。', '厨房点位确认必须先确定插座位置再确认设备位置。']
          : ['水压测试必须拍摄两次压力表照片。', '水压测试只需拍摄一次压力表照片。'];
        const versions = [];
        for (const body of bodies) { const doc = await create({ title: '隔离冲突验收资料', sourceType: 'manual_text', body, faq: [] }); temporary.push(doc.id); versions.push(doc.versionId); }
        scenario.conflictVersions = versions; scenario.conflictBodies = bodies;
      }
      if (c.id === 'A10-45') {
        const versionId = await draft('S2', ' 验收版本乙。');
        await indexPublish(docs.get('S2')!.id, versionId);
        scenario.newVersion = versionId;
        scenario.previousProjection = await chat.messages(conversations.get(c.previousCaseId)!);
      }
      if (c.id === 'A10-46') {
        await retire(docs.get('S8')!.id);
        scenario.retiredDocument = docs.get('S8')!.id;
        scenario.previousProjection = await chat.messages(conversations.get(c.previousCaseId)!);
        assert.ok((scenario.previousProjection as {items: Row[]}).items.some(m => m.authorKind === 'assistant' && m.available === false));
      }
      if (c.id === 'A10-47') {
        const doc = docs.get('S7')!, detail = await get(doc.id);
        await knowledge.execute('metadata', { documentId: doc.id, expectedVersion: Number((detail.document as Row).version), audience: 'staff_internal' }, randomUUID());
        scenario.internalDocument = doc.id;
        scenario.previousProjection = await chat.messages(conversations.get(c.previousCaseId)!);
        assert.ok((scenario.previousProjection as {items: Row[]}).items.some(m => m.authorKind === 'assistant' && m.available === false));
      }
      if (c.id === 'A10-48') scenario.unpublishedVersion = await draft('S4', ' 隔离测试新草稿：不核对费用即可开工。');
      const conversationId = c.previousCaseId ? conversations.get(c.previousCaseId)! : String((await chat.create(randomUUID())).id);
      assert.ok(conversationId); conversations.set(c.id, conversationId);
      const run = await chat.send(conversationId, randomUUID(), { version: 1, blocks: [{ type: 'text', text: c.question }] });
      const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, run.runId); assert.equal(lease.enterpriseId, activeActor.enterpriseId);
      await processAnswer(lease);
      const terminal = await chat.run(String(run.runId));
      const answer = (await chat.messages(conversationId)).items.find(m => m.id === terminal.outputMessageId);
      const citations = answer?.citations ?? [];
      for (const cite of citations) assert.deepEqual(await chat.citation(cite.id), cite);
      const providers = await withTenantTransaction(activeActor.enterpriseId, tx => rows(tx, sql`select id::text,provider_key,remote_model,status from app.ai_provider_attempts where assistant_run_id=${String(run.runId)}`));
      const row = { caseId: c.id, question: c.question, conversationId, messageId: answer?.id ?? 'missing:' + run.runId, runId: String(run.runId),
        status: terminal.status, errorCode: terminal.errorCode, answerKind: terminal.answerKind, answer: answer ? safeText(answer.content as MessageContent) : '',
        capturedAt: new Date().toISOString(), citations, executionEnterpriseId: activeActor.enterpriseId, providers, durationMs: Date.now() - started,
        scenarioEvidence: ['conflict', 'updated'].includes(c.category) ? JSON.stringify({ setup: c.setup, ...scenario }) : undefined,
        automaticKindMatch: terminal.status === 'succeeded' && terminal.answerKind === c.expectedKind };
      results.push(row); await save();
      console.log(JSON.stringify({ caseId: c.id, status: row.status, kind: row.answerKind, expected: c.expectedKind, match: row.automaticKindMatch, durationMs: row.durationMs }));
      if (temporary.length) { for (const id of temporary) await retire(id); for (const doc of docs.values()) await restore(doc); }
      if (c.id === 'A10-45') await restore(docs.get('S2')!);
      if (c.id === 'A10-46') await restore(docs.get('S8')!);
      if (c.id === 'A10-47') {
        const doc = docs.get('S7')!, detail = await get(doc.id);
        await knowledge.execute('metadata', { documentId: doc.id, expectedVersion: Number((detail.document as Row).version), audience: 'customer_public' }, randomUUID());
      }
      if (Date.now() - started < 2200) await delay(2200 - (Date.now() - started));
    }
    if (process.env.ASSISTANT_A10_PREVIEW_PROBE === '1') {
      await create({ title: '隔离合成权限回归：内部报销', sourceType: 'faq', audience: 'staff_internal', body: '',
        faq: [{ question: '员工提交报销材料需要包含什么？', answer: '隔离合成验收制度：员工报销材料需包含发票和报销申请单。' }] });
      const preview = new ConversationService({ ...activeActor, principal: { kind: 'admin', adminId }, capabilities: ['assistant.preview.self'] });
      const probeResults = [];
      for (const [label, service, input] of [['authorized_internal_preview', preview, { audience: 'staff_internal' }], ['customer_no_internal_access', chat, {}]] as const) {
        const cid = String((await service.create(randomUUID(), input)).id);
        const run = await service.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: '按内部资料，员工提交报销材料需要包含什么？' }] });
        const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, run.runId); await processAnswer(lease);
        const terminal = await service.run(String(run.runId)), answer = (await service.messages(cid)).items.find(m => m.id === terminal.outputMessageId);
        const expected = label === 'authorized_internal_preview' ? 'grounded' : 'insufficient_evidence';
        const result = { label, expected, terminal, answer };
        probeResults.push(result);
        await writeFile(path.join(output, 'preview-boundary.json'), JSON.stringify({ scope: 'Synthetic permission regression, not one of the 60 business questions', results: probeResults }, null, 2));
        assert.equal(terminal.status, 'succeeded'); assert.equal(terminal.answerKind, expected);
      }
    }
    await writeFile(path.join(output, 'review.json'), JSON.stringify(prepareReview(dataset, evidence), null, 2));
    console.log(JSON.stringify({ completed: results.length, kindMatches: results.filter(r => r.automaticKindMatch).length, businessReview: 'pending', output }));
    if (results.some(r => !r.automaticKindMatch)) process.exitCode = 1;
  } finally {
    // Keep execution history/provider audits for the nominated reviewer. Disable
    // only this generated evaluation enterprise, never alter the source tenant.
    if (actor) await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${actor!.enterpriseId}`));
    await save(); await closePostgresPool(); await release();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'A10 execution failed'); process.exitCode = 1; });
