import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AssistantError, fail } from '../../contracts';
import { AiProviderError } from '@/lib/ai/provider-types';
import type { AgentV2Configuration } from './config';

export const agentV2ToolNames = ['search_enterprise'] as const;
export type AgentV2ToolName = typeof agentV2ToolNames[number];
export type AgentV2ToolInput = { query: string };
export type AgentV2Ports = {
  authorize: () => Promise<void>;
  tool: (name: AgentV2ToolName, input: AgentV2ToolInput, sequence: number) => Promise<Record<string, unknown>>;
};
export type AgentV2RunResult = { text: string; usage: { inputTokens: number; outputTokens: number } | null };
type Ticket = { ports: AgentV2Ports; expires: number; calls: number; failure?: AssistantError | AiProviderError };
const toolPrefix = '/agent-v2-tool/';

/** FastGPT Agent V2 owns orchestration and the model call. Tool callbacks carry
 * only the deployment bridge key: 4.17.4 HTTP tool sets resolve static headers
 * from model arguments, not workflow variables, so a per-run ticket cannot be
 * injected. One active run per bridge keeps each callback attributable. */
export class FastGPTAgentV2 {
  private tickets = new Map<string, Ticket>();
  constructor(private readonly config: AgentV2Configuration & {
    baseUrl: string; apiKey: string; bridgeKey: string; record: (value: unknown) => void;
  }) {
    const url = new URL(config.baseUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '18300'
      || config.bridgeKey.length < 32) throw Error('Agent V2 requires the isolated pilot endpoint');
  }
  busy() { return this.tickets.size > 0; }
  private active() {
    if (this.tickets.size !== 1) return;
    const [ticket] = [...this.tickets.values()];
    return ticket.expires < Date.now() ? undefined : ticket;
  }
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(toolPrefix) || request.method !== 'POST') return Response.json({ error: 'not_found' }, { status: 404 });
    const name = url.pathname.slice(toolPrefix.length);
    if (!agentV2ToolNames.includes(name as AgentV2ToolName)) return Response.json({ error: 'not_found' }, { status: 404 });
    const key = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (key.length !== this.config.bridgeKey.length || !timingSafeEqual(Buffer.from(key), Buffer.from(this.config.bridgeKey)))
      return Response.json({ error: 'not_found' }, { status: 404 });
    const ticket = this.active();
    if (!ticket) return Response.json({ error: 'context_unavailable' }, { status: 409 });
    if (ticket.failure) return Response.json({ error: ticket.failure.code }, { status: 409 });
    try {
      const bytes = await request.text();
      if (Buffer.byteLength(bytes) > 8000) fail('invalid_message', 422);
      // The vendor tool template substitutes model arguments as raw text; a
      // form body keeps quotes/newlines out of JSON syntax.
      const form = (request.headers.get('content-type') || '').includes('application/x-www-form-urlencoded');
      const query = form ? (() => { const parsed = new URLSearchParams(bytes);
        return [...parsed.keys()].length === 1 && parsed.has('query') ? parsed.get('query') : undefined; })()
        : (() => { let body: unknown; try { body = JSON.parse(bytes); } catch { fail('invalid_message', 422); }
          return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1
            ? (body as { query?: unknown }).query : undefined; })();
      if (typeof query !== 'string' || !query.trim() || Array.from(query).length > 1000) fail('invalid_message', 422);
      await ticket.ports.authorize();
      const receipt = await ticket.ports.tool(name as AgentV2ToolName, { query }, ++ticket.calls);
      await ticket.ports.authorize();
      this.config.record({ kind: 'agent_v2_tool', name, query, status: receipt.status,
        sources: Array.isArray(receipt.cites) ? receipt.cites.length : 0 });
      return Response.json(receipt);
    } catch (error) {
      const known = error instanceof AssistantError || error instanceof AiProviderError;
      if (known) ticket.failure ??= error as AssistantError | AiProviderError;
      const code = known ? (error as AssistantError | AiProviderError).code : 'internal_error';
      this.config.record({ kind: 'agent_v2_tool_failure', name, code });
      return Response.json({ error: code }, { status: error instanceof AssistantError ? error.status : 502 });
    }
  }
  async run(messages: Array<{ role: 'user' | 'assistant'; content: string }>, ports: AgentV2Ports): Promise<AgentV2RunResult> {
    await ports.authorize();
    if (this.busy()) fail('conversation_busy');
    const id = randomUUID() + randomUUID(), ticket: Ticket = { ports, expires: Date.now() + 180000, calls: 0 };
    this.tickets.set(id, ticket);
    try {
      const response = await fetch(this.config.baseUrl + '/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(150000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.config.apiKey },
        body: JSON.stringify({ appId: this.config.appId, chatId: 'NO_RECORD_HISTORIES', stream: false, detail: true,
          variables: { workflowTicket: id }, messages }),
      });
      const packet = await response.json();
      this.config.record({ kind: 'agent_v2', status: response.status,
        response: JSON.parse(JSON.stringify(packet).replaceAll(id, '[expired scoped ticket]')) });
      if (ticket.failure) throw ticket.failure;
      if (!response.ok || packet.error) fail('fastgpt_workflow_unavailable', 502);
      const content = packet.choices?.[0]?.message?.content;
      const text = (typeof content === 'string' ? content : Array.isArray(content)
        ? content.flatMap((block: { type?: unknown; text?: { content?: unknown } }) =>
          block?.type === 'text' && typeof block.text?.content === 'string' ? [block.text.content] : []).join('\n')
        : '').trim();
      if (!text || text.length > 16000) fail('invalid_model_answer', 502);
      // Top-level usage is a placeholder for Agent V2. Sum the agent node
      // receipts; a partially reported run stays unknown instead of under-billing.
      const nodes = Array.isArray(packet.responseData) ? packet.responseData.filter((node: { moduleType?: unknown }) => node?.moduleType === 'agent') : [];
      const observed = nodes.length > 0 && nodes.every((node: { inputTokens?: unknown; outputTokens?: unknown }) =>
        Number.isSafeInteger(node.inputTokens) && Number.isSafeInteger(node.outputTokens)
        && Number(node.inputTokens) >= 0 && Number(node.outputTokens) >= 0);
      const usage = observed ? { inputTokens: nodes.reduce((sum: number, node: { inputTokens: number }) => sum + node.inputTokens, 0),
        outputTokens: nodes.reduce((sum: number, node: { outputTokens: number }) => sum + node.outputTokens, 0) } : null;
      await ports.authorize();
      return { text, usage };
    } finally { this.tickets.delete(id); }
  }
}
