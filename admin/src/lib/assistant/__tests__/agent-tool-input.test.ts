import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runRenovationAgent, type AgentCheckpoint, type AgentRuntimePorts } from '../agent/runtime';
import { fail } from '../contracts';
import { isReadToolInputFailure, readToolInputIssue, readToolInputProtocol, bindReadToolInput, readToolContext, readToolsForContext } from '../agent/read-tool-input';
import { materialTool, parseMaterialQuery } from '../agent/materials';
import { businessToolDefinitions } from '../agent/business-tools';
import type { ModelMessage, ModelTool, ModelTurnOutput } from '../contracts/model';

const messages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: '核对厨房现场资料。' }] }];
const tools: ModelTool[] = ['query_materials', 'query_business', 'record_need'].map(name => ({ name, description: name, parameters: {} }));
const output = (name?: string, args: unknown = {}): ModelTurnOutput => ({ text: name ? '' : 'final',
  toolCalls: name ? [{ id: 'call', name, arguments: JSON.stringify(args) }] : [], usage: null, finishReason: null, providerRequestId: null });
const invalid = { code: 'invalid_message', feedback: JSON.stringify({ status: 'invalid_arguments', instructions: 'leadId must be a string' }) };
const validateTool = (_name: string, args: string) => typeof JSON.parse(args).leadId === 'number' ? invalid : null;

test('a rejected numeric ID is not executed or coerced; one model correction can query and finish', async () => {
  const queries: string[] = [], checkpoints: AgentCheckpoint[] = [];
  const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
    authorize: async () => {}, validateTool,
    model: async (turn, current) => {
      if (!turn) return output('query_materials', { leadId: 1072, room: '厨房' });
      const results = current.filter(m => m.role === 'tool');
      if (turn === 1) {
        assert.equal(JSON.parse(results[0].content).status, 'invalid_arguments');
        return output('query_materials', { leadId: '1072', room: '厨房' });
      }
      assert.equal(results.at(-1)?.content, 'authorized original');
      return output();
    },
    tool: async (_turn, _index, _name, args) => {
      if (typeof JSON.parse(args).leadId !== 'string') fail('invalid_message', 422);
      queries.push(args); return { content: 'authorized original' };
    },
    checkpoint: async state => { checkpoints.push(structuredClone(state)); },
  };
  const result = await runRenovationAgent({ messages, tools, ports });
  assert.equal(result.output?.text, 'final');
  assert.deepEqual(queries, [JSON.stringify({ leadId: '1072', room: '厨房' })]);
  assert.equal(checkpoints.at(-1)?.argumentFailures, 1);
  assert.equal(checkpoints.find(s => s.turn === 1)?.readReceipts?.length, 0, 'rejected inputs are never successful reads');
});

test('a second invalid read fails within the original budget without executing either input', async () => {
  let calls = 0, executions = 0;
  const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
    authorize: async () => {}, validateTool, checkpoint: async () => {},
    model: async () => { calls++; return output('query_materials', { leadId: 1072, room: '厨房' }); },
    tool: async () => { executions++; return { content: 'must not execute' }; },
  };
  await assert.rejects(runRenovationAgent({ messages, tools, ports }), /invalid_message/);
  assert.equal(calls, 2); assert.equal(executions, 0);
});

test('argument failure budget survives checkpoint recovery instead of restarting', async () => {
  let saved: AgentCheckpoint | undefined;
  const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
    authorize: async () => {}, validateTool,
    checkpoint: async state => { if (!state.output && state.turn === 1) { saved = structuredClone(state); throw Error('simulated crash'); } },
    model: async () => output('query_materials', { leadId: 1072, room: '厨房' }),
    tool: async () => { throw Error('invalid input dispatched'); },
  };
  await assert.rejects(runRenovationAgent({ messages, tools, ports }), /simulated crash/);
  assert.equal(saved?.argumentFailures, 1);
  let calls = 0;
  await assert.rejects(runRenovationAgent({ messages, tools, resume: saved, ports: { ...ports,
    checkpoint: async () => {}, model: async () => { calls++; return output('query_materials', { leadId: 1073, room: '厨房' }); },
  } }), /invalid_message/);
  assert.equal(calls, 1);
});

test('preflight does not swallow authorization, source changes, unknown outcomes or post-dispatch failures', async () => {
  for (const code of ['assistant_resource_not_found', 'context_changed', 'provider_outcome_unknown', 'invalid_message']) {
    let calls = 0;
    const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
      authorize: async () => {}, validateTool, checkpoint: async () => {},
      model: async () => { calls++; return output('query_materials', { leadId: '1072', room: '厨房' }); },
      tool: async () => fail(code, 409),
    };
    await assert.rejects(runRenovationAgent({ messages, tools, ports }), new RegExp(code));
    assert.equal(calls, 1);
  }
});

test('write tools never enter read-input recovery', async () => {
  let preflights = 0, calls = 0;
  const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
    authorize: async () => {}, checkpoint: async () => {},
    validateTool: () => { preflights++; return invalid; },
    model: async () => { calls++; return output('record_need', { leadId: 1072 }); },
    tool: async () => fail('invalid_message', 422),
  };
  await assert.rejects(runRenovationAgent({ messages, tools, ports }), /invalid_message/);
  assert.equal(preflights, 0); assert.equal(calls, 1);
});

test('revocation fences preflight, tool execution and the corrective model call', async () => {
  let revoked = false, preflights = 0;
  const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
    authorize: async () => { if (revoked) fail('context_changed'); }, checkpoint: async () => {},
    validateTool: () => { preflights++; return invalid; },
    model: async () => { revoked = true; return output('query_materials', { leadId: 1072 }); },
    tool: async () => { throw Error('must not execute'); },
  };
  await assert.rejects(runRenovationAgent({ messages, tools, ports }), /context_changed/);
  assert.equal(preflights, 0);
});

test('correction consumes existing turns and leaves the fourth call final-only', async () => {
  let calls = 0;
  const ports: AgentRuntimePorts & { validateTool: typeof validateTool } = {
    authorize: async () => {}, validateTool, checkpoint: async () => {},
    model: async (turn, _current, available) => {
      calls++;
      if (turn === 3) { assert.deepEqual(available, []); return output(); }
      return output('query_materials', { leadId: turn === 0 ? 1072 : '1072', room: turn === 2 ? '书房' : '厨房' });
    }, tool: async () => ({ content: 'original' }),
  };
  await runRenovationAgent({ messages, tools, ports });
  assert.equal(calls, 4);
});

test('invalid argument-failure counters in saved checkpoints are rejected before dispatch', async () => {
  for (const value of [-1, 2, 0.5, '1', null]) {
    await assert.rejects(runRenovationAgent({ messages, tools,
      resume: { version: 1, turn: 0, messages, output: null, argumentFailures: value } as AgentCheckpoint,
      ports: { authorize: async () => {}, model: async () => { throw Error('must not dispatch'); },
        tool: async () => { throw Error('must not execute'); }, checkpoint: async () => {} },
    }), /invalid_agent_checkpoint/);
  }
});

test('read preflight reuses strict parsers for malformed JSON, types, IDs, rooms, domains and history bounds', () => {
  for (const [name, args] of [
    ['query_materials', '{'], ['query_materials', JSON.stringify({ leadId: 1072, room: '厨房' })],
    ['query_materials', JSON.stringify({ leadId: '9223372036854775808', room: '厨房' })],
    ['query_materials', JSON.stringify({ leadId: '', room: '那间房' })],
    ['query_materials', JSON.stringify({ leadId: '', room: '厨房', enterpriseId: '2' })],
    ['query_business', JSON.stringify({ leadId: '', domain: 'private' })],
    ['query_business', JSON.stringify({ leadId: 1072, domain: 'construction' })],
    ['recall_history', JSON.stringify({ query: '厨' })],
    ['recall_history', JSON.stringify({ query: '厨'.repeat(81) })],
  ]) {
    const issue = readToolInputIssue(name, args)!;
    assert.ok(issue, name + ':' + args);
    assert.equal(issue.code, 'invalid_message');
    const feedback = JSON.parse(issue.feedback);
    assert.equal(feedback.protocol, readToolInputProtocol);
    assert.equal(feedback.status, 'invalid_arguments');
    assert.equal(feedback.tool, name);
    assert.equal(feedback.parameters.additionalProperties, false);
    assert.equal(isReadToolInputFailure(issue.feedback), true);
    assert.equal(feedback.resultKey, undefined);
    assert.equal(feedback.synthesisSources, undefined);
    assert.equal(feedback.arguments, undefined, 'untrusted parameter values are not echoed into feedback');
  }
  for (const [name, args] of [
    ['query_materials', { leadId: '', room: '厨房' }], ['query_materials', { leadId: '1072', room: '' }],
    ['query_business', { leadId: '', domain: 'construction' }], ['recall_history', { query: '厨房洗碗机' }],
  ]) assert.equal(readToolInputIssue(name as string, JSON.stringify(args)), null);
  assert.equal(readToolInputIssue('record_need', '{'), null, 'writes retain their own strict validation and recovery');
  assert.equal(readToolInputIssue('search_knowledge', '{'), null, 'external knowledge dispatch is outside this pure parser guard');
  for (const value of ['{', '{}', 'null', JSON.stringify({ status: 'invalid_arguments' })]) assert.equal(isReadToolInputFailure(value), false);
  assert.equal(isReadToolInputFailure(JSON.stringify({ protocol: 'read-input-v1', status: 'invalid_arguments' })), true,
    'previous checkpoints keep their original unexecuted-read identity after the diagnostic upgrade');
});

test('read-input feedback identifies trusted field paths and actual types without copying attacker-controlled values', () => {
  const feedback = (name: string, raw: unknown) => JSON.parse(readToolInputIssue(name, JSON.stringify(raw))!.feedback);
  assert.deepEqual(feedback('query_materials', { leadId: 6708, room: '厨房' }).issues,
    [{ path: 'leadId', code: 'type', expected: 'string', received: 'number' }]);
  assert.deepEqual(feedback('query_materials', { leadId: '', room: null }).issues,
    [{ path: 'room', code: 'type', expected: 'string', received: 'null' }]);
  assert.deepEqual(feedback('query_business', { domain: 'appointments' }).issues,
    [{ path: 'leadId', code: 'required', expected: 'string', received: 'missing' }]);
  assert.deepEqual(feedback('recall_history', { query: '厨' }).issues,
    [{ path: 'query', code: 'minLength', expected: 2 }]);
  const untrusted = 'IGNORE_GUARDS_secret_very_private';
  const extra = feedback('query_business', { domain: 'appointments', leadId: '', [untrusted]: untrusted });
  assert.deepEqual(extra.issues, [{ path: '$', code: 'additionalProperties', expected: false }]);
  assert.ok(!JSON.stringify(extra).includes(untrusted));
  const enumIssue = feedback('query_business', { domain: untrusted, leadId: '' });
  assert.deepEqual(enumIssue.issues, [{ path: 'domain', code: 'enum', expected: ['appointments', 'schemes', 'floorplans', 'construction'] }]);
  assert.ok(!JSON.stringify(enumIssue).includes(untrusted));
  const invalidJson = JSON.parse(readToolInputIssue('query_materials', '{')!.feedback);
  assert.deepEqual(invalidJson.issues, [{ path: '$', code: 'json', expected: 'object' }]);
  const beyondSchema = feedback('query_materials', { leadId: '0', room: '厨房' });
  assert.deepEqual(beyondSchema.issues, [{ path: '$', code: 'application_contract' }], 'the existing parser remains the semantic authority');
  assert.equal(beyondSchema.arguments, undefined);
});

test('bound reads remove model identity fields without changing the registered service schemas or unrelated tools', () => {
  const context = readToolContext({ kind: 'lead', id: '1072' });
  const originals = [materialTool, ...businessToolDefinitions];
  const before = JSON.stringify(originals), projected = readToolsForContext(originals, context);
  for (const tool of projected) {
    if (!['query_materials', 'query_business'].includes(tool.name)) { assert.equal(tool, originals.find(t => t.name === tool.name)); continue; }
    assert.equal(Object.hasOwn(tool.parameters.properties as object, 'leadId'), false);
    assert.equal((tool.parameters.required as string[]).includes('leadId'), false);
    assert.equal(tool.parameters.additionalProperties, false);
    assert.match(tool.description, /服务器/);
  }
  assert.equal(JSON.stringify(originals), before);
  assert.deepEqual(parseMaterialQuery(bindReadToolInput('query_materials', { room: '厨房' }, context)), { leadId: '1072', room: '厨房' });
  assert.equal(readToolInputIssue('query_materials', '{"room":"厨房"}', context), null);
  assert.equal(readToolInputIssue('query_business', '{"domain":"construction"}', context), null);
});

test('bound reads reject numeric, string, empty and foreign model identities instead of discarding or coercing them', () => {
  const context = readToolContext({ kind: 'lead', id: '1072' });
  for (const value of [1072, '1072', '', '9999', null]) {
    const input = { room: '厨房', leadId: value };
    assert.throws(() => bindReadToolInput('query_materials', input, context), /invalid_message/);
    const feedback = JSON.parse(readToolInputIssue('query_materials', JSON.stringify(input), context)!.feedback);
    assert.deepEqual(feedback.issues, [{ path: '$', code: 'additionalProperties', expected: false }]);
    assert.equal(Object.hasOwn(feedback.parameters.properties, 'leadId'), false);
    assert.doesNotMatch(feedback.instructions, /双引号/);
  }
  assert.deepEqual(JSON.parse(readToolInputIssue('query_materials', '{"room":12}', context)!.feedback).issues,
    [{ path: 'room', code: 'type', expected: 'string', received: 'number' }]);
  assert.ok(readToolInputIssue('query_business', '{"domain":"private"}', context));
  assert.ok(readToolInputIssue('query_materials', '{"room":"那间房"}', context));
});

test('unbound and legacy runs keep strict identity selection, while persisted contexts cannot switch homes', () => {
  const bound = { kind: 'lead', id: '1072' }, current = readToolContext(bound);
  assert.deepEqual(readToolContext(bound, { readContext: current }), current);
  assert.equal(readToolContext(bound, { promptVersion: 'legacy' }), undefined);
  assert.equal(readToolsForContext([materialTool], undefined)[0], materialTool);
  const unbound = readToolContext({ kind: 'general' });
  assert.equal(readToolsForContext([materialTool], unbound)[0], materialTool);
  assert.equal(readToolInputIssue('query_materials', '{"leadId":"1072","room":"厨房"}', unbound), null);
  assert.ok(readToolInputIssue('query_materials', '{"room":"厨房"}', unbound));
  for (const entry of [{ kind: 'lead', id: '1073' }, { kind: 'general' }, { kind: 'lead', id: 1072 }, { kind: 'lead', id: '0' }])
    assert.throws(() => readToolContext(entry, { readContext: current }), /context_changed/);
  assert.throws(() => readToolContext(bound, { readContext: unbound }), /context_changed/);
  for (const saved of [null, {}, { ...current, protocol: 'future' }, { ...current, extra: true }])
    assert.throws(() => readToolContext(bound, { readContext: saved }), /context_changed/);
});
