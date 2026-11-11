import { randomUUID, timingSafeEqual } from 'node:crypto';
import { AssistantError, fail, fingerprint } from '../contracts';
import type { ModelMessage, ModelTurnOutput } from '../contracts/model';
import { AiProviderError } from '@/lib/ai/provider-types';
import type { RagConfiguration, RagSource } from './rag-config';
import type { MessageContent } from '../contracts';

const marker = 'XIAOK_RAG_TRANSPORT_TICKET=';
export type RagChatMessage = { role: 'user' | 'assistant'; content: string };
export type RagModelInput = { messages: ModelMessage[]; temperature: number; maxTokens: number };
type Ports = { authorize: () => Promise<void>; sources: (sources: RagSource[]) => Promise<void>;
  model: (input: RagModelInput) => Promise<ModelTurnOutput>; checkpoint: (packet: unknown) => Promise<void> };
type Ticket = { ports: Ports; expires: number; sources?: RagSource[]; quoteHash?: string;
  modelHash?: string; pending?: Promise<ModelTurnOutput>; output?: ModelTurnOutput; failure?: unknown };

/** Source IDs and originals come only from the deployment binding. Foreign or
 * modified search hits cannot enter the native AI node, even as uncited context. */
export function ragSources(quotes: unknown, configured: RagSource[]): RagSource[] {
  if (!Array.isArray(quotes) || quotes.length > configured.length) fail('invalid_model_citation', 502);
  const seen = new Set<string>();
  return quotes.map(q => {
    const source = configured.find(s => s.nativeId === q?.id);
    if (!source || seen.has(source.nativeId) || q.datasetId !== source.datasetId || q.collectionId !== source.collectionId
      || q.q !== source.q || (q.a || '') !== source.a) fail('invalid_model_citation', 502);
    seen.add(source.nativeId); return source;
  });
}
/** Where a catalog entry came from. Only `current`/`recovered` sources were
 * returned inside this run; `history` sources are conversation history that
 * stays citable, but cannot satisfy this run's retrieval-citation rules. */
export type RagCitationOrigin = 'history' | 'current' | 'recovered';
export type RagCitationSource = Pick<RagSource, 'nativeId' | 'evidence'>
  & { sourceId?: string; quote?: string; origin?: RagCitationOrigin };
export type RagPart = { text: string } | { source: RagCitationSource };
/** Citation chips/notices are UI projections, never assistant history. Native
 * originals retain their own CITE protocol so the model sees the actual reply. */
export function ragHistoryText(content: MessageContent, nativeOriginal?: string) {
  return nativeOriginal ?? content.blocks.flatMap(b => b.type === 'text' ? [b.text] : []).join('');
}
/** Decode the vendor's documented CITE protocol only. No answer rewriting or
 * semantic keyword rules; retrieved-but-uncited hits never become citations. */
export function ragAnswerParts(text: string, sources: RagCitationSource[]): RagPart[] {
  if (!text.trim() || text.length > 16000) fail('invalid_model_answer', 502);
  const parts: RagPart[] = [];
  for (const paragraph of text.match(/[^]+?(?:\n\n|$)/g) || []) {
    const selected: RagCitationSource[] = [];
    const prose = paragraph.replace(/\[([^\]]+)\]\(CITE\)/g, (_match, id: string) => {
      // Whitespace inside the brackets is tokenizer noise, not a different
      // reference: the retained repaired drafts emit `[ K2841](CITE)` for the
      // issued K2841. The resolved id must still match an issued source
      // character-for-character after trimming; anything else stays
      // invalid_model_citation.
      const source = sources.find(s => s.nativeId === id.trim());
      if (!source) fail('invalid_model_citation', 502);
      if (!selected.includes(source)) selected.push(source);
      return '';
    }).replace(/\([^()]{1,128}\)\(CITE\)/g, '').replace(/\(CITE\)/g, '');
    // A model occasionally emits a stray duplicate such as
    // `[A](CITE)(B)(CITE)`. The bare token is protocol noise, not prose or a
    // second citation; never deliver it to the customer.
    if (prose) parts.push({ text: prose });
    parts.push(...selected.map(source => ({ source })));
  }
  if (!parts.some(p => 'text' in p)) fail('invalid_model_answer', 502);
  return parts;
}

/** Native datasetSearch -> guarded HTTP boundary -> native chatNode. The
 * existing model gateway still owns provider attempts, usage and no-retry. */
export class FastGPTNativeRag {
  private tickets = new Map<string, Ticket>();
  constructor(private readonly config: RagConfiguration & { baseUrl: string; apiKey: string; record: (value: unknown) => void }) {}
  private ticket(id: string) {
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.expires < Date.now()) fail('context_changed');
    if (ticket.failure) throw ticket.failure;
    return ticket;
  }
  async handle(request: Request): Promise<Response> {
    let ticket: Ticket | undefined;
    try {
      const route = new URL(request.url).pathname;
      if (request.method !== 'POST') return Response.json({ error: 'not_found' }, { status: 404 });
      const key = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
      if (route === '/rag-sources') {
        ticket = this.ticket(key);
        const quotes = await request.json(), sources = ragSources(quotes, this.config.sources), hash = fingerprint(quotes);
        if (ticket.quoteHash && ticket.quoteHash !== hash) fail('context_changed');
        await ticket.ports.authorize(); await ticket.ports.sources(sources);
        ticket.sources = sources; ticket.quoteHash = hash;
        return Response.json({ quotes, instructions: marker + key });
      }
      if (route !== '/rag-model/v1/chat/completions' || key.length !== this.config.bridgeKey.length
        || !timingSafeEqual(Buffer.from(key), Buffer.from(this.config.bridgeKey))) return Response.json({ error: 'not_found' }, { status: 404 });
      const body = await request.json();
      if (body.model !== this.config.transportModel || !Array.isArray(body.messages) || body.tools?.length
        || body.max_tokens !== 1950 || body.temperature !== 0.3) fail('context_changed');
      const ids: string[] = body.messages.filter((m: { role: string }) => m.role === 'system').flatMap((m: { content: string }) =>
        typeof m.content === 'string' ? m.content.split('\n').filter(line => line.startsWith(marker)).map(line => line.slice(marker.length).trim()) : []);
      if (ids.length !== 1) fail('context_changed');
      ticket = this.ticket(ids[0]);
      if (!ticket.sources || !ticket.quoteHash) fail('context_changed');
      await ticket.ports.authorize(); await ticket.ports.sources(ticket.sources);
      const messages: ModelMessage[] = body.messages.map((m: { role: string; content: string }) => {
        if (typeof m.content !== 'string') fail('invalid_message', 422);
        if (m.role === 'assistant') return { role: m.role, content: m.content };
        if (!['system', 'user'].includes(m.role)) fail('invalid_message', 422);
        return { role: m.role as 'system' | 'user', content: [{ type: 'text', text: m.role === 'system'
          ? m.content.split('\n').filter(line => !line.startsWith(marker)).join('\n').trim() : m.content }] };
      });
      const hash = fingerprint(messages);
      if (ticket.modelHash && ticket.modelHash !== hash) fail('context_changed');
      ticket.modelHash = hash;
      // FastGPT/AIProxy HTTP retries receive the same promise, never another paid attempt.
      ticket.pending ??= ticket.ports.model({ messages, temperature: body.temperature, maxTokens: body.max_tokens });
      const output = await ticket.pending;
      if (output.toolCalls.length || output.finishReason !== 'stop') fail('invalid_model_answer', 502);
      ticket.output = output;
      const result = { id: output.providerRequestId || randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: this.config.transportModel,
        choices: [{ index: 0, message: { role: 'assistant', content: output.text }, finish_reason: 'stop' }],
        usage: output.usage ? { prompt_tokens: output.usage.inputTokens, completion_tokens: output.usage.outputTokens,
          total_tokens: output.usage.inputTokens + output.usage.outputTokens } : undefined };
      if (!body.stream) return Response.json(result);
      const chunk = { ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: output.text }, finish_reason: null }], usage: undefined };
      return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: ' + JSON.stringify({ ...chunk,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: result.usage }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    } catch (error) {
      if (ticket) ticket.failure ??= error;
      return Response.json({ error: { message: error instanceof AssistantError || error instanceof AiProviderError ? error.code : 'fastgpt_workflow_unavailable' } },
        { status: error instanceof AssistantError ? error.status : 502 });
    }
  }
  async run(messages: RagChatMessage[], ports: Ports) {
    await ports.authorize();
    const id = randomUUID() + randomUUID(), ticket: Ticket = { ports, expires: Date.now() + 180000 };
    this.tickets.set(id, ticket);
    try {
      const response = await fetch(this.config.baseUrl + '/api/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(150000),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.config.apiKey },
        body: JSON.stringify({ appId: this.config.appId, chatId: 'NO_RECORD_HISTORIES', stream: false, detail: true,
          retainDatasetCite: true, variables: { workflowTicket: id }, messages }) });
      const packet = await response.json();
      const receipt = JSON.parse(JSON.stringify(packet).replaceAll(id, '[expired scoped ticket]'));
      this.config.record({ kind: 'native_rag', status: response.status, packet: receipt });
      await ports.checkpoint(receipt);
      if (ticket.failure) throw ticket.failure;
      if (!response.ok || packet.error || !ticket.output || !ticket.sources) fail('fastgpt_workflow_unavailable', 502);
      const text = packet.choices?.[0]?.message?.content;
      if (text !== ticket.output.text) fail('invalid_model_answer', 502);
      await ports.authorize(); await ports.sources(ticket.sources);
      const parts = ragAnswerParts(text, ticket.sources);
      const retrieval = packet.responseData?.filter((r: { moduleType: string }) => r.moduleType === 'datasetSearchNode');
      const embeddingTokens = retrieval?.length === 1 && Number.isSafeInteger(retrieval[0].embeddingTokens) && retrieval[0].embeddingTokens >= 0
        ? retrieval[0].embeddingTokens as number : null;
      return { text, parts, sources: ticket.sources, output: ticket.output, embeddingTokens };
    } finally { this.tickets.delete(id); }
  }
}
