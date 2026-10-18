import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, type ActorContext, type Evidence } from '../contracts';
import { sourceReady, sourceScope } from './sources';
import { contentEntrySource, type ContentEntry } from './content-entry';

/** Curated labels are a bounded matcher, not an inference of visual similarity. */
export async function recommendReferences(tx: PostgresTransaction, actor: ActorContext, conversation: Row, query: unknown): Promise<Evidence[]> {
  if (typeof query !== 'string' || query.length > 200) fail('invalid_message', 422);
  const candidates = await rows(tx, sql`select c.id,c.text,c.text_hash,c.document_version_id,d.title,v.reference_case->'tags' as tags
    from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
    join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
    join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
    join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
    where c.enterprise_id=${actor.enterpriseId} and d.source_type='reference_case' and v.reference_case is not null
    and c.ordinal=0 and ${sourceReady} and ${sourceScope(actor, conversation)}
    order by d.id desc limit 200`);
  const terms = query.trim().split(/\s+/).filter(Boolean);
  return candidates.filter(c => !terms.length || terms.every(term => [String(c.title), ...(c.tags as string[])].some(tag => tag.includes(term) || term.includes(tag))))
    .slice(0, 3).map(c => ({ ref: { type: 'knowledge_chunk', id: String(c.id), version: String(c.document_version_id) }, text: String(c.text), hash: String(c.text_hash) }));
}
export type ReferencePreference = { operationId: string; sourceMessageId: string; quote: string; sentiment: 'like' | 'dislike';
  documentId: string; versionId: string; supersedes: string | null };
export function explicitReferencePreference(text: string, quote: unknown, sentiment: unknown) {
  if (typeof quote !== 'string' || !quote.trim() || quote.length > 500 || !text.includes(quote)
    || !['like','dislike'].includes(String(sentiment)) || /[？?]|如果|假如|假设|是不是|是否|要不要|随便|浏览|看看|先看|不代表|[“”「」"]/.test(text)) return false;
  const negative = /(?:不|没)(?:太|那么|怎么)?(?:喜欢|中意|满意)|不(?:太)?合适|不适合/;
  return sentiment === 'like' ? /喜欢|中意|满意/.test(quote) && !negative.test(text) : negative.test(quote);
}
export async function saveReferencePreference(tx: PostgresTransaction, actor: ActorContext, conversation: Row, trigger: Row, input: Row, operationId: string) {
  if (actor.principal.kind !== 'user' || !input || Object.keys(input).some(k => !['ordinal','quote','sentiment'].includes(k))
    || !Number.isInteger(input.ordinal) || Number(input.ordinal) < 1 || Number(input.ordinal) > 3) fail('invalid_message', 422);
  const text = ((trigger.content as Row).blocks as Array<{text?: string}>).map(b => b.text || '').join('\n');
  if (!explicitReferencePreference(text, input.quote, input.sentiment)) fail('reference_preference_not_explicit', 422);
  // Ordinal is relative to the latest recommendation in THIS conversation, not a model supplied global case ID.
  const latest = await one(tx, sql`select m.id from app.assistant_messages m where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${String(conversation.id)}
    and m.seq<${String(trigger.seq)} and exists(select 1 from app.assistant_message_citations mc join app.assistant_knowledge_documents d
      on d.enterprise_id=mc.enterprise_id and d.id=mc.document_id where mc.enterprise_id=m.enterprise_id and mc.message_id=m.id and d.source_type='reference_case')
    order by m.seq desc limit 1`);
  const entry=conversation.entry_snapshot as Row;
  const entrySource=!latest&&entry.kind==='reference_content'?await contentEntrySource(tx,entry as ContentEntry):null;
  const cited = latest ? await rows(tx, sql`select mc.document_id,mc.document_version_id,d.title,d.status,d.audience,v.effective_from,v.effective_to from app.assistant_message_citations mc
    join app.assistant_knowledge_documents d on d.enterprise_id=mc.enterprise_id and d.id=mc.document_id
    join app.assistant_knowledge_versions v on v.enterprise_id=mc.enterprise_id and v.id=mc.document_version_id
    where mc.enterprise_id=${actor.enterpriseId} and mc.message_id=${String(latest.id)} and d.source_type='reference_case' order by mc.id`) : entrySource?[entrySource]:[];
  const source = cited[Number(input.ordinal) - 1];
  if (!source || source.status !== 'active' || source.audience !== 'customer_public' || new Date(String(source.effective_from)).getTime() > Date.now()
    || (source.effective_to && new Date(String(source.effective_to)).getTime() <= Date.now())) fail('reference_unavailable', 409);
  const numeral = ['一','二','三'][Number(input.ordinal)-1];
  const ordinal = new RegExp(`第(?:${numeral}|${Number(input.ordinal)})(?:个|款|张|套|例)`);
  const quote=String(input.quote);
  if (!ordinal.test(quote) && !quote.includes(String(source.title)) && !(cited.length === 1 && /这(?:个|张|款|套)|参考|案例/.test(quote))) fail('reference_preference_not_explicit', 422);
  const ordinals=[...quote.matchAll(/第([一二三123])(?:个|款|张|套|例)/g)].map(m=>m[1]);
  if (ordinals.some(n=>![numeral,String(input.ordinal)].includes(n))) fail('reference_preference_not_explicit',422);
  const preferences = ((conversation.entry_snapshot as Row)?.referencePreferences || []) as ReferencePreference[];
  if (preferences.some(p => p.operationId === operationId)) return;
  if (preferences.length >= 100) fail('need_memory_limit', 422);
  const prior = [...preferences].reverse().find(p => p.documentId === String(source.document_id));
  const next: ReferencePreference = { operationId, sourceMessageId: String(trigger.id), quote: String(input.quote), sentiment: input.sentiment as 'like' | 'dislike',
    documentId: String(source.document_id), versionId: String(source.document_version_id), supersedes: prior?.operationId || null };
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{referencePreferences}',${JSON.stringify([...preferences,next])}::jsonb),
    version=version+1,updated_at=now() where enterprise_id=${actor.enterpriseId} and id=${String(conversation.id)}`);
}
