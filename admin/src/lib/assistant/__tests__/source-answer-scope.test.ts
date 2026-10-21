import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from '../contracts/model';
import { fingerprint } from '../contracts';
import { sourceCitationCatalog, modelCitationCatalog } from '../agent/citation-catalog';
import { parseSynthesis, synthesisRepairFeedback, type SynthesisSource } from '../agent/synthesis';
import { resolveSynthesisRepair } from '../agent/synthesis-repair';
import { agentToolsForTurn, agentToolsForMessage } from '../agent/worker';

const currentQuestion = '合成点位说明第二节如何区分方案同意和关闭？';
const rule: SynthesisSource = { sourceId: 'K-original', kind: 'knowledge', title: '合成手测点位说明',
  text: '第二节 状态区别 客户同意某版方案不等于已经落实，也不等于事项关闭或工程验收通过。' };
const project: SynthesisSource = { sourceId: 'B-original', kind: 'project', title: '本人项目实际节点', text: '团队标记的当前节点：水电。' };
const sources = [rule, project];
const cite = (source = rule) => ({ citationId: sourceCitationCatalog(source)[0].citationId });
const evidence = { basis: 'evidence', text: '客户同意某版方案，不等于已经落实，也不等于事项关闭或工程验收通过。', citations: [cite()] };
const raw = (extra: object[]) => JSON.stringify({ kind: 'synthesis', segments: [evidence, ...extra] });
const retained = [
  '方案同意仅表示客户认可设计版本，而关闭需团队提供现场落实证据、正式解决记录或客户明确决定，三者不可混同。',
  '方案同意仅表示客户认可该版本内容，但现场落实、节点验收、费用结算及正式关闭需依赖团队实际施工记录、验收报告及客户明确签署的关闭确认。',
];
const messages = (question = currentQuestion): ModelMessage[] => [
  { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', sourceRole: 'current_request', text: question }) }] },
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: '{"query":"模型自选查询"}' }] },
  { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', evidence: [], synthesisSources: sources.map(source => ({ ...source, citationOptions: modelCitationCatalog(source) })) }) },
];
const final = (question = currentQuestion) => agentToolsForTurn(question, messages(question), agentToolsForMessage(question, true), 'current').find(t => t.name === 'final_response')!;

test('original-only answers constrain the existing final envelope, leaving model text and citation selection open', () => {
  const tool = final(), properties = tool.parameters.properties as Record<string, Record<string, unknown>>;
  const segment = (properties.segments.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(properties.kind.enum, ['synthesis']);
  assert.deepEqual(segment.basis.enum, ['evidence', 'uncertainty']);
  assert.equal(segment.text.const, undefined); assert.equal(segment.text.enum, undefined);
  assert.doesNotThrow(() => parseSynthesis(raw([]), sources, { currentQuestion }));
  for (const question of ['请按原文解释方案同意。另外给一个一般建议。', '请结合我家现场解释《点位说明》。', '书房柔和照明怎么选？',
    '更正：书房改为单人办公。另外，合成点位说明第二节如何区分方案同意和关闭？']) {
    const properties = final(question).parameters.properties as Record<string, Record<string, unknown>>;
    const segment = (properties.segments.items as Record<string, unknown>).properties as Record<string, Record<string, unknown>>;
    assert.ok((segment.basis.enum as string[]).includes('advice'));
  }
});

test('retained run1363/1366 advice and relabelled evidence cannot invent source conditions under a real citation', () => {
  for (const text of retained) for (const basis of ['advice', 'evidence', 'uncertainty']) {
    const bad = raw([{ basis, text, citations: [cite()] }]);
    assert.throws(() => parseSynthesis(bad, sources, { currentQuestion }), /ungrounded_response_scope/, basis + ':' + text);
  }
  for (const text of ['事项只有完成结算并签署确认后才能关闭。', '原文要求先提交验收报告。', '关闭必须提供签字记录。',
    '原文未说明关闭条件但关闭需签字。', '本次原文没有规定关闭流程并要求提交报告。'])
    assert.throws(() => parseSynthesis(raw([{ basis: 'evidence', text, citations: [cite()] }]), sources, { currentQuestion }), /ungrounded_response_scope/);
  assert.throws(() => parseSynthesis(raw([{ basis: 'evidence', text: project.text, citations: [cite(project)] }]), sources, { currentQuestion }), /ungrounded_response_scope/);
});

test('original missing conditions stay unknown while actual cited requirements remain usable', () => {
  assert.doesNotThrow(() => parseSynthesis(raw([{ basis: 'uncertainty', text: '本次原文未写明关闭所需的具体条件。', citations: [] }]), sources, { currentQuestion }));
  const actual: SynthesisSource = { ...rule, sourceId: 'K-actual', text: '关闭须核对事项记录。' };
  assert.doesNotThrow(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [
    { basis: 'evidence', text: '原文规定：关闭须核对事项记录。', citations: [cite(actual)] },
  ] }), [actual], { currentQuestion }));
  // An unrelated real requirement cannot license a different requirement.
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [
    { basis: 'evidence', text: '关闭须提供签字报告。', citations: [cite(actual)] },
  ] }), [actual], { currentQuestion }), /ungrounded_response_scope/);
  assert.doesNotThrow(() => parseSynthesis(raw([{ basis: 'advice', text: '一般选择可结合使用习惯核对。', citations: [] }]), sources,
    { currentQuestion: '请按原文解释方案同意。另外给一个一般建议。' }));
});

test('scope failures reuse the existing bound edit repair without changing support or numerical guards', () => {
  const bad = raw([{ basis: 'advice', text: retained[1], citations: [cite()] }]);
  const issue = synthesisRepairFeedback(bad, sources, { currentQuestion });
  assert.equal(issue?.code, 'ungrounded_response_scope');
  assert.match(issue!.feedback, /source_answer_scope/);
  const controls: ModelMessage[] = [{ role: 'assistant', content: bad }, { role: 'system', content: [{ type: 'text', text: issue!.feedback }] }];
  const repaired = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(bad), edits: [{ segment: 1, remove: true }] }), controls, sources, 1);
  assert.doesNotThrow(() => parseSynthesis(repaired, sources, { currentQuestion }));
  const ignored = resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(bad), edits: [{ segment: 1, basis: 'evidence' }] }), controls, sources, 1);
  assert.throws(() => parseSynthesis(ignored, sources, { currentQuestion }), /ungrounded_response_scope/);
  assert.throws(() => parseSynthesis(raw([{ basis: 'advice', text: '关闭需在3天内完成结算。', citations: [cite()] }]), sources, { currentQuestion }), /unsupported_model_commitment/);
});
