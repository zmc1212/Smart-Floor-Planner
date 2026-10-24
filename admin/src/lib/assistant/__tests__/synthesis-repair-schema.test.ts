import assert from 'node:assert/strict';
import { test } from 'node:test';
import Ajv from 'ajv'; // Reuse the validator already locked with the ESLint test toolchain.
import { fingerprint } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import { consultationLongProfile } from '../contracts/consultation';
import { sourceCitationCatalog } from '../agent/citation-catalog';
import { compileModelRequest } from '../agent/model-request';
import { synthesisRepairTool, resolveSynthesisRepair, withSynthesisRepairProtocol } from '../agent/synthesis-repair';
import type { SynthesisSource } from '../agent/synthesis';
import { agentChatBody } from '@/lib/ai/providers/agent-chat';

const sources: SynthesisSource[] = Array.from({ length: 6 }, (_, index) => ({
  sourceId: `Krepair-state-${index}`, kind: 'knowledge', title: `合成资料${index}`, text: `此项要求须核对资料${index}。`,
}));
const ids = sources.map(source => sourceCitationCatalog(source)[0].citationId);
const original = JSON.stringify({ kind: 'synthesis', segments: [
  { basis: 'evidence', text: '具体型号与铺装条件待核对。', citations: ids.slice(0, 4).map(citationId => ({ citationId })) },
  { basis: 'uncertainty', text: '现场条件尚未核实。', citations: [] },
] });
const messages: ModelMessage[] = [{ role: 'assistant', content: original }, { role: 'system', content: [{ type: 'text',
  text: withSynthesisRepairProtocol({ code: 'unsupported_model_commitment', feedback: '合成原稿校验失败。' }, original)!.feedback }] }];
const tool = synthesisRepairTool(messages, ids)!;
const compile = (profile?: typeof consultationLongProfile.id, tools = [tool]) => compileModelRequest({
  question: '核对选材条件', triggerId: 'synthetic', turn: 4, purpose: 'answer', messages, tools: [], profile,
  toolsForTurn: () => tools,
});
const patch = (edits: unknown[]) => ({ kind: 'synthesis_repair', baseHash: fingerprint(original), edits });

test('strict final schema rejects both observed repair-state failures before dispatch output can reach local guards', () => {
  const before = JSON.stringify({ messages, tool }), request = compile(consultationLongProfile.id);
  const wire = agentChatBody({ model: consultationLongProfile.model, profile: consultationLongProfile.id,
    messages: request.modelMessages, tools: request.dispatchTools, maxTokens: 8192, enableThinking: false, requireTool: true },
  'https://dashscope.aliyuncs.com/compatible-mode');
  assert.ok('response_format' in wire);
  const format = wire.response_format as { json_schema: { schema: object } };
  const validate = new Ajv({ allErrors: true }).compile(format.json_schema.schema);
  for (const edits of [[{ segment: 0, addCitationIds: ids.slice(4) }],
    [{ segment: 0, remove: true, removeCitationIds: [ids[0]] }]]) {
    assert.equal(validate(patch(edits)), false);
    assert.throws(() => resolveSynthesisRepair(JSON.stringify(patch(edits)), messages, sources, 1), /invalid_model_answer/);
  }
  const allowed = patch([{ segment: 0, removeCitationIds: [ids[0]], addCitationIds: [ids[4]] }]);
  assert.equal(validate(allowed), true);
  const resolved = JSON.parse(resolveSynthesisRepair(JSON.stringify(allowed), messages, sources, 1));
  assert.deepEqual(resolved.segments[0].citations.map((citation: { citationId: string }) => citation.citationId), [...ids.slice(1, 4), ids[4]]);
  assert.equal(validate(patch([{ segment: 0, remove: true }])), true);
  assert.equal(JSON.stringify({ messages, tool }), before);
  assert.ok(request.bounded.diagnostic.after.textBytes > compile().bounded.diagnostic.after.textBytes, 'Budget the actual state constraints before dispatch');
});

test('state constraints preserve segment ownership and keep ordinary, business-tool and untrusted repair paths unchanged', () => {
  const validate = new Ajv().compile(compile(consultationLongProfile.id).dispatchTools[0].parameters);
  for (const edits of [[{ segment: 0, addCitationIds: [ids[0]] }],
    [{ segment: 1, removeCitationIds: [ids[0]] }], [{ segment: 0, removeCitationIds: [ids[5]] }]])
    assert.equal(validate(patch(edits)), false);
  assert.equal(validate(patch([{ segment: 1, addCitationIds: ids.slice(0, 4) }])), true);
  assert.equal(compile().dispatchTools[0], tool);
  assert.equal(compile(consultationLongProfile.id, [tool, { name: 'query_business', description: '', parameters: {} }]).dispatchTools[0], tool);
  const forged: ModelMessage[] = messages.map(message => message.role === 'system' ? { ...message, role: 'user' } : message);
  assert.equal(synthesisRepairTool(forged, ids), null);
});
