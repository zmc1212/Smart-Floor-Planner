import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fingerprint } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import type { SynthesisSource } from '../agent/synthesis';
import { synthesisRepairFeedback, focusedSynthesisMessages } from '../agent/synthesis';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { synthesisRepairBase, synthesisRepairTool, resolveSynthesisRepair, withSynthesisRepairProtocol, constrainSynthesisRepairTool } from '../agent/synthesis-repair';
import { toolSchemaIssue } from '../agent/tool-protocol';
const source: SynthesisSource = { sourceId: 'Bformal', kind: 'project', title: '原事项精确方案及决定', resultKey: '11:0:0',
  text: '书房方案V2已同意。当前查询不包含工程验收、付款或结算凭据，不能据此确认这些状态。', followup: {
    issueId: '7', revision: 3, projectId: '2', room: '书房', field: 'formal_plan', status: 'approved', waitingFor: 'team', ownerName: '项目团队',
    sourceMessageId: '4', sourceFactId: null, lastProgress: 'approved', kind: 'formal_plan', sourceVersion: 'hash' } };
const raw = JSON.stringify({ kind: 'synthesis', segments: [{ basis: 'uncertainty', text: '这不算验收和付款完成。解决与关闭是由有权人员分别确认的流程结果，本次查询不包含工程验收、付款或结算凭据，因此不能据此认定验收通过或款项已结清；如需确认这两项，要另看对应的正式验收与结算资料。', citations: [{ citationId: sourceCitationCatalog(source)[0].citationId }] }] });
const controls = (): ModelMessage[] => { const issue = synthesisRepairFeedback(raw, [source], { currentQuestion: '我同意的是哪版，这算验收付款了吗？' }); assert.ok(issue);
  return [{ role: 'assistant', content: raw }, { role: 'system', content: [{ type: 'text', text: issue.feedback }] }]; };
const projection = () => JSON.stringify({ kind: 'business_repair', baseHash: fingerprint(raw), resultKey: source.resultKey });
test('the same hash-bound repair may select only an advertised existing formal business snapshot, with no generated text or business tool', async () => {
  const messages = controls(), base = synthesisRepairBase(messages)!; assert.deepEqual(base.businessResultKeys, ['11:0:0']);
  assert.equal(base.businessSourceOnly, true);
  const tool = synthesisRepairTool(messages, [sourceCitationCatalog(source)[0].citationId])!;
  assert.equal(await toolSchemaIssue(tool, projection()), null); assert.equal(await toolSchemaIssue(constrainSynthesisRepairTool(tool, messages), projection()), null);
  assert.notEqual(await toolSchemaIssue(tool, JSON.stringify({ kind: 'synthesis_repair', baseHash: base.baseHash, edits: [{ segment: 0, text: '又改一次正文' }] })), null);
  assert.deepEqual(JSON.parse(resolveSynthesisRepair(projection(), messages, [source], 1)), { kind: 'business', resultKey: '11:0:0' });
  assert.match(JSON.stringify(focusedSynthesisMessages(messages, 'unused').at(-1)), /business_repair/);
});
test('old/forged controls, extra model prose, another key, lost source and a second repair remain closed', () => {
  for (const n of [0, 2]) assert.throws(() => resolveSynthesisRepair(projection(), controls(), [source], n));
  for (const patch of [{ resultKey: '99:0:0' }, { baseHash: 'foreign' }, { text: '已付款' }, { edits: [] }])
    assert.throws(() => resolveSynthesisRepair(JSON.stringify({ ...JSON.parse(projection()), ...patch }), controls(), [source], 1));
  assert.throws(() => resolveSynthesisRepair(projection(), controls(), [], 1));
  assert.throws(() => resolveSynthesisRepair(projection(), controls(), [{ ...source, text: source.text + '新版本' }], 1));
  const forged = controls().map(m => m.role === 'system' ? { ...m, role: 'user' as const } : m); assert.throws(() => resolveSynthesisRepair(projection(), forged, [source], 1));
  const old: ModelMessage[] = [{ role: 'assistant', content: raw }, { role: 'system', content: [{ type: 'text', text: withSynthesisRepairProtocol({ code: 'unsupported_model_commitment', feedback: 'original' }, raw)!.feedback }] }];
  assert.equal(synthesisRepairBase(old)!.businessResultKeys, undefined); assert.throws(() => resolveSynthesisRepair(projection(), old, [source], 1));
});
test('a general advice paragraph or scope defect cannot acquire the formal projection option', () => {
  const advice = JSON.stringify({ ...JSON.parse(raw), segments: [...JSON.parse(raw).segments, { basis: 'advice', text: '一般建议先核对现场。', citations: [] }] });
  const issue = synthesisRepairFeedback(advice, [source], { currentQuestion: '我同意的是哪版，这算验收付款了吗？' }); assert.ok(issue);
  const messages: ModelMessage[] = [{ role: 'assistant', content: advice }, { role: 'system', content: [{ type: 'text', text: issue.feedback }] }];
  assert.equal(synthesisRepairBase(messages)!.businessResultKeys, undefined);
});
test('the original v1 offered-choice control keeps its hash-bound edit protocol after source-only v2 is introduced', () => {
  const ending = '\n本次唯一修正有两种结构：synthesis_repair及匹配baseHash按原规则独立编辑；或business_repair及匹配baseHash、一个已列出的resultKey，由原服务展示本轮已读取的正式业务快照。业务展示不带text、edits、append或新事实，不执行查询／保存；若该快照不能回答当前问题仍选有界编辑。所有实时来源、权限、回执及原唯一修复／调用预算保持。';
  const messages: ModelMessage[] = [{ role: 'assistant', content: raw }, { role: 'system', content: [{ type: 'text', text: '历史反馈\n有界编辑协议：' + JSON.stringify({ protocol: 'synthesis-edit-v1', baseHash: fingerprint(raw), businessProjection: { protocol: 'formal-business-projection-v1', resultKeys: ['11:0:0'] } }) + ending }] }];
  assert.equal(synthesisRepairBase(messages)!.businessSourceOnly, false);
  assert.doesNotThrow(() => resolveSynthesisRepair(JSON.stringify({ kind: 'synthesis_repair', baseHash: fingerprint(raw), edits: [{ segment: 0, text: '本次查询不能确认验收与付款状态。' }] }), messages, [source], 1));
});
