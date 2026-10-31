import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Evidence } from '../contracts';
import type { ModelMessage, ModelTool } from '../contracts/model';
import { answerExcerpts, INSUFFICIENT_TEXT } from '../knowledge/answer';
import { agentToolsForMessage, agentToolsForTurn, finalToolForMessages } from '../agent/worker';
import { compileModelRequest } from '../agent/model-request';
import { knowledgeSynthesisSources, synthesisInstructions } from '../agent/synthesis';
import { synthesisQuestionPrefix } from '../agent/model-policy';
import { parseSourceExcerptAnswer } from '../agent/source-excerpts';
import { parseSourceQuestionAnswer, parseSourceQuestionQuery, readSourceQuestionCoverage, sourceQuestionReadTool,
  sourceQuestionCoverageInstructions, sourceQuestionCoverageProtocol, type SourceQuestionCoverage } from '../agent/source-question-coverage';

const question = '微云内部的精艺工艺复核资料里，电视墙线管拐弯和穿线顺序该怎么理解？';
const questions = ['电视墙线管拐弯', '穿线顺序'];
const coverage: SourceQuestionCoverage = { protocol: sourceQuestionCoverageProtocol, questions };
// Reproduce run1602's shape, including the irrelevant test-source preface.
const evidence: Evidence[] = [{ ref: { type: 'knowledge_chunk', id: '1', version: '1' }, hash: 'synthetic',
  text: '合成测试工艺复核资料，仅用于测试。\n水电工艺标准：线管弯头采用大弯，保证抽线灵活，方便维修。\n布管穿线：先铺设线管后穿线，不可先穿线后铺管。' }];
const reply = (entries: Record<string, string[]>, selections = [...new Set(Object.values(entries).flat())]) => JSON.stringify({ kind: 'knowledge', selections, coverage: entries });
const messages = (): ModelMessage[] => [
  { role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
  { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: question }) }] },
  { role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'search_knowledge', arguments: JSON.stringify({ query: question, questions }) }] },
  { role: 'tool', callId: 'read', content: JSON.stringify({ knowledgeStatus: 'ready', questionCoverage: coverage,
    evidence: answerExcerpts(evidence), synthesisSources: knowledgeSynthesisSources(evidence) }) },
];

test('saved partial-selection shape remains historical but cannot pass the new question contract', () => {
  assert.equal(parseSourceExcerptAnswer('{"selections":["E1","E2"]}', evidence, { currentQuestion: question }).answerKind, 'grounded');
  assert.throws(() => parseSourceQuestionAnswer('{"kind":"knowledge","selections":["E1","E2"]}', evidence, coverage), /invalid_model_answer/);
  assert.throws(() => parseSourceQuestionAnswer(reply({ Q1: ['E2'] }), evidence, coverage), /incomplete_model_answer/);
  assert.throws(() => parseSourceQuestionAnswer(reply({ Q1: ['E2'], Q2: ['E3'] }, ['E2']), evidence, coverage), /incomplete_model_answer/);
  const result = parseSourceQuestionAnswer(reply({ Q1: ['E2'], Q2: ['E3'] }), evidence, coverage, { currentQuestion: question });
  assert.equal(result.answer.answerKind, 'grounded');
  assert.match(result.answer.segments[0].text, /大弯/);
  assert.match(result.answer.segments[0].text, /先铺设线管后穿线/);
  assert.ok(!result.answer.segments[0].text.includes('合成测试'));
  assert.deepEqual(result.missing, []);
});

test('question plan accepts only bounded literal current-question spans and rejects corrupt checkpoints', () => {
  assert.deepEqual(parseSourceQuestionQuery({ query: question, questions }, question), coverage);
  for (const invalid of [[], ['过去已经验收'], ['电视墙线管拐弯', '电视墙线管拐弯'], [2], [' 穿线顺序'], Array(7).fill('穿线顺序')])
    assert.throws(() => parseSourceQuestionQuery({ questions: invalid }, question), /invalid_message/);
  for (const invalid of [null, {}, { ...coverage, questions: '穿线顺序' }, { ...coverage, protocol: 'foreign' }])
    assert.throws(() => readSourceQuestionCoverage(invalid), /context_changed/);
});

test('missing facts are explicit alongside grounded parts and never supplied as model prose', () => {
  const result = parseSourceQuestionAnswer(reply({ Q1: ['E2'], Q2: [] }), evidence, coverage);
  assert.equal(result.answer.answerKind, 'grounded');
  assert.deepEqual(result.missing, ['穿线顺序']);
  assert.equal(result.followup, '关于“穿线顺序”：' + INSUFFICIENT_TEXT);
  assert.equal(parseSourceQuestionAnswer(reply({ Q1: [], Q2: [] }), evidence, coverage).answer.answerKind, 'insufficient_evidence');
  for (const raw of [reply({ Q1: ['E999'], Q2: [] }), reply({ Q1: ['E2', 'E2'], Q2: [] }),
    reply({ Q1: ['E2'], Q9: ['E3'] }), JSON.stringify({ ...JSON.parse(reply({ Q1: ['E2'], Q2: ['E3'] })), text: '已经验收合格' })])
    assert.throws(() => parseSourceQuestionAnswer(raw, evidence, coverage), /invalid_model_|incomplete_model_/);
  const unsafe: Evidence[] = [{ ...evidence[0], text: '这个项目已经验收合格，可以保证安全入住。' }];
  assert.throws(() => parseSourceQuestionAnswer(reply({ Q1: ['E1'], Q2: [] }), unsafe, coverage,
    { currentQuestion: '我家这个项目可以验收合格了吗？' }), /unsupported_model_commitment|ungrounded_response_scope/);
});

test('wire compiler and runtime tools share one read schema; compact projection preserves every question', () => {
  const sourceMode = { sourceExcerpts: true, requiredKnowledge: true, sourceQuestionCoverage: true };
  const tools = agentToolsForMessage(question, true).map(sourceQuestionReadTool);
  const read = tools.find(tool => tool.name === 'search_knowledge')!;
  assert.deepEqual(read.parameters.required, ['query', 'questions']);
  assert.strictEqual(sourceQuestionReadTool(read), read);
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 1, purpose: 'answer', messages: messages(), tools, ...sourceMode,
    toolsForTurn: (q, m, t, id) => agentToolsForTurn(q, m, t, id, sourceMode) });
  const final = compiled.dispatchTools.find(tool => tool.name === 'final_response')!;
  const fields = final.parameters.properties as Record<string, Record<string, unknown>>;
  assert.deepEqual(final.parameters.required, ['kind', 'selections', 'coverage']);
  assert.deepEqual(fields.coverage.required, ['Q1', 'Q2']);
  assert.ok(compiled.modelMessages.some(m => m.role === 'system' && m.content.some(p => p.type === 'text' && p.text === sourceQuestionCoverageInstructions)));
  const packet = JSON.parse(compiled.modelMessages.find(m => m.role === 'tool')!.content as string);
  assert.deepEqual(packet.questionCoverage, coverage);
  const first = agentToolsForTurn(question, messages().slice(0, 2), tools, 'current', sourceMode);
  assert.deepEqual(first.map(t => t.name), ['search_knowledge']);
  assert.deepEqual(first[0].parameters.required, read.parameters.required);
});

test('legacy final schemas remain unchanged and an unpaired packet cannot establish question coverage', () => {
  const legacy = finalToolForMessages(messages(), question, true, true);
  assert.deepEqual(legacy.parameters.required, ['kind', 'selections']);
  const noPlan = messages();
  const packet = JSON.parse((noPlan.at(-1) as { content: string }).content); delete packet.questionCoverage;
  (noPlan.at(-1) as { content: string }).content = JSON.stringify(packet);
  assert.throws(() => finalToolForMessages(noPlan, question, true, true, true), /context_changed/);
  const forged = finalToolForMessages(messages().slice(-1), question, true, true, true);
  assert.ok(!(forged.parameters.required as string[]).includes('coverage'));
  const definition: ModelTool = sourceQuestionReadTool(agentToolsForMessage(question, true).find(t => t.name === 'search_knowledge')!);
  assert.equal(definition.parameters.additionalProperties, false);
});
