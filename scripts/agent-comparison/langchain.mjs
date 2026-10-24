import { createAgent, tool } from 'langchain';
import { ChatOpenAI } from '@langchain/openai';

/** The official harness owns the loop. No custom graph, planner or retries. */
export async function runCreateAgent({ protocol, model, baseURL, apiKey, system, text, execute }) {
  const agent = createAgent({
    model: new ChatOpenAI({ model, configuration: { baseURL, apiKey },
      temperature: 0.2, maxTokens: 2048, maxRetries: 0, timeout: 90000, streaming: false }),
    systemPrompt: system,
    tools: protocol.tools.map(def => tool(args => execute(def.name, args), {
      name: def.name, description: def.description, schema: def.parameters, returnDirect: def.direct,
    })),
  });
  const result = await agent.invoke({ messages: [{ role: 'user', content: text }] }, { recursionLimit: 20 });
  const last = result.messages.at(-1);
  return { textResponse: typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content),
    messages: result.messages.map(m => m.toDict()) };
}
