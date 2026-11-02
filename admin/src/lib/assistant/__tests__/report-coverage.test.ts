import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BusinessSnapshot } from '../agent/business-tools';
import type { ModelMessage } from '../contracts/model';
import { reportQuestionCoverage, reportAnswerSynthesis, reportCoverageFailure, reportCoverageProtocol } from '../agent/report-final';
import { compileModelRequest } from '../agent/model-request';
import { finalToolForMessages, agentToolsForTurn, constructionReadOnlyTools } from '../agent/worker';
import { businessSynthesisSources, focusedSynthesisMessages, parseSynthesis, synthesisInstructions } from '../agent/synthesis';
import { synthesisQuestionPrefix } from '../agent/model-policy';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';
import { AssistantError } from '../contracts';

const question = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
const current: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', sourceRole: 'current_request', text: question }) }] };
const snapshot: BusinessSnapshot = { query: { domain: 'construction', leadId: '3142' }, leadIds: ['3142'], version: 'synthetic-hash', queriedAt: '2026-11-01T12:00:00.000Z',
  reportReference: { principal: { kind: 'user', userId: '3912' }, selection: { bindingId: '22', reportId: '61', revision: 1, projectId: '247', conversationId: '855',
    factsHash: 'synthetic-hash', kind: 'daily', periodStart: '2026-10-31T16:00:00.000Z', periodEnd: '2026-11-01T12:00:00.000Z', cutoffAt: '2026-11-01T12:00:00.000Z' } },
  data: [], displayText: '报告原事实：照明回路待设计师核对，未记录完成期限。' };
const sources = businessSynthesisSources('trial:0:0', snapshot), coverage = reportQuestionCoverage(question);
const pair: ModelMessage[] = [{ role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'query_followups', arguments: '{}' }] },
  { role: 'tool', callId: 'read', content: JSON.stringify({ ...snapshot, resultKey: 'trial:0:0', synthesisSources: sources }) }];
const flat1931 = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '照明回路待设计师核对，未记录完成期限。', citations: [{ citationId: sourceCitationCatalog(sources[0])[0].citationId }] }] });
const answer = { kind: 'report_answer', answers: {
  Q1: [{ basis: 'uncertainty', text: '按你这次的说法，问题指客厅。当前报告未标明对应房间，客厅现场状态这次无法确认。', citations: [] }],
  Q2: [{ basis: 'evidence', text: '报告中的照明回路仍待设计师核对，未记录完成期限。', citations: [{ citationId: sourceCitationCatalog(sources[0])[0].citationId }] },
    { basis: 'advice', text: '建议先联系设计师核对客厅回路，再向团队核实周五能否安排；这次不能确认安装时间。', citations: [] }],
} };
const good = JSON.stringify(answer);
const validate = async (raw: string) => { try { parseSynthesis(reportAnswerSynthesis(raw, coverage), sources, { currentQuestion: question }); return null; }
  catch (error) { return reportCoverageFailure(error); } };

test('coverage retains exact current corrections/conditions without intent guessing, truncation or history substitution', () => {
  assert.deepEqual(coverage.questions, ['刚才说错了，我问的是客厅，不是卧室。', '要是周五要装灯，现在还缺哪一步？']);
  for (const text of [question, '  客厅照明？\n再问时间。', '甲。乙。丙。丁。戊。己。庚。辛。', '周五还没确定']) {
    const groups = reportQuestionCoverage(text).questions;
    assert.ok(groups.length <= 6); assert.equal(groups.join('').trim(), text.trim());
  }
});

test('actual compiler binds all current Q groups to required answers while preserving the catalog and ordinary source contract', async () => {
  const messages: ModelMessage[] = [{ role: 'system', content: [{ type: 'text', text: synthesisInstructions + synthesisQuestionPrefix + JSON.stringify({ currentQuestion: question }) }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'old', text: '历史问卧室。' }) }] }, current, ...pair];
  const before = JSON.stringify(messages), tools = constructionReadOnlyTools('construction_followup', true)!;
  const compiled = compileModelRequest({ question, triggerId: 'current', turn: 1, purpose: 'answer', messages, tools,
    toolsForTurn: (q, m, t, id) => agentToolsForTurn(q, m, t, id) });
  const tool = compiled.dispatchTools.find(t => t.name === 'final_response')!;
  assert.deepEqual((tool.parameters.properties as Record<string, { enum: string[] }>).kind.enum, ['report_answer']);
  const projected = JSON.parse(compiled.focused.find(m => m.role === 'tool')!.content as string);
  assert.deepEqual(projected.questionCoverage, coverage);
  assert.equal(await toolSchemaIssue(tool, good), null); assert.ok(await toolSchemaIssue(tool, flat1931));
  for (const source of sources) for (const citation of sourceCitationCatalog(source)) assert.ok(JSON.stringify(tool).includes(citation.citationId));
  assert.equal(JSON.stringify(messages), before);
  assert.ok(JSON.stringify(compiled.policyView).includes('kind=report_answer'));
  const ordinary = structuredClone(pair); if (ordinary[1].role === 'tool') { const p = JSON.parse(ordinary[1].content); delete p.reportReference; ordinary[1].content = JSON.stringify(p); }
  assert.ok(JSON.stringify(finalToolForMessages([current, ...ordinary], question).parameters).includes('business'));
});

test('missing, empty, unknown or cross-kind answers fail before projection; every retained segment still passes original semantic guards', () => {
  assert.doesNotThrow(() => parseSynthesis(reportAnswerSynthesis(good, coverage), sources, { currentQuestion: question }));
  for (const value of [{ ...answer, answers: { Q2: answer.answers.Q2 } }, { ...answer, answers: { ...answer.answers, Q1: [] } },
    { ...answer, answers: { ...answer.answers, Q3: answer.answers.Q1 } }, { ...answer, segments: JSON.parse(flat1931).segments }])
    assert.throws(() => reportAnswerSynthesis(JSON.stringify(value), coverage), /invalid_model_answer|incomplete_model_answer/);
  assert.throws(() => reportAnswerSynthesis(flat1931, coverage), /invalid_model_answer/);
  const fabricated = structuredClone(answer); fabricated.answers.Q2[0].citations = [{ citationId: 'Cforeign' }];
  assert.throws(() => parseSynthesis(reportAnswerSynthesis(JSON.stringify(fabricated), coverage), sources), /invalid_model_citation/);
});

test('one final-only repair preserves grouped questions/raw failed draft without reissuing a business action', async () => {
  const saved: AgentCheckpoint[] = []; let calls = 0, writes = 0;
  const ports = { authorize: async () => {}, checkpoint: async (s: AgentCheckpoint) => { saved.push(structuredClone(s)); }, validateFinal: validate,
    tool: async () => { writes++; return { content: '{}' }; },
    model: async (_turn: number, _messages: ModelMessage[], tools: unknown[]) => { if (calls++ > 0) assert.deepEqual(tools, []);
      return { text: calls === 1 ? flat1931 : good, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null }; } };
  const result = await runRenovationAgent({ messages: [current, ...pair], tools: constructionReadOnlyTools('construction_followup', true)!, ports });
  assert.equal(result.output!.text, good); assert.equal(calls, 2); assert.equal(writes, 0);
  assert.ok(saved.some(s => s.output?.text === flat1931));
  const repair = saved.find(s => s.validationRepairs === 1 && !s.output)!;
  assert.ok(JSON.stringify(repair.messages).includes(reportCoverageProtocol));
  await assert.rejects(runRenovationAgent({ messages: [], tools: [], resume: repair, ports: { ...ports,
    model: async () => ({ text: flat1931, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null }) } }), /invalid_model_answer/);
  await assert.rejects(runRenovationAgent({ messages: [], tools: [], resume: repair, ports: { ...ports,
    authorize: async () => { throw new AssistantError('context_changed', 409); } } }), /context_changed/);
  assert.equal(writes, 0);
  assert.deepEqual(JSON.parse(focusedSynthesisMessages([current, ...pair], 'current').find(m => m.role === 'tool')!.content as string).questionCoverage, coverage);
});
