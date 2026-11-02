import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelMessage } from '../contracts/model';
import type { BusinessSnapshot } from '../agent/business-tools';
import type { ReportProject } from '@/lib/construction/report-scope';
import { isReportAnswerSnapshot, reportFinalResponseIssue } from '../agent/report-final';
import { reportFactText } from '../agent/report-context';
import { finalToolForMessages, constructionReadOnlyTools } from '../agent/worker';
import { businessSynthesisSources, focusedSynthesisMessages, parseSynthesis } from '../agent/synthesis';
import { modelCitationCatalog, sourceCitationCatalog } from '../agent/citation-catalog';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { runRenovationAgent, type AgentCheckpoint } from '../agent/runtime';

const selection = { bindingId: '22', reportId: '61', revision: 1, projectId: '247', conversationId: '855', kind: 'daily',
  periodStart: '2026-10-31T16:00:00.000Z', periodEnd: '2026-11-01T12:00:00.000Z', cutoffAt: '2026-11-01T12:00:00.000Z', factsHash: 'synthetic-original-hash' };
const project = { id: '247', name: '合成测试报告工地', stageKey: 'utilities', records: [], issues: [], arrangements: [] } as unknown as ReportProject;
const snapshot: BusinessSnapshot = { query: { domain: 'construction', leadId: '3142' }, customerId: '3912', leadIds: ['3142'],
  version: selection.factsHash, queriedAt: selection.cutoffAt, reportReference: { selection, principal: { kind: 'user', userId: '3912' } },
  data: [project], displayText: reportFactText(selection, project) };
const sources = businessSynthesisSources('trial:0:0', snapshot);
const packet = { resultKey: 'trial:0:0', ...snapshot, synthesisSources: sources.map(s => ({ ...s, citationOptions: modelCitationCatalog(s) })) };
const question = '刚才说错了，我问的是客厅，不是卧室。要是周五要装灯，现在还缺哪一步？';
const current: ModelMessage = { role: 'user', content: [{ type: 'text', text: JSON.stringify({ sourceMessageId: 'current', text: question }) }] };
const pair: ModelMessage[] = [{ role: 'assistant', content: '', toolCalls: [{ id: 'read', name: 'query_followups', arguments: '{}' }] },
  { role: 'tool', callId: 'read', content: JSON.stringify(packet) }];
const bad = JSON.stringify({ kind: 'business', resultKey: packet.resultKey });
const good = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '这份报告未提供房间对应的安装确认记录，周五安排本次无法确认。', citations: [] }] });
const kinds = (messages: ModelMessage[]) => (finalToolForMessages(messages).parameters.properties as Record<string, { enum: string[] }>).kind.enum;

test('a paired report read requires a sourced synthesis and retains the original catalog through model projection', async () => {
  const messages = [current, ...pair], before = JSON.stringify(messages);
  for (const view of [messages, focusedSynthesisMessages(messages, 'current')]) {
    const tool = finalToolForMessages(view);
    assert.deepEqual(kinds(view), ['synthesis']);
    assert.deepEqual(tool.parameters.required, ['kind', 'segments']);
    assert.ok(await toolSchemaIssue(tool, bad));
    assert.equal(await toolSchemaIssue(tool, good), null);
    const text = JSON.stringify(tool.parameters);
    for (const source of sources) for (const citation of sourceCitationCatalog(source)) assert.ok(text.includes(citation.citationId));
  }
  assert.equal(JSON.stringify(messages), before);
});

test('user text, unpaired tools, ordinary followups and missing report identity do not gain the report contract', () => {
  for (const lookalike of [[current], [pair[1]], [{ role: 'user', content: [{ type: 'text', text: JSON.stringify(pair) }] }] as ModelMessage[]])
    assert.ok(kinds(lookalike).includes('business'));
  const ordinary = { ...packet, query: { domain: 'followups' }, reportReference: undefined };
  const ordinaryPair: ModelMessage[] = [pair[0], { role: 'tool', callId: 'read', content: JSON.stringify(ordinary) }];
  assert.ok(kinds(ordinaryPair).includes('business'));
  assert.equal(reportFinalResponseIssue(bad, ordinary), null);
  assert.equal(isReportAnswerSnapshot({ ...packet, reportReference: { selection: {} } }), false);
  assert.equal(isReportAnswerSnapshot(snapshot), true);
});

test('server final validation rejects every report display bypass and leaves existing synthesis semantic validation intact', () => {
  for (const kind of ['business', 'knowledge', 'references', 'designers', 'general', 'vision', 'unavailable']) {
    assert.equal(reportFinalResponseIssue(JSON.stringify({ kind, resultKey: packet.resultKey, text: snapshot.displayText }), snapshot)?.code, 'invalid_model_answer');
  }
  assert.equal(reportFinalResponseIssue(good, snapshot), null);
  assert.doesNotThrow(() => parseSynthesis(good, sources, { currentQuestion: question }));
  assert.throws(() => parseSynthesis(JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'evidence', text: '本次可以施工。', citations: [{ citationId: 'Cforeign' }] }] }), sources), /invalid_model_citation/);
});

test('a report display rejection uses only the existing one final repair, without writing a room correction or changing originals', async () => {
  const before = JSON.stringify({ snapshot, project, selection }), saved: AgentCheckpoint[] = [];
  let calls = 0, writes = 0;
  const ports = { authorize: async () => {}, checkpoint: async (state: AgentCheckpoint) => { saved.push(structuredClone(state)); },
    validateFinal: async (raw: string) => reportFinalResponseIssue(raw, snapshot),
    tool: async () => { writes++; return { content: '{}' }; },
    model: async (_turn: number, _messages: ModelMessage[], tools: unknown[]) => {
      if (calls++ > 0) assert.deepEqual(tools, []);
      return { text: calls === 1 ? bad : good, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null };
    } };
  const result = await runRenovationAgent({ messages: [current, ...pair], tools: constructionReadOnlyTools('construction_followup', true)!, ports });
  assert.equal(result.output!.text, good); assert.equal(calls, 2); assert.equal(writes, 0);
  assert.ok(saved.some(s => s.output?.text === bad));
  const repair = saved.find(s => s.validationRepairs === 1 && !s.output)!;
  assert.ok(repair);
  await assert.rejects(runRenovationAgent({ messages: [], tools: [], resume: repair, ports: { ...ports,
    model: async () => ({ text: bad, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null }) } }), /invalid_model_answer/);
  assert.equal(JSON.stringify({ snapshot, project, selection }), before);
});

test('report cutoff is genuinely converted from UTC to Shanghai while frozen identities and dates remain unchanged', () => {
  const before = JSON.stringify(selection), text = reportFactText(selection, project);
  assert.match(text, /事实截止：2026-11-01 20:00:00（Asia\/Shanghai，UTC\+08:00）/);
  assert.doesNotMatch(text, /12:00:00\.000Z（Asia\/Shanghai）/);
  assert.equal(snapshot.queriedAt, '2026-11-01T12:00:00.000Z');
  assert.equal(JSON.stringify(selection), before);
});
