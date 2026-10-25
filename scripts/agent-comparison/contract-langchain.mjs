import { createAgent, createMiddleware, tool } from 'langchain';
import { ToolMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

// The official afterModel middleware routes known rejections back to the model.
// No custom inference loop or synthetic success message replaces a draft.
export async function runContractCreateAgent({ protocol, model, baseURL, apiKey, system, text, prepare, execute }) {
  let rejected = 0, terminal = false;
  const middleware = createMiddleware({ name: 'BusinessContract', beforeModel: {
    canJumpTo: ['end'],
    hook: () => terminal ? { jumpTo: 'end' } : undefined,
  }, afterModel: {
    canJumpTo: ['model'],
    hook: async state => {
      const last = state.messages.at(-1), calls = last?.tool_calls || [];
      if (!calls.length) {
        if (++rejected > 2) throw Error('contract_output_retries_exhausted');
        return { messages: [new SystemMessage('Known rejection: no action executed. Submit the structured sfp-contract-turn proposal; plain prose cannot finalize a business turn.')], jumpTo: 'model' };
      }
      if (calls.length !== 1 || calls[0].name !== protocol.tools[0].name) throw Error('one_contract_submission_required');
      const result = await prepare(calls[0].args);
      if (result.ok) return;
      if (++rejected > 2) throw Error('contract_output_retries_exhausted');
      return { messages: [new ToolMessage({ tool_call_id: calls[0].id, content: JSON.stringify(result) })], jumpTo: 'model' };
    },
  } });
  const agent = createAgent({
    model: new ChatOpenAI({ model, configuration: { baseURL, apiKey }, temperature: 0.2, maxTokens: 2048,
      maxRetries: 0, timeout: 90000, streaming: false }),
    systemPrompt: system, middleware: [middleware],
    tools: [tool(async args => {
      const result = await execute(args); terminal = result.terminal === true;
      return terminal ? result.text : JSON.stringify(result);
    }, { name: protocol.tools[0].name, description: protocol.tools[0].description,
      schema: protocol.tools[0].parameters })],
  });
  const result = await agent.invoke({ messages: [{ role: 'user', content: text }] }, { recursionLimit: 24 });
  const last = result.messages.at(-1);
  return { textResponse: typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content), messages: result.messages.map(m => m.toDict()) };
}
