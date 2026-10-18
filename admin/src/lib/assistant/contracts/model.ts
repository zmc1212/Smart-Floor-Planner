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
};
export type ModelTurnOutput = {
  text: string; toolCalls: ModelToolCall[]; finishReason: string | null; providerRequestId: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
};
export interface AgentModelGateway {
  readonly capabilities: ModelCapabilities;
  generate(input: Omit<ModelTurnInput, 'model'>): Promise<ModelTurnOutput & { attemptId: string }>;
}

/** Conservative application budgets, not a claim about a provider's advertised maximums. */
export const agentModelLimits = { contextLimit: 16000, maxImages: 4, maxImageBytes: 4 * 1024 * 1024,
  maxOutputTokens: 2048, maxToolCalls: 4, maxModelTurns: 4, maxTextBytes: 48000 } as const;
