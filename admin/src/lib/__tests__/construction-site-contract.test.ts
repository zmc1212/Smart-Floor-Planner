import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { parseSiteDraft, siteDraftTool, siteDraftOutput } from '../construction/site-contract';

const data = { title: '合成防水观察', roomId: '256', completed: '涂刷完成', pending: '保养时长未核实', coordination: '请负责人核对', note: '' };
const output = (value: unknown, name = 'final_response'): ModelTurnOutput => ({ text: '', toolCalls: [{ id:'draft', name, arguments: JSON.stringify(value) }],
  finishReason:'tool_calls', providerRequestId:null, usage:{inputTokens:40,outputTokens:30} });

test('site output serialization constrains the exact authorized room strings without opening business tools', () => {
  const tool = siteDraftTool(['256','257']), schema = tool.parameters.properties as Record<string,Record<string,unknown>>;
  assert.equal(tool.name,'final_response'); assert.deepEqual(schema.roomId.enum,['256','257']);
  assert.equal(schema.roomId.type,'string'); assert.equal(tool.parameters.additionalProperties,false);
  assert.deepEqual(parseSiteDraft(siteDraftOutput(output(data)),['256','257']),data);
});

test('an omitted room selection decodes only to null, including a project without rooms, while legacy JSON stays strict', () => {
  const {roomId: _roomId,...unknown}=data;
  assert.deepEqual(parseSiteDraft(siteDraftOutput(output(unknown)),['256']),{...data,roomId:null});
  assert.deepEqual(parseSiteDraft(siteDraftOutput(output(unknown)),[]),{...data,roomId:null});
  assert.equal((siteDraftTool([]).parameters.properties as Record<string,unknown>).roomId,undefined);
  assert.deepEqual(siteDraftTool(['256']).parameters.required,['title','completed','pending','coordination','note']);
  assert.throws(()=>parseSiteDraft(JSON.stringify(unknown),['256']),/invalid_construction/);
});

test('run1038 numeric room identifiers stay rejected instead of being coerced or mapped by name', () => {
  for(const roomId of [256,'主卫','999'])assert.throws(()=>parseSiteDraft(siteDraftOutput(output({...data,roomId})),['256']),/invalid_(construction|model_answer)/);
  assert.deepEqual(parseSiteDraft(siteDraftOutput(output({...data,roomId:null})),['256']),{...data,roomId:null});
  assert.throws(()=>parseSiteDraft(siteDraftOutput(output({...data,approved:true})),['256']),/invalid_construction/);
});

test('native JSON-schema omission from run9678 has the same room semantics as output-tool serialization', () => {
  const native: ModelTurnOutput = { text: JSON.stringify({ title: '现场施工进展', completed: '', pending: '底盒尚未固定',
    coordination: '请设计师核对底盒位置', note: '原话明确底盒位置已补拍清楚但未固定，需设计师核对；照片仅辅助识别部位，不作为完成依据。' }),
    toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: { inputTokens: 675, outputTokens: 57 } };
  const draft = parseSiteDraft(siteDraftOutput(native), ['256']);
  assert.equal(draft.roomId, null); assert.equal(draft.completed, ''); assert.equal(draft.pending, '底盒尚未固定');
  assert.deepEqual(draft, parseSiteDraft(siteDraftOutput(native), []));
  for (const roomId of [256, '书房', '999']) assert.throws(() => parseSiteDraft(siteDraftOutput({ ...native,
    text: JSON.stringify({ ...JSON.parse(native.text), roomId }) }), ['256']), /invalid_(construction|model_answer)/);
});

test('site model output rejects business/unknown or multiple calls and preserves legacy JSON checkpoints', () => {
  assert.throws(()=>siteDraftOutput(output(data,'publish')),/invalid_model_answer/);
  const multiple=output(data);multiple.toolCalls.push({...multiple.toolCalls[0],id:'other'});
  assert.throws(()=>siteDraftOutput(multiple),/invalid_model_answer/);
  assert.throws(()=>siteDraftOutput({...output(data),finishReason:'length'}),/invalid_model_answer/);
  const json=JSON.stringify(data);assert.equal(siteDraftOutput({...output(data),text:json,toolCalls:[]}),json);
  assert.deepEqual(parseSiteDraft(json,['256']),data);
});
