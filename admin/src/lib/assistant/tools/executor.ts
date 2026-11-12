import { fingerprint, principalKey, type ActorContext } from '../contracts';
import type { ModelToolCall } from '../contracts/model';
import { toolSchemaIssue } from '../agent/tool-protocol';
import {
  toolEngineLimits, toolExecutionProtocol, toModelTool,
  type ToolApprovalDecision, type ToolAuthorizationDecision, type ToolCallResult, type ToolDefinition,
  type ToolErrorCode, type ToolExecuteContext, type ToolExecutionRecord, type ToolStatus,
} from './contract';
import type { ToolRegistry } from './registry';

export type ToolExecutionScope = {
  actor: ActorContext;
  /** Server-bound project scope. Model arguments can never widen it. */
  projectId: string | null;
  conversationId?: string;
  runId?: string;
  turn: number;
  signal?: AbortSignal;
  deadlineAt?: number;
};

export type ToolExecutorOptions = {
  now?: () => Date;
  defaultTimeoutMs?: number;
  maxResultBytes?: number;
  /** Internal audit hook; the run checkpoint stays the durable record. */
  onRecord?: (record: ToolExecutionRecord) => void;
};

type AttemptOutcome =
  | { kind: 'value'; value: unknown }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' }
  | { kind: 'interrupted' };

type ParsedArguments = { ok: true; value: Record<string, unknown> } | { ok: false; message: string };

function nowMs(now: () => Date) {
  return now().getTime();
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown');
  return message.replace(/\s+/g, ' ').slice(0, 300) || 'unknown_error';
}

/** Bound a UTF-8 string without splitting a code point. */
function truncateUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  let low = 0, high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(text.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, low);
}

function parseArguments(call: ModelToolCall): ParsedArguments {
  if (typeof call.arguments !== 'string' || Buffer.byteLength(call.arguments) > toolEngineLimits.maxArgumentsBytes) {
    return { ok: false, message: 'arguments_too_large_or_not_string' };
  }
  let value: unknown;
  try { value = JSON.parse(call.arguments); } catch { return { ok: false, message: 'arguments_not_json' }; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, message: 'arguments_not_object' };
  return { ok: true, value: value as Record<string, unknown> };
}

function approvalValid(decision: ToolApprovalDecision | null | undefined): decision is { approved: true; approvalId: string } {
  return !!decision && decision.approved === true && typeof decision.approvalId === 'string'
    && /^[A-Za-z0-9._:-]{1,128}$/.test(decision.approvalId);
}

function authorizationValid(decision: ToolAuthorizationDecision | null | undefined): decision is { allowed: true } {
  return !!decision && decision.allowed === true;
}

/**
 * Executes one model-requested tool call. Every failure is returned as a
 * serialized `ok:false` result; nothing is thrown to the model and no result is
 * ever promoted to success.
 *
 * One executor belongs to one run: its operation ledger is the in-run duplicate
 * guard. Durable cross-run idempotency stays with each business tool, which
 * receives the stable `operationKey`. A timed-out write may still complete on
 * the backend, so write tools must use that key for durable deduplication.
 */
export class ToolExecutor {
  private readonly ledger = new Map<string, { callId: string; content: string; value: unknown }>();
  private readonly log: ToolExecutionRecord[] = [];

  constructor(private readonly registry: ToolRegistry, private readonly options: ToolExecutorOptions = {}) {}

  records(): readonly ToolExecutionRecord[] {
    return this.log;
  }

  async execute(call: ModelToolCall, scope: ToolExecutionScope): Promise<ToolCallResult> {
    const now = this.options.now ?? (() => new Date());
    const started = nowMs(now);
    const startedAt = now().toISOString();
    const parsed = parseArguments(call);
    const argumentsHash = fingerprint(parsed.ok ? parsed.value : String(call.arguments ?? ''));
    const definition = this.registry.get(call.name);
    const operationKey = fingerprint({
      protocol: toolExecutionProtocol, tool: call.name, actor: principalKey(scope.actor),
      enterpriseId: scope.actor.enterpriseId, projectId: scope.projectId,
      arguments: parsed.ok ? parsed.value : String(call.arguments ?? ''),
    });

    const finish = (status: ToolStatus, content: string, extra: {
      executed?: boolean; attempts?: number; risk?: ToolDefinition['risk'] | null;
      error?: { code: ToolErrorCode; message: string };
    } = {}): ToolCallResult => {
      const record: ToolExecutionRecord = {
        protocol: toolExecutionProtocol, callId: call.id, tool: call.name, risk: extra.risk ?? definition?.risk ?? null,
        status, executed: extra.executed === true, attempts: extra.attempts ?? 0,
        argumentsHash, operationKey, actorKey: principalKey(scope.actor), projectId: scope.projectId,
        startedAt, durationMs: Math.max(0, nowMs(now) - started),
        resultHash: fingerprint(content), resultBytes: Buffer.byteLength(content),
        content, ...(extra.error ? { error: extra.error } : {}),
      };
      this.log.push(record);
      this.options.onRecord?.(record);
      // A duplicate is a usable result that was deliberately not executed again.
      return { callId: call.id, ok: status === 'succeeded' || status === 'duplicate', status, content, record };
    };

    const fail = (status: ToolStatus, code: ToolErrorCode, message: string, extra: {
      executed?: boolean; attempts?: number; risk?: ToolDefinition['risk'] | null;
    } = {}) => finish(status, JSON.stringify({
      ok: false, tool: call.name, callId: call.id, status,
      error: { code, message }, dispatched: extra.executed === true,
      instruction: '该工具未成功执行，结果不可当作成功。不得声称操作已完成或编造结果。',
    }), { ...extra, error: { code, message } });

    if (scope.signal?.aborted) return fail('interrupted', 'tool_interrupted', '调用已被中断，工具未执行');
    if (scope.deadlineAt !== undefined && nowMs(now) >= scope.deadlineAt) {
      return fail('timeout', 'tool_timeout', '本轮已超过总时限，工具未执行');
    }
    if (!definition) return finish('not_registered', JSON.stringify({
      ok: false, tool: call.name, callId: call.id, status: 'not_registered',
      error: { code: 'tool_not_registered', message: '模型请求了未注册的工具' }, dispatched: false,
      instruction: '该工具不存在，不得执行或声称已执行。',
    }), { error: { code: 'tool_not_registered', message: '模型请求了未注册的工具' } });

    if (!parsed.ok) return fail('invalid_arguments', 'tool_invalid_arguments', parsed.message);
    let schemaIssue: { code: string; feedback: string } | null = null;
    try { schemaIssue = await toolSchemaIssue(toModelTool(definition), call.arguments); }
    catch (error) {
      return fail('invalid_arguments', 'tool_invalid_arguments', `schema_validation_failed:${errorMessage(error)}`);
    }
    if (schemaIssue) return fail('invalid_arguments', 'tool_invalid_arguments', '参数未通过工具 JSON Schema 校验（必填字段或类型不符）');

    if (definition.requiresProject && !scope.projectId) {
      return fail('denied', 'tool_project_scope_missing', '缺少服务端绑定的项目范围，未执行');
    }

    const authContext = {
      actor: scope.actor, projectId: scope.projectId,
      ...(scope.conversationId ? { conversationId: scope.conversationId } : {}),
      ...(scope.runId ? { runId: scope.runId } : {}),
    };
    let authorization: ToolAuthorizationDecision | null = null;
    try { authorization = await definition.authorize(authContext, parsed.value); }
    catch (error) { return fail('denied', 'tool_permission_denied', `authorization_failed:${errorMessage(error)}`); }
    if (!authorizationValid(authorization)) {
      const reason = authorization && authorization.allowed === false ? authorization.reason : '未获得明确授权';
      return fail('denied', 'tool_permission_denied', String(reason).slice(0, 200) || '未获得明确授权');
    }

    if (definition.risk === 'sensitive') {
      if (!definition.approval) return fail('denied', 'tool_approval_required', '该操作需要独立授权流程，当前未配置审批端口');
      let decision: ToolApprovalDecision | null = null;
      try {
        decision = await definition.approval({ ...authContext, tool: definition.name, arguments: parsed.value, operationKey });
      } catch (error) { return fail('denied', 'tool_approval_denied', `approval_failed:${errorMessage(error)}`); }
      if (!approvalValid(decision)) {
        const reason = decision && decision.approved === false ? decision.reason : '审批未通过';
        return fail('denied', 'tool_approval_denied', String(reason).slice(0, 200) || '审批未通过');
      }
    }

    const previous = this.ledger.get(operationKey);
    if (previous) {
      return finish('duplicate', JSON.stringify({
        ok: true, tool: definition.name, callId: call.id, status: 'duplicate', duplicate: true,
        previousCallId: previous.callId,
        instruction: '相同参数的调用已执行过，本次未重复执行或提交。可直接使用此前结果。',
        result: previous.value,
      }));
    }

    const maxAttempts = definition.risk === 'read' && definition.retry ? definition.retry.maxAttempts : 1;
    const timeoutMs = definition.timeoutMs ?? this.options.defaultTimeoutMs ?? toolEngineLimits.defaultTimeoutMs;
    let attempts = 0;
    for (;;) {
      attempts++;
      const outcome = await this.attempt(definition, {
        ...authContext, callId: call.id, turn: scope.turn, tool: definition.name,
        arguments: parsed.value, operationKey,
      }, timeoutMs, scope.signal);
      if (outcome.kind === 'interrupted') {
        return fail('interrupted', 'tool_interrupted', '调用已被中断', { executed: true, attempts });
      }
      if (outcome.kind === 'timeout') {
        if (attempts < maxAttempts) continue;
        return fail('timeout', 'tool_timeout', `工具执行超过 ${timeoutMs}ms 未完成`, { executed: true, attempts });
      }
      if (outcome.kind === 'error') {
        const retryable = definition.risk === 'read'
          && !!(outcome.error && typeof outcome.error === 'object' && (outcome.error as { retryable?: unknown }).retryable === true);
        if (retryable && attempts < maxAttempts) continue;
        return fail('failed', 'tool_execution_failed', errorMessage(outcome.error), { executed: true, attempts });
      }

      const encoded = this.encodeResult(definition.name, call.id, outcome.value);
      if (!encoded) return fail('failed', 'tool_result_invalid', '工具返回值无法序列化为 JSON', { executed: true, attempts });
      const maxResultBytes = this.options.maxResultBytes ?? toolEngineLimits.maxResultBytes;
      let content = encoded;
      if (Buffer.byteLength(content) > maxResultBytes) {
        content = JSON.stringify({
          ok: true, tool: definition.name, callId: call.id, truncated: true,
          instruction: '工具结果超出上限，已截断预览；不得据此推断被截断部分的内容。',
          resultPreview: truncateUtf8(encoded, Math.max(256, maxResultBytes - 512)),
        });
      }
      this.ledger.set(operationKey, { callId: call.id, content, value: outcome.value === undefined ? null : outcome.value });
      return finish('succeeded', content, { executed: true, attempts });
    }
  }

  private encodeResult(tool: string, callId: string, value: unknown): string | null {
    try {
      return JSON.stringify({ ok: true, tool, callId, result: value === undefined ? null : value });
    } catch { return null; }
  }

  private async attempt(
    definition: ToolDefinition,
    input: Omit<ToolExecuteContext, 'signal'>,
    timeoutMs: number,
    external?: AbortSignal,
  ): Promise<AttemptOutcome> {
    if (external?.aborted) return { kind: 'interrupted' };
    const controller = new AbortController();
    let reason: 'timeout' | 'interrupted' | null = null;
    const onAbort = () => { reason = 'interrupted'; controller.abort(); };
    external?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { reason = 'timeout'; controller.abort(); }, timeoutMs);
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('tool_aborted')), { once: true });
    });
    try {
      const value = await Promise.race([
        Promise.resolve().then(() => definition.execute({ ...input, signal: controller.signal })),
        aborted,
      ]);
      return { kind: 'value', value };
    } catch (error) {
      if (reason === 'interrupted') return { kind: 'interrupted' };
      if (reason === 'timeout') return { kind: 'timeout' };
      return { kind: 'error', error };
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  }
}
