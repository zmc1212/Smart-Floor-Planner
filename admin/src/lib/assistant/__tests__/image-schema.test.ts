import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { explicitNativeObjectRoot, nativeFinalDefinition } from '../agent/native-final';
import { reviewModelTools } from '../agent/review-runtime';
import { toolSchemaIssue } from '../agent/tool-protocol';
import type { ModelTool } from '../contracts/model';

test('explicit native object root preserves accepted source-bearing answers and rejects the original array, foreign citation and extra fields', async () => {
  const original = nativeFinalDefinition({ name: 'final_response', description: '', parameters: {
    type: 'object', properties: { kind: { enum: ['general', 'synthesis'] }, text: { type: 'string' },
      segments: { type: 'array', items: { type: 'object', properties: { basis: { enum: ['evidence', 'advice'] }, text: { type: 'string' },
        citations: { type: 'array', items: { type: 'object', properties: { citationId: { enum: ['owned'] } }, required: ['citationId'], additionalProperties: false } } },
      required: ['basis', 'text', 'citations'], additionalProperties: false } } }, required: ['kind'], additionalProperties: false,
  } });
  const before = structuredClone(original), current = explicitNativeObjectRoot(original);
  assert.deepEqual(current.parameters.required, ['kind']);
  assert.deepEqual(current.parameters.anyOf, original.parameters.anyOf);
  const valid = { kind: 'synthesis', segments: [{ basis: 'evidence', text: '图内墙边记录4000毫米，仍需核对具体墙面。', citations: [{ citationId: 'owned' }] }] };
  for (const value of [valid, { kind: 'general', text: '请补充新房对应墙面的照片。' }, [valid],
    { ...valid, extra: true }, { ...valid, segments: [{ ...valid.segments[0], citations: [{ citationId: 'other-customer' }] }] }]) {
    assert.equal(!!await toolSchemaIssue(current, JSON.stringify(value)), !!await toolSchemaIssue(original, JSON.stringify(value)));
  }
  assert.deepEqual(original, before);
  assert.throws(() => explicitNativeObjectRoot({ ...original, parameters: { type: 'object', anyOf: [{ type: 'array' }] } }), /invalid_agent_tools/);
});

function review(saved: boolean) {
  const target = saved ? z.enum(['saved-item']) : z.never(), source = z.enum(['c-old', 'c-current']);
  const definition = tool(async () => { throw Error('must_not_execute_service'); }, { name: 'propose_requirement_changes', description: '', schema: z.object({
    retainedIds: z.array(target).max(40), changes: z.array(z.discriminatedUnion('operation', [
      z.object({ operation: z.literal('add'), field: z.enum(['room']), sourceId: source }).strict(),
      z.object({ operation: z.literal('replace'), targetId: target, sourceId: source }).strict(),
      z.object({ operation: z.literal('remove'), targetId: target, sourceId: source }).strict(),
    ])).max(20),
  }).strict() });
  const empty = (name: string) => tool(async () => { throw Error('must_not_execute_service'); }, { name, description: '', schema: z.object({}).strict() });
  return { proposeRequirements: definition, requestDesigner: empty('propose_designer_reception'), cancelDesigner: empty('propose_reception_cancellation'), context: {
    customerClauses: [{ id: 'c-old', sourceMessageId: '11', text: '旧原话', writeEligible: true },
      { id: 'c-current', sourceMessageId: '12', text: '本轮更正', writeEligible: true },
      { id: 'c-question', sourceMessageId: '12', text: '另一个问题？', writeEligible: false }],
    savedItems: saved ? [{ id: 'saved-item' }] : [],
  } } as unknown as Parameters<typeof reviewModelTools>[0];
}

test('no saved targets exposes only additions, and original clauses cannot masquerade as retained or deleted items', async () => {
  const fixture = review(false), scoped = reviewModelTools(fixture, '12')[0];
  assert.ok(!JSON.stringify(scoped.parameters).includes('"remove"'));
  assert.ok(!JSON.stringify(scoped.parameters).includes('"replace"'));
  assert.ok(JSON.stringify(reviewModelTools(fixture)[0].parameters).includes('"remove"'), 'old snapshot projection is retained');
  assert.equal(await toolSchemaIssue(scoped, JSON.stringify({ retainedIds: [], changes: [] })), null);
  assert.equal(await toolSchemaIssue(scoped, JSON.stringify({ retainedIds: [], changes: [{ operation: 'add', field: 'room', sourceId: 'c-old' }] })), null,
    'valid historical additions still follow the original service contract');
  for (const args of [{ retainedIds: ['c-old'], changes: [] }, { retainedIds: [], changes: [{ operation: 'remove', targetId: 'c-old', sourceId: 'c-current' }] }])
    assert.ok(await toolSchemaIssue(scoped, JSON.stringify(args)));
});

test('saved-item removal binds a current writable clause while legitimate historical replacement remains valid', async () => {
  const scoped: ModelTool = reviewModelTools(review(true), '12')[0];
  const remove = (sourceId: string) => ({ retainedIds: [], changes: [{ operation: 'remove', targetId: 'saved-item', sourceId }] });
  assert.equal(await toolSchemaIssue(scoped, JSON.stringify(remove('c-current'))), null);
  for (const source of ['c-old', 'c-question', 'foreign']) assert.ok(await toolSchemaIssue(scoped, JSON.stringify(remove(source))));
  assert.equal(await toolSchemaIssue(scoped, JSON.stringify({ retainedIds: [], changes: [{ operation: 'replace', targetId: 'saved-item', sourceId: 'c-old' }] })), null);
  const upload = reviewModelTools(review(true), 'upload-with-no-original')[0];
  assert.ok(!JSON.stringify(upload.parameters).includes('"remove"'), 'an image notice cannot authorize removing a saved item');
});
