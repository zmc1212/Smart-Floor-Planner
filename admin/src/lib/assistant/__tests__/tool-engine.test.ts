import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentModelGateway, ModelMessage, ModelToolCall, ModelTurnInput, ModelTurnOutput } from '../contracts/model';
import type { ActorContext } from '../contracts';
import type { ToolDefinition } from '../tools/contract';
import { ToolRegistry } from '../tools/registry';
import { ToolExecutor, type ToolExecutionScope } from '../tools/executor';
import { runToolLoop } from '../tools/loop';
import { bailianResponsesBody } from '@/lib/ai/providers/bailian-responses';

const actor: ActorContext = {
  enterpriseId: '1', principal: { kind: 'user', userId: '2' }, contextVersion: 0, capabilities: [],
};

const userMessages: ModelMessage[] = [{ role: 'user', content: [{ type: 'text', text: '帮我查一下' }] }];

const scope = (overrides: Partial<ToolExecutionScope> = {}): ToolExecutionScope => ({
  actor, projectId: '9', turn: 0, ...overrides,
});

const call = (name: string, args: Record<string, unknown>, id = 'call_1'): ModelToolCall => ({
  id, name, arguments: JSON.stringify(args),
});

function reply(text: string): ModelTurnOutput {
  return { text, toolCalls: [], finishReason: 'stop', providerRequestId: 'resp_text', usage: null };
}

function callTurn(toolCalls: ModelToolCall[], text = ''): ModelTurnOutput {
  return { text, toolCalls, finishReason: 'tool_calls', providerRequestId: 'resp_tool', usage: null };
}

function gateway(responses: ModelTurnOutput[]) {
  const seen: Array<Omit<ModelTurnInput, 'model'>> = [];
  let index = 0;
  const value: AgentModelGateway & { seen: typeof seen } = {
    capabilities: {
      text: true, imageInput: false, toolCalling: true, structuredOutput: false,
      streaming: false, usageReporting: false, contextLimit: 16000, maxImages: 4, maxImageBytes: 4 * 1024 * 1024,
    },
    async generate(input) {
      seen.push(structuredClone(input));
      const response = responses[Math.min(index, responses.length - 1)];
      index++;
      return { ...response, attemptId: `attempt_${index}` };
    },
    seen,
  };
  return value;
}

function makeTool(overrides: Partial<ToolDefinition> & Pick<ToolDefinition, 'name'>): ToolDefinition {
  const { name, ...rest } = overrides;
  return {
    description: '测试工具',
    parameters: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false },
    risk: 'read',
    authorize: async () => ({ allowed: true }),
    execute: async () => ({ ok: true }),
    ...rest,
    name,
  };
}

test('tool definitions are validated, unique and projected without provider fields', () => {
  const registry = new ToolRegistry();
  const lookup = makeTool({ name: 'lookup' });
  registry.register(lookup);
  assert.deepEqual(registry.toModelTools(), [{
    name: 'lookup', description: lookup.description, parameters: lookup.parameters,
  }]);
  assert.throws(() => registry.register(lookup), /duplicate_tool_definition/);
  assert.throws(() => new ToolRegistry().register(makeTool({ name: 'bad name' })), /tool_name_invalid/);
  assert.throws(() => new ToolRegistry().register(makeTool({ name: 'approve', risk: 'sensitive' })), /tool_approval_missing/);
  assert.throws(() => new ToolRegistry().register(makeTool({
    name: 'write', risk: 'write', retry: { maxAttempts: 2 },
  })), /tool_retry_forbidden/);
  assert.throws(() => new ToolRegistry().register(makeTool({
    name: 'schema', parameters: { type: 'object', required: ['q'] },
  })), /tool_schema_invalid/);
});

test('a request without tool calls returns the final answer and never dispatches', async () => {
  const registry = new ToolRegistry();
  let executes = 0;
  registry.register(makeTool({ name: 'lookup', execute: async () => { executes++; return {}; } }));
  const model = gateway([reply('你好，可以直接回答')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.text, '你好，可以直接回答');
  assert.equal(outcome.turns.length, 1);
  assert.equal(executes, 0);
  assert.deepEqual(model.seen[0].tools.map(tool => tool.name), ['lookup']);
});

test('a single tool call executes once and is returned as function_call_output', async () => {
  const seen: string[] = [];
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup',
    execute: async input => { seen.push(input.callId); return { answer: '42' }; },
  }));
  const model = gateway([callTurn([call('lookup', { q: '面积' })]), reply('面积是 42')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.text, '面积是 42');
  assert.deepEqual(seen, ['call_1']);
  assert.equal(outcome.records.length, 1);
  assert.equal(outcome.records[0].status, 'succeeded');
  assert.equal(outcome.records[0].executed, true);
  const toolMessage = outcome.messages.find(message => message.role === 'tool')!;
  assert.equal(toolMessage.role === 'tool' ? toolMessage.callId : null, 'call_1');

  // The same transcript becomes the documented Responses wire items.
  const body = bailianResponsesBody({
    model: 'qwen3.7-flash', messages: outcome.messages, tools: registry.toModelTools(), maxTokens: 256,
  });
  const items = body.input as Array<Record<string, unknown>>;
  assert.deepEqual(items.map(item => String(item.type ?? 'message')),
    ['message', 'function_call', 'function_call_output', 'message']);
  const output = items[2];
  assert.equal(output.type, 'function_call_output');
  assert.equal(output.call_id, 'call_1');
  assert.equal('previous_response_id' in body, false);
  assert.equal(body.store, false);
});

test('assistant text becomes a message item before its function_call items', () => {
  const body = bailianResponsesBody({
    model: 'qwen3.7-flash', maxTokens: 256, tools: [{ name: 'lookup', description: '查询', parameters: { type: 'object' } }],
    messages: [
      { role: 'user', content: [{ type: 'text', text: '查一下' }] },
      { role: 'assistant', content: '我先查一下', toolCalls: [{ id: 'call_1', name: 'lookup', arguments: '{}' }] },
      { role: 'tool', callId: 'call_1', content: '{"ok":true}' },
    ],
  });
  const items = body.input as Array<Record<string, unknown>>;
  assert.deepEqual(items.map(item => String(item.type ?? 'message')),
    ['message', 'message', 'function_call', 'function_call_output']);
  assert.deepEqual(items[1], {
    type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '我先查一下' }],
  });
});

test('multiple tool calls in one turn are executed in order', async () => {
  const executed: string[] = [];
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async input => { executed.push(String(input.arguments.q)); return { q: input.arguments.q }; },
  }));
  const model = gateway([callTurn([
    call('lookup', { q: 'a' }, 'call_a'), call('lookup', { q: 'b' }, 'call_b'),
  ]), reply('两处都查到了')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(executed, ['a', 'b']);
  assert.deepEqual(outcome.messages.filter(message => message.role === 'tool').map(message => message.role === 'tool' ? message.callId : ''),
    ['call_a', 'call_b']);
});

test('consecutive tool turns keep a bounded, paired transcript', async () => {
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async input => ({ q: input.arguments.q }),
  }));
  const model = gateway([
    callTurn([call('lookup', { q: 'first' }, 'call_1')]),
    callTurn([call('lookup', { q: 'second' }, 'call_2')]),
    reply('汇总完成'),
  ]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.turns.length, 3);
  assert.equal(outcome.records.length, 2);
  assert.deepEqual(outcome.records.map(record => record.operationKey === outcome.records[0].operationKey), [true, false]);
});

test('invalid arguments are rejected before dispatch with a recoverable failure', async () => {
  let executes = 0;
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { executes++; return {}; },
  }));
  for (const raw of ['{"q":123}', '{"wrong":1}', '{bad']) {
    const model = gateway([callTurn([{ id: 'call_1', name: 'lookup', arguments: raw }]), reply('参数有误')]);
    const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.records[0].status, 'invalid_arguments');
    assert.equal(JSON.parse(outcome.records[0].content).ok, false);
  }
  assert.equal(executes, 0);
});

test('an unregistered tool is never executed', async () => {
  let executes = 0;
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { executes++; return {}; },
  }));
  const model = gateway([callTurn([call('eval', { code: 'process.exit()' })]), reply('无法执行该工具')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(executes, 0);
  assert.equal(outcome.records[0].status, 'not_registered');
  assert.equal(JSON.parse(outcome.records[0].content).error.code, 'tool_not_registered');
});

test('authorization denial blocks execution and keeps the real failure reason', async () => {
  let executes = 0;
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', authorize: async () => ({ allowed: false, reason: '项目不属于当前客户' }),
    execute: async () => { executes++; return {}; },
  }));
  const model = gateway([callTurn([call('lookup', { q: 'x' })]), reply('没有权限')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(executes, 0);
  assert.equal(outcome.records[0].status, 'denied');
  assert.equal(outcome.records[0].error?.code, 'tool_permission_denied');
  assert.match(outcome.records[0].error?.message ?? '', /项目不属于当前客户/);
});

test('a project-bound tool without a server-bound project scope is denied', async () => {
  let authorizes = 0, executes = 0;
  const registry = new ToolRegistry().register(makeTool({
    name: 'construction_read', requiresProject: true,
    authorize: async () => { authorizes++; return { allowed: true }; },
    execute: async () => { executes++; return {}; },
  }));
  const model = gateway([callTurn([call('construction_read', { q: 'x' })]), reply('缺少项目范围')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: null } });
  assert.equal(authorizes, 0);
  assert.equal(executes, 0);
  assert.equal(outcome.records[0].error?.code, 'tool_project_scope_missing');
});

test('a thrown tool error is reported as failed, never as success', async () => {
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { throw new Error('backend unavailable'); },
  }));
  const model = gateway([callTurn([call('lookup', { q: 'x' })]), reply('查询失败，请稍后再试')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.records[0].status, 'failed');
  assert.equal(outcome.records[0].executed, true);
  const content = JSON.parse(outcome.records[0].content);
  assert.equal(content.ok, false);
  assert.equal(content.error.code, 'tool_execution_failed');
  assert.match(content.error.message, /backend unavailable/);
});

test('duplicate calls are suppressed within the run and never submitted twice', async () => {
  let executes = 0;
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { executes++; return { rows: 1 }; },
  }));
  const model = gateway([callTurn([
    call('lookup', { q: 'same' }, 'call_1'), call('lookup', { q: 'same' }, 'call_2'),
  ]), reply('结果已返回')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(executes, 1);
  assert.deepEqual(outcome.records.map(record => record.status), ['succeeded', 'duplicate']);
  assert.equal(JSON.parse(outcome.records[1].content).duplicate, true);
  assert.equal(JSON.parse(outcome.records[1].content).previousCallId, 'call_1');
});

test('a hanging tool times out and the failure stays visible to the model', async () => {
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', timeoutMs: 20, execute: async () => new Promise(() => {}),
  }));
  const model = gateway([callTurn([call('lookup', { q: 'x' })]), reply('超时了')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.records[0].status, 'timeout');
  assert.equal(JSON.parse(outcome.records[0].content).error.code, 'tool_timeout');
});

test('an interrupted run stops without fabricating a final answer', async () => {
  const registry = new ToolRegistry().register(makeTool({ name: 'lookup' }));
  const controller = new AbortController();
  controller.abort();
  const model = gateway([reply('不会到达')]);
  const outcome = await runToolLoop({
    gateway: model, registry, messages: userMessages,
    context: { actor, projectId: '9', signal: controller.signal },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'tool_loop_interrupted');
  assert.equal(outcome.text, '');
  assert.equal(model.seen.length, 0);
});

test('a sensitive tool requires the server approval flow, not model arguments', async () => {
  let executes = 0, approvals = 0;
  const tool = makeTool({
    name: 'change_budget', risk: 'sensitive',
    parameters: {
      type: 'object', properties: { q: { type: 'string' }, approvalId: { type: 'string' } },
      required: ['q'], additionalProperties: false,
    },
    approval: async () => { approvals++; return { approved: false, reason: '预算变更未获项目经理批准' }; },
    execute: async () => { executes++; return {}; },
  });
  const registry = new ToolRegistry().register(tool);
  const model = gateway([callTurn([call('change_budget', { q: '12万', approvalId: 'fake-model-approval' })]),
    reply('变更未获授权')]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(executes, 0);
  assert.equal(approvals, 1);
  assert.equal(outcome.records[0].status, 'denied');
  assert.equal(outcome.records[0].error?.code, 'tool_approval_denied');

  let approvedExecutes = 0;
  const approved = new ToolRegistry().register(makeTool({
    name: 'change_budget', risk: 'sensitive',
    approval: async () => ({ approved: true, approvalId: 'approval-2026-0001' }),
    execute: async () => { approvedExecutes++; return { changed: true }; },
  }));
  const approvedModel = gateway([callTurn([call('change_budget', { q: '12万' })]), reply('已按审批变更')]);
  const approvedOutcome = await runToolLoop({
    gateway: approvedModel, registry: approved, messages: userMessages, context: { actor, projectId: '9' },
  });
  assert.equal(approvedExecutes, 1);
  assert.equal(approvedOutcome.records[0].status, 'succeeded');
});

test('only read-only tools may retry; writes execute at most once', async () => {
  let readAttempts = 0;
  const read = new ToolRegistry().register(makeTool({
    name: 'lookup', retry: { maxAttempts: 2 },
    execute: async () => {
      readAttempts++;
      if (readAttempts === 1) throw Object.assign(new Error('transient'), { retryable: true });
      return { ok: true };
    },
  }));
  const readModel = gateway([callTurn([call('lookup', { q: 'x' })]), reply('恢复成功')]);
  const readOutcome = await runToolLoop({
    gateway: readModel, registry: read, messages: userMessages, context: { actor, projectId: '9' },
  });
  assert.equal(readAttempts, 2);
  assert.equal(readOutcome.records[0].attempts, 2);
  assert.equal(readOutcome.records[0].status, 'succeeded');

  let writeAttempts = 0;
  const write = new ToolRegistry().register(makeTool({
    name: 'record_note', risk: 'write',
    execute: async () => { writeAttempts++; throw Object.assign(new Error('transient'), { retryable: true }); },
  }));
  const writeModel = gateway([callTurn([call('record_note', { q: 'x' })]), reply('保存失败')]);
  const writeOutcome = await runToolLoop({
    gateway: writeModel, registry: write, messages: userMessages, context: { actor, projectId: '9' },
  });
  assert.equal(writeAttempts, 1);
  assert.equal(writeOutcome.records[0].attempts, 1);
  assert.equal(writeOutcome.records[0].status, 'failed');
});

test('the loop reserves the final turn for an answer and stops an endless tool loop', async () => {
  const registry = new ToolRegistry().register(makeTool({ name: 'lookup' }));
  const model = gateway([callTurn([call('lookup', { q: 'x' }, 'call_1')])]);
  const outcome = await runToolLoop({
    gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' }, maxTurns: 3,
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'tool_loop_limit');
  assert.equal(model.seen.length, 3);
  assert.deepEqual(model.seen[2].tools, []);
  assert.match(JSON.stringify(model.seen[2].messages), /收尾轮/);
  // Only the two tool-capable turns executed anything.
  assert.equal(outcome.records.length, 2);
});

test('a turn with too many tool calls is rejected before any execution', async () => {
  let executes = 0;
  const registry = new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { executes++; return {}; },
  }));
  const model = gateway([callTurn(Array.from({ length: 5 }, (_, index) => call('lookup', { q: String(index) }, `call_${index}`)))]);
  const outcome = await runToolLoop({ gateway: model, registry, messages: userMessages, context: { actor, projectId: '9' } });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'tool_call_limit');
  assert.equal(executes, 0);
});

test('an expired deadline stops the loop before another model call', async () => {
  const registry = new ToolRegistry().register(makeTool({ name: 'lookup' }));
  const model = gateway([reply('不会到达')]);
  const outcome = await runToolLoop({
    gateway: model, registry, messages: userMessages,
    context: { actor, projectId: '9', deadlineAt: Date.now() - 1 },
  });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.code, 'tool_loop_timeout');
  assert.equal(model.seen.length, 0);
});

test('the executor records the real result, hash and identity for audit', async () => {
  const executor = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => ({ rows: [{ id: 'r1' }] }),
  })));
  const result = await executor.execute(call('lookup', { q: 'x' }), scope());
  assert.equal(result.ok, true);
  const record = result.record;
  assert.match(record.argumentsHash, /^[a-f0-9]{64}$/);
  assert.match(record.operationKey, /^[a-f0-9]{64}$/);
  assert.match(record.resultHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(record.actorKey, 'user:2');
  assert.equal(record.projectId, '9');
  assert.equal(record.executed, true);
  assert.deepEqual(JSON.parse(record.content), {
    ok: true, tool: 'lookup', callId: 'call_1', result: { rows: [{ id: 'r1' }] },
  });
});
