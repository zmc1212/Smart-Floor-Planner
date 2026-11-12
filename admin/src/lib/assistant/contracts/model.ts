/** Versioned provider-neutral contract. Images are resolved by the server, never fetched from model/client URLs. */
export type ModelCapabilities = {
  text: boolean; imageInput: boolean; toolCalling: boolean; structuredOutput: boolean;
  streaming: boolean; usageReporting: boolean; contextLimit: number;
  maxImages: number; maxImageBytes: number;
};
export type ModelTool = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelToolCall = { id: string; name: string; arguments: string };
export type ModelPart = { type: 'text'; text: string }
  | { type: 'image'; mediaId: string; hash: string; mimeType: 'image/jpeg' | 'image/png'; data: string };
export type ModelMessage = { role: 'system' | 'user'; content: ModelPart[] }
  | { role: 'assistant'; content: string; toolCalls?: ModelToolCall[] }
  | { role: 'tool'; callId: string; content: string };
export type ModelTurnInput = {
  model: string; messages: ModelMessage[]; tools: ModelTool[];
  maxTokens: number; enableThinking?: boolean; jsonOutput?: boolean; requireTool?: boolean;
  /** Explicit native-workflow generation setting; ordinary Agent turns retain 0. */
  temperature?: number;
  /** Server-selected native final channel; business/tool turns stay function calling. */
  outputMode?: 'json_object' | 'json_schema' | 'function_call';
  /** Server-bound report final allocation; never a provider wire argument. */
  reportFinalOutputTokens?: typeof reportFinalOutputTokenLimit;
  cacheControl?: 'implicit' | 'ephemeral_system';
  /** Server-bound opt-in only; never emitted as a provider/model argument. */
  profile?: 'bailian-deepseek-flash-consultation-v1' | 'bailian-qwen37-flash-long-v1'; deadlineAt?: number;
};
export type ModelTurnOutput = {
  text: string; toolCalls: ModelToolCall[]; finishReason: string | null; providerRequestId: string | null;
  /** Provider-side native tool evidence (Bailian Responses API only). Absent on
   * the Chat Completions wire so existing runs and checkpoints are unchanged. */
  nativeTools?: import('./native-tools').NativeToolEvidence;
  /** Server-created wire compatibility evidence, retained only in private run
   * checkpoints. Never copied to safe provider metadata or customer messages. */
  wireNormalization?: { protocol: 'qwen37-final-trailing-brace-v1'; rawArguments: string; normalizedHash: string };
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number; cacheWriteInputTokens?: number } | null;
  observation?: { latencyMs: number; cache: ReturnType<typeof import('@/lib/ai/providers/model-observation').cacheObservation>;
    prefix: ReturnType<typeof import('@/lib/ai/providers/model-observation').modelPrefixObservation>;
    /** Wire protocol actually used; Chat Completions is the pre-existing default. */
    protocol?: 'chat-completions' | 'responses';
    /** Metadata-only request evidence for the Responses wire. */
    request?: Record<string, unknown>;
    /** Provider-side retries performed after an explicit pre-execution rejection. */
    retries?: number;
    format?: { mode:string;jsonValid:boolean;schemaValid:boolean|null;schemaValidation?:'application' } };
  /** Application bridge metadata; never parsed from provider-controlled fields. */
  toolProtocolFeedback?: { code: 'mixed_final_response'; text: string };
};
export interface AgentModelGateway {
  readonly capabilities: ModelCapabilities;
  generate(input: Omit<ModelTurnInput, 'model'>): Promise<ModelTurnOutput & { attemptId: string }>;
}

/** Conservative application budgets, not a claim about a provider's advertised maximums. */
export const agentModelLimits = { contextLimit: 16000, maxImages: 4, maxImageBytes: 4 * 1024 * 1024,
  maxOutputTokens: 2048, maxToolCalls: 4, maxModelTurns: 4, maxTextBytes: 48000 } as const;
export const reportFinalOutputTokenLimit = 4096 as const;
