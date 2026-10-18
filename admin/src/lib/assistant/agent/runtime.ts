import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { fail } from '../contracts';
import { agentModelLimits, type ModelMessage, type ModelTool, type ModelTurnOutput } from '../contracts/model';

export type AgentCheckpoint = { version: 1; turn: number; messages: ModelMessage[]; output: ModelTurnOutput | null };
export type AgentToolResult = { content: string; stop?: boolean };
export type AgentRuntimePorts = {
  /** Must check lease, actor, mode, revision and source availability on every call. */
  authorize(): Promise<void>;
  /** Persists dispatch and response separately; unknown dispatch must never be retried here. */
  model(turn: number, messages: ModelMessage[], tools: ModelTool[]): Promise<ModelTurnOutput>;
  /** Owns schema validation, version checks and durable operation-key idempotency. */
  tool(turn: number, index: number, name: string, args: string): Promise<AgentToolResult>;
  /** Save only authorized application checkpoints, never framework/global conversation state. */
  checkpoint(state: AgentCheckpoint): Promise<void>;
};
const State = Annotation.Root({
  turn: Annotation<number>(), messages: Annotation<ModelMessage[]>(),
  output: Annotation<ModelTurnOutput | null>(), stop: Annotation<boolean>(),
});

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
      const output = await ports.model(state.turn, state.messages, tools);
      await ports.authorize();
      if (output.toolCalls.length > agentModelLimits.maxToolCalls || output.toolCalls.some(c => !names.has(c.name))) fail('assistant_capability_forbidden', 403);
      await ports.checkpoint({ version: 1, turn: state.turn, messages: state.messages, output });
      return { output };
    })
    .addNode('tools', async state => {
      const output = state.output!;
      const messages: ModelMessage[] = [...state.messages, { role: 'assistant', content: output.text, toolCalls: output.toolCalls }];
      let stop = false;
      for (const [index, call] of output.toolCalls.entries()) {
        await ports.authorize();
        const result = await ports.tool(state.turn, index, call.name, call.arguments);
        // Handoff intentionally invalidates the AI lease. Do not ask a model to speak after it.
        if (result.stop) { stop = true; break; }
        await ports.authorize();
        messages.push({ role: 'tool', callId: call.id, content: result.content });
      }
      if (!stop) await ports.checkpoint({ version: 1, turn: state.turn + 1, messages, output: null });
      return { messages, turn: state.turn + 1, output: null, stop };
    })
    .addNode('resume', async () => { await ports.authorize(); return {}; })
    .addEdge(START, 'resume')
    .addConditionalEdges('resume', state => state.output ? (state.output.toolCalls.length ? 'tools' : END) : 'model')
    .addConditionalEdges('model', state => state.output?.toolCalls.length ? 'tools' : END)
    .addConditionalEdges('tools', state => state.stop ? END : 'model')
    .compile();
  const saved = input.resume;
  if (saved && (saved.version !== 1 || !Number.isInteger(saved.turn) || saved.turn < 0 || saved.turn >= agentModelLimits.maxModelTurns)) fail('invalid_agent_checkpoint', 409);
  if (saved?.output && (saved.output.toolCalls.length > agentModelLimits.maxToolCalls || saved.output.toolCalls.some(call => !names.has(call.name)))) fail('assistant_capability_forbidden', 403);
  return graph.invoke({ turn: saved?.turn ?? 0, messages: saved?.messages ?? input.messages, output: saved?.output ?? null, stop: false },
    { recursionLimit: 12 });
}
