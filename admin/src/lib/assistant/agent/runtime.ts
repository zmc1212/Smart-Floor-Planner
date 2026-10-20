import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { fail } from '../contracts';
import { agentModelLimits, type ModelMessage, type ModelTool, type ModelTurnOutput } from '../contracts/model';

export type AgentCheckpoint = { version: 1; turn: number; messages: ModelMessage[]; output: ModelTurnOutput | null; validationRepairs?:number; exhaustedTools?: string[] };
export type AgentToolResult = { content: string; stop?: boolean; exhausted?: boolean };
export type AgentRuntimePorts = {
  /** Must check lease, actor, mode, revision and source availability on every call. */
  authorize(): Promise<void>;
  /** Persists dispatch and response separately; unknown dispatch must never be retried here. */
  model(turn: number, messages: ModelMessage[], tools: ModelTool[]): Promise<ModelTurnOutput>;
  /** Owns schema validation, version checks and durable operation-key idempotency. */
  tool(turn: number, index: number, name: string, args: string): Promise<AgentToolResult>;
  /** Save only authorized application checkpoints, never framework/global conversation state. */
  checkpoint(state: AgentCheckpoint): Promise<void>;
  /** Deterministic final-response reconstruction only; no tools or dispatch. */
  resolveFinal?(text: string, state: AgentCheckpoint): Promise<string>;
  validateFinal?(text:string,turn:number):Promise<{code:string;feedback:string}|null>;
};
const State = Annotation.Root({
  turn: Annotation<number>(), messages: Annotation<ModelMessage[]>(),
  output: Annotation<ModelTurnOutput | null>(), stop: Annotation<boolean>(),
  validationRepairs: Annotation<number>(),
  exhaustedTools: Annotation<string[]>(),
});
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
      await ports.checkpoint({ version: 1, turn: state.turn, messages: state.messages, output,validationRepairs:state.validationRepairs, exhaustedTools: state.exhaustedTools });
      return { output };
    })
    .addNode('tools', async state => {
      const output = state.output!;
      const messages: ModelMessage[] = [...state.messages, { role: 'assistant', content: output.text, toolCalls: output.toolCalls }];
      const exhaustedTools = new Set(state.exhaustedTools);
      let stop = false;
      for (const [index, call] of output.toolCalls.entries()) {
        await ports.authorize();
        const result: AgentToolResult = exhaustedTools.has(call.name) ? { content: exhaustedToolContent }
          : await ports.tool(state.turn, index, call.name, call.arguments);
        // Handoff intentionally invalidates the AI lease. Do not ask a model to speak after it.
        if (result.stop) { stop = true; break; }
        await ports.authorize();
        if (result.exhausted) exhaustedTools.add(call.name);
        messages.push({ role: 'tool', callId: call.id, content: result.content });
      }
      if (!stop) await ports.checkpoint({ version: 1, turn: state.turn + 1, messages, output: null,validationRepairs:state.validationRepairs, exhaustedTools: [...exhaustedTools] });
      return { messages, turn: state.turn + 1, output: null, stop, exhaustedTools: [...exhaustedTools] };
    })
    .addNode('validate',async state=>{
      await ports.authorize();
      const output = { ...state.output! };
      if (ports.resolveFinal) output.text = await ports.resolveFinal(output.text, { version: 1, turn: state.turn,
        messages: state.messages, output: state.output, validationRepairs: state.validationRepairs, exhaustedTools: state.exhaustedTools });
      const issue=await ports.validateFinal?.(output.text,state.turn);
      // Keep the original provider output in the durable checkpoint. A crash
      // replays deterministic reconstruction, never a new provider dispatch.
      if(!issue) return { output };
      if(state.validationRepairs>=1 || state.turn+1>=agentModelLimits.maxModelTurns)fail(issue.code,502);
      const messages:ModelMessage[]=[...state.messages,{role:'assistant',content:state.output!.text},
        {role:'system',content:[{type:'text',text:issue.feedback}]}];
      const next={version:1 as const,turn:state.turn+1,messages,output:null,validationRepairs:1,exhaustedTools:state.exhaustedTools};
      await ports.authorize();await ports.checkpoint(next);return next;
    })
    .addNode('resume', async () => { await ports.authorize(); return {}; })
    .addEdge(START, 'resume')
    .addConditionalEdges('resume', state => state.output ? (state.output.toolCalls.length ? 'tools' : 'validate') : 'model')
    .addConditionalEdges('model', state => state.output?.toolCalls.length ? 'tools' : 'validate')
    .addConditionalEdges('validate',state=>state.output?END:'model')
    .addConditionalEdges('tools', state => state.stop ? END : 'model')
    .compile();
  const saved = input.resume;
  if (saved && (saved.version !== 1 || !Number.isInteger(saved.turn) || saved.turn < 0 || saved.turn >= agentModelLimits.maxModelTurns)) fail('invalid_agent_checkpoint', 409);
  if (saved?.output && (saved.output.toolCalls.length > agentModelLimits.maxToolCalls || saved.output.toolCalls.some(call => !names.has(call.name)))) fail('assistant_capability_forbidden', 403);
  if(saved?.validationRepairs!==undefined&&![0,1].includes(saved.validationRepairs))fail('invalid_agent_checkpoint',409);
  if(saved?.validationRepairs&&saved.output?.toolCalls.length)fail('assistant_capability_forbidden',403);
  if (saved?.exhaustedTools !== undefined && (!Array.isArray(saved.exhaustedTools)
    || saved.exhaustedTools.some(name => !names.has(name)) || new Set(saved.exhaustedTools).size !== saved.exhaustedTools.length)) fail('invalid_agent_checkpoint', 409);
  if (saved?.output?.toolCalls.some(call => saved.exhaustedTools?.includes(call.name)
    || saved.turn === agentModelLimits.maxModelTurns - 1)) fail('assistant_capability_forbidden', 403);
  return graph.invoke({ turn: saved?.turn ?? 0, messages: saved?.messages ?? input.messages, output: saved?.output ?? null, stop: false,validationRepairs:saved?.validationRepairs??0, exhaustedTools: saved?.exhaustedTools ?? [] },
    { recursionLimit: 12 });
}
