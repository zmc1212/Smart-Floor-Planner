import { createHash } from 'node:crypto';

export type Principal = { kind: 'user'; userId: string } | { kind: 'admin'; adminId: string };
export type ActorContext = {
  enterpriseId: string; principal: Principal; contextVersion: number;
  capabilities: readonly string[]; entry?: Record<string, unknown>;
};
export type MessageBlock = { type: 'text'; text: string }
  | { type: 'citation'; citationId: string; fallbackText: string }
  | { type: 'notice'; code: string; fallbackText: string };
export type MessageContent = { version: 1; blocks: MessageBlock[] };
export type InvocationOwner = { kind: 'generation'; generationId: bigint }
  | { kind: 'assistant_run'; runId: bigint } | { kind: 'knowledge_job'; jobId: bigint };
export type RunTrigger = { kind: 'user_message'; messageId: string }
  | { kind: 'domain_event'; eventId: string } | { kind: 'scheduled_task'; occurrenceKey: string };
export type ResourceRef = { type: string; id: string; version?: string };
export type Evidence = { ref: ResourceRef; text: string; hash: string; similarity?:number };
export interface ContextProvider {
  authorize(actor: ActorContext, ref: ResourceRef): Promise<boolean>;
  resolve(actor: ActorContext, ref: ResourceRef): Promise<Evidence[]>;
}
export interface KnowledgeRetriever {
  retrieve(actor: ActorContext, query: string, epoch: number): Promise<Evidence[]>;
}
export interface EmbeddingGateway {
  readonly profile: { model: string; revision: string; dimensions: number };
  embed(texts: string[], kind: 'query' | 'document'): Promise<{
    vectors: number[][]; usage: { inputTokens: number } | null;
  }>;
}
export interface TextModelGateway {
  readonly capabilities: { streaming: boolean; toolCalling: boolean; usage: boolean };
  generate(input: { enterpriseId: string; owner: InvocationOwner; messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>; maxTokens: number }): Promise<{
    text: string; attemptId: string; finishReason: string | null;
    usage: { inputTokens: number; outputTokens: number } | null; providerRequestId: string | null;
  }>;
}
export type DomainEvent = {
  id: string; type: string; version: number; enterpriseId: string; aggregateRef: ResourceRef;
  aggregateVersion: number; actorRef: Principal | { kind: 'system' }; occurredAt: string;
  correlationId: string; causationId?: string; payload: Record<string, unknown>;
};
export class AssistantError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
export function fail(code: string, status = 409): never { throw new AssistantError(code, status); }
export function principalKey(actor: ActorContext) {
  return actor.principal.kind === 'user' ? 'user:' + actor.principal.userId : 'admin:' + actor.principal.adminId;
}
export function requireCapability(actor: ActorContext, capability: string) {
  if (!actor.capabilities.includes(capability)) fail('assistant_capability_forbidden', 403);
}
export function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > BigInt('9223372036854775807')) fail('invalid_message', 422);
  return value;
}
export function key(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value)) fail('invalid_message', 422);
  return value;
}
export function fingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)]));
    return v;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
export function userContent(value: unknown, max = 4000): MessageContent {
  const v = value as MessageContent;
  if (!v || v.version !== 1 || Object.keys(v).some(k => !['version', 'blocks'].includes(k)) || !Array.isArray(v.blocks) || v.blocks.length !== 1) fail('invalid_message', 422);
  const b = v.blocks[0];
  if (b.type !== 'text' || Object.keys(b).some(k => !['type', 'text'].includes(k)) || typeof b.text !== 'string' || !b.text.trim() || b.text.length > max) fail('invalid_message', 422);
  return { version: 1, blocks: [{ type: 'text', text: b.text }] };
}
/** Unknown blocks never execute HTML, URLs, or client actions. */
export function safeText(content: { blocks: Array<{ type: string; text?: string; fallbackText?: string }> }) {
  return content.blocks.map(b => b.type === 'text' ? b.text || '' : b.fallbackText || '').join('\n');
}
