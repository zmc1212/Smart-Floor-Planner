import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type MessageContent } from '../contracts';
import type { SynthesisContext } from '../agent/synthesis';
import { synthesisContextAvailable } from '../agent/synthesis-sources';
import { readMemory } from '../agent/memory';
import { publicHistoryScope, type HistorySnapshot } from '../agent/history';
import { projectMessage } from '../knowledge/sources';
import { runKnowledgeEnabled } from '../knowledge-policy';
import { runContext, type Lease } from '../infrastructure/job-queue';
import { publicContextSelection, publicMessageRefs, type PublicContextRef } from '@/lib/construction/public-projections';
import { samePublicRef } from '@/lib/construction/public-contract';
import { fastGPTRagProtocol, type RagSource } from './rag-config';
import { ragAnswerParts, ragHistoryText, type RagChatMessage, type RagCitationSource } from './native-rag';

const historyBytes = 16000;
const historyAncestors = 32;

/** Read one persisted synthesis step for the next turn's history. A
 * snapshot-only delivery (`composition.modelIncluded === false`) never
 * contributed model prose: its `raw` was — and on legacy rows still is — the
 * discarded draft, kept only for audit. History must use the delivered message
 * content instead, so no discarded draft is replayed and its markers are never
 * re-parsed against an empty binding set. Normal deliveries keep using the
 * model original and its saved citations. */
export function nativeHistoryCheckpoint(checkpoint: Row | null | undefined, configured: RagCitationSource[]):
  { original?: string; citations: RagCitationSource[] } {
  const composition = checkpoint?.composition as Row | null | undefined;
  if (!checkpoint || checkpoint.kind !== 'synthesis' || composition?.modelIncluded === false
    || typeof checkpoint.raw !== 'string') return { citations: [] as RagCitationSource[] };
  const original = checkpoint.raw;
  const bindings = (checkpoint.citations as RagCitationSource[] | undefined) || configured;
  return { original, citations: ragAnswerParts(original, bindings).flatMap(p => 'source' in p
    ? [{ ...p.source, origin: 'history' as const }] : []) };
}

/** The immediately preceding answer decides the current object of an
 * ambiguous follow-up. `source_refs.snapshots` is the cumulative synthesis
 * context: it also carries business snapshots inherited only for source
 * auditing (and re-saved by later answers), so its length can never name the
 * current topic. The run's own record is the composition count of the business
 * snapshots it actually delivered, or a business tool call made by that run.
 * A legacy row with neither stays out of the business thread; query_business
 * remains callable and the model can re-read the records when the customer
 * actually asks about them. */
export function priorAnswerBusinessObject(input: { checkpoint: Row | null | undefined; ownBusinessTool: boolean }) {
  if (input.ownBusinessTool) return true;
  const delivered = (input.checkpoint?.composition as Row | null | undefined)?.snapshots;
  return typeof delivered === 'number' && delivered > 0;
}

/** One authorized history projection for native dataset and ToolCall workflows. */
export async function nativeConversation(lease: Lease, configured: RagSource[], protocol: string = fastGPTRagProtocol) {
    const context: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [], web: [], history: [], ancestors: [] };
    const citations: RagCitationSource[] = [];
    const inheritedPublicRefs = new Map<string, PublicContextRef & { contentHash?: string }>();
    let businessContextActive = false;
    const { messages, publicSite } = await withTenantTransaction(lease.enterpriseId, async tx => {
      const { conversation, run } = await runContext(tx, lease);
      const entry = conversation.entry_snapshot as Row;
      const active = (entry.activePublicSite ?? null) as PublicContextRef | null;
      const hasPublicHistory = !!active || (Array.isArray(entry.publicSiteContexts) && entry.publicSiteContexts.length > 0);
      const selected = active ? await publicContextSelection(tx, lease.enterpriseId, active) : null;
      const historyScope = publicHistoryScope(conversation, !!selected?.source);
      const originals = await rows(tx, sql`select m.* from app.assistant_messages m join app.assistant_messages trigger
        on trigger.enterprise_id=m.enterprise_id and trigger.conversation_id=m.conversation_id
        where m.enterprise_id=${lease.enterpriseId} and m.conversation_id=${String(conversation.id)} and trigger.id=${String(run.trigger_message_id)}
          and m.seq<=trigger.seq and (m.author_kind='assistant' or m.author_kind='user' and (m.id=trigger.id or ${historyScope}))
        order by m.seq desc limit 7`);
      if (!originals.length || String(originals[0].id) !== String(run.trigger_message_id)) fail('context_changed');
      const result: RagChatMessage[] = [], history: HistorySnapshot['sources'] = [];
      let keptAssistant = false;
      for (const m of originals) {
        const projected = await projectMessage(tx, lease.actor, conversation, m);
        if (!projected.available) continue;
        const role = m.author_kind === 'assistant' ? 'assistant' : 'user';
        const turn = (original?: string): RagChatMessage => ({ role, content: ragHistoryText(projected.content as MessageContent, original) });
        const fits = (candidate: RagChatMessage) => candidate.content.trim() && Buffer.byteLength(JSON.stringify([...result, candidate])) <= historyBytes;
        let nativeOriginal: string | undefined;
        if (role === 'assistant') {
          // The immediately preceding assistant turn defines the active
          // topic. A skipped/unavailable answer is not a topic.
          const prior = await one(tx, sql`select s.source_refs,s.private_checkpoint,s.input_summary,
              coalesce(r.policy_snapshot->'publicSiteSelection',p.input_summary->'current') as public_selection,
              (r.policy_snapshot ? 'publicSiteSelection' or coalesce(p.input_summary ? 'current',false)) as selection_recorded
            from app.assistant_run_steps s join app.assistant_runs r on r.enterprise_id=s.enterprise_id and r.id=s.run_id
            left join app.assistant_run_steps p on p.enterprise_id=s.enterprise_id and p.run_id=s.run_id
              and p.step_seq=1003 and p.kind='agent_public_context' and p.status='succeeded'
            where s.enterprise_id=${lease.enterpriseId} and s.run_id=${String(m.run_id)}
              and s.kind='agent_synthesis_context' and s.status='succeeded'`);
          // Do not import unbound historical generated prose into a new answer.
          if (!prior) continue;
          // Every public source the prior answer consumed (persisted 1003, plus
          // the earlier 1006.publicSite form) becomes a dependency of this turn
          // too. Its material must still be the same published version.
          const savedRefs = (await publicMessageRefs(tx, lease.enterpriseId, String(conversation.id), String(m.id)))
            .filter(ref => !ref.recommendation);
          if (savedRefs.some(ref => !samePublicRef(ref, active))) continue;
          if (prior.selection_recorded && !samePublicRef(prior.public_selection as PublicContextRef | null, active)) continue;
          if (hasPublicHistory && !prior.selection_recorded && !savedRefs.length) continue;
          const original = prior.source_refs as SynthesisContext;
          if (!runKnowledgeEnabled(run.policy_snapshot as Row) && original.knowledge.length) continue;
          const ancestors = [...(original.ancestors || []), { runId: String(m.run_id), messageId: String(m.id),
            contentHash: fingerprint(m.content), contextHash: fingerprint(original) }];
          // Keep the newest eligible turn that fits with its entire evidence
          // chain. Older prose remains readable through the history API.
          if (new Set([...context.ancestors!, ...ancestors].map(ref => ref.messageId)).size > historyAncestors) continue;
          if (!await synthesisContextAvailable(tx, lease.actor, conversation, original)) continue;
          const historyCheckpoint = (prior.input_summary as Row)?.protocol === protocol
            ? nativeHistoryCheckpoint(prior.private_checkpoint as Row, configured) : null;
          nativeOriginal = historyCheckpoint?.original;
          if (!fits(turn(nativeOriginal))) continue;
          if (!keptAssistant) {
            businessContextActive = priorAnswerBusinessObject({
              checkpoint: prior.private_checkpoint as Row,
              ownBusinessTool: !!await one(tx, sql`select id from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
                and run_id=${String(m.run_id)} and kind='agent_tool' and capability_name='query_business' and status='succeeded' limit 1`),
            });
            keptAssistant = true;
          }
          for (const ref of savedRefs) inheritedPublicRefs.set(ref.siteId + ':' + ref.versionId, ref);
          citations.push(...(historyCheckpoint?.citations || []));
          for (const key of ['knowledge','snapshots','sources','web','history'] as const)
            (context[key] as unknown[]).push(...(original[key] || []));
          context.ancestors!.push(...ancestors);
        } else {
          if (!fits(turn())) {
            if (m.id === originals[0].id) fail('invalid_message', 422);
            continue;
          }
          history.push({ messageId: String(m.id), hash: fingerprint(m.content), memoryVersion: readMemory(conversation.entry_snapshot).version,
            text: safeText(projected.content as MessageContent), seq: String(m.seq) });
        }
        result.push(turn(nativeOriginal));
      }
      if (history[0]?.messageId !== String(run.trigger_message_id)) fail('invalid_message', 422);
      context.history!.push({ query: '本轮获权会话历史', beforeSeq: String(BigInt(String(originals[0].seq)) + BigInt(1)),
        sources: history.reverse(), hasMore: false, oversized: false });
      for (const key of ['knowledge','snapshots','sources','web','history','ancestors'] as const)
        (context[key] as unknown[]) = [...new Map((context[key] as unknown[]).map(value => [fingerprint(value), value])).values()];
      if (!await synthesisContextAvailable(tx, lease.actor, conversation, context)) fail('context_changed');
      return { messages: result.reverse(), publicSite: { active, source: selected?.source ?? null, reason: selected?.reason } };
    });
  return { context, messages, citations, publicRefs: [...inheritedPublicRefs.values()], businessContextActive, publicSite };
}
