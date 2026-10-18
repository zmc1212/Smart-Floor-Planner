import { fail, requireCapability, type ActorContext, type ContextProvider, type ResourceRef } from '../contracts';

export interface ToolDefinition {
  name: string; version: number; capability: string; effect: 'read'; confirmation: 'none';
  timeoutMs: number; idempotency: 'read-only';
  parseInput(value: unknown): unknown; parseOutput(value: unknown): unknown;
  authorize(actor: ActorContext, input: unknown): Promise<boolean>;
  execute(actor: ActorContext, input: unknown, signal: AbortSignal): Promise<unknown>;
}
export class CapabilityRegistry {
  private tools = new Map<string, ToolDefinition>();
  register(tool: ToolDefinition) {
    if (this.tools.has(tool.name) || tool.effect !== 'read' || tool.timeoutMs < 1 || tool.timeoutMs > 90000) throw new Error('Invalid capability registration');
    this.tools.set(tool.name, tool); return this;
  }
  async execute(name: string, actor: ActorContext, value: unknown) {
    const tool = this.tools.get(name); if (!tool) fail('assistant_capability_forbidden', 403);
    requireCapability(actor, tool.capability);
    const input = tool.parseInput(value);
    if (!await tool.authorize(actor, input)) fail('assistant_resource_not_found', 404);
    const signal = AbortSignal.timeout(tool.timeoutMs);
    const result = await Promise.race([
      tool.execute(actor, input, signal),
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(new Error('capability_timeout')), { once: true })),
    ]);
    if (!await tool.authorize(actor, input)) fail('assistant_resource_not_found', 404);
    return tool.parseOutput(result);
  }
}
export class ContextRegistry {
  private providers = new Map<string, ContextProvider>();
  register(type: string, provider: ContextProvider) { if (this.providers.has(type)) throw new Error('Duplicate provider'); this.providers.set(type, provider); return this; }
  async resolve(actor: ActorContext, ref: ResourceRef) {
    const provider = this.providers.get(ref.type);
    if (!provider || !await provider.authorize(actor, ref)) fail('assistant_resource_not_found', 404);
    const evidence = await provider.resolve(actor, ref);
    if (!await provider.authorize(actor, ref)) fail('assistant_resource_not_found', 404);
    return evidence;
  }
}
