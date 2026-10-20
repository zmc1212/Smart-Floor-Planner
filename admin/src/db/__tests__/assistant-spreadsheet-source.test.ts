import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { claimKnowledgeJob, runKnowledgeJob } from '@/lib/assistant/knowledge/index-worker';
import { readOriginal } from '@/lib/assistant/knowledge/file-service';
import { retrieveKnowledge } from '@/lib/assistant/knowledge/retrieval';
import { parseSourceFile } from '@/lib/assistant/knowledge/source-file';
import { chunkDocument } from '@/lib/assistant/knowledge/chunk-gateway';
import { embeddingGateway } from '@/lib/assistant/infrastructure/embedding-gateway';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { claimJob } from '@/lib/assistant/infrastructure/job-queue';
import { processAnswer } from '@/lib/assistant/infrastructure/answer-worker';
import type { ActorContext, TextModelGateway } from '@/lib/assistant/contracts';
import { syntheticXlsx, syntheticXlsxEntries, syntheticZip, syntheticFormattedXlsx, syntheticDateXlsx, syntheticDateXlsxEntries, syntheticTimeXlsx, syntheticTimeXlsxEntries } from '../../../scripts/assistant-file-fixtures';

const prefix = 'synthetic-kb2-xlsx-' + randomUUID(), tenants: string[] = [], platformAdmins: string[] = [];
let eid: string, aid: string, uid: string, cid: string, service: KnowledgeService, customer: ConversationService, actor: ActorContext, published: Row;
const op = (action: string, input: Row) => service.execute(action, input, randomUUID());
const input = (bytes = syntheticXlsx()) => ({ title: '合成XLSX材料与检查', fileName: '合成核对表.xlsx', fileBase64: bytes.toString('base64'), authorization: 'SYNTHETIC ONLY; repeatable permitted fixture', audience: 'customer_public' });
const epoch = async () => Number((await withTenantTransaction(eid, tx => one(tx, sql`select knowledge_epoch from app.assistant_enterprise_settings where enterprise_id=${eid}`)))!.knowledge_epoch);
async function create(bytes = syntheticXlsx()) {
  const r = await op('createFile', input(bytes));
  return { documentId: String((r.document as Row).id), versionId: String((r.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1, jobId: r.jobId };
}
async function run(jobId: unknown) {
  const lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.jobId, jobId);
  await runKnowledgeJob(lease); return op('job', { jobId });
}
async function version(d: Row) { return ((await op('detail', { documentId: d.documentId })).versions as Row[]).find(v => String(v.id) === d.versionId)!; }
async function ready(d: Row) {
  assert.equal((await run(d.jobId)).status, 'succeeded'); d.expectedEditVersion = 2;
  await op('reviewFile', { ...d, acknowledgeWarnings: true, excludedBlockIds: [] }); d.expectedEditVersion = 3;
  const indexed = await op('index', d); assert.equal((await run(indexed.jobId)).status, 'succeeded');
}
function formulaFile() {
  const entries = syntheticXlsxEntries(); entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<v>2</v>', '<f>1+1</f><v>999</v>'); return syntheticZip(entries);
}
before(async () => {
  const url = new URL(resolvePostgresRuntimeConfig().connectionString); assert.equal(url.port, '55432'); assert.equal(url.pathname, '/xiaok_embedding_eval');
  await withPlatformTransaction(async tx => {
    for (let i = 0; i < 2; i++) tenants.push(String((await one(tx, sql`insert into app.enterprises(name,code,status) values(${prefix+i},${prefix+i},'active') returning id`))!.id));
    eid = tenants[0];
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,1000,12000000,1000000000,30)`);
    aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
    uid = String((await one(tx, sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);
    await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
  });
  service = new KnowledgeService({ enterpriseId: eid, adminId: aid }); actor = { enterpriseId: eid, principal: { kind: 'user', userId: uid }, contextVersion: 1, capabilities: ['assistant.chat.self'] };
  customer = new ConversationService(actor); cid = String((await customer.create(randomUUID())).id);
});
after(async () => {
  try { await withPlatformTransaction(async tx => {
    for (const t of tenants) { await deleteAssistantData(tx, BigInt(t)); await tx.execute(sql`delete from app.admin_users where enterprise_id=${t}`); await tx.execute(sql`delete from app.enterprises where id=${t}`); }
    for (const a of platformAdmins) await tx.execute(sql`delete from app.admin_users where id=${a}`);
    if (uid) await tx.execute(sql`delete from app.users where id=${uid}`);
  }); } finally { await closePostgresPool(); }
});

test('K02 XLSX real writes, idempotent original-key reentry, parser provenance and explicit review before indexing', async () => {
  const key = randomUUID(), a = await service.execute('createFile', input(), key), b = await service.execute('createFile', input(), key);
  assert.equal((a.document as Row).id, (b.document as Row).id); assert.equal(a.jobId, b.jobId);
  const d = { documentId: String((a.document as Row).id), versionId: String((a.draft as Row).id), expectedEditVersion: 1, expectedVersion: 1, jobId: a.jobId };
  assert.equal((await run(a.jobId)).status, 'succeeded'); const v = await version(d), file = v.source_file as Row;
  assert.equal(file.format, 'xlsx'); assert.match(String((file.parsed as Row).parser), /:xlsx:/); assert.equal(file.review, null);
  assert.deepEqual((await readOriginal(service.actor, d.documentId, d.versionId)).data, syntheticXlsx());
  await assert.rejects(op('index', { ...d, expectedEditVersion: 2 }), /knowledge_file_review_required/);
  published = d; d.expectedEditVersion = 2; await op('reviewFile', { ...d, acknowledgeWarnings: true, excludedBlockIds: [] }); d.expectedEditVersion = 3;
  const indexed = await op('index', d); assert.equal((await run(indexed.jobId)).status, 'succeeded'); await op('publish', d);
  await assert.rejects(withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_knowledge_versions set source_file=null,source_asset_id=null where enterprise_id=${eid} and id=${d.versionId}`)), e => /immutable published source file/.test(String((e as Error & {cause?:Error}).cause?.message)));
});

test('K03 real embeddings/retrieval retain actual worksheet/range, headers, numeric units and exceptions', async () => {
  const result = await retrieveKnowledge(cid, actor, 'TEST-A示例厚度mm地暖材料核对', await epoch());
  const source = result.evidence.find(e => e.file?.sheet === '材料核对' && e.file.row === 3)!; assert.ok(source);
  assert.equal(source.file?.range, 'A3:D3'); assert.equal(source.file?.page, undefined); assert.equal(source.file?.table, undefined);
  assert.match(source.text, /B3: 2/); assert.match(source.text, /C3: mm/); assert.match(source.text, /合成示例厚度与单位/);
  assert.match(source.text, /地暖场景不能直接套用/); assert.match(source.text, /不据此确认验收/);
});

test('K03 formatted XLSX real review/publication/retrieval uses display units and retains raw provenance on persisted reentry', async () => {
  const bytes = syntheticFormattedXlsx(), d = await create(bytes); await ready(d); await op('publish', d);
  const stored = (await version(d)).source_file as Row;
  const parsed = stored.parsed as { blocks: Array<{ sheet?: string; row?: number; cells?: Array<{ text: string; numberFormat?: Row }> }> };
  const original = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
  assert.deepEqual(original.cells?.[1].numberFormat, { raw: '0.125', id: 10, code: '0.00%' });
  assert.deepEqual(original.cells?.[2].numberFormat, { raw: '2.345', id: 164, code: '0.00" mm"' });
  assert.deepEqual((await readOriginal(service.actor, d.documentId, d.versionId)).data, bytes);
  const result = await retrieveKnowledge(cid, actor, 'TEST-A 合成示例比例与用量 参考比例 参考用量', await epoch());
  const source = result.evidence.find(e => e.ref.version === d.versionId && e.file?.row === 3)!; assert.ok(source);
  assert.match(source.text, /B3: 12\.50% \| C3: 2\.35 mm/); assert.match(source.text, /地暖场景不能直接套用/);
  assert.doesNotMatch(source.text, /0\.125|2\.345/); assert.equal(source.file?.range, 'A3:D3');
  await assert.rejects(withTenantTransaction(eid, tx => tx.execute(sql`update app.assistant_knowledge_versions set source_file=jsonb_set(source_file,'{parsed,parser}','"mutated"') where enterprise_id=${eid} and id=${d.versionId}`)), e => /immutable published source file/.test(String((e as Error & {cause?:Error}).cause?.message)));
  await op('retire', { documentId: d.documentId, expectedVersion: 2 });
  const revoked = await retrieveKnowledge(cid, actor, 'TEST-A 参考比例 参考用量', await epoch());
  assert.ok(revoked.evidence.every(e => e.ref.version !== d.versionId));
});

test('K03 date systems survive real writes, review, publication, customer citations and revoked historical reentry', async () => {
  for (const dateSystem of ['1900','1904'] as const) {
    const bytes = syntheticDateXlsx(dateSystem), d = await create(bytes); await ready(d); await op('publish', d);
    const stored = (await version(d)).source_file as Row;
    const parsed = stored.parsed as { blocks: Array<{ sheet?: string; row?: number; cells?: Array<{ text: string; numberFormat?: Row }> }> };
    const original = parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
    assert.equal(original.cells![1].text, '2026-10-19'); assert.equal(original.cells![2].text, '2026年10月20日');
    assert.deepEqual(original.cells![1].numberFormat, { raw: dateSystem === '1900' ? '46314' : '44852', id: 164, code: 'yyyy-mm-dd', dateSystem });
    assert.deepEqual((await readOriginal(service.actor, d.documentId, d.versionId)).data, bytes);
    const result = await retrieveKnowledge(cid, actor, 'TEST-A合成参考日期一参考日期二地暖', await epoch());
    const source = result.evidence.find(e => e.ref.version === d.versionId && e.file?.row === 3)!; assert.ok(source);
    assert.match(source.text, /B3: 2026-10-19 \| C3: 2026年10月20日/); assert.match(source.text, /地暖场景不能直接套用/);
    assert.doesNotMatch(source.text, /46314|44852|dateSystem/); assert.equal(source.file?.range, 'A3:D3');
    const dateCustomer = new ConversationService(actor), dateCid = String((await dateCustomer.create(randomUUID())).id);
    const sent = await dateCustomer.send(dateCid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: 'TEST-A合成参考日期一和参考日期二是什么？地暖能直接套用吗？' }] });
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    const model: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false }, generate: async data => {
      const evidence = JSON.parse(data.messages[1].content).evidence;
      const row = evidence.find((e: { text: string }) => e.text.includes('A3: TEST-A') && e.text.includes('B3: 2026-10-19')); assert.ok(row);
      return { text: JSON.stringify({ selections: [row.selectionId] }), attemptId: '', usage: null, finishReason: null, providerRequestId: null };
    } };
    await processAnswer(lease, { model }); assert.equal((await dateCustomer.run(lease.runId)).status, 'succeeded');
    const message = ((await new ConversationService(actor).messages(dateCid)).items as Row[]).find(m => m.authorKind === 'assistant')!;
    const citation = (message.citations as Row[]).find(c => c.version === d.versionId)!; assert.ok(citation);
    const quoted = await dateCustomer.citation(String(citation.id)); assert.equal(quoted.available, true);
    assert.match(String('quote' in quoted && quoted.quote), /2026-10-19/);
    assert.match(String('sourceLocation' in quoted && quoted.sourceLocation), /材料核对.*A3:D3/);
    await op('metadata', { documentId: d.documentId, expectedVersion: 2, audience: 'staff_internal' });
    assert.equal((await dateCustomer.citation(String(citation.id))).available, false);
    assert.equal(((await new ConversationService(actor).messages(dateCid)).items as Row[]).find(m => m.id === message.id)?.available, false);
    await op('retire', { documentId: d.documentId, expectedVersion: 3 });
  }
});

test('K03 local date/time clocks survive publication, exact original citations, persisted reentry and audience revocation', async () => {
  for (const dateSystem of ['1900','1904'] as const) {
    const bytes = syntheticTimeXlsx(dateSystem), d = await create(bytes); await ready(d); await op('publish', d);
    const stored = (await version(d)).source_file as { parsed: Awaited<ReturnType<typeof parseSourceFile>> };
    const original = stored.parsed.blocks.find(b => b.sheet === '材料核对' && b.row === 3)!;
    assert.equal(original.cells![1].text, '2026-10-19 09:30:00'); assert.equal(original.cells![1].numberFormat!.dateSystem, dateSystem);
    assert.equal(original.cells![2].text, '13:30:00'); assert.equal(original.cells![2].numberFormat!.raw, '0.5625');
    assert.deepEqual((await readOriginal(service.actor, d.documentId, d.versionId)).data, bytes);
    const clockCid = String((await customer.create(randomUUID())).id);
    const question = 'TEST-A合成参考日期时刻和参考时间是什么？地暖能直接套用吗？';
    const sent = await customer.send(clockCid, randomUUID(), {version:1,blocks:[{type:'text',text:question}]});
    const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
    const model: TextModelGateway = {capabilities:{streaming:false,toolCalling:false,usage:false},generate:async data=>{
      const evidence = JSON.parse(data.messages[1].content).evidence;
      const row = evidence.find((e:{text:string})=>e.text.includes('A3: TEST-A')&&e.text.includes('2026-10-19 09:30:00')); assert.ok(row);
      assert.match(row.text,/13:30:00/); assert.doesNotMatch(row.text,/395833333336|0\.5625/);
      // Legacy excerpts split sentences. The condition must belong to the same
      // original chunk, and selecting both must persist their contiguous quote.
      const condition=evidence.find((e:{sourceId:string;text:string})=>e.sourceId===row.sourceId&&e.text.includes('地暖场景不能直接套用')); assert.ok(condition);
      return {text:JSON.stringify({selections:[row.selectionId,condition.selectionId]}),attemptId:'',usage:null,finishReason:null,providerRequestId:null};
    }};
    await processAnswer(lease,{model}); assert.equal((await customer.run(lease.runId)).status,'succeeded');
    const message = ((await new ConversationService(actor).messages(clockCid)).items as Row[]).find(m=>m.authorKind==='assistant')!;
    const citation = (message.citations as Row[]).find(c=>c.version===d.versionId)!; assert.ok(citation);
    const quoted = await customer.citation(String(citation.id)); assert.equal(quoted.available,true);
    assert.match(String('quote' in quoted && quoted.quote),/2026-10-19 09:30:00/);
    assert.match(String('quote' in quoted && quoted.quote),/地暖场景不能直接套用/);
    assert.match(String('sourceLocation' in quoted && quoted.sourceLocation),/材料核对.*A3:D3/);
    await op('metadata',{documentId:d.documentId,expectedVersion:2,audience:'staff_internal'});
    assert.equal((await customer.citation(String(citation.id))).available,false);
    assert.equal(((await new ConversationService(actor).messages(clockCid)).items as Row[]).find(m=>m.id===message.id)?.available,false);
    await op('retire',{documentId:d.documentId,expectedVersion:3});
  }
});

test('K02 unsupported clock values keep originals and durable failure without partial parsed facts or publication', async () => {
  const entries = syntheticTimeXlsxEntries();
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<v>0.5625</v>','<v>1.5625</v>');
  const bytes = syntheticZip(entries), d = await create(bytes);
  assert.equal((await run(d.jobId)).status,'failed');
  assert.equal((await op('job',{jobId:d.jobId})).last_error,'knowledge_file_spreadsheet_number_format');
  assert.equal(((await version(d)).source_file as Row).parsed,null); assert.equal((await version(d)).published_at,null);
  assert.deepEqual((await readOriginal(service.actor,d.documentId,d.versionId)).data,bytes);
  await assert.rejects(op('index',d),/knowledge_file_review_required/);
});

test('K02 invalid date serials retain originals and a durable explicit failure without indexing or publication', async () => {
  const entries = syntheticDateXlsxEntries();
  entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<v>46314</v>', '<v>60</v>');
  const bytes = syntheticZip(entries), d = await create(bytes);
  assert.equal((await run(d.jobId)).status, 'failed');
  assert.equal((await op('job', { jobId: d.jobId })).last_error, 'knowledge_file_spreadsheet_number_format');
  assert.equal(((await version(d)).source_file as Row).parsed, null); assert.equal((await version(d)).published_at, null);
  assert.deepEqual((await readOriginal(service.actor, d.documentId, d.versionId)).data, bytes);
  await assert.rejects(op('index', d), /knowledge_file_review_required/);
});

test('K07 owners and both platform management roles retain XLSX access without employee membership or tenant leaks', async () => {
  for (const role of ['admin','super_admin']) {
    const adminId = String((await withPlatformTransaction(tx => one(tx, sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password) values(${prefix+role},'unusable-synthetic',${role},'active',ARRAY[]::text[],false) returning id`)))!.id); platformAdmins.push(adminId);
    assert.ok((await readOriginal({ enterpriseId: eid, adminId }, String(published.documentId), String(published.versionId))).data);
    const created = await new KnowledgeService({ enterpriseId: eid, adminId }).execute('createFile', input(), randomUUID());
    assert.equal((await run(created.jobId)).status, 'succeeded');
    await assert.rejects(readOriginal({ enterpriseId: tenants[1], adminId }, String(published.documentId), String(published.versionId)), /assistant_resource_not_found/);
  }
  await assert.rejects(readOriginal({ enterpriseId: tenants[1], adminId: aid }, String(published.documentId), String(published.versionId)), /assistant_capability_forbidden/);
  const unseen = await withTenantTransaction(tenants[1], tx => rows(tx, sql`select id from app.assistant_knowledge_assets`)); assert.equal(unseen.length, 0);
});

test('K07 internal XLSX and unreviewed drafts are absent from customer recall and diagnostics', async () => {
  const d = await create(); await op('metadata', { documentId: d.documentId, expectedVersion: 1, audience: 'staff_internal' }); d.expectedVersion = 2;
  await ready(d); await op('publish', d);
  const result = await retrieveKnowledge(cid, actor, 'TEST-A材料示例厚度地暖', await epoch());
  assert.ok(result.evidence.every(e => e.ref.version !== d.versionId)); assert.ok(result.diagnostic.candidates.every(c => c.ref.version !== d.versionId));
});

test('K10 formula rejection retains original and exact failure, with retry/cancel using original persisted job', async () => {
  const d = await create(formulaFile()); assert.equal((await run(d.jobId)).status, 'failed');
  assert.equal((await op('job', { jobId: d.jobId })).last_error, 'knowledge_file_spreadsheet_formula');
  assert.equal((await version(d)).published_at, null); assert.deepEqual((await readOriginal(service.actor, d.documentId, d.versionId)).data, formulaFile());
  const retry = await op('parse', d); assert.equal(retry.jobId, d.jobId); const lease = await claimKnowledgeJob(); assert.ok(lease);
  await op('cancelParse', d); await runKnowledgeJob(lease); assert.equal((await op('job', { jobId: d.jobId })).status, 'cancelled');
  assert.equal((await version(d)).edit_version, 1);
});

test('K06 failed XLSX replacement preserves effective publication; a reviewed replacement switches to its exact new version', async () => {
  const d = await create(); await ready(d); await op('publish', d);
  const copy = await op('newVersion', { documentId: d.documentId, fromVersionId: d.versionId, expectedVersion: 2 });
  const next = { ...d, versionId: String(copy.id), expectedVersion: 3, expectedEditVersion: 1 };
  const failed = await op('replaceFile', { ...next, ...input(formulaFile()) }); assert.equal((await run(failed.jobId)).status, 'failed');
  assert.equal(((await op('detail', { documentId: d.documentId })).document as Row).published_version_id, d.versionId);
  const replacement = await op('replaceFile', { ...next, ...input(syntheticXlsx(true)), expectedEditVersion: 2 });
  next.jobId = replacement.jobId; assert.equal((await run(next.jobId)).status, 'succeeded'); next.expectedEditVersion = 4;
  await op('reviewFile', { ...next, acknowledgeWarnings: true, excludedBlockIds: [] }); next.expectedEditVersion = 5;
  const indexed = await op('index', next); assert.equal((await run(indexed.jobId)).status, 'succeeded'); await op('publish', next);
  assert.equal(((await op('detail', { documentId: d.documentId })).document as Row).published_version_id, next.versionId);
  const chunks = await withTenantTransaction(eid, tx => rows(tx, sql`select text from app.assistant_knowledge_chunks where enterprise_id=${eid} and document_version_id=${next.versionId}`));
  assert.ok(chunks.some(c => String(c.text).includes('B3: 3')));
  await op('retire', { documentId: d.documentId, expectedVersion: 4 });
});

test('K08 withdrawal during XLSX parsing fences the late result and never saves partial provenance', async () => {
  const d = await create(), lease = await claimKnowledgeJob(); assert.ok(lease); assert.equal(lease.jobId, d.jobId);
  await runKnowledgeJob(lease, { chunk: chunkDocument, embedding: embeddingGateway(), parse: async (bytes, format) => {
    const parsed = await parseSourceFile(bytes, format); await op('retire', { documentId: d.documentId, expectedVersion: 1 }); return parsed;
  } });
  assert.equal((await op('job', { jobId: d.jobId })).status, 'cancelled'); assert.equal(((await version(d)).source_file as Row).parsed, null);
});

test('K08 persisted customer citations expose XLSX originals/ranges, then revoke on withdrawal with no construction effects', async () => {
  const sent = await customer.send(cid, randomUUID(), { version: 1, blocks: [{ type: 'text', text: 'TEST-A材料合成示例厚度与地暖前提' }] });
  const lease = await claimJob(); assert.ok(lease); assert.equal(lease.runId, sent.runId);
  const model: TextModelGateway = { capabilities: { streaming: false, toolCalling: false, usage: false }, generate: async data => {
    const evidence = JSON.parse(data.messages[1].content).evidence;
    const row = evidence.find((e: { text: string }) => e.text.includes('A3: TEST-A') && e.text.includes('B3: 2')); assert.ok(row);
    return { text: JSON.stringify({ selections: [row.selectionId] }), attemptId: '', usage: null, finishReason: null, providerRequestId: null };
  } };
  await processAnswer(lease, { model }); assert.equal((await customer.run(lease.runId)).status, 'succeeded');
  const message = ((await customer.messages(cid)).items as Row[]).find(m => m.authorKind === 'assistant')!; assert.ok(message);
  const citation = (message.citations as Row[])[0], source = await customer.citation(String(citation.id));
  assert.equal(source.available, true); assert.ok('sourceLocation' in source && 'sourceFile' in source);
  assert.match(String(source.sourceLocation), /合成核对表.xlsx.*材料核对.*A3:D3/);
  assert.equal((source.sourceFile as Row).range, 'A3:D3'); assert.equal((source.sourceFile as Row).format, 'xlsx');
  await op('retire', { documentId: published.documentId, expectedVersion: 2 });
  assert.equal((await customer.citation(String(citation.id))).available, false);
  assert.equal(((await customer.messages(cid)).items as Row[]).find(m => m.id === message.id)?.available, false);
  await assert.rejects(readOriginal(service.actor, String(published.documentId), String(published.versionId)), /assistant_resource_not_found/);
  const events = await withTenantTransaction(eid, tx => rows(tx, sql`select type from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.%issue.%'`)); assert.equal(events.length, 0);
});
