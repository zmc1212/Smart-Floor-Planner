import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ActorContext } from '../contracts';
import type { ModelToolCall } from '../contracts/model';
import type { ToolDefinition } from '../tools/contract';
import { ToolRegistry } from '../tools/registry';
import { ToolExecutor, type ToolExecutionScope } from '../tools/executor';

const actor: ActorContext = {
  enterpriseId: '1', principal: { kind: 'user', userId: '2' }, contextVersion: 0, capabilities: [],
};

const scope = (overrides: Partial<ToolExecutionScope> = {}): ToolExecutionScope => ({
  actor, projectId: '9', turn: 0, ...overrides,
});

const call = (name: string, args: Record<string, unknown>, id = 'call_1'): ModelToolCall => ({
  id, name, arguments: JSON.stringify(args),
});

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

test('invalid arguments, unregistered tools and project scope failures never dispatch', async () => {
  let executes = 0;
  const registry = new ToolRegistry();
  registry.register(makeTool({ name: 'lookup', execute: async () => { executes++; return {}; } }));
  registry.register(makeTool({ name: 'project_tool', requiresProject: true, execute: async () => { executes++; return {}; } }));
  const executor = new ToolExecutor(registry);

  const invalid = await executor.execute({ id: 'call_bad', name: 'lookup', arguments: 'not-json' }, scope());
  assert.equal(invalid.status, 'invalid_arguments');
  assert.equal(JSON.parse(invalid.content).error.code, 'tool_invalid_arguments');

  const missing = await executor.execute(call('missing', { q: 'x' }), scope());
  assert.equal(missing.status, 'not_registered');
  assert.equal(JSON.parse(missing.content).error.code, 'tool_not_registered');

  const noProject = await executor.execute(call('project_tool', { q: 'x' }), scope({ projectId: null }));
  assert.equal(noProject.status, 'denied');
  assert.equal(JSON.parse(noProject.content).error.code, 'tool_project_scope_missing');
  assert.equal(executes, 0);
});

test('authorization denial and thrown tool errors stay visible as failures', async () => {
  let executes = 0;
  const registry = new ToolRegistry();
  registry.register(makeTool({
    name: 'lookup', authorize: async () => ({ allowed: false, reason: '无权限' }),
    execute: async () => { executes++; return {}; },
  }));
  registry.register(makeTool({
    name: 'broken', execute: async () => { executes++; throw new Error('backend failed'); },
  }));
  const executor = new ToolExecutor(registry);

  const denied = await executor.execute(call('lookup', { q: 'x' }), scope());
  assert.equal(denied.status, 'denied');
  assert.equal(JSON.parse(denied.content).error.code, 'tool_permission_denied');
  assert.equal(JSON.parse(denied.content).dispatched, false);

  const failed = await executor.execute(call('broken', { q: 'x' }), scope());
  assert.equal(failed.status, 'failed');
  assert.equal(JSON.parse(failed.content).error.code, 'tool_execution_failed');
  assert.equal(failed.record.executed, true);
  assert.equal(executes, 1);
});

test('duplicate calls are suppressed and never executed twice', async () => {
  let executes = 0;
  const executor = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { executes++; return { answer: '42' }; },
  })));
  const first = await executor.execute(call('lookup', { q: 'x' }, 'call_1'), scope());
  const second = await executor.execute(call('lookup', { q: 'x' }, 'call_2'), scope());
  assert.equal(first.status, 'succeeded');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.ok, true);
  assert.equal(second.record.executed, false);
  assert.equal(executes, 1);
  assert.equal(JSON.parse(second.content).previousCallId, 'call_1');
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
  const denied = await new ToolExecutor(new ToolRegistry().register(tool))
    .execute(call('change_budget', { q: '12万', approvalId: 'fake-model-approval' }), scope());
  assert.equal(denied.status, 'denied');
  assert.equal(JSON.parse(denied.content).error.code, 'tool_approval_denied');
  assert.equal(executes, 0);
  assert.equal(approvals, 1);

  let approvedExecutes = 0;
  const approved = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'change_budget', risk: 'sensitive',
    approval: async () => ({ approved: true, approvalId: 'approval-2026-0001' }),
    execute: async () => { approvedExecutes++; return { changed: true }; },
  })));
  const result = await approved.execute(call('change_budget', { q: '12万' }), scope());
  assert.equal(result.status, 'succeeded');
  assert.equal(approvedExecutes, 1);
});

test('only read-only tools may retry; writes execute at most once', async () => {
  let readAttempts = 0;
  const read = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'lookup', retry: { maxAttempts: 2 },
    execute: async () => {
      readAttempts++;
      if (readAttempts === 1) throw Object.assign(new Error('transient'), { retryable: true });
      return { ok: true };
    },
  })));
  const readResult = await read.execute(call('lookup', { q: 'x' }), scope());
  assert.equal(readResult.status, 'succeeded');
  assert.equal(readResult.record.attempts, 2);
  assert.equal(readAttempts, 2);

  let writeAttempts = 0;
  const write = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'record_note', risk: 'write',
    execute: async () => { writeAttempts++; throw Object.assign(new Error('transient'), { retryable: true }); },
  })));
  const writeResult = await write.execute(call('record_note', { q: 'x' }), scope());
  assert.equal(writeResult.status, 'failed');
  assert.equal(writeResult.record.attempts, 1);
  assert.equal(writeAttempts, 1);
});

test('a hanging tool times out and stays a visible failure', async () => {
  const executor = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => new Promise(() => {}),
  })), { defaultTimeoutMs: 25 });
  const result = await executor.execute(call('lookup', { q: 'x' }), scope());
  assert.equal(result.status, 'timeout');
  assert.equal(JSON.parse(result.content).error.code, 'tool_timeout');
  assert.equal(result.record.executed, true);
});

test('an aborted scope never dispatches the tool', async () => {
  let executes = 0;
  const executor = new ToolExecutor(new ToolRegistry().register(makeTool({
    name: 'lookup', execute: async () => { executes++; return {}; },
  })));
  const result = await executor.execute(call('lookup', { q: 'x' }), scope({ signal: AbortSignal.abort() }));
  assert.equal(result.status, 'interrupted');
  assert.equal(JSON.parse(result.content).dispatched, false);
  assert.equal(executes, 0);
});
