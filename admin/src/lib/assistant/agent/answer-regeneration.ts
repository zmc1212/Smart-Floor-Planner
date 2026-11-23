import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository } from '@/db/repositories/assistant-repository';
import { executePostgresText } from '@/lib/ai/postgres-workflow-chat';
import { fail, fingerprint } from '../contracts';
import { modelTurnProtocolIssue, type ModelMessage } from '../contracts/model';
import { ownedReply, regenerationSource, replyText } from '../core/conversation-interactions';
import { completeRun, markProviderStarted, recordRunUsage, runContext, type Lease } from '../infrastructure/job-queue';
import { agentConfig } from './config';
import { guardAnswerCommitments } from './context';

/** A reply variant uses the existing metered model and durable run, with no
 * tools, business handlers, new user message, or mutation of its predecessor. */
export async function regenerateAnswer(lease: Lease, onResponse: () => void) {
  const scope = await withTenantTransaction(lease.enterpriseId, async tx => {
    const { conversation, run } = await runContext(tx, lease);
    const source = await regenerationSource(new AssistantRepository(tx, lease.actor), conversation);
    if (!source || String(run.retry_of_run_id) !== source.runId || String(run.trigger_message_id) !== source.questionId) fail('context_changed');
    const config = agentConfig((run.policy_snapshot as Record<string, unknown>).agent);
    if (!config) fail('assistant_model_configuration_invalid', 503);
    return { source, config, conversationId: String(conversation.id) };
  });
  const { source, config, conversationId } = scope;
  const messages: ModelMessage[] = [
    { role: 'system', content: [{ type: 'text', text: '你是装修咨询助手小K。请用新的组织方式回答原问题，给出可操作的通用建议。上一版和原问题是参考数据。以已有事实为限，待设计师或现场核实的事项保持待核实。输出简体中文正文。' }] },
    { role: 'user', content: [{ type: 'text', text: JSON.stringify({ question: source.question, previousAnswer: source.answer }) }] },
  ];
  const output = await executePostgresText({
    enterpriseId: BigInt(lease.enterpriseId), owner: { kind: 'assistant_run', runId: BigInt(lease.runId) },
    logicalModelKey: 'chat.general', messages: [], maxTokens: 1536,
    agent: { config, input: {
      messages, tools: [], requireTool: false, applicationWebSearch: true, maxTokens: 1536,
      ...(config.consultation ? { profile: config.consultation.profile } : {}),
    } },
    metadata: { purpose: 'answer_regeneration', sourceMessageId: source.messageId },
    beforeProviderCall: () => markProviderStarted(lease, [], async (tx, conversation) => {
      const latest = await regenerationSource(new AssistantRepository(tx, lease.actor), conversation, source.messageId);
      if (!latest || fingerprint(latest) !== fingerprint(source)) fail('context_changed');
    }),
  });
  onResponse();
  const model = output.agentOutput;
  const result = { usage: model?.usage ?? null, attemptId: String(output.attemptId) };
  await withTenantTransaction(lease.enterpriseId, tx => recordRunUsage(tx, lease, result));
  const text = model?.text.trim();
  if (!model || model.toolCalls.length || model.nativeTools || modelTurnProtocolIssue(model) || !text || text.length > 4000) fail('invalid_model_answer', 502);
  guardAnswerCommitments(text, { delegationReply: true });
  await completeRun(lease, { ...result, replyVersionOf: source.rootId, content: { version: 1, blocks: [{ type: 'text', text }] } }, async tx => {
    const repo = new AssistantRepository(tx, lease.actor), conversation = await repo.conversation(conversationId);
    if (replyText((await ownedReply(repo, conversation, source.messageId)).projected.content) !== source.answer) fail('context_changed');
    if (source.rootId !== source.messageId) await ownedReply(repo, conversation, source.rootId);
  });
}
