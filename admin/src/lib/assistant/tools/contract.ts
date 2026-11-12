import type { ActorContext } from '../contracts';
import type { ModelTool } from '../contracts/model';

/**
 * Provider-neutral tool contract for the Responses API tool-calling loop.
 *
 * A tool definition never contains wire fields, provider names or prompt text.
 * The Bailian Responses adapter only sees the derived `ModelTool` (name,
 * description, JSON Schema); execution, authorization and tracing stay in the
 * application layer.
 */
export const toolDefinitionProtocol = 'assistant-tool-definition-v1';
export const toolExecutionProtocol = 'assistant-tool-execution-v1';
export const toolLoopProtocol = 'assistant-tool-loop-v1';

export const toolEngineLimits = {
  /** Model calls per loop, including the reserved final-answer call. */
  maxTurns: 4,
  maxToolCallsPerTurn: 4,
  maxDefinitions: 32,
  maxNameChars: 64,
  maxDescriptionChars: 2000,
  maxArgumentsBytes: 8000,
  maxResultBytes: 16000,
  defaultTimeoutMs: 10000,
  maxTimeoutMs: 60000,
} as const;

/**
 * `read`: side-effect free, may opt into bounded retries.
 * `write`: a bounded business write; authorization plus durable operation-key
 * idempotency are required and it is never retried automatically.
 * `sensitive`: cost, schedule, construction-plan activation, acceptance or
 * external notification; a separate server-side approval flow is mandatory and
 * a model function_call can never act as that approval.
 */
export type ToolRisk = 'read' | 'write' | 'sensitive';

export type ToolJsonSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type ToolAuthorizationContext = {
  actor: ActorContext;
  /** Server-bound project scope. Never taken from model arguments. */
  projectId: string | null;
  conversationId?: string;
  runId?: string;
};

export type ToolAuthorizationDecision = { allowed: true } | { allowed: false; reason: string };

export type ToolApprovalDecision =
  | { approved: true; approvalId: string }
  | { approved: false; reason: string };

export type ToolApprovalContext = ToolAuthorizationContext & {
  tool: string;
  arguments: Record<string, unknown>;
  operationKey: string;
};

export type ToolExecuteContext = ToolAuthorizationContext & {
  callId: string;
  turn: number;
  tool: string;
  arguments: Record<string, unknown>;
  /** Stable hash over tool, actor, project and canonical arguments. Business
   * tools may use it for their own durable operation-key idempotency. */
  operationKey: string;
  /** Aborted on per-call timeout or caller interruption. Tools should observe it. */
  signal: AbortSignal;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: ToolJsonSchema;
  risk: ToolRisk;
  /** Project-bound business tools reject a call without a server-bound project. */
  requiresProject?: boolean;
  /** Mandatory identity and project permission gate; called on every attempt. */
  authorize(context: ToolAuthorizationContext, args: Record<string, unknown>): Promise<ToolAuthorizationDecision>;
  /** Mandatory for `sensitive` tools. A model function_call can never satisfy it. */
  approval?: (context: ToolApprovalContext) => Promise<ToolApprovalDecision>;
  execute(context: ToolExecuteContext): Promise<unknown>;
  /** Only side-effect-free reads may opt into a bounded retry. */
  retry?: { maxAttempts: number };
  timeoutMs?: number;
};

export type ToolStatus =
  | 'succeeded' | 'failed' | 'denied' | 'invalid_arguments' | 'not_registered'
  | 'duplicate' | 'timeout' | 'interrupted';

export type ToolErrorCode =
  | 'tool_not_registered' | 'tool_invalid_arguments' | 'tool_project_scope_missing'
  | 'tool_permission_denied' | 'tool_approval_required' | 'tool_approval_denied'
  | 'tool_timeout' | 'tool_interrupted' | 'tool_execution_failed' | 'tool_result_invalid';

export type ToolError = { code: ToolErrorCode; message: string };

export type ToolExecutionRecord = {
  protocol: typeof toolExecutionProtocol;
  callId: string;
  tool: string;
  risk: ToolRisk | null;
  status: ToolStatus;
  /** True only when the registered implementation was actually invoked. */
  executed: boolean;
  attempts: number;
  argumentsHash: string;
  operationKey: string;
  actorKey: string;
  projectId: string | null;
  startedAt: string;
  durationMs: number;
  resultHash: string | null;
  resultBytes: number;
  /** Serialized JSON delivered to the model; bounded by maxResultBytes. */
  content: string;
  error?: ToolError;
};

export type ToolCallResult = {
  callId: string;
  ok: boolean;
  status: ToolStatus;
  content: string;
  record: ToolExecutionRecord;
};

export const toolLoopFinalInstruction =
  '本轮为收尾轮，仅提交最终回答，不再调用任何工具。只使用已经取得的工具结果和仍有效的信息；'
  + '工具失败、被拒绝或未执行的部分必须如实说明，不得声称操作成功，不得编造结果或来源。';

/** Structural checks only. Actual argument validation runs against the JSON
 * Schema in the executor via the existing LangChain validator. */
export function toolDefinitionIssue(definition: ToolDefinition): string | null {
  if (!definition || typeof definition !== 'object') return 'definition_not_object';
  if (typeof definition.name !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{1,${toolEngineLimits.maxNameChars}}$`).test(definition.name)) {
    return 'tool_name_invalid';
  }
  if (typeof definition.description !== 'string' || !definition.description.trim()
    || definition.description.length > toolEngineLimits.maxDescriptionChars) return 'tool_description_invalid';
  const schema = definition.parameters as unknown;
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)
    || (schema as Record<string, unknown>).type !== 'object') return 'tool_schema_invalid';
  const required = (schema as Record<string, unknown>).required;
  const properties = (schema as Record<string, unknown>).properties;
  if (required !== undefined && (!Array.isArray(required) || required.some(item => typeof item !== 'string')
    || new Set(required).size !== required.length)) return 'tool_schema_invalid';
  if (required && required.length) {
    // A required field must be declared so its type and description are on the wire.
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return 'tool_schema_invalid';
    if (required.some(name => !(name in (properties as Record<string, unknown>)))) return 'tool_schema_invalid';
  }
  if (!['read', 'write', 'sensitive'].includes(definition.risk)) return 'tool_risk_invalid';
  if (typeof definition.authorize !== 'function') return 'tool_authorize_missing';
  if (typeof definition.execute !== 'function') return 'tool_execute_missing';
  if (definition.risk === 'sensitive' && typeof definition.approval !== 'function') return 'tool_approval_missing';
  if (definition.retry !== undefined) {
    if (definition.risk !== 'read') return 'tool_retry_forbidden';
    if (!Number.isInteger(definition.retry.maxAttempts) || definition.retry.maxAttempts < 1 || definition.retry.maxAttempts > 3) {
      return 'tool_retry_invalid';
    }
  }
  if (definition.timeoutMs !== undefined && (!Number.isInteger(definition.timeoutMs) || definition.timeoutMs < 1
    || definition.timeoutMs > toolEngineLimits.maxTimeoutMs)) return 'tool_timeout_invalid';
  return null;
}

/** The only projection the provider adapter is allowed to see. */
export function toModelTool(definition: ToolDefinition): ModelTool {
  return { name: definition.name, description: definition.description, parameters: definition.parameters };
}
