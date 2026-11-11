import test from 'node:test';
import assert from 'node:assert/strict';
import { composeNativeDelivery, nativeCitationFeedback, nativeExecutorPrompt, recoveredDialogueToolState, xiaokNativeExecutorProtocol } from '../agent/native-executor';
import { nativeAgentRuntimeBinding } from '../fastgpt/agent-v2/config';
import { recoverableUnavailableRead, runRenovationAgent, type AgentRuntimePorts } from '../agent/runtime';
import { modelBusinessReceipt } from '../agent/dialogue-tools';
import { webCitations } from '../agent/dialogue-web-tools';
import { webSynthesisSources } from '../agent/web-evidence';
import { AssistantError, type Evidence } from '../contracts';
import { ragAnswerParts, type RagCitationSource } from '../fastgpt/native-rag';
import type { ModelTool, ModelTurnOutput } from '../contracts/model';

type Code = { code?: string };
const invalidCheckpoint = (error: Code) => error.code === 'invalid_agent_checkpoint';
const readTools: ModelTool[] = [
  { name: 'query_business', description: '', parameters: {} },
  { name: 'final_response', description: '', parameters: {} },
];

test('knowledge retrieval without a model citation fails closed', () => {
  assert.throws(() => composeNativeDelivery('先排版再铺贴。', '', 0, true), (error: Code) => error.code === 'missing_citation');
  assert.throws(() => composeNativeDelivery('先排版再铺贴。', '', 0, false, true), (error: Code) => error.code === 'missing_citation');
  // The same text with its citation marker present is deliverable.
  assert.equal(composeNativeDelivery('先排版再铺贴[15](CITE)。', '', 1, true).modelIncluded, true);
});

test('an uncited explanation now accompanies an authoritative snapshot when nothing was retrieved', () => {
  // P1 delivery change: the FastGPT V2 discard rule retires with the bridge.
  const composed = composeNativeDelivery('您家的施工记录里写着当前在软装阶段。', '项目记录快照内容', 0, false);
  assert.equal(composed.modelIncluded, true);
  assert.match(composed.text, /您家的施工记录里写着当前在软装阶段。/);
  assert.match(composed.text, /项目记录（授权快照，以此为准）\n项目记录快照内容$/);
  // Retrieved-but-uncited knowledge still cannot ride along with a snapshot.
  assert.equal(composeNativeDelivery('先排版再铺贴。', '项目记录快照内容', 0, true).modelIncluded, false);
  assert.equal(composeNativeDelivery('', '项目记录快照内容', 0, false).modelIncluded, false);
});

test('a commitment-violating draft falls back to the snapshot section only', () => {
  assert.equal(composeNativeDelivery('您家已经验收完成了。', '项目记录快照内容', 0, false).modelIncluded, false);
  // Without a snapshot the violated draft has nothing authoritative to fall
  // back to; the run fails closed exactly like the FastGPT V2 path.
  assert.throws(() => composeNativeDelivery('您家已经验收完成了。', '', 0, false),
    (error: Code) => error.code === 'unsupported_model_commitment');
  assert.throws(() => composeNativeDelivery('这个价格我保证不超过五万元。', '', 0, false),
    (error: Code) => error.code === 'unsupported_model_commitment');
});

test('the executor prompt keeps knowledge discipline without the knowledge switch', () => {
  assert.match(nativeExecutorPrompt(true), /search_enterprise/);
  assert.doesNotMatch(nativeExecutorPrompt(true), /\[id\]\(CITE\)/);
  assert.match(nativeExecutorPrompt(true), /本轮没有任何cites时不得输出任何 CITE 引用标记/);
  const off = nativeExecutorPrompt(false);
  assert.doesNotMatch(off, /search_enterprise检索获权资料/);
  assert.match(off, /不声称检索过企业资料/);
  assert.match(nativeExecutorPrompt(false), /query_business/);
});

test('the runtime read registry covers the V2 tool names for unavailable-read recovery', () => {
  const calls = (name: string, id: string, args = '{}'): ModelTurnOutput =>
    ({ text: '', toolCalls: [{ id, name, arguments: args }], finishReason: 'tool_calls', providerRequestId: null, usage: null });
  // A batch mixing one active read with the unregistered V2 name stays
  // recoverable instead of instantly poisoning the run.
  assert.equal(recoverableUnavailableRead(calls('search_enterprise', 'a'), readTools), true);
  assert.equal(recoverableUnavailableRead(calls('recommend_public_sites', 'a'), readTools), true);
  // A write outside the read family is never recoverable.
  assert.equal(recoverableUnavailableRead(calls('record_need', 'a'), readTools), false);
});

test('the native binding only selects the langgraph-v1 executor switch', () => {
  // Without a workflows file nothing is bound; the executor cannot silently start.
  const previous = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  delete process.env.XIAOK_FASTGPT_WORKFLOWS_FILE;
  try {
    assert.equal(nativeAgentRuntimeBinding('1454'), undefined);
  } finally {
    if (previous !== undefined) process.env.XIAOK_FASTGPT_WORKFLOWS_FILE = previous;
  }
  assert.equal(xiaokNativeExecutorProtocol, 'xiaok-native-executor-v1');
});

test('the saved 3413 first draft reproduces: with no cites the repair must ask for marker removal', () => {
  // run3413 answered a business-snapshot question, retrieved no knowledge, and
  // copied the prompt's literal placeholder marker four times. The old repair
  // asked it to "reuse the original id", so it repeated the identical draft and
  // the run failed closed. Feedback now follows the draft's actual markers; the
  // empty catalog still forbids every marker because there is nothing to cite.
  const placeholder = '记录显示当前在软装阶段[id](CITE)。';
  assert.doesNotMatch(nativeCitationFeedback(placeholder, []), /\[id\]\(CITE\)/);
  assert.match(nativeCitationFeedback(placeholder, []), /没有返回任何可引用来源/);
  assert.match(nativeCitationFeedback(placeholder, []), /删除全部 CITE 标记/);
  assert.match(nativeCitationFeedback(placeholder, []), /业务 resultKey/);
  // With a real issued source the same placeholder is an invalid marker: the
  // repair must cite the issued id instead of deleting every marker.
  const source: RagCitationSource = { nativeId: 'K2511', sourceId: 'K2511', quote: '原文',
    evidence: { ref: { id: '2511', type: 'knowledge_chunk' }, text: '原文', hash: 'h2511' }, origin: 'current' };
  assert.match(nativeCitationFeedback(placeholder, [source]), /id 不是本轮任何工具返回的 cites\[\]\.id|不是引用 id/);
  assert.match(nativeCitationFeedback(placeholder, [source]), /不得删除全部 CITE 标记/);
  assert.throws(() => ragAnswerParts('记录显示当前在软装阶段[id](CITE)。', []),
    (error: Code) => error.code === 'invalid_model_citation');
});

test('the saved 3026/3027 first drafts reproduce: a prefix-stripped citation id fails closed at parse', () => {
  // Offline reproduction of the retained first-draft failures: the tool receipt
  // issued K-prefixed ids, the model echoed the raw chunk id, and the strict
  // parser rejected it. The mechanism answer is the existing one-shot repair
  // turn, never an auto-prefixed or accepted unknown id.
  const evidence = { ref: { id: '2828', type: 'knowledge_chunk' }, text: '所有瓷砖铺贴要求横平竖直。', hash: 'h1' };
  const catalog = [{ nativeId: 'K2828', sourceId: 'K2828', quote: evidence.text, evidence }];
  assert.throws(() => ragAnswerParts('铺贴要求横平竖直[2828](CITE)。', catalog),
    (error: Code) => error.code === 'invalid_model_citation');
  assert.doesNotThrow(() => ragAnswerParts('铺贴要求横平竖直[K2828](CITE)。', catalog));
  // The repaired drafts of today's journeys emit tokenizer noise inside the
  // brackets: the same issued id with a leading space resolves, an unknown id
  // with trailing whitespace still fails closed.
  assert.doesNotThrow(() => ragAnswerParts('蓄水深度不低于20毫米[ K2828](CITE)。', catalog));
  assert.throws(() => ragAnswerParts('铺贴要求横平竖直[K9999 ](CITE)。', catalog),
    (error: Code) => error.code === 'invalid_model_citation');
  // An id that was never issued still fails closed after the repair turn.
  assert.throws(() => ragAnswerParts('铺贴要求横平竖直[K9999](CITE)。', catalog),
    (error: Code) => error.code === 'invalid_model_citation');
});

test('recovered tool state reuses persisted receipts and allocates fresh sequences', () => {
  const state = recoveredDialogueToolState(
    [{ step_seq: 1301, input_summary: { query: '防水闭水试验', receipt: { status: 'ready', kind: 'enterprise', cites: [1] } } }],
    [{ step_seq: 1402, input_summary: { key: 'construction:3132', receipt: { status: 'ready', text: '快照' } } }]);
  assert.equal(state.nextSequence, 3);
  assert.equal(state.searches.get('防水闭水试验')?.status, 'ready');
  assert.equal(state.businesses.get('construction:3132')?.status, 'ready');
  // Receipts recorded before the recovery format are not reconstructable:
  // fail closed instead of re-dispatching a metered call.
  assert.throws(() => recoveredDialogueToolState([{ step_seq: 1301, input_summary: { query: 'q' } }], []), invalidCheckpoint);
  // Duplicate identities and unknown step ranges cannot be recovered either.
  assert.throws(() => recoveredDialogueToolState([
    { step_seq: 1301, input_summary: { query: 'q', receipt: { status: 'empty' } } },
    { step_seq: 1302, input_summary: { query: 'q', receipt: { status: 'empty' } } }], []), invalidCheckpoint);
  assert.throws(() => recoveredDialogueToolState([{ step_seq: 1501, input_summary: { query: 'q', receipt: {} } }], []), invalidCheckpoint);
  // An empty run starts the shared counter from the beginning.
  assert.equal(recoveredDialogueToolState([], []).nextSequence, 0);
});

test('recovery covers the 1200 web band by the model\'s own call arguments', () => {
  const searchReceipt = { status: 'ready', failures: [], candidates: [{ id: 'P5:1200:0', url: 'https://example.com', title: 't', parent: null, depth: 0 }],
    documents: [], instructions: 'i' };
  const readReceipt = { status: 'ready', failures: [], documents: [{ title: 't', url: 'https://example.com', text: '原文' }], instructions: 'i' };
  const state = recoveredDialogueToolState([], [], [
    { step_seq: 1200, capability_name: 'web.search.v1', input_summary: { tool: 'search_web', rawQuery: '地暖 安装手册', queryHash: 'q1', receipt: searchReceipt } },
    { step_seq: 1201, capability_name: 'web.read.v1', input_summary: { tool: 'read_web', candidateId: 'P5:1200:0', queryHash: 'q2', receipt: readReceipt } },
  ]);
  assert.deepEqual(state.webs.get('search:地暖 安装手册'), searchReceipt);
  assert.deepEqual(state.webs.get('read:P5:1200:0'), readReceipt);
  // Fresh calls continue after step 1201 in every band: a new web call takes
  // 1202, so a recovered run can never collide with a persisted step_seq.
  assert.equal(state.nextSequence, 2);
  // A step without its receipt, an unknown tool tag or a duplicate identity
  // fails closed exactly like the 1300/1400 bands.
  assert.throws(() => recoveredDialogueToolState([], [], [
    { step_seq: 1200, capability_name: 'web.search.v1', input_summary: { tool: 'search_web' } }]), invalidCheckpoint);
  assert.throws(() => recoveredDialogueToolState([], [], [
    { step_seq: 1200, capability_name: 'web.search.v1', input_summary: { tool: 'other', rawQuery: 'q', receipt: searchReceipt } }]), invalidCheckpoint);
  assert.throws(() => recoveredDialogueToolState([], [], [
    { step_seq: 1200, capability_name: 'web.search.v1', input_summary: { tool: 'search_web', rawQuery: 'q', receipt: searchReceipt } },
    { step_seq: 1201, capability_name: 'web.search.v1', input_summary: { tool: 'search_web', rawQuery: 'q', receipt: searchReceipt } }]), invalidCheckpoint);
  // Receipts written before rawQuery existed cannot reconstruct the model's own
  // argument: fail closed instead of guessing from the normalized WebQuery.
  assert.throws(() => recoveredDialogueToolState([], [], [
    { step_seq: 1200, capability_name: 'web.search.v1',
      input_summary: { tool: 'search_web', query: { query: 'q', domains: [] }, queryHash: 'q', receipt: searchReceipt } }]), invalidCheckpoint);
});

test('recovery covers recall_history steps and the fixed 2000/2010 receipts', () => {
  const historyReceipt = { query: '书房 书桌', beforeSeq: '30', sources: [{ messageId: '11', hash: 'h11', memoryVersion: 3, text: '原话', seq: '5' }],
    hasMore: false, oversized: false, exhausted: false, instructions: 'i' };
  const state = recoveredDialogueToolState([], [], [], [
    { step_seq: 1502, capability_name: 'recall_history', input_summary: { tool: 'recall_history', query: '书房 书桌', beforeSeq: '30',
      count: 1, hasMore: false, oversized: false, receipt: historyReceipt } },
  ], [
    { step_seq: 2000, kind: 'agent_designer_result', input_summary: { protocol: 'p', tool: 'recommend_designers', count: 2, receipt: { status: 'ready', tool: 'recommend_designers', text: 't' } } },
    { step_seq: 2010, kind: 'agent_public_sites', input_summary: { protocol: 'p', tool: 'recommend_public_sites', count: 0, receipt: { status: 'empty', tool: 'recommend_public_sites', text: '空' } } },
  ]);
  assert.deepEqual(state.histories.get('书房 书桌'), historyReceipt);
  assert.equal(state.designers?.status, 'ready');
  assert.equal(state.publicSites?.status, 'empty');
  // recall_history with an empty source list stays recoverable (exhausted is a
  // complete honest answer), and the counter continues past step 1502.
  assert.equal(state.nextSequence, 3);
  // A history receipt without its snapshot shape, or a fixed step without its
  // receipt, cannot be reconstructed.
  assert.throws(() => recoveredDialogueToolState([], [], [], [
    { step_seq: 1502, capability_name: 'recall_history', input_summary: { query: 'q', receipt: { status: 'ready' } } }]), invalidCheckpoint);
  assert.throws(() => recoveredDialogueToolState([], [], [], [], [
    { step_seq: 2000, kind: 'agent_designer_result', input_summary: { count: 2 } }]), invalidCheckpoint);
  // A need_region result never persisted a step, so nothing is recovered for it.
  assert.equal(recoveredDialogueToolState([], [], [], [], []).publicSites, undefined);
});

/** run3566's sanitized business snapshot version. The model copied it as a
 * CITE id after query_business; it is a server version hash, never an issued
 * citation id. */
const run3566ResultKey = 'e32ca7c3965654ea4445e51cc64646d6ac8f7ce5698eb6b60e6f4270b625fa4e';
const knowledgeSource = (chunkId: string, origin: RagCitationSource['origin'], text = '墙面基层处理应先清理浮灰再涂刷界面剂。'): RagCitationSource => ({
  nativeId: 'K' + chunkId, sourceId: 'K' + chunkId, quote: text,
  evidence: { ref: { id: chunkId, type: 'knowledge_chunk' }, text, hash: 'hash-' + chunkId }, origin,
});
const webEvidenceFixture = (): Evidence => {
  const text = '地暖盘管间距应为200毫米，回填前须完成打压试验。';
  return { ref: { type: 'web_page', id: '42:1200:0', version: 'web-hash' }, text, hash: 'web-hash',
    web: { url: 'https://example.com/floor-heating', title: '地暖安装手册', retrievedAt: '2026-11-11T00:00:00.000Z',
      hash: 'web-hash', parser: 'public-html-text-v1', textBytes: Buffer.byteLength(text) } };
};
/** The real runtime graph with the executor's own strict citation gate. The
 * model port replays the retained first draft and one repair draft; no DB or
 * provider is touched. */
function citationGraph(catalog: Map<string, RagCitationSource>, drafts: string[]) {
  const feedback: string[] = [];
  let calls = 0;
  const ports: AgentRuntimePorts = {
    authorize: async () => {},
    model: async turn => {
      calls++;
      return { text: drafts[Math.min(turn, drafts.length - 1)], toolCalls: [],
        finishReason: null, providerRequestId: null, usage: null } as ModelTurnOutput;
    },
    tool: async () => { throw new Error('no tool dispatch expected'); },
    checkpoint: async () => {},
    validateFinal: async text => {
      try { ragAnswerParts(text, [...catalog.values()]); return null; }
      catch (error) {
        if (!(error instanceof AssistantError) || error.code !== 'invalid_model_citation') throw error;
        const message = nativeCitationFeedback(text, catalog.values());
        feedback.push(message);
        return { code: 'invalid_model_citation', feedback: message };
      }
    },
  };
  return {
    run: () => runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '我本人的项目进度怎么样了？' }] }],
      tools: [], ports }),
    feedback, calls: () => calls,
  };
}

test('run3566: with only history sources the business resultKey marker must be removed', async () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2826', knowledgeSource('2826', 'history')]]);
  const graph = citationGraph(catalog, [
    `您本人的项目目前在施工阶段，现场记录已同步[${run3566ResultKey}](CITE)。`,
    '您本人的项目目前在施工阶段，现场记录已同步。',
  ]);
  const result = await graph.run();
  assert.equal(graph.feedback.length, 1);
  assert.match(graph.feedback[0], /没有返回任何可引用来源/);
  assert.match(graph.feedback[0], /业务 resultKey/);
  assert.match(graph.feedback[0], /删除全部 CITE 标记/);
  assert.equal(result.output?.text, '您本人的项目目前在施工阶段，现场记录已同步。');
});

test('run3566: repeating the resultKey marker exhausts the single repair and fails closed', async () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2826', knowledgeSource('2826', 'history')]]);
  const draft = `您本人的项目目前在施工阶段[${run3566ResultKey}](CITE)。`;
  const graph = citationGraph(catalog, [draft, draft]);
  await assert.rejects(graph.run(), (error: Code) => error.code === 'invalid_model_citation');
  assert.equal(graph.calls(), 2, 'only one repair turn is ever dispatched');
});

test('run3566: a valid history citation is kept while the resultKey marker is rejected', async () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2826', knowledgeSource('2826', 'history')]]);
  const graph = citationGraph(catalog, [
    `卫生间墙面先做基层处理[K2826](CITE)；您本人的项目在施工阶段[${run3566ResultKey}](CITE)。`,
    '卫生间墙面先做基层处理[K2826](CITE)；您本人的项目在施工阶段。',
  ]);
  const result = await graph.run();
  assert.equal(graph.feedback.length, 1);
  assert.match(graph.feedback[0], /K2826/);
  assert.match(graph.feedback[0], /必须保留/);
  assert.match(graph.feedback[0], new RegExp(run3566ResultKey));
  assert.match(graph.feedback[0], /删除或改正/);
  assert.match(result.output?.text ?? '', /\[K2826\]\(CITE\)/);
  assert.equal((result.output?.text ?? '').includes(run3566ResultKey), false);
});

test('resume: recovered knowledge and web sources enter the catalog and stay citable', async () => {
  const catalog = new Map<string, RagCitationSource>([['K2511', knowledgeSource('2511', 'recovered')]]);
  const cites = webCitations(catalog, webSynthesisSources([webEvidenceFixture()]), 'recovered');
  assert.equal(catalog.get('K2511')?.origin, 'recovered');
  assert.equal(cites.length, 1);
  assert.equal(catalog.get(cites[0].id)?.origin, 'recovered');
  const draft = `地暖盘管间距按原文执行[${cites[0].id}](CITE)，企业工艺同样要求基层处理[K2511](CITE)。`;
  const graph = citationGraph(catalog, [draft]);
  const result = await graph.run();
  assert.equal(graph.feedback.length, 0);
  assert.equal(result.output?.text, draft);
});

test('current-run sources: deleting every marker cannot bypass the missing-citation rule', async () => {
  const catalog = new Map<string, RagCitationSource>([['K2511', knowledgeSource('2511', 'current')]]);
  const graph = citationGraph(catalog, [
    `基层处理按企业工艺执行[${run3566ResultKey}](CITE)。`,
    '基层处理按企业工艺执行。',
  ]);
  const result = await graph.run();
  assert.equal(graph.feedback.length, 1);
  assert.match(graph.feedback[0], /本轮工具已返回可引用来源/);
  assert.match(graph.feedback[0], /不得删除全部 CITE 标记/);
  // The repaired draft passes marker validation, but delivery still refuses to
  // present it as a cited knowledge answer: snapshot fallback or fail closed.
  assert.throws(() => composeNativeDelivery(result.output!.text, '', 0, true),
    (error: Code) => error.code === 'missing_citation');
  assert.equal(composeNativeDelivery(result.output!.text, '项目记录快照内容', 0, true).modelIncluded, false);
});

test('the model sees only status/text for business snapshots, while recovery keeps the full resultKey', () => {
  const receipt = { status: 'ready', resultKey: run3566ResultKey, text: '您的项目目前在施工阶段。' };
  assert.deepEqual(modelBusinessReceipt(receipt), { status: 'ready', text: '您的项目目前在施工阶段。' });
  assert.equal(JSON.stringify(modelBusinessReceipt(receipt)).includes(run3566ResultKey), false);
  const state = recoveredDialogueToolState([], [
    { step_seq: 1401, input_summary: { key: 'construction:', receipt } }]);
  // Recovery re-serves the persisted receipt verbatim, resultKey included, for
  // the server-side snapshot version revalidation.
  assert.deepEqual(state.businesses.get('construction:'), receipt);
});
