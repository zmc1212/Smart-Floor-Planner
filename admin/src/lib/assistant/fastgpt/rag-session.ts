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
import { publicContextAvailable, type PublicContextRef } from '@/lib/construction/public-projections';
import { fastGPTRagProtocol, type RagSource } from './rag-config';
import { ragAnswerParts, ragHistoryText, type RagChatMessage, type RagCitationSource } from './native-rag';

/** A public-site conversation may only reuse assistant answers that were
 * produced for the same selected site/version and whose published material is
 * still available. Answers from before the public context was wired (or from
 * a replaced/withdrawn version) are not history for this site. */
export function nativePublicSiteHistoryAllowed(
  active: { siteId: string; versionId: string } | undefined,
  saved: { siteId?: string; versionId?: string; contentHash?: string } | undefined,
  available: boolean) {
  if (!active) return true;
  return !!saved && saved.siteId === active.siteId && saved.versionId === active.versionId && available;
}

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
    const messages = await withTenantTransaction(lease.enterpriseId, async tx => {
      const { conversation, run } = await runContext(tx, lease);
      const originals = await rows(tx, sql`select m.* from app.assistant_messages m join app.assistant_messages trigger
        on trigger.enterprise_id=m.enterprise_id and trigger.conversation_id=m.conversation_id
        where m.enterprise_id=${lease.enterpriseId} and m.conversation_id=${String(conversation.id)} and trigger.id=${String(run.trigger_message_id)}
          and m.seq<=trigger.seq and m.author_kind in ('user','assistant') order by m.seq desc limit 7`);
      if (!originals.length || String(originals[0].id) !== String(run.trigger_message_id)) fail('context_changed');
      const activePublicSite = (conversation.entry_snapshot as Row).activePublicSite as
        { siteId: string; versionId: string } | undefined;
      const result: RagChatMessage[] = [], history: HistorySnapshot['sources'] = [];
      for (const m of originals.reverse()) {
        if (m.author_kind === 'assistant') businessContextActive = false;
        const projected = await projectMessage(tx, lease.actor, conversation, m);
        if (!projected.available) continue;
        let nativeOriginal: string | undefined;
        if (m.author_kind === 'assistant') {
          // The immediately preceding assistant turn defines the active
          // topic. A skipped/unavailable answer is not a topic.
          const prior = await one(tx, sql`select source_refs,private_checkpoint,input_summary from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
            and run_id=${String(m.run_id)} and kind='agent_synthesis_context' and status='succeeded'`);
          // Do not import unbound historical generated prose into a new answer.
          if (!prior) continue;
          // Every public source the prior answer consumed (persisted 1003, plus
          // the earlier 1006.publicSite form) becomes a dependency of this turn
          // too. Its material must still be the same published version.
          const publicSteps = await rows(tx, sql`select kind,step_seq,source_refs,private_checkpoint from app.assistant_run_steps
            where enterprise_id=${lease.enterpriseId} and run_id=${String(m.run_id)} and status='succeeded'
              and (kind='agent_public_context' or (step_seq=1006 and kind='agent_synthesis_context'))`);
          const savedRefs = new Map<string, PublicContextRef & { contentHash?: string }>();
          for (const step of publicSteps) {
            if (Array.isArray(step.source_refs))
              for (const ref of step.source_refs as (PublicContextRef & { contentHash?: string })[])
                if (ref?.siteId && ref.versionId) savedRefs.set(ref.siteId + ':' + ref.versionId, ref);
            const legacy = (step.private_checkpoint as Row | null)?.publicSite as
              (PublicContextRef & { contentHash?: string }) | undefined;
            if (legacy?.siteId && legacy.versionId) savedRefs.set(legacy.siteId + ':' + legacy.versionId, legacy);
          }
          // An answer that consumed no public source (its own 1003 record is
          // empty) is provably about the customer's own material and stays
          // valid history while a site is merely selected. Only answers tied to
          // another site/version are excluded from this object's thread.
          if (activePublicSite && savedRefs.size) {
            const same = [...savedRefs.values()].find(ref => String(ref.siteId) === String(activePublicSite.siteId)
              && String(ref.versionId) === String(activePublicSite.versionId));
            if (!same) continue;
          }
          let refsAvailable = true;
          for (const ref of savedRefs.values()) if (!await publicContextAvailable(tx, lease.enterpriseId, ref)) {
            refsAvailable = false;
            break;
          }
          if (!refsAvailable) continue;
          const original = prior.source_refs as SynthesisContext;
          if (!runKnowledgeEnabled(run.policy_snapshot as Row) && original.knowledge.length) continue;
          if (!await synthesisContextAvailable(tx, lease.actor, conversation, original)) continue;
          businessContextActive = priorAnswerBusinessObject({
            checkpoint: prior.private_checkpoint as Row,
            ownBusinessTool: !!await one(tx, sql`select id from app.assistant_run_steps where enterprise_id=${lease.enterpriseId}
              and run_id=${String(m.run_id)} and kind='agent_tool' and capability_name='query_business' and status='succeeded' limit 1`),
          });
          for (const ref of savedRefs.values()) inheritedPublicRefs.set(ref.siteId + ':' + ref.versionId, ref);
          if ((prior.input_summary as Row)?.protocol === protocol) {
            const historyCheckpoint = nativeHistoryCheckpoint(prior.private_checkpoint as Row, configured);
            nativeOriginal = historyCheckpoint.original;
            citations.push(...historyCheckpoint.citations);
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
  return { context, messages, citations, publicRefs: [...inheritedPublicRefs.values()], businessContextActive };
}
