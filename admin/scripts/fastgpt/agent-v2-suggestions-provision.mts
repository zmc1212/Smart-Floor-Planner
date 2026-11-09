/* eslint-disable @typescript-eslint/no-explicit-any -- Isolated development provisioning. */
import fs from 'node:fs';
import path from 'node:path';

const apply = process.argv.includes('--apply');
const f1 = path.resolve('../tmp/xiaok-fastgpt-agentv2-f1-20261109/runtime.private.json');
const f0StateFile = path.resolve('../tmp/xiaok-fastgpt-agentv2-f0-20261109/state.private.json');
const out = path.resolve('../tmp/xiaok-fastgpt-agentv2-f2-20261109');
fs.mkdirSync(out, { recursive: true });
const stateFile = path.join(out, 'state.private.json');
const state: any = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};

const f1Runtime = JSON.parse(fs.readFileSync(f1, 'utf8'));
const f0State = JSON.parse(fs.readFileSync(f0StateFile, 'utf8'));
const management = JSON.parse(fs.readFileSync(path.resolve('../tmp/xiaok-fastgpt-rag-session-20261107/runtime.private.json'), 'utf8'));
const apiKey = f1Runtime.apiKey, cookie = management.managementCookie;
const secrets = [apiKey, cookie];
const redact = (text: string) => secrets.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), String(text));

const api = async (endpoint: string, method = 'GET', body?: unknown) => {
  const response = await fetch(f1Runtime.baseUrl + endpoint, {
    method, signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey, Cookie: cookie, 'fastgpt-web-request': '1' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let packet: any;
  try { packet = JSON.parse(text); } catch { packet = { raw: text.slice(0, 300) }; }
  if (!response.ok || (packet.code && packet.code !== 200)) {
    throw Error(redact(`${method} ${endpoint} -> HTTP ${response.status} code=${packet.code} message=${String(packet.message || packet.raw || '').slice(0, 300)}`));
  }
  return packet.data ?? packet;
};

const label = '开发·小K Agent V2·猜你想问·20261109';
const modelName = f1Runtime.agentV2.model;
const suggestionPrompt = `你是装修咨询的追问生成器。用户会给你一段小K刚刚给客户的回答。请只生成3条客户接下来最可能问的问题。每行一条，不加序号、引号、解释或前缀。每条不超过30个字。问题必须与回答内容或装修服务直接相关，不要承诺优惠、报价、工期或企业内部信息。不要输出其他内容。`;

if (!apply) {
  console.log(JSON.stringify({ mode: 'dry-run', label, model: modelName, hasApp: Boolean(state.appId),
    runtimeFile: path.join(out, 'runtime.private.json') }, null, 2));
  process.exit(0);
}

const templateDetail = JSON.parse(fs.readFileSync(path.resolve('tmp/agentv2-test-detail.json'), 'utf8')).data;
const nodes = JSON.parse(JSON.stringify(templateDetail.nodes));
const edges = JSON.parse(JSON.stringify(templateDetail.edges));
const agentNode = nodes.find((node: any) => node.flowNodeType === 'agent');
if (!agentNode) throw Error('Agent template node missing');
const setValue = (key: string, value: unknown) => {
  const input = agentNode.inputs.find((item: any) => item.key === key);
  if (input) input.value = value;
};
setValue('modelId', f0State.modelId);
setValue('systemPrompt', suggestionPrompt);
setValue('agent_selectedTools', []);
const datasetParam = agentNode.inputs.find((item: any) => item.key === 'agent_datasetParams');
if (datasetParam) datasetParam.value = { ...datasetParam.value, datasets: [] };

const chatConfig = {
  variables: [],
  autoExecute: { open: false, defaultPrompt: '' },
  questionGuide: { open: false, customPrompt: '' },
  ttsConfig: { type: 'web' },
  whisperConfig: { open: true, autoSend: false, autoTTSResponse: false },
  chatInputGuide: { open: false, customUrl: '' },
  fileSelectConfig: {
    maxFiles: 10, canSelectFile: true, canSelectImg: false, canSelectVideo: false, canSelectAudio: false,
    canSelectCustomFileExtension: false, customFileExtensionList: [],
  },
  entryPoints: [],
  welcomeText: '猜你想问生成器',
  welcomeConfig: { welcomeText: '猜你想问生成器', welcomeQuestions: [] },
};

if (!state.appId) {
  state.appId = await api('/api/core/app/create', 'POST', {
    name: label, intro: '开发 F2：仅根据本轮回答生成 3 条客户追问，无工具、无数据集、无业务写入。',
    type: 'chatAgent', nodes, edges, chatConfig,
  });
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
}
await api('/api/core/app/version/publish?appId=' + state.appId, 'POST', {
  nodes, edges, chatConfig, isPublish: true, versionName: 'dev-f2-20261109', autoSave: false,
});
const published = await api('/api/core/app/detail?appId=' + state.appId);
const publishedAgent = (published.nodes || []).find((node: any) => node.flowNodeType === 'agent');
const publishedTools = ((publishedAgent?.inputs || []).find((input: any) => input.key === 'agent_selectedTools')?.value || []);
if (publishedTools.length) throw Error('Suggestion app must carry no tools: ' + JSON.stringify(publishedTools));

const runtimeFile = path.join(out, 'runtime.private.json');
fs.writeFileSync(runtimeFile, JSON.stringify({
  ...f1Runtime,
  auditFile: path.join(out, 'agent-v2-audit.jsonl'),
  agentV2: {
    ...f1Runtime.agentV2,
    welcome: '想先聊点什么？',
    presets: ['旧房改造从哪里开始？', '装修风格怎么选？', '预算怎么安排？'],
    suggestionAppId: state.appId,
  },
}, null, 2));
state.published = true;
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

console.log(JSON.stringify({
  applied: true, appId: state.appId, model: modelName, selectedTools: publishedTools.length,
  runtimeFile, welcome: true, presets: 3, preserved: ['f0 evidence', 'f1 evidence'],
}, null, 2));
