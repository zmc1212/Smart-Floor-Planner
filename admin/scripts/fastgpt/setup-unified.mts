/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated, labelled development fixture and vendor setup. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { unifiedWorkflow } from './unified-workflow.mjs';
const require = createRequire(import.meta.url); require('@next/env').loadEnvConfig(process.cwd(), true);
const model = process.argv.includes('--plus') ? 'qwen3.7-plus' : 'qwen3.7-flash';
const grounding = process.argv.includes('--workflow-grounding');
const classified = process.argv.includes('--classified');
assert.ok(!classified || grounding);
assert.ok(!grounding || model === 'qwen3.7-plus', 'Mechanism comparison keeps the last configured chat model unchanged');
const root = path.resolve('..'), out = path.join(root, 'tmp/xiaok-fastgpt-unified-20261107', ...(process.argv.includes('--plus') ? ['plus'] : []), ...(grounding ? ['workflow-grounding'] : []), ...(classified ? ['classified'] : []));
fs.mkdirSync(out, { recursive: true });
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const original = read(grounding ? 'tmp/xiaok-fastgpt-unified-20261107/plus/runtime.private.json' : 'tmp/xiaok-fastgpt-rag-session-20261107/runtime.private.json');
const file = path.join(out, 'runtime.private.json'), state: any = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
  ...original, auditFile: path.join(out, 'workflow-attempts.jsonl'), ragChannelId: grounding ? original.ragChannelId : undefined,
  ragModelId: grounding ? original.ragModelId : undefined, ragWorkflowHash: undefined, ragPublished: undefined,
  rag: {...original.rag, model, mode: 'unified', ...(grounding ? { grounding: classified ? 'native-dataset-classified' : 'native-dataset' } : {}), appId: undefined,
    bridgeKey: grounding ? original.rag.bridgeKey : randomBytes(32).toString('hex'), transportModel: 'sfp-unified-' + model.replaceAll('.', '')},
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
const { lockAssistantAcceptance } = await import('../assistant-acceptance-safety.mjs');
let tunnel: ReturnType<typeof spawn> | undefined, release: any;
try {
  release = await lockAssistantAcceptance(process.env.DATABASE_URL!, { waitForLock: true });
  const net = require('node:net'); await new Promise<void>((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(18300, '127.0.0.1', () => s.close(() => resolve())); });
  tunnel = spawn('ssh', ['-i', 'C:/Users/Administrator/.ssh/toonflow_remote_ed25519', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ExitOnForwardFailure=yes',
    '-N', '-L', '127.0.0.1:18300:127.0.0.1:18300', 'Administrator@192.168.10.54'], { windowsHide: true, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 900)); save();
  const catalogBefore = await api('/api/core/ai/model/catalog');
  fs.writeFileSync(path.join(out, 'catalog-before.json'), JSON.stringify(catalogBefore, null, 2));
  if (!state.ragChannelId) { state.ragChannelId = (await api('/api/core/ai/model/channel/create', 'POST', {
    channelType: 'system', name: '合成测试·小K统一会话原服务模型·' + model, type: 1, key: state.rag.bridgeKey,
    base_url: 'http://host.docker.internal:18310/unified-model/v1', models: [state.rag.transportModel], status: 1, priority: 1,
  })).id; save(); }
  if (!state.ragModelId) { state.ragModelId = (await api('/api/core/ai/model/create', 'POST', {
    channelType: 'system', channelIds: [state.ragChannelId], modelData: { scope: 'system', type: 'llm', provider: 'Other', model: state.rag.transportModel,
      name: '小K统一会话·' + model + ' 原服务计量', isActive: true, config: { maxContext: 16000, maxResponse: 2048, quoteMaxToken: 8000,
        maxTemperature: 1, toolChoice: true, vision: false, responseFormatList: ['text'], defaultConfig: { enable_thinking: false } } },
  })).modelId; save(); }
  const { unifiedTools, knowledgeQuestionClasses } = require(path.resolve('src/lib/assistant/fastgpt/unified-tools.ts'));
  const datasetNode = grounding ? read('tmp/xiaok-fastgpt-rag-session-20261107/workflow.json').nodes.find((n: any) => n.flowNodeType === 'datasetSearchNode') : undefined;
  if (grounding) assert.ok(datasetNode);
  const workflow = unifiedWorkflow(state.ragModelId, unifiedTools, datasetNode, classified ? knowledgeQuestionClasses : undefined);
  const hash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
  const updating = !!state.ragWorkflowHash && state.ragWorkflowHash !== hash;
  assert.ok(!state.publicationPending, 'Inspect the prior unknown publication before another write');
  if (updating) {
    assert.ok(grounding && classified && process.argv.includes('--publish-update'), 'Never silently change an already bound native workflow');
    const history = path.join(out, 'workflow-revisions', state.ragWorkflowHash); fs.mkdirSync(history, { recursive: true });
    fs.copyFileSync(path.join(out, 'workflow.json'), path.join(history, 'workflow.json'));
    const privateCopy = path.join(history, 'runtime.private.json'); fs.copyFileSync(file, privateCopy);
    execFileSync('icacls.exe', [privateCopy, '/inheritance:r', '/grant:r', 'Administrator:F', 'SYSTEM:F'], { windowsHide: true, stdio: 'ignore' });
    state.ragWorkflowHash = hash; state.ragPublished = undefined; save();
  }
  fs.writeFileSync(path.join(out, 'workflow.json'), JSON.stringify(workflow, null, 2));
  if (!state.rag.appId) { state.rag.appId = await api('/api/core/app/create', 'POST', workflow); state.ragWorkflowHash = hash; save(); }
  assert.equal(state.ragWorkflowHash, hash, 'Never silently change an already bound native workflow');
  const publishUpdate = process.argv.includes('--publish-update');
  assert.ok(!publishUpdate || (grounding && classified), 'Explicit version updates are scoped to this classified pilot');
  if (!state.ragPublished || publishUpdate) {
    const detail = await api('/api/core/app/detail?appId=' + state.rag.appId);
    if (updating || publishUpdate || !detail.publishedVersionId) { const { nodes, edges, chatConfig } = workflow;
      state.publicationPending = true; save();
      await api('/api/core/app/version/publish?appId=' + state.rag.appId, 'POST', { nodes, edges, chatConfig, isPublish: true });
      state.publicationPending = false; save();
      const published = await api('/api/core/app/detail?appId=' + state.rag.appId);
      assert.notEqual(published.publishedVersionId, detail.publishedVersionId, 'A saved draft is not a published workflow');
    }
    state.ragPublished = (await api('/api/core/app/detail?appId=' + state.rag.appId)).publishedVersionId; assert.ok(state.ragPublished); save();
  }
  if (classified) {
    const published = await api('/api/core/app/version/detail?appId=' + state.rag.appId + '&versionId=' + state.ragPublished);
    assert.equal(published.nodes.length, workflow.nodes.length);
    for (const id of ['classify', 'query', 'enterprise', 'sources', 'dialogue']) {
      const expected = workflow.nodes.find((n: any) => n.nodeId === id)!;
      const actual = published.nodes.find((n: any) => n.nodeId === id); assert.ok(actual);
      for (const input of expected.inputs) {
        const found = actual.inputs.find((i: any) => i.key === input.key); assert.ok(found);
        // Native detail rewriting clears the legacy vectorModel.model display
        // alias; immutable dataset/model IDs are the executed references.
        const value = (v: any) => input.key === 'datasets' ? v.map((d: any) => ({ datasetId: d.datasetId, modelId: d.vectorModel.modelId })) : v;
        assert.deepEqual(value(found.value), value(input.value), `Published ${id}.${input.key} must match the requested graph`);
        assert.equal(found.selectedType ?? found.renderTypeList[0], input.selectedType ?? input.renderTypeList[0]);
      }
    }
    fs.writeFileSync(path.join(out, 'published-check.json'), JSON.stringify({ versionId: state.ragPublished,
      requestedWorkflowHash: hash, nodes: published.nodes.length, verifiedInputs: true, at: new Date().toISOString() }, null, 2));
  }
  const prior = read('tmp/xiaok-fastgpt-rag-session-20261107/preparation.json');
  fs.writeFileSync(path.join(out, 'preparation.json'), JSON.stringify({...prior, model, appId: state.rag.appId, channelId: state.ragChannelId, modelId: state.ragModelId, workflowHash: hash, mode: 'unified', noAnswerCalls: true}, null, 2));
  console.log(JSON.stringify({prepared: true, appId: state.rag.appId, sourceCount: state.rag.sources.length, answerCalls: 0}));
} finally { if (tunnel) tunnel.kill(); if (release) await release(); await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); }
