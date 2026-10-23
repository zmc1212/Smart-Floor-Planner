import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, safeText, type ActorContext, type Evidence } from '../contracts';
import { resolveEvidence } from '../knowledge/sources';
import { businessSnapshotAvailable, type BusinessSnapshot } from './business-tools';
import { businessSynthesisSources, knowledgeSynthesisSources, type SynthesisContext } from './synthesis';
import { historySynthesisSources, historyRefsAvailable, type HistorySnapshot } from './history';
import { needMemoryPolicy, readMemory } from './memory';
import { resolveWebEvidence, webEvidence, webSynthesisSources } from './web-evidence';
import type { WebSearchSnapshot } from './web';
import { ancestorSourcesAvailable } from './ancestor-sources';

/** A committed receipt cites its actual customer original through the existing
 * original-message protocol, never a proposed call or model source packet. */
async function savedNeedOriginal(tx: PostgresTransaction, actor: ActorContext, conversation: Row, runId: string, step: Row): Promise<HistorySnapshot> {
  const checkpoint = step.private_checkpoint as { policy?: string; receipt?: { status?: string; savedFacts?: unknown[] } };
  const refs = step.source_refs as Array<{ messageId: string; hash: string }>;
  if (actor.principal.kind !== 'user' || checkpoint?.policy !== needMemoryPolicy.version || checkpoint.receipt?.status !== 'saved'
    || !checkpoint.receipt.savedFacts?.length || !Array.isArray(refs) || refs.length !== 1) fail('context_changed');
  const original = await one(tx, sql`select m.id,m.seq,m.content from app.assistant_messages m join app.assistant_runs r
    on r.enterprise_id=m.enterprise_id and r.conversation_id=m.conversation_id and r.trigger_message_id=m.id
    where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${String(conversation.id)} and m.id=${refs[0].messageId}
      and m.author_kind='user' and m.user_id=${actor.principal.userId} and r.id=${runId}`);
  if (!original || fingerprint(original.content) !== refs[0].hash) fail('context_changed');
  const sources = [{ ...refs[0], memoryVersion: readMemory(conversation.entry_snapshot).version,
    text: safeText(original.content as Parameters<typeof safeText>[0]), seq: String(original.seq) }];
  if (!await historyRefsAvailable(tx, actor.enterpriseId, String(conversation.id), sources)) fail('context_changed');
  return { query: '本轮已记录需求的客户原话', beforeSeq: String(BigInt(String(original.seq)) + BigInt(1)), sources, hasMore: false, oversized: false };
}

/** Read only durable, authorized results of this run; never accept client/model source packets. */
export async function currentSynthesisContext(tx: PostgresTransaction, actor: ActorContext, conversation: Row, runId: string): Promise<SynthesisContext> {
  const steps = await rows(tx, sql`select step_seq,capability_name,private_checkpoint,source_refs from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${runId} and status='succeeded'
      and capability_name in ('source.restore.v1','record_need','history.summary.v1','recall_history','knowledge.search.v1','web.search.v1','web.read.v1','query_business','query_materials','query_followups','synthesis.bound_materials.v1','synthesis.bound_construction.v1','synthesis.bound_followups.v1') order by step_seq`);
  const context: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [] };
  for (const step of steps) {
    if (step.capability_name === 'source.restore.v1') {
      const restored = step.private_checkpoint as SynthesisContext;
      if (!await synthesisContextAvailable(tx, actor, conversation, restored)) fail('context_changed');
      context.ancestors = restored.ancestors;
      for (const key of ['knowledge','snapshots','sources'] as const) (context[key] as unknown[]).push(...restored[key]);
      (context.web ??= []).push(...(restored.web || []));
      (context.history ??= []).push(...(restored.history || []));
    } else if (step.capability_name === 'record_need') {
      const snapshot = await savedNeedOriginal(tx, actor, conversation, runId, step);
      (context.history ??= []).push(snapshot);
      context.sources.push(...historySynthesisSources(snapshot).map(source => ({ ...source, title: '本轮已记录需求的客户原话' })));
    } else if (step.capability_name === 'recall_history' || step.capability_name === 'history.summary.v1') {
      const snapshot=step.private_checkpoint as HistorySnapshot;
      if(!await historyRefsAvailable(tx,actor.enterpriseId,String(conversation.id),snapshot.sources))fail('context_changed');
      (context.history??=[]).push(snapshot);context.sources.push(...historySynthesisSources(snapshot));
    } else if (step.capability_name === 'web.search.v1' || step.capability_name === 'web.read.v1') {
      const evidence = webEvidence(step.private_checkpoint as WebSearchSnapshot, runId, Number(step.step_seq));
      for (const e of evidence) if (!await resolveWebEvidence(tx, actor, conversation, e)) fail('context_changed');
      (context.web ??= []).push(...evidence);
      context.sources.push(...webSynthesisSources(evidence));
    } else if (step.capability_name === 'knowledge.search.v1') {
      for (const e of step.private_checkpoint as Evidence[]) {
        const source = await resolveEvidence(tx, actor, conversation, e);
        if (!source || !String(source.text).includes(e.text)) fail('context_changed');
        if (!context.knowledge.some(old => old.ref.id === e.ref.id)) {
          context.knowledge.push(e);
          context.sources.push(...knowledgeSynthesisSources([e], { [e.ref.id]: String(source.title) }));
        }
      }
    } else {
      const bound = ['synthesis.bound_materials.v1','synthesis.bound_construction.v1','synthesis.bound_followups.v1'].includes(String(step.capability_name))
        ? step.private_checkpoint as { resultKey: string; snapshot: BusinessSnapshot } : null;
      const snapshot = bound ? bound.snapshot : step.private_checkpoint as BusinessSnapshot;
      if (!await businessSnapshotAvailable(tx, actor.enterpriseId, snapshot)) fail('context_changed');
      context.snapshots.push(snapshot);
      const seq = Number(step.step_seq) - 1200;
      context.sources.push(...businessSynthesisSources(bound?.resultKey || `${runId}:${Math.floor(seq / 10)}:${seq % 10}`, snapshot));
    }
  }
  // The same original can be consulted by both the optional digest and recall.
  // Collapse only identical complete source packets; differing hashes, versions,
  // audiences or metadata stay distinct and cannot gain an unambiguous ID.
  context.sources = [...new Map(context.sources.map(source => [fingerprint(source),source])).values()];
  return context;
}

/** All consulted evidence is retained, including conflicting/uncited candidates. Replacement invalidates synthesis. */
export async function synthesisContextAvailable(tx: PostgresTransaction, actor: ActorContext, conversation: Row, context: SynthesisContext) {
  if (context.version !== 1) return false;
  if (context.ancestors && !await ancestorSourcesAvailable(tx, actor, conversation, context.ancestors)) return false;
  for(const snapshot of context.history||[])if(!await historyRefsAvailable(tx,actor.enterpriseId,String(conversation.id),snapshot.sources))return false;
  for (const e of context.knowledge) if (!await resolveEvidence(tx, actor, conversation, e)) return false;
  for (const e of context.web || []) if (!await resolveWebEvidence(tx, actor, conversation, e)) return false;
  for (const snapshot of context.snapshots) {
    try { if (!await businessSnapshotAvailable(tx, actor.enterpriseId, snapshot)) return false; } catch { return false; }
  }
  return true;
}
