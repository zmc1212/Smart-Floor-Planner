import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type MessageContent } from '../contracts';
import type { SynthesisContext } from '../agent/synthesis';
import { synthesisContextAvailable } from '../agent/synthesis-sources';
import { readMemory } from '../agent/memory';
import type { HistorySnapshot } from '../agent/history';
import { projectMessage } from '../knowledge/sources';
import { runKnowledgeEnabled } from '../knowledge-policy';
import { runContext, type Lease } from '../infrastructure/job-queue';
import { fastGPTRagProtocol, type RagSource } from './rag-config';
import { ragAnswerParts, ragHistoryText, type RagChatMessage, type RagCitationSource } from './native-rag';

/** One authorized history projection for native dataset and ToolCall workflows. */
export async function nativeConversation(lease: Lease, configured: RagSource[]) {
    const context: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [], web: [], history: [], ancestors: [] };
    const citations: RagCitationSource[] = [];
    const messages = await withTenantTransaction(lease.enterpriseId, async tx => {
      const { conversation, run } = await runContext(tx, lease);
      const originals = await rows(tx, sql`select m.* from app.assistant_messages m join app.assistant_messages trigger
        on trigger.enterprise_id=m.enterprise_id and trigger.conversation_id=m.conversation_id
        where m.enterprise_id=${lease.enterpriseId} and m.conversation_id=${String(conversation.id)} and trigger.id=${String(run.trigger_message_id)}
          and m.seq<=trigger.seq and m.author_kind in ('user','assistant') order by m.seq desc limit 7`);
      if (!originals.length || String(originals[0].id) !== String(run.trigger_message_id)) fail('context_changed');
      const result: RagChatMessage[] = [], history: HistorySnapshot['sources'] = [];
      for (const m of originals.reverse()) {
        const projected = await projectMessage(tx, lease.actor, conversation, m);
        if (!projected.available) continue;
        let nativeOriginal: string | undefined;
        if (m.author_kind === 'assistant') {
          const prior = await one(tx, sql`select source_refs,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
            and run_id=${String(m.run_id)} and kind='agent_synthesis_context' and status='succeeded'`);
          // Do not import unbound historical generated prose into a new answer.
          if (!prior) continue;
          const original = prior.source_refs as SynthesisContext;
          if (!runKnowledgeEnabled(run.policy_snapshot as Row) && original.knowledge.length) continue;
          if (!await synthesisContextAvailable(tx, lease.actor, conversation, original)) continue;
          if ((prior.input_summary as Row)?.protocol === fastGPTRagProtocol) {
            nativeOriginal = String((prior.private_checkpoint as Row).raw);
            const bindings = (prior.private_checkpoint as { citations?: RagCitationSource[] }).citations || configured;
            citations.push(...ragAnswerParts(nativeOriginal, bindings).flatMap(p => 'source' in p ? [p.source] : []));
          }
          for (const key of ['knowledge','snapshots','sources','web','history','ancestors'] as const)
            (context[key] as unknown[]).push(...(original[key] || []));
          context.ancestors!.push({ runId: String(m.run_id), messageId: String(m.id), contentHash: fingerprint(m.content), contextHash: fingerprint(original) });
        } else {
          history.push({ messageId: String(m.id), hash: fingerprint(m.content), memoryVersion: readMemory(conversation.entry_snapshot).version,
            text: safeText(projected.content as MessageContent), seq: String(m.seq) });
        }
        const text = ragHistoryText(projected.content as MessageContent, nativeOriginal);
        if (text.trim()) result.push({ role: m.author_kind === 'assistant' ? 'assistant' : 'user', content: text });
      }
      if (result.at(-1)?.role !== 'user' || Buffer.byteLength(JSON.stringify(result)) > 16000) fail('invalid_message', 422);
      context.history!.push({ query: '本轮获权会话历史', beforeSeq: String(BigInt(String(originals.at(-1)!.seq)) + BigInt(1)),
        sources: history, hasMore: false, oversized: false });
      for (const key of ['knowledge','snapshots','sources','web','history','ancestors'] as const)
        (context[key] as unknown[]) = [...new Map((context[key] as unknown[]).map(value => [fingerprint(value), value])).values()];
      if (context.ancestors!.length > 32 || !await synthesisContextAvailable(tx, lease.actor, conversation, context)) fail('context_changed');
      return result;
    });
  return { context, messages, citations };
}
