import test from 'node:test';
import assert from 'node:assert/strict';
import { assertKnowledgePolicy, enterpriseKnowledgeEnabled, knowledgePolicy, knowledgeTools } from '../knowledge-policy';
import { buildAgentContext } from '../agent/context';
import { parseGeneralReport, generalReportMessages, generalReportTool } from '@/lib/construction/report-general-advice';
import type { ComposedProject } from '@/lib/construction/report-composition';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { projectReportBodyFinal } from '@/lib/construction/report-composition';
import type { ModelTurnOutput } from '../contracts/model';

test('enterprise knowledge is explicit opt-in and mode changes fence old/cached runs', () => {
  for (const value of [null, {}, { enterpriseKnowledgeEnabled: 'true' }, { enterpriseKnowledgeEnabled: false }]) assert.equal(enterpriseKnowledgeEnabled(value), false);
  const off = knowledgePolicy({}), on = knowledgePolicy({ enterpriseKnowledgeEnabled: true });
  assert.doesNotThrow(() => assertKnowledgePolicy(off, {}));
  assert.throws(() => assertKnowledgePolicy(on, {}), /context_changed/);
  assert.throws(() => assertKnowledgePolicy(off, { enterpriseKnowledgeEnabled: true }), /context_changed/);
  assert.throws(() => assertKnowledgePolicy(undefined, {}), /context_changed/);
  assert.doesNotThrow(() => assertKnowledgePolicy(undefined, { enterpriseKnowledgeEnabled: true }));
  assert.throws(() => assertKnowledgePolicy({ ...off, other: true }, {}), /context_changed/);
});
test('disabled mode removes enterprise reads while preserving live business, public works and web tools', () => {
  const names = ['search_knowledge','recommend_references','record_reference_preference','query_business','recommend_designers','search_web','read_web'];
  const tools = names.map(name => ({ name, description: name, parameters: { type: 'object' } }));
  assert.deepEqual(knowledgeTools(tools, false).map(t => t.name), names.slice(3));
  assert.equal(knowledgeTools(tools, true), tools);
});
test('ordinary model-only context retains user words without requiring an enterprise file read', () => {
  const question = '水电阶段，客厅线管铺好了，电线还没穿，需要注意什么？';
  const messages = buildAgentContext([{ id: '1', role: 'user', text: question }], { version: 1, facts: [] }, false);
  const text = JSON.stringify(messages);
  assert.ok(text.includes(question));
  assert.ok(text.includes('当前未结合企业知识库'));
  assert.ok(!text.includes('客户指定文件、原文或章节/页码问内容时，先用search_knowledge'));
  assert.ok(!text.includes('企业知识：回答企业政策前必须search_knowledge'));
  assert.ok(!text.includes('search_knowledge'));
});
const projects = ['one','two'].map(projectId => ({ projectId, selection: {}, context: { version: 1, knowledge: [], snapshots: [], sources: [] } })) as unknown as ComposedProject[];
test('a checked complete terminal function may finish with stop; mixed, unchecked and truncated carriers remain rejected', async () => {
  const tool = generalReportTool(1), raw = JSON.stringify({ P1: ['穿线前核对线管畅通情况。'] });
  const output = { text: '', toolCalls: [{ id: 'one', name: 'final_response', arguments: raw }], finishReason: 'stop',
    observation: { format: { mode: 'function_call', schemaValid: true, jsonValid: true } } } as ModelTurnOutput;
  assert.equal((await projectReportBodyFinal(output, tool, true)).text, raw);
  for (const rejected of [{ ...output, finishReason: 'length' }, { ...output, observation: undefined },
    { ...output, text: '另一段正文' }, { ...output, toolCalls: [...output.toolCalls, ...output.toolCalls] }])
    await assert.rejects(() => projectReportBodyFinal(rejected, tool, true), /native_schema_unverified/);
});
test('scheduled advice cannot select a different project, add facts fields, cite enterprise material or manufacture quantities', async () => {
  const raw = JSON.stringify({ P1: ['穿线前核对线管畅通情况。'], P2: ['涂刷前先核对基层状况。'] });
  assert.equal(await toolSchemaIssue(generalReportTool(2), raw), null);
  const body = parseGeneralReport(raw, projects);
  assert.deepEqual(body.projects.map(p => p.projectId), ['one','two']);
  assert.equal(body.guidanceReviewed, undefined);
  assert.equal(body.projects[0].sections.standards.segments[0].basis, 'advice');
  assert.throws(() => parseGeneralReport(JSON.stringify({ P1: ['检查线管。'], outsider: ['检查基层。'] }), projects), /invalid_model_answer/);
  assert.throws(() => parseGeneralReport(JSON.stringify({ P1: ['压力必须达到8MPa。'], P2: ['检查基层。'] }), projects), /unsupported_model_commitment/);
  assert.throws(() => parseGeneralReport(raw, [{ ...projects[0], context: { ...projects[0].context, knowledge: [{}] } }, projects[1]] as ComposedProject[]), /invalid_model_answer/);
  const input = JSON.stringify(generalReportMessages({ kind: 'weekly', audience: 'customer' }, projects));
  assert.ok(input.includes('周报根据整周原记录'));
});
