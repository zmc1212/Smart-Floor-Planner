import { randomUUID, createHash } from 'node:crypto';
import type { ModelMessage, ModelTool, ModelTurnOutput } from '@/lib/assistant/contracts/model';
import { fail } from '@/lib/assistant/contracts';

export type ReportWorkflowGuard = {
  authorize: () => Promise<unknown>;
  validate: (raw: string) => void;
  runId: string;
  enterpriseId: string;
};
type Ticket = {
  guard: ReportWorkflowGuard;
  input: unknown;
  instructions: string;
  expires: number;
  accepted?: string;
  rejection?: string;
};
export type FastGPTReportConfig = {
  baseUrl: string;
  appId: string;
  apiKey: string;
  record: (value: { chatId: string; runId: string; response: unknown }) => void;
};

/** A development adapter over the existing report model port. No independent
 * permissions, facts, report store, scheduler, or automatic retry is introduced.
 * Tickets are single-run, short-lived, and never included in model input. */
export class FastGPTReportWorkflow {
  private readonly tickets = new Map<string, Ticket>();
  constructor(private readonly config: FastGPTReportConfig) {
    const url = new URL(config.baseUrl);
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== '18300') {
      throw new Error('FastGPT report pilot requires the isolated SSH loopback endpoint :18300');
    }
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const ticketId = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    const ticket = this.tickets.get(ticketId);
    if (!ticket || ticket.expires < Date.now()) return Response.json({ error: 'not_found' }, { status: 404 });
    try {
      await ticket.guard.authorize();
      if (request.method === 'GET' && url.pathname === '/report-input') {
        return Response.json({ input: JSON.stringify(ticket.input), instructions: ticket.instructions });
      }
      if (request.method === 'POST' && url.pathname === '/report-result') {
        const bytes = await request.text();
        if (bytes.length > 20000) return Response.json({ error: 'invalid_result' }, { status: 400 });
        const value = JSON.parse(bytes);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_result');
        const accepted = JSON.stringify(value);
        try { ticket.guard.validate(accepted); }
        catch(error) {
          const code = (error as {code?:string})?.code;
          ticket.rejection = ['invalid_model_answer','unsupported_model_commitment','ungrounded_response_scope','invalid_model_citation'].includes(code || '') ? code : 'invalid_report_result';
          return Response.json({error:ticket.rejection}, {status:422});
        }
        if (ticket.accepted && ticket.accepted !== accepted) return Response.json({ error: 'conflict' }, { status: 409 });
        ticket.accepted = accepted;
        return Response.json({ result: accepted, state: 'generated_not_saved' });
      }
      return Response.json({ error: 'not_found' }, { status: 404 });
    } catch {
      return Response.json({ error: 'report_context_unavailable' }, { status: 409 });
    }
  }

  readonly model = async (messages: ModelMessage[], tools: ModelTool[], turn: number, guard?: ReportWorkflowGuard): Promise<ModelTurnOutput> => {
    if (!guard || turn !== 0 || tools.length !== 1 || tools[0].name !== 'final_response') fail('assistant_capability_forbidden', 403);
    await guard.authorize();
    const parts = messages.filter(m => m.role === 'user').flatMap(m =>
      typeof m.content === 'string' ? [{ type: 'text' as const, text: m.content }] : m.content);
    const text = parts.filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n');
    const input = JSON.parse(text);
    if (!['daily', 'weekly'].includes(input.scope?.kind)) fail('assistant_capability_forbidden', 403);
    const ticketId = randomUUID() + randomUUID();
    const instructions = messages.filter(m => m.role === 'system').flatMap(m =>
      typeof m.content === 'string' ? [{type:'text' as const,text:m.content}] : m.content)
      .filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n');
    const ticket: Ticket = { guard, expires: Date.now() + 180000,
      instructions: instructions + '\n输出载体为所给outputSchema对应的JSON对象。', input: {
      ...input, outputSchema: tools[0].parameters,
    } };
    this.tickets.set(ticketId, ticket);
    const chatId = `xiaok-report-${guard.runId}-${randomUUID()}`;
    let response: unknown;
    try {
      // One dispatch only. Network ambiguity remains an unknown original attempt.
      const result = await fetch(`${this.config.baseUrl}/api/v1/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ appId: this.config.appId, chatId, stream: false, detail: true,
          // Maintained FastGPT scheduled-run sentinel; uses a fixed title and
          // avoids an unmetered auxiliary title-generation model call.
          variables: { reportTicket: ticketId }, messages: [{ role: 'user', content: 'AUTO_EXECUTE' }] }),
      });
      response = await result.json();
      const recorded = JSON.parse(JSON.stringify(response).replaceAll(ticketId, '[expired scoped ticket]').replaceAll(this.config.apiKey, '[redacted]'));
      this.config.record({ chatId, runId: guard.runId, response: {...recorded, ...(ticket.rejection ? {pilotCallbackRejection:ticket.rejection} : {})} });
      if (!result.ok) fail('model_unavailable', 502);
      const packet = response as { choices?: { message?: { content?: string } }[];
        responseData?: { nodeId?: string; inputTokens?: number; outputTokens?: number }[]; error?: unknown };
      // v4.17.4 hardcodes OpenAI-compatible usage to 1/1/1. Only the native
      // AI node's provider observations are accounting evidence.
      const observation = packet.responseData?.find(node => node.nodeId === 'compose');
      const inputTokens = observation?.inputTokens, outputTokens = observation?.outputTokens;
      if (!Number.isSafeInteger(inputTokens) || !Number.isSafeInteger(outputTokens)) fail('provider_usage_unknown', 502);
      // FastGPT joins answer-node output with a leading newline. Ignore only
      // transport whitespace; the accepted JSON still comes from the guard.
      if (packet.error || !ticket.accepted || packet.choices?.[0]?.message?.content?.trim() !== ticket.accepted) {
        // The platform returned a known model result. Let the original worker
        // retain its observed usage before its terminal-frame guard rejects it.
        // Full original platform output remains in the audit receipt above.
        return { text: '', toolCalls: [], finishReason: 'stop', providerRequestId: chatId,
          usage: { inputTokens: inputTokens!, outputTokens: outputTokens! } };
      }
      return { text: '', toolCalls: [{ id: createHash('sha256').update(chatId).digest('hex').slice(0,24),
        name: 'final_response', arguments: ticket.accepted }], finishReason: 'tool_calls',
        providerRequestId: chatId, usage: { inputTokens: inputTokens!, outputTokens: outputTokens! } };
    } finally {
      this.tickets.delete(ticketId);
    }
  };
}
