import test from 'node:test';
import assert from 'node:assert/strict';
import { assessNativeCitations, nativeCitationFeedback, nativeCitationGate } from '../agent/native-citation-gate';
import { composeNativeDelivery, scanNativeCitationMarkers } from '../agent/native-executor';
import { webCitations } from '../agent/dialogue-web-tools';
import { webEvidence, webSynthesisSources } from '../agent/web-evidence';
import { runRenovationAgent, type AgentRuntimePorts } from '../agent/runtime';
import { fingerprint } from '../contracts';
import type { RagCitationSource } from '../fastgpt/native-rag';
import type { WebSearchSnapshot } from '../agent/web';
import type { ModelTurnOutput } from '../contracts/model';

type Code = { code?: string };
const knowledgeSource = (chunkId: string, origin?: RagCitationSource['origin']): RagCitationSource => ({
  nativeId: 'K' + chunkId, sourceId: 'K' + chunkId, quote: '墙面基层处理应先清理浮灰再涂刷界面剂。',
  evidence: { ref: { id: chunkId, type: 'knowledge_chunk' }, text: '墙面基层处理应先清理浮灰再涂刷界面剂。', hash: 'hash-' + chunkId },
  ...(origin ? { origin } : {}),
});
/** The exact sanitized snapshot version hash run3566 copied into a marker. */
const run3566ResultKey = 'e32ca7c3965654ea4445e51cc64646d6ac8f7ce5698eb6b60e6f4270b625fa4e';
/** The real graph with the executor's citation gate; the model port replays
 * one first draft and one repair draft, no DB or provider is touched. */
function gatedGraph(catalog: Map<string, RagCitationSource>, drafts: string[]) {
  const issues: Array<{ code: string; feedback: string }> = [];
  let repairIssued = false, calls = 0;
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
      const { issue } = nativeCitationGate(text, catalog.values(), repairIssued);
      if (issue) { repairIssued = true; issues.push(issue); }
      return issue;
    },
  };
  return {
    run: () => runRenovationAgent({ messages: [{ role: 'user', content: [{ type: 'text', text: '卫生间墙面怎么处理？' }] }],
      tools: [], ports }),
    issues, calls: () => calls,
  };
}

test('a history-only draft gets exactly one repair and passes once it cites this run\'s source', async () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2511', knowledgeSource('2511', 'current')]]);
  const repaired = '卫生间墙面先清理浮灰再涂刷界面剂[K2511](CITE)。';
  const graph = gatedGraph(catalog, ['卫生间墙面先清理浮灰再涂刷界面剂[K7](CITE)。', repaired]);
  const result = await graph.run();
  assert.deepEqual(graph.issues.map(issue => issue.code), ['missing_citation']);
  // History ids are named as insufficient, and the feedback never shows a
  // copyable placeholder marker the model could paste back.
  assert.match(graph.issues[0].feedback, /K7 是历史对话里的引用/);
  assert.match(graph.issues[0].feedback, /K2511/);
  assert.match(graph.issues[0].feedback, /cites\[\]\.id/);
  assert.doesNotMatch(graph.issues[0].feedback, /\[[^\]]+\]\(CITE\)/);
  assert.equal(graph.calls(), 2, 'only one repair turn is ever dispatched');
  assert.equal(result.output?.text, repaired);
  // Delivery uses the same assessment: one current-run citation is enough.
  const assessment = assessNativeCitations(result.output!.text, catalog.values());
  assert.equal(assessment.runCitations, 1);
  assert.equal(assessment.runSources, 1);
  assert.deepEqual(assessment.validRun, ['K2511']);
  assert.equal(assessment.parts?.length, 2);
  assert.equal(composeNativeDelivery(result.output!.text, '', assessment.runCitations, true).modelIncluded, true);
});

test('a repair that still cites only history is silent on the second pass and delivery applies its own rule', async () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2511', knowledgeSource('2511', 'current')]]);
  const draft = '卫生间墙面先清理浮灰再涂刷界面剂[K7](CITE)。';
  const graph = gatedGraph(catalog, [draft, draft]);
  const result = await graph.run();
  // The single repair was already issued; no second issue and no extra model call.
  assert.equal(graph.issues.length, 1);
  assert.equal(graph.calls(), 2);
  assert.equal(result.output?.text, draft);
  const assessment = assessNativeCitations(draft, catalog.values());
  assert.equal(assessment.runCitations, 0);
  assert.throws(() => composeNativeDelivery(result.output!.text, '', assessment.runCitations, true),
    (error: Code) => error.code === 'missing_citation');
  assert.equal(composeNativeDelivery(result.output!.text, '项目记录快照内容', assessment.runCitations, true).modelIncluded, false);
});

test('recovered sources satisfy the run requirement exactly like current ones', async () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2826', knowledgeSource('2826', 'recovered')]]);
  const cited = '卫生间墙面先清理浮灰再涂刷界面剂[K2826](CITE)。';
  const passing = gatedGraph(catalog, [cited]);
  const result = await passing.run();
  assert.equal(passing.issues.length, 0);
  assert.equal(result.output?.text, cited);
  assert.equal(assessNativeCitations(cited, catalog.values()).runCitations, 1);
  const uncitedDraft = '卫生间墙面先清理浮灰再涂刷界面剂。';
  const uncited = gatedGraph(catalog, [uncitedDraft, uncitedDraft]);
  const uncitedResult = await uncited.run();
  assert.equal(uncited.issues.length, 1);
  assert.equal(uncited.issues[0].code, 'missing_citation');
  assert.match(uncited.issues[0].feedback, /K2826/);
  assert.throws(() => composeNativeDelivery(uncitedResult.output!.text, '', 0, true),
    (error: Code) => error.code === 'missing_citation');
});

test('an uncited business-only answer stays deliverable when this run retrieved no knowledge or web source', async () => {
  const catalog = new Map<string, RagCitationSource>([['K7', knowledgeSource('7', 'history')]]);
  const draft = '您家的项目目前在施工阶段，现场记录已同步。';
  const graph = gatedGraph(catalog, [draft]);
  const result = await graph.run();
  assert.equal(graph.issues.length, 0);
  const assessment = assessNativeCitations(result.output!.text, catalog.values());
  assert.equal(assessment.runSources, 0);
  assert.equal(assessment.runCitations, 0);
  assert.equal(composeNativeDelivery(result.output!.text, '项目记录快照内容', assessment.runCitations, false).modelIncluded, true);
});

test('an invalid business resultKey is never masked by history or current citations', () => {
  const catalog = new Map<string, RagCitationSource>([
    ['K7', knowledgeSource('7', 'history')], ['K2511', knowledgeSource('2511', 'current')]]);
  const draft = `卫生间墙面先清理浮灰[K7](CITE)；企业工艺要求界面剂[K2511](CITE)；项目在施工阶段[${run3566ResultKey}](CITE)。`;
  const { assessment, issue } = nativeCitationGate(draft, catalog.values(), false);
  assert.deepEqual(assessment.invalid, [run3566ResultKey]);
  assert.deepEqual(assessment.validHistory, ['K7']);
  assert.deepEqual(assessment.validRun, ['K2511']);
  assert.equal(assessment.parts, undefined, 'invalid ids are reported instead of parsed away');
  assert.equal(issue?.code, 'invalid_model_citation');
  assert.match(issue!.feedback, new RegExp(run3566ResultKey));
  assert.match(issue!.feedback, /业务 resultKey/);
  assert.match(issue!.feedback, /必须保留/);
  // Without valid markers the same id still fails closed, even beside a
  // current-run source the draft never used.
  const bare = nativeCitationGate(`项目在施工阶段[${run3566ResultKey}](CITE)。`, catalog.values(), false);
  assert.equal(bare.issue?.code, 'invalid_model_citation');
  assert.match(nativeCitationFeedback(`项目在施工阶段[${run3566ResultKey}](CITE)。`, catalog.values()), /不得删除全部 CITE 标记/);
});

test('legacy catalog entries without an origin count as history, not as this run\'s sources', () => {
  const legacy = knowledgeSource('2828');
  const assessment = assessNativeCitations('墙面基层先清理浮灰[K2828](CITE)。', [legacy]);
  assert.deepEqual(assessment.validHistory, ['K2828']);
  assert.deepEqual(assessment.validRun, []);
  assert.equal(assessment.runSources, 0);
  assert.equal(assessment.runCitations, 0);
  // No run sources means no forced citation: the draft passes the gate as-is.
  assert.equal(nativeCitationGate('墙面基层先清理浮灰[K2828](CITE)。', [legacy], false).issue, null);
  assert.deepEqual(scanNativeCitationMarkers('墙面基层先清理浮灰[K2828](CITE)。', [legacy]),
    { valid: ['K2828'], invalid: [] });
});

/** The real web factory chain for one read page: evidence -> synthesis source
 * -> deterministic citation catalog. No hand-built catalog entry. */
function webRead(text: string, origin: 'current' | 'recovered') {
  const retrievedAt = '2026-11-11T00:00:00.000Z', url = 'https://example.com/manual', title = 'Installation manual';
  const page = { url, title, text, retrievedAt, parser: 'public-html-text-v1' as const,
    textBytes: Buffer.byteLength(text), hash: fingerprint({ url, title, text, retrievedAt }) };
  const snapshot: WebSearchSnapshot = { version: 1, provider: 'test', query: { query: 'installation manual', domains: [] },
    status: 'ready', pages: [page], failures: [], retrievedAt, candidates: [] };
  const evidence = webEvidence(snapshot, '5', 1200), sources = webSynthesisSources(evidence);
  const catalog = new Map<string, RagCitationSource>(), cites = webCitations(catalog, sources, origin);
  return { evidence, sources, catalog, cites };
}

test('a web original with no citable clause still requires a this-run citation after the page was read', () => {
  // Far beyond 400 Latin characters, periods only: no separator the catalog
  // splits on, so every clause exceeds the quotation bound.
  const text = ('The installation manual requires the pressure test to be held for thirty minutes at one and a half times '
    + 'the working pressure before any backfill is allowed and the result must be recorded by the site team. ').repeat(5).trim();
  assert.ok(text.length > 400 && !/[\n。！？；;]/u.test(text));
  for (const origin of ['current', 'recovered'] as const) {
    const { evidence, sources, catalog, cites } = webRead(text, origin);
    assert.equal(evidence.length, 1);
    assert.equal(sources.length, 1);
    assert.equal(catalog.size, 0);
    assert.equal(cites.length, 0);
    // Evidence was handed to the model even though no id exists.
    const draft = '打压试验需按读取到的安装手册执行，具体以现场记录为准。';
    const assessment = assessNativeCitations(draft, catalog.values(), true);
    assert.equal(assessment.runEvidence, true);
    assert.equal(assessment.runSources, 0);
    assert.equal(assessment.runCitations, 0);
    // No repair can ask for an id that was never issued.
    assert.equal(nativeCitationGate(draft, catalog.values(), false, true).issue, null);
    // Delivery fails closed without a snapshot, or uses the snapshot only.
    assert.throws(() => composeNativeDelivery(draft, '', 0, true),
      (error: Code) => error.code === 'missing_citation');
    assert.equal(composeNativeDelivery(draft, '项目记录快照内容', 0, true).modelIncluded, false);
    // History citations remain legal markers but still cannot satisfy the run.
    const history = knowledgeSource('7', 'history');
    const historyDraft = '墙面基层处理见历史记录[K7](CITE)。';
    const gate = nativeCitationGate(historyDraft, [history], false, true);
    assert.equal(gate.issue, null);
    assert.equal(gate.assessment.runEvidence, true);
    assert.equal(gate.assessment.runCitations, 0);
  }
});

test('a short web page still issues a real id, repairs a missing citation and delivers cited prose', () => {
  const text = '地暖盘管间距应为200毫米，回填前须完成打压试验。';
  const { catalog, cites } = webRead(text, 'current');
  assert.equal(cites.length, 1);
  const id = cites[0].id;
  assert.equal(catalog.get(id)?.origin, 'current');
  const uncited = '地暖盘管间距应按原文执行。';
  const issue = nativeCitationGate(uncited, catalog.values(), false, true).issue;
  assert.equal(issue?.code, 'missing_citation');
  assert.match(issue!.feedback, new RegExp(id));
  const cited = `地暖盘管间距按原文执行[${id}](CITE)。`;
  const pass = nativeCitationGate(cited, catalog.values(), false, true);
  assert.equal(pass.issue, null);
  assert.equal(pass.assessment.runCitations, 1);
  assert.equal(composeNativeDelivery(cited, '', pass.assessment.runCitations, true).modelIncluded, true);
  // With no evidence at all the same uncited draft stays a pure business answer.
  assert.equal(composeNativeDelivery(uncited, '项目记录快照内容', 0, false).modelIncluded, true);
});
