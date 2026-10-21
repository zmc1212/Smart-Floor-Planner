import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { fail, fingerprint } from '../contracts';
import { agentModelLimits, type ModelMessage, type ModelTool, type ModelTurnOutput } from '../contracts/model';
import { finalAnswerRepairControl, type FinalAnswerRepairScope } from './synthesis-repair';

type ReadReceipt = { name: string; argumentsHash: string; messageIndex: number };
export type AgentCheckpoint = { version: 1; turn: number; messages: ModelMessage[]; output: ModelTurnOutput | null; validationRepairs?:number; argumentFailures?: number; exhaustedTools?: string[]; readReceipts?: ReadReceipt[]; finalFromTools?: boolean };
export type AgentToolResult = { content: string; stop?: boolean; exhausted?: boolean };
export type AgentRuntimePorts = {
  /** Must check lease, actor, mode, revision and source availability on every call. */
  authorize(): Promise<void>;
  /** Persists dispatch and response separately; unknown dispatch must never be retried here. */
  model(turn: number, messages: ModelMessage[], tools: ModelTool[]): Promise<ModelTurnOutput>;
  /** Owns schema validation, version checks and durable operation-key idempotency. */
  tool(turn: number, index: number, name: string, args: string): Promise<AgentToolResult>;
  /** Pure read-input validation before dispatch; never catches an executed tool's errors. */
  validateTool?(name: string, args: string): { code: string; feedback: string } | null;
  /** Save only authorized application checkpoints, never framework/global conversation state. */
  checkpoint(state: AgentCheckpoint): Promise<void>;
  /** Application-owned direct tool reply. Complete the whole paired batch first.
   * Reconstruct from durable authorized results on every validation/resume;
   * never dispatch a tool/provider or infer success from model wording. */
  resolveToolReply?(state: AgentCheckpoint): Promise<string | null>;
  /** Deterministic final-response reconstruction only; no tools or dispatch. */
  resolveFinal?(text: string, state: AgentCheckpoint): Promise<string>;
  validateFinal?(text:string,turn:number):Promise<{code:string;feedback:string;responseScope?:FinalAnswerRepairScope}|null>;
};
const State = Annotation.Root({
  turn: Annotation<number>(), messages: Annotation<ModelMessage[]>(),
  output: Annotation<ModelTurnOutput | null>(), stop: Annotation<boolean>(),
  validationRepairs: Annotation<number>(),
  argumentFailures: Annotation<number>(),
  exhaustedTools: Annotation<string[]>(),
  readReceipts: Annotation<ReadReceipt[]>(),
  finalFromTools: Annotation<boolean>(),
});
export const agentReadProtocol = 'same-run-read-v1';
export const agentToolReplyProtocol = 'durable-tool-reply-v1';
// Only these application-owned reads may reuse a completed result. Writes and
// newly introduced tools always execute through their existing durable ports.
const readTools = new Set(['search_knowledge', 'recall_history', 'query_materials', 'query_business', 'query_followups', 'recommend_references']);
function readArgumentsHash(name: string, args: string): string | null {
  if (!readTools.has(name)) return null;
  try {
    const value = JSON.parse(args);
    return value && typeof value === 'object' && !Array.isArray(value) ? fingerprint(value) : null;
  } catch { return null; }
}
function validateReadReceipts(saved: AgentCheckpoint, names: Set<string>) {
  const receipts = saved.readReceipts;
  if (receipts === undefined) return; // Legacy checkpoints retain their original behavior.
  if (!Array.isArray(receipts) || receipts.length > agentModelLimits.maxModelTurns * agentModelLimits.maxToolCalls) fail('invalid_agent_checkpoint', 409);
  const seen = new Set<string>();
  for (const receipt of receipts) {
    if (!receipt || Object.keys(receipt).some(key => !['name', 'argumentsHash', 'messageIndex'].includes(key))
      || !names.has(receipt.name) || !readTools.has(receipt.name) || !Number.isInteger(receipt.messageIndex)
      || receipt.messageIndex < 1 || receipt.messageIndex >= saved.messages.length) fail('invalid_agent_checkpoint', 409);
    const result = saved.messages[receipt.messageIndex];
    let index = receipt.messageIndex - 1;
    while (index >= 0 && saved.messages[index].role === 'tool') index--;
    const request = saved.messages[index];
    const call = request?.role === 'assistant' && result.role === 'tool'
      ? request.toolCalls?.find(call => call.id === result.callId) : undefined;
    const key = receipt.name + ':' + receipt.argumentsHash;
    if (!call || call.name !== receipt.name || readArgumentsHash(call.name, call.arguments) !== receipt.argumentsHash || seen.has(key)) fail('invalid_agent_checkpoint', 409);
    seen.add(key);
  }
}
const exhaustedToolContent = JSON.stringify({ status: 'tool_exhausted', instructions: '本轮该项有界查询已结束，不再换词重复查询。未命中不代表客户没有说过或现实没有发生；只使用仍有效的资料回答有据部分，必要时说明本次范围限制并作最小澄清。' });
const finalTurnInstructions = '本轮为收尾轮，仅提交最终回答，不再调用查询、保存或业务工具。使用已经取得且仍有效的来源；没有命中不代表客户没说过或现实没有发生。回答有据部分，对无法确认的部分说明本次范围限制，必要时作最小澄清。不得编造来源、恢复失效值或声称操作成功。';

/** One bounded runtime. Postgres owns persistence/recovery; no LangGraph checkpointer or tracing exporter. */
export async function runRenovationAgent(input: {
  messages: ModelMessage[]; tools: ModelTool[]; ports: AgentRuntimePorts; resume?: AgentCheckpoint;
}) {
  const { ports, tools } = input;
  const names = new Set(tools.map(t => t.name));
  if (names.size !== tools.length) fail('invalid_agent_tools', 500);
  const graph = new StateGraph(State)
    .addNode('model', async state => {
      await ports.authorize();
      if (state.turn >= agentModelLimits.maxModelTurns) fail('agent_iteration_limit', 422);
      // Reserve the last existing call for a response, without extending the
      // provider budget or replaying a write. Exhaustion belongs to this run.
      const finalTurn = state.turn === agentModelLimits.maxModelTurns - 1;
      const availableTools = state.validationRepairs || finalTurn ? [] : tools.filter(tool => !state.exhaustedTools.includes(tool.name));
      const messages: ModelMessage[] = !availableTools.length && !state.validationRepairs
        ? [...state.messages, { role: 'system', content: [{ type: 'text', text: finalTurnInstructions }] }] : state.messages;
      const output = await ports.model(state.turn, messages, availableTools);
      await ports.authorize();
      const availableNames = new Set(availableTools.map(tool => tool.name));
      if (output.toolCalls.length > agentModelLimits.maxToolCalls || output.toolCalls.some(c => !availableNames.has(c.name))) fail('assistant_capability_forbidden', 403);
      if(state.validationRepairs&&output.toolCalls.length)fail('assistant_capability_forbidden',403);
      if (output.toolProtocolFeedback && (output.toolProtocolFeedback.code !== 'mixed_final_response'
        || typeof output.toolProtocolFeedback.text !== 'string' || !output.toolProtocolFeedback.text.trim()
        || output.toolProtocolFeedback.text.length > 1000 || state.turn + 1 >= agentModelLimits.maxModelTurns)) fail('invalid_model_answer', 502);
      await ports.checkpoint({ version: 1, turn: state.turn, messages: state.messages, output,validationRepairs:state.validationRepairs, argumentFailures: state.argumentFailures, exhaustedTools: state.exhaustedTools, readReceipts: state.readReceipts });
      return { output, finalFromTools: false };
    })
    .addNode('tools', async state => {
      const output = state.output!;
      const messages: ModelMessage[] = output.toolCalls.length
        ? [...state.messages, { role: 'assistant', content: output.text, toolCalls: output.toolCalls }] : [...state.messages];
      const exhaustedTools = new Set(state.exhaustedTools);
      let readReceipts = [...state.readReceipts];
      let argumentFailures = state.argumentFailures;
      let stop = false;
      for (const [index, call] of output.toolCalls.entries()) {
        await ports.authorize();
        const issue = !exhaustedTools.has(call.name) && readTools.has(call.name) ? ports.validateTool?.(call.name, call.arguments) : null;
        if (issue) {
          if (argumentFailures >= 1) fail(issue.code, 422);
          argumentFailures++;
          // No dispatch, receipt, coercion, write replay or extra model turn.
          messages.push({ role: 'tool', callId: call.id, content: issue.feedback });
          continue;
        }
        const argumentsHash = readArgumentsHash(call.name, call.arguments);
        const previous = argumentsHash && readReceipts.find(receipt => receipt.name === call.name && receipt.argumentsHash === argumentsHash);
        const original = previous ? messages[previous.messageIndex] : undefined;
        const result: AgentToolResult = exhaustedTools.has(call.name) ? { content: exhaustedToolContent }
          : original?.role === 'tool' ? { content: JSON.stringify({ status: 'already_queried', tool: call.name, previousCallId: original.callId,
            instructions: '相同参数的查询已成功返回，完整结果仍在上方对应工具消息中，不再执行或复制。直接使用仍有效的原来源回答；确有不同范围才改参数补查，不把未命中当现实不存在，不新增事实或操作。' }) }
          : await ports.tool(state.turn, index, call.name, call.arguments);
        // Handoff intentionally invalidates the AI lease. Do not ask a model to speak after it.
        if (result.stop) { stop = true; break; }
        await ports.authorize();
        // A write may change the meaning of an earlier read even in this run.
        if (!readTools.has(call.name)) readReceipts = [];
        else if (argumentsHash && !previous && !exhaustedTools.has(call.name)) readReceipts.push({ name: call.name, argumentsHash, messageIndex: messages.length });
        if (result.exhausted) exhaustedTools.add(call.name);
        messages.push({ role: 'tool', callId: call.id, content: result.content });
      }
      const next: AgentCheckpoint = { version: 1, turn: state.turn + 1, messages, output: null,validationRepairs:state.validationRepairs, argumentFailures, exhaustedTools: [...exhaustedTools], readReceipts, finalFromTools: false };
      if (!stop) {
        const text = await ports.resolveToolReply?.(next);
        await ports.authorize();
        if (text != null) {
          if (typeof text !== 'string' || !text.trim()) fail('invalid_model_answer', 502);
          next.output = { text, toolCalls: [], finishReason: null, providerRequestId: null, usage: null };
          next.finalFromTools = true;
        }
        if (!next.output && output.toolProtocolFeedback) next.messages = [...next.messages,
          { role: 'system', content: [{ type: 'text', text: output.toolProtocolFeedback.text }] }];
        await ports.checkpoint(next);
      }
      return { ...next, stop };
    })
    .addNode('validate',async state=>{
      await ports.authorize();
      const output = { ...state.output! };
      if (state.finalFromTools) {
        const text = await ports.resolveToolReply?.({ version: 1, turn: state.turn, messages: state.messages, output: state.output, finalFromTools: true });
        if (typeof text !== 'string' || !text.trim()) fail('context_changed', 409);
        await ports.authorize();
        output.text = text;
      }
      if (ports.resolveFinal) output.text = await ports.resolveFinal(output.text, { version: 1, turn: state.turn,
        messages: state.messages, output: state.output, validationRepairs: state.validationRepairs, argumentFailures: state.argumentFailures, exhaustedTools: state.exhaustedTools, readReceipts: state.readReceipts, finalFromTools: state.finalFromTools });
      const issue=await ports.validateFinal?.(output.text,state.turn);
      // Keep provider output or the explicitly marked server tool reply in the
      // durable checkpoint. A crash reconstructs without provider dispatch.
      if(!issue) return { output };
      if (state.finalFromTools) fail(issue.code, 502);
      if(state.validationRepairs>=1 || state.turn+1>=agentModelLimits.maxModelTurns)fail(issue.code,502);
      const messages:ModelMessage[]=[...state.messages,{role:'assistant',content:state.output!.text},
        {role:'system',content:[{type:'text',text:issue.feedback},finalAnswerRepairControl(state.output!.text,issue.responseScope)]}];
      const next={version:1 as const,turn:state.turn+1,messages,output:null,validationRepairs:1,argumentFailures:state.argumentFailures,exhaustedTools:state.exhaustedTools,readReceipts:state.readReceipts,finalFromTools:false};
      await ports.authorize();await ports.checkpoint(next);return next;
    })
    .addNode('resume', async () => { await ports.authorize(); return {}; })
    .addEdge(START, 'resume')
    .addConditionalEdges('resume', state => state.output ? (state.output.toolCalls.length || state.output.toolProtocolFeedback ? 'tools' : 'validate') : 'model')
    .addConditionalEdges('model', state => state.output?.toolCalls.length || state.output?.toolProtocolFeedback ? 'tools' : 'validate')
    .addConditionalEdges('validate',state=>state.output?END:'model')
    .addConditionalEdges('tools', state => state.stop ? END : state.output ? 'validate' : 'model')
    .compile();
  const saved = input.resume;
  if (saved && (saved.version !== 1 || !Number.isInteger(saved.turn) || saved.turn < 0 || saved.turn >= agentModelLimits.maxModelTurns)) fail('invalid_agent_checkpoint', 409);
  if (saved?.output && (saved.output.toolCalls.length > agentModelLimits.maxToolCalls || saved.output.toolCalls.some(call => !names.has(call.name)))) fail('assistant_capability_forbidden', 403);
  if(saved?.validationRepairs!==undefined&&![0,1].includes(saved.validationRepairs))fail('invalid_agent_checkpoint',409);
  if (saved?.finalFromTools !== undefined && typeof saved.finalFromTools !== 'boolean') fail('invalid_agent_checkpoint', 409);
  if (saved?.finalFromTools && (!ports.resolveToolReply || !saved.output || saved.output.toolCalls.length
    || saved.messages.at(-1)?.role !== 'tool')) fail('invalid_agent_checkpoint', 409);
  if (saved?.argumentFailures !== undefined && ![0, 1].includes(saved.argumentFailures)) fail('invalid_agent_checkpoint', 409);
  if(saved?.validationRepairs&&saved.output?.toolCalls.length)fail('assistant_capability_forbidden',403);
  if (saved?.exhaustedTools !== undefined && (!Array.isArray(saved.exhaustedTools)
    || saved.exhaustedTools.some(name => !names.has(name)) || new Set(saved.exhaustedTools).size !== saved.exhaustedTools.length)) fail('invalid_agent_checkpoint', 409);
  if (saved?.output?.toolCalls.some(call => saved.exhaustedTools?.includes(call.name)
    || saved.turn === agentModelLimits.maxModelTurns - 1)) fail('assistant_capability_forbidden', 403);
  if (saved) validateReadReceipts(saved, names);
  return graph.invoke({ turn: saved?.turn ?? 0, messages: saved?.messages ?? input.messages, output: saved?.output ?? null, stop: false,validationRepairs:saved?.validationRepairs??0, argumentFailures: saved?.argumentFailures ?? 0, exhaustedTools: saved?.exhaustedTools ?? [], readReceipts: saved?.readReceipts ?? [], finalFromTools: saved?.finalFromTools ?? false },
    { recursionLimit: 12 });
}
