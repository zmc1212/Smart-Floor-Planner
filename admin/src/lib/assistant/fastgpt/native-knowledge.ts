import { randomUUID, timingSafeEqual } from 'node:crypto';
import { fail, fingerprint } from '../contracts';
import { agentModelLimits, type ModelMessage, type ModelTool, type ModelTurnOutput } from '../contracts/model';
import type { AgentCheckpoint, AgentRuntimePorts } from '../agent/runtime';
import { toolSchemaIssue } from '../agent/tool-protocol';
import { synthesisModelMessages } from '../agent/synthesis';

export const nativeKnowledgeProtocol = 'fastgpt-native-knowledge-v1';
export const nativeKnowledgeReadNames = ['search_web', 'read_web', 'query_business', 'recall_history'] as const;
const names = new Set<string>([...nativeKnowledgeReadNames, 'final_response']);
const marker = 'XIAOK_NATIVE_TRANSPORT_TICKET=';
/** Remove the vendor HTTP envelope, then reuse XiaoK's one model-facing
 * Evidence/catalog projection. Original tool receipts/checkpoints stay exact. */
export function nativeKnowledgeModelMessages(messages: ModelMessage[]): ModelMessage[] {
  return synthesisModelMessages(messages.map(message => {
    if (message.role !== 'tool') return message;
    try {
      const packet = JSON.parse(message.content);
      if (typeof packet?.result !== 'string') return message;
      const original = JSON.parse(packet.result);
      if (!Array.isArray(original?.synthesisSources)) return message;
      return { ...message, content: JSON.stringify(original) };
    } catch { return message; }
  }));
}
type NativeInput = { messages: ModelMessage[]; tools: ModelTool[]; ports: AgentRuntimePorts; resume?: AgentCheckpoint; question?: string };
type Call = { turn: number; index: number; name: string; args: string; pending?: Promise<Response>; result?: string };
type Ticket = {
  input: NativeInput; expires: number; calls: Call[]; messages: ModelMessage[];
  turn: number; busy: boolean; final?: ModelTurnOutput; failure?: string;
};
export type NativeKnowledgeConfig = {
  baseUrl: string; apiKey: string; appId: string; model: string; bridgeKey: string;
  record: (value: unknown) => void;
};

/** FastGPT's maintained ToolCall node owns the entire tool/model loop. This
 * bridge only adapts transport to the application's existing guarded ports.
 * It does not run LangGraph, select queries, rewrite answers or retry a model.
 */
export class FastGPTNativeKnowledge {
  private tickets = new Map<string, Ticket>();
  constructor(private readonly config: NativeKnowledgeConfig) {
    const url = new URL(config.baseUrl);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '18300'
      || config.bridgeKey.length < 32) throw Error('Native knowledge requires the isolated pilot endpoint');
  }

  private state(ticket: Ticket): AgentCheckpoint {
    return { version: 1, turn: Math.max(0, ticket.turn - 1), messages: ticket.messages,
      output: ticket.final || null, nativeWorkflow: nativeKnowledgeProtocol };
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/native-model/v1/chat/completions') return this.model(request);
    const id = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    const ticket = this.tickets.get(id);
    if (!ticket || ticket.expires < Date.now()) return Response.json({ error: 'not_found' }, { status: 404 });
    try {
      await ticket.input.ports.authorize();
      if (url.pathname === '/native-input' && request.method === 'GET') {
        const system = ticket.input.messages.flatMap(m => m.role === 'system' ? m.content : [])
          .filter(p => p.type === 'text').map(p => p.type === 'text' ? p.text : '').join('\n');
        return Response.json({ instructions: system + '\n' + marker + id,
          input: JSON.stringify({ context: nativeKnowledgeModelMessages(ticket.input.messages).filter(m => m.role !== 'system'), current_request: ticket.input.question ?? null }) });
      }
      if (request.method !== 'POST' || !url.pathname.startsWith('/native-tool/')) return Response.json({ error: 'not_found' }, { status: 404 });
      const name = url.pathname.slice('/native-tool/'.length);
      const bytes = await request.text();
      if (bytes.length > 64000) return Response.json({ error: 'invalid_message' }, { status: 400 });
      const payload = JSON.parse(bytes);
      const args = JSON.stringify(payload);
      const call = ticket.calls.find(c => c.name === name && fingerprint(JSON.parse(c.args)) === fingerprint(payload));
      if (!call || ticket.failure || !names.has(name)) return Response.json({ error: 'assistant_capability_forbidden' }, { status: 403 });
      // Repeated/concurrent HTTP requests await the original operation. Neither
      // a failure nor an ambiguous model outcome clears its promise.
      call.pending ??= (async () => {
        if (name === 'final_response') {
          const state = this.state(ticket);
          const raw = await ticket.input.ports.resolveFinal?.(args, state) ?? args;
          const issue = await ticket.input.ports.validateFinal?.(raw, call.turn);
          if (issue) {
            ticket.failure = issue.code;
            this.config.record({ kind: 'native_final_rejected', turn: call.turn, raw, issue });
            return Response.json({ error: issue.code }, { status: 422 });
          }
          ticket.final = { text: raw, toolCalls: [], finishReason: 'stop', providerRequestId: null, usage: null };
        } else {
          const definition = ticket.input.tools.find(t => t.name === name);
          if (!definition || await toolSchemaIssue(definition, args)) fail('invalid_message', 422);
          const invalid = ticket.input.ports.validateTool?.(name, args);
          if (invalid) return Response.json({ result: JSON.stringify({ status: 'invalid_tool_input', ...invalid }) });
          const result = await ticket.input.ports.tool(call.turn, call.index, name, args);
          if (result.stop) fail('assistant_capability_forbidden', 403);
          call.result = result.content;
          ticket.messages.push({ role: 'tool', callId: `${call.turn}:${call.index}`, content: result.content });
        }
        await ticket.input.ports.authorize();
        await ticket.input.ports.checkpoint(this.state(ticket));
        return Response.json({ result: call.result || 'validated_not_saved' });
      })();
      return (await call.pending).clone();
    } catch (error) {
      ticket.failure ??= (error as { code?: string }).code || 'context_unavailable';
      return Response.json({ error: ticket.failure }, { status: 409 });
    }
  }

  private async model(request: Request): Promise<Response> {
    const key = request.headers.get('authorization')?.replace(/^Bearer /, '') || '';
    if (key.length !== this.config.bridgeKey.length || !timingSafeEqual(Buffer.from(key), Buffer.from(this.config.bridgeKey))) {
      return Response.json({ error: { message: 'not_found' } }, { status: 404 });
    }
    let ticket: Ticket | undefined;
    try {
      const bytes = await request.text();
      if (Buffer.byteLength(bytes) > 128000) fail('agent_input_limit', 422);
      const body = JSON.parse(bytes);
      if (body.model !== this.config.model || !Array.isArray(body.messages)) fail('context_changed', 409);
      const systems = body.messages.filter((m: { role: string }) => m.role === 'system');
      const ids = systems.flatMap((m: { content: unknown }) => typeof m.content === 'string'
        ? m.content.split('\n').filter(line => line.startsWith(marker)).map(line => line.slice(marker.length).trim()) : []);
      if (ids.length !== 1) fail('context_changed', 409);
      ticket = this.tickets.get(ids[0]);
      if (!ticket || ticket.expires < Date.now() || ticket.final) fail('context_changed', 409);
      if (ticket.failure) fail(ticket.failure, 502);
      await ticket.input.ports.authorize();
      if (ticket.busy || ticket.turn >= agentModelLimits.maxModelTurns) fail('agent_iteration_limit', 422);
      ticket.busy = true;
      const turn = ticket.turn++;
      const messages: ModelMessage[] = body.messages.map((m: { role: string; content?: string; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }) => {
        if (m.role === 'system' || m.role === 'user') {
          if (typeof m.content !== 'string') fail('invalid_message', 422);
          const text = m.role === 'system' ? m.content.split('\n').filter(line => !line.startsWith(marker)).join('\n') : m.content;
          return { role: m.role, content: [{ type: 'text', text }] };
        }
        if (m.role === 'tool') return { role: 'tool', callId: m.tool_call_id!, content: m.content || '' };
        if (m.role !== 'assistant') fail('invalid_message', 422);
        return { role: 'assistant', content: m.content || '', ...(m.tool_calls?.length ? {
          toolCalls: m.tool_calls.map(c => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })) } : {}) };
      });
      const nativeTools: ModelTool[] = (body.tools || []).map((t: { function: { name: string; description?: string; parameters?: Record<string, unknown> } }) => ({
        name: t.function.name, description: t.function.description || '', parameters: t.function.parameters || { type: 'object', properties: {} },
      }));
      this.config.record({ kind: 'native_transport', turn, toolNames: nativeTools.map(t => t.name) });
      // ToolCall v4.17.4 always installs its file reader. This text-only pilot
      // supplies no file access; exclude that specific native capability before
      // dispatch. Unknown tools and any attempted file call remain forbidden.
      const tools = nativeTools.filter(t => t.name !== 'read_files');
      if (tools.some(t => !names.has(t.name))) fail('assistant_capability_forbidden', 403);
      const projected = nativeKnowledgeModelMessages(messages);
      const output = await ticket.input.ports.model(turn, projected, tools);
      if (output.toolCalls.length > agentModelLimits.maxToolCalls) fail('assistant_capability_forbidden', 403);
      const calls = output.toolCalls.map((call, index) => {
        if (!tools.some(t => t.name === call.name) || !names.has(call.name)) fail('assistant_capability_forbidden', 403);
        const payload = JSON.parse(call.arguments).payload;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('invalid_message', 422);
        return { turn, index, name: call.name, args: JSON.stringify(payload) };
      });
      if (calls.some(c => c.name === 'final_response') && calls.length !== 1) fail('invalid_model_answer', 502);
      ticket.calls.push(...calls);
      ticket.messages.push({ role: 'assistant', content: output.text,
        toolCalls: calls.map(c => ({ id: `${c.turn}:${c.index}`, name: c.name, arguments: c.args })) });
      await ticket.input.ports.checkpoint(this.state(ticket));
      this.config.record({ kind: 'native_model', turn, request: { messages: projected, tools }, output });
      const result = { id: output.providerRequestId || randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: this.config.model,
        choices: [{ index: 0, message: { role: 'assistant', content: output.text || null,
          ...(output.toolCalls.length ? { tool_calls: output.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) } : {}) },
          finish_reason: output.toolCalls.length ? 'tool_calls' : 'stop' }],
        usage: output.usage ? { prompt_tokens: output.usage.inputTokens, completion_tokens: output.usage.outputTokens,
          total_tokens: output.usage.inputTokens + output.usage.outputTokens } : undefined };
      if (!body.stream) return Response.json(result);
      const delta = { role: 'assistant', content: output.text || '', ...(output.toolCalls.length ? {
        tool_calls: result.choices[0].message.tool_calls!.map((c, index) => ({ index, ...c })) } : {}) };
      const chunk = { ...result, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }], usage: undefined };
      return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: ' + JSON.stringify({ ...chunk,
        choices: [{ index: 0, delta: {}, finish_reason: result.choices[0].finish_reason }], usage: result.usage }) + '\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } });
    } catch (error) {
      if (ticket) ticket.failure ??= (error as { code?: string }).code || 'provider_outcome_unknown';
      return Response.json({ error: { message: ticket?.failure || 'context_unavailable' } }, { status: 502 });
    } finally { if (ticket) ticket.busy = false; }
  }

  async run(input: NativeInput): Promise<{ output: ModelTurnOutput; finalFromTools: false; stop: false }> {
    await input.ports.authorize();
    if (input.resume) {
      if (input.resume.nativeWorkflow !== nativeKnowledgeProtocol || !input.resume.output
        || input.resume.output.toolCalls.length) fail('provider_outcome_unknown', 409);
      const issue = await input.ports.validateFinal?.(input.resume.output.text, input.resume.turn);
      if (issue) fail(issue.code, 502);
      return { output: input.resume.output, finalFromTools: false, stop: false };
    }
    const id = randomUUID() + randomUUID();
    const ticket: Ticket = { input, expires: Date.now() + 180000, messages: [...input.messages], calls: [], turn: 0, busy: false };
    this.tickets.set(id, ticket);
    try {
      await input.ports.checkpoint(this.state(ticket));
      // No chatId: XiaoK supplies the one authorized conversation snapshot.
      // FastGPT owns only this run, without a second persistent user session.
      const response = await fetch(this.config.baseUrl + '/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(150000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.config.apiKey },
        body: JSON.stringify({ appId: this.config.appId, stream: false, detail: true,
          variables: { workflowTicket: id }, messages: [{ role: 'user', content: 'AUTO_EXECUTE' }] }),
      });
      const packet = await response.json();
      this.config.record({ kind: 'native_workflow', status: response.status, response: JSON.parse(JSON.stringify(packet).replaceAll(id, '[expired scoped ticket]')) });
      if (!response.ok || packet.error || ticket.failure || !ticket.final) fail(ticket.failure || 'fastgpt_workflow_unavailable', 502);
      await input.ports.authorize();
      return { output: ticket.final, finalFromTools: false, stop: false };
    } finally { this.tickets.delete(id); }
  }
}
