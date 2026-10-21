import test from 'node:test';
import assert from 'node:assert/strict';
import type { ModelMessage } from '../contracts/model';
import { fingerprint } from '../contracts';
import { buildAgentContext } from '../agent/context';
import { assertToolPairs } from '../agent/context-budget';
import { modelCitationCatalog } from '../agent/citation-catalog';
import { projectSynthesisPolicy, synthesisQuestionPrefix } from '../agent/model-policy';
import { focusedSynthesisMessages, parseSynthesis, synthesisInstructions, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';
import { resolveSynthesisRepair } from '../agent/synthesis-repair';
import { originalAnswerOnly } from '../agent/read-tool-input';
import { agentToolsForMessage } from '../agent/worker';

const question = '合成点位说明第二节如何区分方案同意和关闭？';
const sources: SynthesisSource[] = [
  { sourceId: 'K-page2', kind: 'knowledge', title: '合成手测点位说明', text: '第二节 状态区别 客户同意某版方案不等于已经落实，也不等于事项关闭或工程验收通过。' },
  { sourceId: 'K-page1', kind: 'knowledge', title: '合成手测点位说明', text: '第一节 点位调整 点位调整需先核对现场尺寸，未核对不能视为已批准。' },
  { sourceId: 'B-project', kind: 'project', title: '本人项目', text: '当前咨询中暂无团队明确回传的节点补充事项或已解决/关闭结果。' },
];
const citation = (source: SynthesisSource) => ({ citationId: modelCitationCatalog(source)[0].citationId });
// Exact text/basis/order of the two retained final drafts, with test-local catalog IDs.
const actualDraft = (tail: string) => JSON.stringify({ kind: 'synthesis', segments: [
  { basis: 'evidence', text: '客户同意某版方案不等于已经落实，也不等于事项关闭或工程验收通过。', citations: [citation(sources[0])] },
  { basis: 'evidence', text: '点位调整需先核对现场尺寸，未核对不能视为已批准。', citations: [citation(sources[1])] },
  { basis: 'uncertainty', text: tail, citations: [] },
] });
const tails = [
  '当前咨询中暂无团队明确回传的节点补充事项或已解决/关闭结果，具体事项状态需查询本咨询的待办事项列表确认。',
  '当前咨询中暂无团队明确回传的节点补充事项或已解决/关闭结果，具体事项状态需查询实时业务记录。',
];

test('original question model context excludes project workflow prompts but mixed saves and application keep them', () => {
  for (const text of [question, '更正：书房改为单人办公。另外，' + question, '请结合我家现场解释《点位说明》。']) {
    const messages = buildAgentContext([{ id: 'old', role: 'user', text: '我家工地到哪个阶段了？' }, { id: 'current', role: 'user', text }], { version: 0, facts: [] });
    const system = JSON.stringify(messages[0]);
    if (text === question) assert.doesNotMatch(system, /施工节点与到场|开轮时客户工作记录|现场落实与正式结束/);
    else assert.match(system, /开轮时客户工作记录/);
    assert.match(JSON.stringify(messages.at(-1)), /current_request/);
    assert.equal(JSON.parse((messages.at(-1)!.content as Array<{ text: string }>)[0].text).text, text);
  }
});

test('separately authorized current human handoff keeps its existing context and gate alongside an original question', () => {
  for (const suffix of ['另外请帮我找设计师。', '同时转人工。', '另外不要找设计师。', '如果找设计师呢？', '原话是“找设计师”。']) {
    const text = question + suffix, enabled = agentToolsForMessage(text, true).some(t => t.name === 'request_designer');
    assert.equal(enabled, suffix === '另外请帮我找设计师。' || suffix === '同时转人工。');
    assert.equal(originalAnswerOnly(text), !enabled);
    if (enabled) assert.match(JSON.stringify(buildAgentContext([{ id: 'current', role: 'user', text }], { version: 0, facts: [] })[0]), /开轮时客户工作记录/);
  }
});

test('original-only model projection preserves all knowledge originals and tool pairs without projecting unrelated project cards', () => {
  const messages = buildAgentContext([{ id: 'current', role: 'user', text: question }], { version: 0, facts: [] });
  const system = messages[0]; assert.equal(system.role, 'system');
  system.content.push({ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) });
  messages.push({ role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: '{"query":"模型自选查询"}' }] },
    { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', evidence: [], unresolvedConflict: true,
      synthesisSources: sources, boundProjectContext: { missing: ['节点事项'], resolution: 'bound' }, instructions: '先用当前实际阶段解释影响。' }) });
  const before = JSON.stringify(messages), view = projectSynthesisPolicy(focusedSynthesisMessages(messages, 'current'));
  assertToolPairs(view); assert.equal(JSON.stringify(messages), before);
  const packet = JSON.parse(view.find(m => m.role === 'tool')!.content as string);
  assert.deepEqual(packet.synthesisSources.map((s: SynthesisSource) => s.text), sources.slice(0, 2).map(s => s.text));
  assert.equal(packet.unresolvedConflict, true); assert.equal(packet.boundProjectContext, undefined);
  assert.doesNotMatch(JSON.stringify(view), /先用当前实际阶段|暂无团队明确回传/);
  assert.match(JSON.stringify(view[0]), /只解释|只回答/);
  // Neither selecting a chapter nor hiding a source is the server's job.
  assert.equal(packet.synthesisSources[1].sourceId, 'K-page1');
  assert.deepEqual(projectSynthesisPolicy(view), view);
});

test('retained1369/1370 drafts receive one diagnostic repair while final commitment and source validation stay strict', () => {
  for (const tail of tails) {
    const raw = actualDraft(tail), before = JSON.stringify(sources);
    assert.throws(() => parseSynthesis(raw, sources, { currentQuestion: question }), /unsupported_model_commitment/);
    const issue = synthesisRepairFeedback(raw, sources, { currentQuestion: question }); assert.ok(issue);
    assert.equal(issue.code, 'unsupported_model_commitment');
    assert.match(issue.feedback, /segments\[1\]\.text/); assert.match(issue.feedback, /segments\[2\]\.text/);
    assert.equal(JSON.stringify(sources), before);
    const controls: ModelMessage[] = [{ role: 'assistant', content: raw }, { role: 'system', content: [{ type: 'text', text: issue.feedback }] }];
    const repaired = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw), edits: [{ segment: 1, remove: true }, { segment: 2, remove: true }] }), controls, sources, 1);
    assert.doesNotThrow(() => parseSynthesis(repaired, sources, { currentQuestion: question }));
    assert.throws(() => parseSynthesis(raw, sources, { currentQuestion: question }), /unsupported_model_commitment/);
    assert.throws(() => resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: 'wrong', edits: [{ segment: 1, remove: true }] }), controls, sources, 1), /invalid_model_answer/);
  }
});

test('original diagnostic recovery cannot authorize unknown citations, unsupported quantities or positive completion', () => {
  const raw = JSON.parse(actualDraft(tails[0])); raw.segments[1].citations = [{ citationId: 'unknown' }];
  assert.throws(() => synthesisRepairFeedback(JSON.stringify(raw), sources, { currentQuestion: question }), /invalid_model_citation/);
  for (const text of ['已经批准方案。', '现场宽度800毫米。', '不是没有已验收。']) {
    const bad = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text, citations: [citation(sources[0])] }] });
    assert.throws(() => parseSynthesis(bad, sources, { currentQuestion: question }), /unsupported_model_commitment/);
    // Providing a diagnostic is never an acceptance, even for the same raw draft.
    assert.ok(synthesisRepairFeedback(bad, sources, { currentQuestion: question }));
    assert.throws(() => parseSynthesis(bad, sources, { currentQuestion: question }), /unsupported_model_commitment/);
  }
});
