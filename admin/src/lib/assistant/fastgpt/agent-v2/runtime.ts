import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AssistantError, fail } from '../../contracts';
import { AiProviderError } from '@/lib/ai/provider-types';
import { parseBusinessQuery, type BusinessQuery } from '../../agent/business-tools';
import type { AgentV2Configuration } from './config';
import { suggestionPrompt } from './suggestions';
import { agentV2SkillPrompt } from './skills';

export const agentV2ToolNames = ['search_enterprise', 'query_business', 'search_web', 'read_web', 'recommend_designers', 'recommend_public_sites'] as const;
export type AgentV2ToolName = typeof agentV2ToolNames[number];
export type AgentV2ToolInput =
  | { name: 'search_enterprise'; query: string }
  | ({ name: 'query_business' } & BusinessQuery)
  | { name: 'search_web'; query: string }
  | { name: 'read_web'; candidateId: string }
  /** No model-supplied filters: the site credit and the conversation's own
   * stated city/style decide the result, so the model cannot turn a guess into
   * a recommendation condition. */
  | { name: 'recommend_designers' }
  /** Same zero-argument contract: the conversation's authorized region and the
   * published catalog decide the result, never a model-supplied place. */
  | { name: 'recommend_public_sites' };
export type AgentV2Ports = {
  systemContext?: string;
  authorize: () => Promise<void>;
  tool: (input: AgentV2ToolInput, sequence: number) => Promise<Record<string, unknown>>;
};
export type AgentV2Usage = { inputTokens: number; outputTokens: number };
export type AgentV2RunResult = { text: string; usage: AgentV2Usage | null };
export type AgentV2SuggestionResult = { text: string; usage: AgentV2Usage | null };
type Packet = { choices?: Array<{ message?: { content?: unknown } }>; responseData?: unknown; error?: unknown };
type Ticket = { enterpriseId: string; ports: AgentV2Ports; expires: number; calls: number; failure?: AssistantError | AiProviderError;
  /** Tool callbacks for one ticket run strictly in arrival order. FastGPT may
   * issue two normal web callbacks that overlap; the shared web factory treats
   * any open dispatch marker as an unknown outcome, so unserialized overlap
   * would fail the whole run even though the first call succeeds. The tail is
   * per ticket only — different runs/enterprises still execute concurrently. */
  tail?: Promise<void>;
  /** Audit-only correlation to the owning assistant run; never sent to the vendor. */
  auditRunId?: string };
type AgentV2Profile = AgentV2Configuration & { baseUrl: string; apiKey: string; record: (value: unknown) => void };
const toolPrefix = '/agent-v2-tool/';
/** The run ticket is injected by the FastGPT HTTP tool from the workflow variable
 * `workflowTicket`. It must not reuse Authorization: staticHeaders is merged last
 * and would overwrite the dynamic value. */
export const agentV2TicketHeader = 'x-sfp-run-ticket';

const sameSecret = (presented: string, expected: string) => {
  const left = Buffer.from(presented), right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

function messageText(content: unknown) {
  return (typeof content === 'string' ? content : Array.isArray(content)
    ? content.flatMap((block: { type?: unknown; text?: { content?: unknown } }) =>
      block?.type === 'text' && typeof block.text?.content === 'string' ? [block.text.content] : []).join('\n')
    : '').trim();
}
/** Top-level usage is a placeholder for Agent V2. Sum the agent node
 * receipts; a partially reported run stays unknown instead of under-billing. */
function agentUsage(packet: Packet): AgentV2Usage | null {
  const nodes = Array.isArray(packet.responseData) ? packet.responseData.filter((node: { moduleType?: unknown }) => node?.moduleType === 'agent') : [];
  const observed = nodes.length > 0 && nodes.every((node: { inputTokens?: unknown; outputTokens?: unknown }) =>
    Number.isSafeInteger(node.inputTokens) && Number.isSafeInteger(node.outputTokens)
    && Number(node.inputTokens) >= 0 && Number(node.outputTokens) >= 0);
  return observed ? { inputTokens: nodes.reduce((sum: number, node: { inputTokens: number }) => sum + node.inputTokens, 0),
    outputTokens: nodes.reduce((sum: number, node: { outputTokens: number }) => sum + node.outputTokens, 0) } : null;
}

/** FastGPT Agent V2 owns orchestration and the model call. Each callback must
 * carry the bridge key of its enterprise plus the run ticket injected by the
 * HTTP tool from `variables.workflowTicket`; the app must declare that variable
 * or FastGPT drops it before `headerSecret.ref` can resolve. A ticket names the
 * enterprise and one run, so late callbacks can never enter another enterprise
 * or another run, even when several enterprises share a deployment bridge. */
export class FastGPTAgentV2 {
  private tickets = new Map<string, Ticket>();
  private readonly profiles = new Map<string, AgentV2Profile>();
  constructor(configurations: ReadonlyArray<AgentV2Profile>) {
    if (!configurations.length) throw Error('Agent V2 requires at least one enterprise');
    for (const config of configurations) {
      const url = new URL(config.baseUrl);
      if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '18300'
        || config.bridgeKey.length < 32) throw Error('Agent V2 requires the isolated pilot endpoint');
      if (this.profiles.has(config.enterpriseId)) throw Error('Agent V2 enterprise configuration is duplicated');
      this.profiles.set(config.enterpriseId, config);
    }
  }
  /** Queueing is per enterprise: a long run in one enterprise must not take the
   * slot of another enterprise's customer. */
  busy(enterpriseId: string) {
    for (const ticket of this.tickets.values()) if (ticket.enterpriseId === enterpriseId) return true;
    return false;
  }
  private profile(enterpriseId: string) {
    const profile = this.profiles.get(enterpriseId);
    if (!profile) fail('context_changed');
    return profile;
  }
  private ticket(id: string | null) {
    if (!id) return;
    const ticket = this.tickets.get(id);
    return ticket && ticket.expires >= Date.now() ? ticket : undefined;
  }
  /** Queue one callback behind the ticket's previous callback. A rejected task
   * must not break the chain, so the stored tail always settles. */
  private serialized<T>(ticket: Ticket, task: () => Promise<T>): Promise<T> {
    const previous = ticket.tail ?? Promise.resolve();
    const current = previous.then(task, task);
    ticket.tail = current.then(() => undefined, () => undefined);
    return current;
  }
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(toolPrefix) || request.method !== 'POST') return Response.json({ error: 'not_found' }, { status: 404 });
    const name = url.pathname.slice(toolPrefix.length);
    if (!agentV2ToolNames.includes(name as AgentV2ToolName)) return Response.json({ error: 'not_found' }, { status: 404 });
    const key = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    // A callback may only enter the run that issued its ticket. Falling back to
    // "the only active run" would let a late callback from a finished run read
    // or mutate the next run's context.
    const ticketId = request.headers.get(agentV2TicketHeader);
    const ticket = this.ticket(ticketId);
    const profile = ticket ? this.profiles.get(ticket.enterpriseId)
      : [...this.profiles.values()].find(candidate => sameSecret(key, candidate.bridgeKey));
    if (!profile || !sameSecret(key, profile.bridgeKey)) return Response.json({ error: 'not_found' }, { status: 404 });
    if (!ticket) return Response.json({ error: 'context_unavailable' }, { status: 409 });
    // Authorization, sequence allocation, the tool dispatch and the post-call
    // re-check form one ordered section per ticket. Body parsing lives beside
    // them because a malformed/limited callback must poison the same run.
    return this.serialized(ticket, async () => {
      // The run may have finished, the ticket expired, or an earlier callback
      // may have failed while this request was queued behind it.
      if (!ticketId || this.tickets.get(ticketId) !== ticket || ticket.expires < Date.now())
        return Response.json({ error: 'context_unavailable' }, { status: 409 });
      if (ticket.failure) return Response.json({ error: ticket.failure.code }, { status: 409 });
      try {
        const bytes = await request.text();
        if (Buffer.byteLength(bytes) > 8000) fail('invalid_message', 422);
        // The vendor tool template substitutes model arguments as raw text; a
        // form body keeps quotes/newlines out of JSON syntax.
        const form = (request.headers.get('content-type') || '').includes('application/x-www-form-urlencoded');
        const fields = (expected: readonly string[]) => {
          if (!form && !bytes.trim() && !expected.length) return {} as Record<string, string>;
          if (form) {
            const parsed = new URLSearchParams(bytes);
            if ([...new Set(parsed.keys())].length !== expected.length || !expected.every(key => parsed.getAll(key).length === 1))
              fail('invalid_message', 422);
            return Object.fromEntries(expected.map(key => [key, parsed.get(key) ?? ''])) as Record<string, string>;
          }
          let body: unknown;
          try { body = JSON.parse(bytes); } catch { fail('invalid_message', 422); }
          if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid_message', 422);
          const keys = Object.keys(body);
          if (keys.length !== expected.length || !expected.every(key =>
            keys.includes(key) && typeof (body as Record<string, unknown>)[key] === 'string')) fail('invalid_message', 422);
          return body as Record<string, string>;
        };
        const input: AgentV2ToolInput = name === 'search_enterprise'
          ? (() => { const { query } = fields(['query']);
            if (!query.trim() || Array.from(query).length > 1000) fail('invalid_message', 422);
            return { name: 'search_enterprise' as const, query }; })()
          : name === 'query_business' ? (() => { const requested = fields(['domain', 'leadId']);
            return { name: 'query_business' as const, ...parseBusinessQuery({ domain: requested.domain, leadId: requested.leadId }) }; })()
          : name === 'search_web' ? (() => { const { query } = fields(['query']);
            if (!query.trim() || Array.from(query).length > 240) fail('invalid_message', 422);
            return { name: 'search_web' as const, query }; })()
          : name === 'read_web' ? (() => { const { candidateId } = fields(['candidateId']);
            if (!/^P[1-9]\d{0,18}:12\d{2}:\d{1,3}$/.test(candidateId)) fail('invalid_message', 422);
            return { name: 'read_web' as const, candidateId }; })()
          : name === 'recommend_designers' ? (() => { fields([]); return { name: 'recommend_designers' as const }; })()
          : (() => { fields([]); return { name: 'recommend_public_sites' as const }; })();
        // The sequence is allocated inside the ticket's ordered section, so two
        // overlapping callbacks can never share/step over one call number.
        await ticket.ports.authorize();
        const receipt = await ticket.ports.tool(input, ++ticket.calls);
        await ticket.ports.authorize();
        profile.record({ enterpriseId: profile.enterpriseId, kind: 'agent_v2_tool', name, status: receipt.status,
          ...(ticket.auditRunId ? { runId: ticket.auditRunId } : {}),
          ...(input.name === 'search_enterprise' || input.name === 'search_web' ? { query: input.query }
            : input.name === 'read_web' ? { candidateId: input.candidateId }
            : input.name === 'recommend_designers' || input.name === 'recommend_public_sites' ? {} : { domain: input.domain, leadId: input.leadId }),
          sources: Array.isArray(receipt.cites) ? receipt.cites.length : 0 });
        return Response.json({ ...receipt, tool: name });
      } catch (error) {
        const known = error instanceof AssistantError || error instanceof AiProviderError;
        if (known) ticket.failure ??= error as AssistantError | AiProviderError;
        const code = known ? (error as AssistantError | AiProviderError).code : 'internal_error';
        profile.record({ enterpriseId: profile.enterpriseId, kind: 'agent_v2_tool_failure', name, code, ...(ticket.auditRunId ? { runId: ticket.auditRunId } : {}) });
        return Response.json({ error: code }, { status: error instanceof AssistantError ? error.status : 502 });
      }
    });
  }
  async run(enterpriseId: string, messages: Array<{ role: 'user' | 'assistant'; content: string }>, ports: AgentV2Ports,
    audit?: { runId: string }): Promise<AgentV2RunResult> {
    const profile = this.profile(enterpriseId);
    await ports.authorize();
    const id = randomUUID() + randomUUID(), ticket: Ticket = { enterpriseId, ports, expires: Date.now() + 180000, calls: 0, auditRunId: audit?.runId };
    this.tickets.set(id, ticket);
    try {
      const system = [agentV2SkillPrompt(profile.skills), ports.systemContext].filter(Boolean).join('\n\n');
      const outgoing = system ? [{ role: 'system' as const, content: system }, ...messages] : messages;
      const response = await fetch(profile.baseUrl + '/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(150000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + profile.apiKey },
        body: JSON.stringify({ appId: profile.appId, chatId: 'NO_RECORD_HISTORIES', stream: false, detail: true,
          variables: { workflowTicket: id }, messages: outgoing }),
      });
      const packet = await response.json() as Packet;
      profile.record({ enterpriseId, kind: 'agent_v2', status: response.status,
        ...(audit?.runId ? { runId: audit.runId } : {}),
        skills: profile.skills?.enabled ?? [], skillPack: profile.skills?.version ?? null,
        response: JSON.parse(JSON.stringify(packet).replaceAll(id, '[expired scoped ticket]')) });
      if (ticket.failure) throw ticket.failure;
      if (!response.ok || packet.error) fail('fastgpt_workflow_unavailable', 502);
      const text = messageText(packet.choices?.[0]?.message?.content);
      if (!text || text.length > 16000) fail('invalid_model_answer', 502);
      await ports.authorize();
      return { text, usage: agentUsage(packet) };
    } finally { this.tickets.delete(id); }
  }
  /** A one-shot opening for one registered scene. No run ticket exists, so a
   * tool callback from this app can only receive 409; the app must stay
   * tool-free, and the scene registry already limits what it receives. */
  async intro(enterpriseId: string, appId: string, facts: string, instructions: string): Promise<AgentV2RunResult> {
    const profile = this.profile(enterpriseId);
    const response = await fetch(profile.baseUrl + '/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(45000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + profile.apiKey },
      body: JSON.stringify({ appId, chatId: 'NO_RECORD_HISTORIES', stream: false, detail: true,
        messages: [{ role: 'user', content: instructions + '\n\n公开快照（JSON）：\n' + facts }] }),
    });
    const packet = await response.json() as Packet;
    profile.record({ enterpriseId, kind: 'agent_v2_intro', status: response.status, response: packet });
    if (!response.ok || packet.error) fail('fastgpt_workflow_unavailable', 502);
    const text = messageText(packet.choices?.[0]?.message?.content);
    if (!text || text.length > 2000) fail('invalid_model_answer', 502);
    return { text, usage: agentUsage(packet) };
  }
  /** Constrained follow-up generation on the same model. The dedicated app
   * carries no tools or datasets, so this call cannot change business facts. */
  async suggest(enterpriseId: string, answer: string, audit?: { runId: string }): Promise<AgentV2SuggestionResult> {
    const profile = this.profile(enterpriseId);
    if (!profile.suggestionAppId) return { text: '', usage: null };
    const response = await fetch(profile.baseUrl + '/api/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(45000),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + profile.apiKey },
      body: JSON.stringify({ appId: profile.suggestionAppId, chatId: 'NO_RECORD_HISTORIES', stream: false, detail: true,
        messages: [{ role: 'user', content: suggestionPrompt(answer) }] }),
    });
    const packet = await response.json() as Packet;
    profile.record({ enterpriseId, kind: 'agent_v2_suggestions', status: response.status, response: packet,
      ...(audit?.runId ? { runId: audit.runId } : {}) });
    if (!response.ok || packet.error) fail('fastgpt_workflow_unavailable', 502);
    const text = messageText(packet.choices?.[0]?.message?.content);
    if (!text || text.length > 2000) fail('invalid_model_answer', 502);
    return { text, usage: agentUsage(packet) };
  }
}
