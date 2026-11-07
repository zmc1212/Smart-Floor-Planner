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
const root = path.resolve('..'), out = path.join(root, 'tmp/xiaok-fastgpt-unified-20261107', ...(process.argv.includes('--plus') ? ['plus'] : []));
fs.mkdirSync(out, { recursive: true });
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const original = read('tmp/xiaok-fastgpt-rag-session-20261107/runtime.private.json');
const file = path.join(out, 'runtime.private.json'), state: any = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
  ...original, auditFile: path.join(out, 'workflow-attempts.jsonl'), ragChannelId: undefined, ragModelId: undefined, ragWorkflowHash: undefined, ragPublished: undefined,
  rag: {...original.rag, model, mode: 'unified', appId: undefined, bridgeKey: randomBytes(32).toString('hex'), transportModel: 'sfp-unified-' + model.replaceAll('.', '')},
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
  const { unifiedTools } = require(path.resolve('src/lib/assistant/fastgpt/unified-tools.ts'));
  const workflow = unifiedWorkflow(state.ragModelId, unifiedTools);
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
  const prior = read('tmp/xiaok-fastgpt-rag-session-20261107/preparation.json');
  fs.writeFileSync(path.join(out, 'preparation.json'), JSON.stringify({...prior, model, appId: state.rag.appId, channelId: state.ragChannelId, modelId: state.ragModelId, workflowHash: hash, mode: 'unified', noAnswerCalls: true}, null, 2));
  console.log(JSON.stringify({prepared: true, appId: state.rag.appId, sourceCount: state.rag.sources.length, answerCalls: 0}));
} finally { if (tunnel) tunnel.kill(); if (release) await release(); await require(path.resolve('src/lib/postgresql.ts')).closePostgresPool(); }
