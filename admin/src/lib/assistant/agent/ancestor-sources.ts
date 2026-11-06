import { sql } from 'drizzle-orm';
import { reportContext } from '@/lib/construction/report-reference';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, type ActorContext } from '../contracts';
import type { ModelMessage } from '../contracts/model';
import type { SynthesisContext } from './synthesis';
import { synthesisContextAvailable } from './synthesis-sources';
import { enterpriseKnowledgeEnabled } from '../knowledge-policy';

export type AncestorSourceRef = { runId: string; messageId: string; contentHash: string; contextHash: string };
export const ancestorSourcesProtocol = 'authorized-ancestor-sources-v1';
// 1008 belongs to history.summary.v1. Public source receipts must not be read
// as summary HistoryRefs when a conversation first acquires web evidence.
export const ancestorSourcesStep = 1013;

/** Public dialogue may retain its original assistant text without inheriting
 * historical project/status/need snapshots as current business facts. */
export function publicOnlySynthesisContext(context: SynthesisContext) {
  return Array.isArray(context?.sources) && context.sources.length > 0 && context.sources.every(source => source?.kind === 'web')
    && Array.isArray(context.knowledge) && !context.knowledge.length
    && Array.isArray(context.snapshots) && !context.snapshots.length && !(context.history?.length);
}

/** Restore whole originals actually cited by the committed answer, not every
 * page its research happened to visit. The parent context/hash and live source
 * checks remain intact; no quotation is shortened or promoted to authority. */
export function selectedAncestorSources(context: SynthesisContext, answer: unknown) {
  const value = answer as { kind?: unknown; segments?: Array<{ citations?: Array<{ sourceId?: unknown }> }> } | null;
  if (value?.kind !== 'synthesis' || !Array.isArray(value.segments)) return [];
  const selected = new Set(value.segments.flatMap(segment => Array.isArray(segment?.citations)
    ? segment.citations.flatMap(citation => typeof citation?.sourceId === 'string' ? [citation.sourceId] : []) : []));
  return context.sources.filter(source => selected.has(source.sourceId));
}

/** Only committed answers in this same authorized conversation can introduce
 * ancestor Evidence. Display ordinals and generated prose are never parsed. */
export async function restoreAncestorSources(tx: PostgresTransaction, actor: ActorContext, conversation: Row,
  runId: string, beforeSeq: string, options: { publicOnly?: boolean } = {}): Promise<SynthesisContext> {
  const saved = await one(tx, sql`select private_checkpoint,input_summary from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${runId}
      and kind='agent_source_context' and capability_name='source.restore.v1' and status='succeeded'`);
  const settings = await one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId} for share`);
  const allowKnowledge = conversation.purpose === 'knowledge_preview' || enterpriseKnowledgeEnabled(settings?.agent_config);
  if (saved) {
    const context = saved.private_checkpoint as SynthesisContext;
    if (!!(saved.input_summary as Row)?.publicOnly !== !!options.publicOnly
      || options.publicOnly && context.sources.length > 0 && !publicOnlySynthesisContext(context)) fail('context_changed');
    if (!allowKnowledge && context.knowledge.length) fail('context_changed');
    return context;
  }
  const candidates = await rows(tx, sql`select r.id run_id,m.id message_id,m.content,s.source_refs,s.private_checkpoint answer
    from app.assistant_runs r join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id
    join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id
    where r.enterprise_id=${actor.enterpriseId} and r.conversation_id=${String(conversation.id)}
      and r.status='succeeded' and m.seq<${beforeSeq} and m.author_kind='assistant'
      and s.kind='agent_synthesis_context' and s.status='succeeded' order by m.seq desc limit 2`);
  const result: SynthesisContext = { version: 1, knowledge: [], snapshots: [], sources: [], web: [], history: [], ancestors: [] };
  for (const candidate of candidates) {
    const context = candidate.source_refs as SynthesisContext;
    if (options.publicOnly && !publicOnlySynthesisContext(context)) continue;
    // Source choice controls new model input, not historical human access.
    if (!allowKnowledge && context.knowledge.length) continue;
    // Removing/replacing the explicit reference is not permission to silently
    // restore a previous report into a new question. Historical answers still
    // use their own live source checks when read.
    const selected = reportContext(conversation.entry_snapshot).selection;
    if (context.snapshots.some(s => 'reportReference' in s && s.reportReference
      && (!selected || fingerprint(s.reportReference.selection) !== fingerprint(selected)))) continue;
    if (!await synthesisContextAvailable(tx, actor, conversation, context)) continue;
    const sources = options.publicOnly ? selectedAncestorSources(context, candidate.answer) : context.sources;
    if (options.publicOnly && !sources.length) continue;
    const refs = [...(context.ancestors || []), { runId: String(candidate.run_id), messageId: String(candidate.message_id),
      contentHash: fingerprint(candidate.content), contextHash: fingerprint(context) }];
    const combined = [...new Map([...result.ancestors!, ...refs].map(ref => [ref.messageId, ref])).values()];
    // A bounded restoration is explicit; never discard a dependency to make an
    // inherited answer appear valid. A fresh read remains available instead.
    if (combined.length > 32 || result.sources.length + sources.length > 80) continue;
    result.ancestors = combined;
    for (const key of ['knowledge','snapshots','sources','web','history'] as const)
      (result[key] as unknown[]).push(...(key === 'sources' ? sources : context[key] || []));
  }
  for (const key of ['knowledge','snapshots','sources','web','history'] as const)
    (result[key] as unknown[]) = [...new Map((result[key] as unknown[]).map(value => [fingerprint(value), value])).values()];
  await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,private_checkpoint,source_refs,input_summary)
    values(${actor.enterpriseId},${runId},${ancestorSourcesStep},'agent_source_context','source.restore.v1',1,'succeeded',
      ${JSON.stringify(result)}::jsonb,${JSON.stringify(result.ancestors)}::jsonb,
      ${JSON.stringify({ protocol: ancestorSourcesProtocol, beforeSeq, sourceCount: result.sources.length,
        ...(options.publicOnly ? { publicOnly: true } : {}) })}::jsonb)`);
  return result;
}

export async function ancestorSourcesAvailable(tx: PostgresTransaction, actor: ActorContext, conversation: Row, refs: AncestorSourceRef[]) {
  if (!Array.isArray(refs) || refs.length > 32) return false;
  for (const ref of refs) {
    if (!ref || !/^[1-9]\d{0,18}$/.test(ref.runId) || !/^[1-9]\d{0,18}$/.test(ref.messageId)) return false;
    const saved = await one(tx, sql`select m.content,s.source_refs from app.assistant_runs r
      join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.id=r.output_message_id
      join app.assistant_run_steps s on s.enterprise_id=r.enterprise_id and s.run_id=r.id
      where r.enterprise_id=${actor.enterpriseId} and r.conversation_id=${String(conversation.id)} and r.id=${ref.runId}
        and r.status='succeeded' and m.id=${ref.messageId} and m.author_kind='assistant'
        and s.kind='agent_synthesis_context' and s.status='succeeded'`);
    if (!saved || fingerprint(saved.content) !== ref.contentHash || fingerprint(saved.source_refs) !== ref.contextHash) return false;
  }
  return true;
}

export function ancestorSourceMessages(context: SynthesisContext): ModelMessage[] {
  if (!context.sources.length) return [];
  const callId = 'server:authorized-ancestor-sources';
  return [{ role: 'assistant', content: '', toolCalls: [{ id: callId, name: 'restore_sources', arguments: '{}' }] },
    { role: 'tool', callId, content: JSON.stringify({ protocol: ancestorSourcesProtocol, synthesisSources: context.sources,
      instructions: '这些是服务端重新核验的同会话祖先原始来源，不是前轮生成答案。来源身份/原文/条件保持；只选择本轮目录提供的citationId，不猜前轮编号。公开资料不证明企业采用或本人现场达标，历史需求不授权新保存/施工/接续。来源缺失只说明本次不可确认；需要最新项目状态仍查对应服务。' }) }];
}
