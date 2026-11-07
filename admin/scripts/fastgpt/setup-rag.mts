/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated, labelled development fixture and vendor setup. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { ragWorkflow } from './rag-workflow.mjs';
const require = createRequire(import.meta.url); require('@next/env').loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), out = path.join(root, 'tmp/xiaok-fastgpt-rag-session-20261107');
fs.mkdirSync(out, { recursive: true });
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const original = read('tmp/mineru-online-test/runtime.private.json');
const wrapper = read('tmp/fastgpt-capabilities-20261106/runtime.private.json');
const fixture = read('tmp/xiaok-mineru-fastgpt-preview-20261107/craft-only/preparation.json');
const manifest = JSON.parse(fs.readFileSync('scripts/fixtures/xiaok-ppt-craft-preview.json', 'utf8'));
const file = path.join(out, 'runtime.private.json'), state: any = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
  baseUrl: original.baseUrl, apiKey: original.apiKey, managementCookie: original.managementCookie,
  knowledgeAppId: wrapper.knowledgeAppId, stageAppId: wrapper.stageAppId, auditFile: path.join(out, 'workflow-attempts.jsonl'),
  rag: { protocol: 'fastgpt-native-rag-v1', enterpriseId: '1454', model: 'qwen3.7-flash', embeddingModel: 'text-embedding-v4',
    bridgeKey: randomBytes(32).toString('hex'), transportModel: 'sfp-ppt-rag-qwen37-flash', sources: [] },
};
const save = () => { fs.writeFileSync(file, JSON.stringify(state, null, 2)); execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', 'Administrator:F', 'SYSTEM:F'], { windowsHide: true, stdio: 'ignore' }); };
const attempt = path.join(out, 'setup-attempts.jsonl');
async function api(endpoint: string, method = 'GET', body?: unknown) {
  fs.appendFileSync(attempt, JSON.stringify({ endpoint, method, phase: 'dispatch', at: new Date().toISOString() }) + '\n');
  const response = await fetch(state.baseUrl + endpoint, { method, signal: AbortSignal.timeout(30000), headers: { 'Content-Type': 'application/json',
    Authorization: 'Bearer ' + state.apiKey, Cookie: state.managementCookie, 'fastgpt-web-request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const packet = await response.json();
  if (!response.ok || packet.code !== 200) fs.writeFileSync(path.join(out, 'setup-rejection-' + Date.now() + '.json'), JSON.stringify(packet, null, 2));
  fs.appendFileSync(attempt, JSON.stringify({ endpoint, status: response.status, code: packet.code, phase: 'response' }) + '\n');
  assert.ok(response.ok && packet.code === 200, `FastGPT setup ${endpoint} HTTP${response.status} code=${packet.code}`);
  return packet.data;
}
process.env.DATABASE_URL = read('tmp/xiaok-vector/connection.private.json').DATABASE_URL;
const database = new URL(process.env.DATABASE_URL!); assert.equal(database.host, '127.0.0.1:55432'); assert.equal(database.pathname, '/xiaok_embedding_eval');
const { sql } = require('drizzle-orm'), { withTenantTransaction } = require(path.resolve('src/db/transaction.ts'));
const { one, rows } = require(path.resolve('src/db/repositories/assistant-repository.ts'));
const { KnowledgeService } = require(path.resolve('src/lib/assistant/knowledge/service.ts'));
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');
const tenant = (f: any) => withTenantTransaction('1454', f);
let tunnel: ReturnType<typeof spawn> | undefined, release: any, before: any;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL!, { waitForLock: true });
  const net = require('node:net'); await new Promise<void>((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(18300, '127.0.0.1', () => s.close(() => resolve())); });
  tunnel = spawn('ssh', ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
    '-N', '-L', '127.0.0.1:18300:127.0.0.1:18300', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900)); save();
  const catalogBefore = await api('/api/core/ai/model/catalog');
  fs.writeFileSync(path.join(out, 'catalog-before.json'), JSON.stringify(catalogBefore, null, 2));
  if (!state.ragChannelId) { state.ragChannelId = (await api('/api/core/ai/model/channel/create', 'POST', {
    channelType: 'system', name: '合成测试·小K PPT RAG 原服务模型', type: 1, key: state.rag.bridgeKey,
    base_url: 'http://host.docker.internal:18310/rag-model/v1', models: [state.rag.transportModel], status: 1, priority: 1,
  })).id; save(); }
  if (!state.ragModelId) { state.ragModelId = (await api('/api/core/ai/model/create', 'POST', {
    channelType: 'system', channelIds: [state.ragChannelId], modelData: { scope: 'system', type: 'llm', provider: 'Other', model: state.rag.transportModel,
      name: '小K PPT RAG·qwen3.7-flash 原服务计量', isActive: true, config: { maxContext: 16000, maxResponse: 2048, quoteMaxToken: 8000,
        maxTemperature: 1, toolChoice: false, vision: false, responseFormatList: ['text'], defaultConfig: { enable_thinking: false } } },
  })).modelId; save(); }
  const workflow = ragWorkflow(read('tmp/xiaok-mineru-fastgpt-preview-20261107/fastgpt-ppt-craft/workflow.json'), state.ragModelId);
  fs.writeFileSync(path.join(out, 'workflow.json'), JSON.stringify(workflow, null, 2));
  const hash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
  if (!state.rag.appId) { state.rag.appId = await api('/api/core/app/create', 'POST', workflow); state.ragWorkflowHash = hash; save(); }
  assert.equal(state.ragWorkflowHash, hash, 'Never silently change an already bound native workflow');
  if (!state.ragPublished) {
    const detail = await api('/api/core/app/detail?appId=' + state.rag.appId);
    if (!detail.publishedVersionId) { const { nodes, edges, chatConfig } = workflow;
      await api('/api/core/app/version/publish?appId=' + state.rag.appId, 'POST', { nodes, edges, chatConfig });
    }
    state.ragPublished = (await api('/api/core/app/detail?appId=' + state.rag.appId)).publishedVersionId; assert.ok(state.ragPublished); save();
  }
  const listed = await api('/api/core/dataset/data/v2/list', 'POST', { collectionId: '6aeebd1a093915ea6cf2da8f', offset: 0, pageSize: 10 });
  const nativeRows = listed.list;
  assert.equal(nativeRows.length, 4);
  before = await tenant((tx: any) => one(tx, sql`select enabled from app.assistant_enterprise_settings where enterprise_id=1454`));
  await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=1454`));
  const knowledge = new KnowledgeService({ enterpriseId: '1454', adminId: fixture.adminIds[0] });
  const published = [];
  for (const part of fixture.parts) {
    const draft = manifest.drafts.find((d: any) => d.slide === part.page); assert.ok(draft);
    let detail = await knowledge.execute('detail', { documentId: part.documentId });
    assert.equal(detail.document.category, fixture.category); assert.equal(String(detail.versions.find((v: any) => String(v.id) === part.versionId).id), part.versionId);
    if (detail.document.audience !== 'customer_public') await knowledge.execute('metadata', { documentId: part.documentId, expectedVersion: Number(detail.document.version), audience: 'customer_public' }, randomUUID());
    detail = await knowledge.execute('detail', { documentId: part.documentId });
    if (String(detail.document.published_version_id) !== part.versionId || detail.document.status !== 'active') await knowledge.execute('publish', {
      documentId: part.documentId, versionId: part.versionId, expectedVersion: Number(detail.document.version),
      expectedEditVersion: Number(detail.versions.find((v: any) => String(v.id) === part.versionId).edit_version),
    }, randomUUID());
    const chunks = await tenant((tx: any) => rows(tx, sql`select id::text,text,text_hash,locator from app.assistant_knowledge_chunks where enterprise_id=1454 and document_version_id=${part.versionId}`));
    const chunk = chunks.find((c: any) => c.text.includes(draft.body)); assert.ok(chunk, 'Original Evidence must contain the complete verified PPT passage');
    const native = nativeRows.find((r: any) => r.chunkIndex === part.page);
    assert.equal(native.q, draft.title + '\n\n' + draft.body); assert.equal(native.a || '', '');
    const source = { nativeId: native._id, datasetId: native.datasetId, collectionId: native.collectionId, q: native.q, a: '',
      evidence: { ref: { type: 'knowledge_chunk', id: chunk.id, version: part.versionId }, hash: chunk.text_hash, text: draft.body,
        ...(chunk.locator.file ? { file: chunk.locator.file } : {}) } };
    state.rag.sources = [...state.rag.sources.filter((s: any) => s.nativeId !== source.nativeId), source]; save();
    published.push({ page: part.page, documentId: part.documentId, versionId: part.versionId, chunkId: chunk.id, audience: 'customer_public' });
  }
  fs.writeFileSync(path.join(out, 'preparation.json'), JSON.stringify({ status: 'ready', enterpriseId: '1454', isolatedDatabase: database.pathname,
    userDirection: '直接发布 验证后不撤回', published, appId: state.rag.appId, channelId: state.ragChannelId, modelId: state.ragModelId,
    workflowHash: hash, model: state.rag.model, embeddingModel: state.rag.embeddingModel, noAnswerCalls: true }, null, 2));
  console.log(JSON.stringify({ prepared: true, appId: state.rag.appId, published, answerCalls: 0 }));
} catch (error) {
  const safe = error instanceof Error ? error.message : 'setup failed';
  fs.writeFileSync(path.join(out, 'setup-failure-' + Date.now() + '.json'), JSON.stringify({ error: safe })); console.error(safe); process.exitCode = 1;
} finally {
  if (before) await tenant((tx: any) => tx.execute(sql`update app.assistant_enterprise_settings set enabled=${before.enabled} where enterprise_id=1454`));
  if (tunnel) tunnel.kill(); if (release) await release();
  await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool();
}
