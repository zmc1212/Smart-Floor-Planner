/* eslint-disable @typescript-eslint/no-explicit-any -- Private vendor configuration adapter. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { nativeKnowledgeWorkflow } from './native-knowledge-workflow.mjs';
const require = createRequire(import.meta.url);
require('@next/env').loadEnvConfig(process.cwd(), true);
const root = path.resolve('..'), out = path.join(root, 'tmp/fastgpt-native-qa-20261106');
fs.mkdirSync(out, { recursive: true });
const original = JSON.parse(fs.readFileSync(path.join(root, 'tmp/fastgpt-report-pilot-20261106/fastgpt.private.json'), 'utf8'));
const old = JSON.parse(fs.readFileSync(path.join(root, 'tmp/fastgpt-capabilities-20261106/runtime.private.json'), 'utf8'));
const requestedModel = process.argv.find(a => a.startsWith('--model='))?.slice(8) || original.model;
if (!['qwen3.7-flash', 'deepseek-v4.1-flash-1017', 'deepseek-v4.1-flash'].includes(requestedModel)) throw Error('Use only the fixed original or user-requested model');
const suffix = requestedModel === 'qwen3.7-flash' ? '' : requestedModel === 'deepseek-v4.1-flash' ? '-deepseek-mainline' : '-deepseek';
const priorNative = JSON.parse(fs.readFileSync(path.join(out, 'runtime.private.json'), 'utf8'));
const file = path.join(out, 'runtime' + suffix + '.private.json');
const state: any = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
  ...old, managementCookie: priorNative.managementCookie, nativeModel: requestedModel, nativeBridgeKey: randomBytes(32).toString('hex'), auditFile: path.join(out, 'workflow-attempts.jsonl'),
};
const save = () => { fs.writeFileSync(file, JSON.stringify(state, null, 2));
  execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', 'Administrator:F', 'SYSTEM:F'], { windowsHide: true, stdio: 'ignore' }); };
save();
async function api(url: string, method: string, body: unknown) {
  const response = await fetch(state.baseUrl + url, { method, signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + state.apiKey, 'fastgpt-web-request': '1',
      ...(state.managementCookie || original.cookie ? { Cookie: state.managementCookie || original.cookie } : {}) }, body: JSON.stringify(body) });
  const packet = await response.json();
  if (!response.ok || packet.code !== 200) fs.writeFileSync(path.join(out, 'setup-last-rejection.json'), JSON.stringify(packet, null, 2));
  fs.appendFileSync(path.join(out, 'setup-attempts.jsonl'), JSON.stringify({ url, status: response.status, code: packet.code, at: new Date().toISOString() }) + '\n');
  if (!response.ok || packet.code !== 200) throw Error('Private pilot setup ' + url + ': HTTP' + response.status + ' code=' + packet.code);
  return packet.data;
}
try {
  if (state.nativeModel !== requestedModel) throw Error('Keep the configured comparison model fixed');
  const transportModel = 'sfp-native-qa-' + requestedModel;
  if (!state.nativeChannelId) { state.nativeChannelId = (await api('/api/core/ai/model/channel/create', 'POST', {
    channelType: 'system', name: '小K原生问答 · ' + requestedModel, type: 1, key: state.nativeBridgeKey,
    base_url: 'http://host.docker.internal:18310/native-model/v1', models: [transportModel], status: 1, priority: 1,
  })).id; save(); }
  if (state.nativeTransportModel !== transportModel) {
    await api('/api/core/ai/model/channel/update', 'PUT', { channelType: 'system', id: state.nativeChannelId, models: [transportModel] });
    state.nativeTransportModel = transportModel; save();
  }
  if (!state.nativeModelId) { state.nativeModelId = (await api('/api/core/ai/model/create', 'POST', {
    channelType: 'system', channelIds: [state.nativeChannelId], modelData: { scope: 'system', type: 'llm', provider: 'Other',
      model: transportModel, name: '小K原生问答 · ' + state.nativeModel, isActive: true,
      config: { maxContext: 16000, maxResponse: 2048, quoteMaxToken: 8000, maxTemperature: 1, toolChoice: true,
        vision: false, responseFormatList: ['text', 'json_object'], defaultConfig: { enable_thinking: false } } },
  })).modelId; save(); }
  const { finalTool } = await import('../../src/lib/assistant/agent/worker');
  const { publicResearchTools } = await import('../../src/lib/assistant/agent/public-research');
  const { webSearchTool } = await import('../../src/lib/assistant/agent/web');
  const { businessToolDefinitions } = await import('../../src/lib/assistant/agent/business-tools');
  const { historyTool } = await import('../../src/lib/assistant/agent/history');
  const { nativeFinalDefinition } = await import('../../src/lib/assistant/agent/native-final');
  const tools = [historyTool, ...businessToolDefinitions.filter(t => t.name === 'query_business'),
    ...publicResearchTools([webSearchTool], true, true), nativeFinalDefinition(finalTool, { quantityValidation: 'application', taggedFields: true })];
  const workflow = nativeKnowledgeWorkflow(state.nativeModelId, tools);
  if (requestedModel !== 'qwen3.7-flash') workflow.name += ' · ' + requestedModel;
  state.nativeNodeCount = workflow.nodes.length;
  const hash = createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
  fs.writeFileSync(path.join(out, 'workflow' + suffix + '.json'), JSON.stringify(workflow, null, 2));
  if (!state.nativeKnowledgeAppId) { state.nativeKnowledgeAppId = await api('/api/core/app/create', 'POST', workflow); state.nativeWorkflowHash = hash; save(); }
  if (state.nativeWorkflowHash !== hash) throw Error('Published pilot definition changed; bind an explicit new version before testing');
  fs.writeFileSync(path.join(out, 'platform' + suffix + '.json'), JSON.stringify({ appId: state.nativeKnowledgeAppId, modelId: state.nativeModelId,
    model: state.nativeModel, workflowHash: hash, nodes: workflow.nodes.map(n => ({ id: n.nodeId, type: n.flowNodeType })),
    controller: 'FastGPT native ToolCall shared agentLoop', originalAgentLoop: false, enterpriseKnowledge: false }, null, 2));
  console.log(JSON.stringify({ configured: true, appId: state.nativeKnowledgeAppId, model: state.nativeModel, nodes: workflow.nodes.length, providerCalls: 0 }));
} catch (error) {
  let text = String(error); for (const value of [state.apiKey, state.nativeBridgeKey, original.cookie, state.managementCookie]) if (value) text = text.replaceAll(value, '[redacted]');
  console.error(text); process.exitCode = 1;
} finally { const { closePostgresPool } = await import('../../src/lib/postgresql'); await closePostgresPool(); }
