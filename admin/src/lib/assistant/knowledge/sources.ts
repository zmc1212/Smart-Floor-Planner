import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, type ActorContext, type Evidence } from '../contracts';
import { knowledgeContext, reportStageKnowledgeContext } from './applicability-context';
import { agentMessageAvailable } from '../agent/media-context';
import { constructionMessageActions } from '@/lib/construction/customer';
import { siteRecordProjection, siteBusinessRecords } from '@/lib/construction/site-publications';
import { siteWatchProjection } from '@/lib/construction/site-watches';
import { publicMessageProjection } from '@/lib/construction/public-projections';
import { planMessageProjection } from '@/lib/construction/site-plans';
import { siteResultRecords } from '@/lib/construction/site-results';
import type { FileLocator } from '../contracts/source-file';
import { fileQuoteSpans } from './source-file';
import { parseWebCitationId, webCitationForAnswer } from '../agent/web-evidence';
import { designerMessageProjection } from '@/lib/portfolio/designer-recommendation';
export type PreviewPolicy={audience:'customer_public'|'staff_internal'|'all';drafts:Array<{id:string;documentId:string;hash:string;editVersion:number}>};
export function previewPolicy(c:Row):PreviewPolicy {
  const value=(c.entry_snapshot as {preview?:PreviewPolicy})?.preview;
  if (!value || !['customer_public','staff_internal','all'].includes(value.audience) || !Array.isArray(value.drafts)) fail('context_changed');
  return value;
}
export async function createPreviewPolicy(tx:PostgresTransaction,enterpriseId:string,input:Row):Promise<PreviewPolicy> {
  const audience=input.audience ?? 'customer_public', ids=input.draftVersionIds ?? [];
  if (!['customer_public','staff_internal','all'].includes(String(audience)) || !Array.isArray(ids) || ids.length>10 || new Set(ids).size!==ids.length) fail('invalid_message',422);
  const drafts:PreviewPolicy['drafts']=[];
  for(const value of ids) {
    const v=await one(tx,sql`select v.*,d.audience from app.assistant_knowledge_versions v join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
      join app.assistant_enterprise_settings s on s.enterprise_id=v.enterprise_id
      where v.enterprise_id=${enterpriseId} and v.id=${id(value)} and v.published_at is null and d.status<>'retired'
      and v.index_status='ready' and v.indexed_hash=v.content_hash and v.index_profile_id=s.active_index_profile_id
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`);
    if(!v || (audience!=='all' && v.audience!==audience) || drafts.some(d=>d.documentId===String(v.document_id))) fail('knowledge_not_ready');
    drafts.push({id:String(v.id),documentId:String(v.document_id),hash:String(v.content_hash),editVersion:Number(v.edit_version)});
  }
  return {audience:audience as PreviewPolicy['audience'],drafts};
}
/** The same predicate protects candidates, final commits and later citation reads. */
export function sourceScope(actor:ActorContext,c:Row,historical=false) {
  const published=historical?sql`v.published_at is not null`:sql`v.published_at is not null and d.published_version_id=v.id`;
  if(actor.principal.kind==='user') return sql`d.status='active' and d.audience='customer_public' and ${published}`;
  // A project conversation is not an owner-private draft preview. Its live
  // membership is checked by AssistantRepository before retrieval or replay.
  if(c.purpose==='project_collaboration' && actor.capabilities.includes('assistant.project.shared')
    || c.purpose==='construction_followup' && actor.capabilities.includes('assistant.followup.self'))
    return sql`d.status='active' and d.audience in ('customer_public','staff_internal') and ${published}`;
  const policy=previewPolicy(c);
  const selected=policy.drafts.length?sql`(${sql.join(policy.drafts.map(p=>sql`(v.id=${p.id} and v.content_hash=${p.hash} and v.edit_version=${p.editVersion})`),sql` or `)})`:sql`false`;
  const excluded=policy.drafts.length?sql`and d.id not in (${sql.join(policy.drafts.map(p=>sql`${p.documentId}`),sql`,`)})`:sql``;
  return sql`d.status<>'retired' and ${policy.audience==='all'?sql`true`:sql`d.audience=${policy.audience}`}
    and (${selected} or (d.status='active' and ${published} ${excluded}))`;
}
export const sourceReady=sql`v.index_status='ready' and v.indexed_hash=v.content_hash and c.content_hash=v.content_hash
  and c.index_profile_id=v.index_profile_id and c.index_profile_id=s.active_index_profile_id
  and ip.status='active' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`;
export async function resolveEvidence(tx:PostgresTransaction,actor:ActorContext,conversation:Row,evidence:Evidence,historical=false) {
  if(evidence.ref.type!=='knowledge_chunk') return undefined;
  const row=await one(tx,sql`select c.*,d.id as document_id,d.title,d.source_type,d.published_version_id,v.published_at,v.version_number,v.edit_version,v.professional
    from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
    join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
    join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
    join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
    where c.enterprise_id=${actor.enterpriseId} and c.id=${id(evidence.ref.id)} and v.id=${id(evidence.ref.version)}
    and c.text_hash=${evidence.hash} and ${sourceReady} and ${sourceScope(actor,conversation,historical)}`);
  const stageContext = row && evidence.reportStage ? await reportStageKnowledgeContext(tx,actor,conversation,evidence.reportStage) : undefined;
  if (evidence.reportStage && !stageContext) return undefined;
  if (row && evidence.professional && (fingerprint(evidence.professional.entry)!==fingerprint(row.professional)
    || evidence.professional.contentHash!==row.content_hash || fingerprint(evidence.professional.context)!==fingerprint(stageContext ?? await knowledgeContext(tx,actor,conversation)))) return undefined;
  if(row && evidence.file && fingerprint(evidence.file)!==fingerprint((row.locator as {file?:FileLocator})?.file))return undefined;
  return row;
}
export async function validatePreviewSnapshot(tx:PostgresTransaction,actor:ActorContext,c:Row) {
  if(actor.principal.kind!=='admin') return;
  if (c.purpose === 'project_collaboration' && actor.capabilities.includes('assistant.project.shared')) return;
  if (c.purpose === 'construction_followup' && actor.capabilities.includes('assistant.followup.self')) return;
  for(const d of previewPolicy(c).drafts) {
    const v=await one(tx,sql`select v.id from app.assistant_knowledge_versions v join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
      join app.assistant_enterprise_settings s on s.enterprise_id=v.enterprise_id where v.enterprise_id=${actor.enterpriseId} and v.id=${d.id}
      and v.content_hash=${d.hash} and v.edit_version=${d.editVersion} and v.index_status='ready' and v.indexed_hash=v.content_hash
      and v.index_profile_id=s.active_index_profile_id and d.status<>'retired' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`);
    if(!v) fail('context_changed');
  }
}
export async function citationProjection(tx:PostgresTransaction,actor:ActorContext,c:Row,citation:Row) {
  const unavailable={id:String(citation.id),available:false,reason:'source_unavailable'};
  // Retention keeps the citation row and source identifiers for audit, but a
  // redacted locator must never rehydrate the knowledge title or quote from a
  // still-retained knowledge source.
  if ((citation.locator as { retentionRedacted?: unknown } | null)?.retentionRedacted === true) return unavailable;
  if(!citation.chunk_id) return unavailable;
  const source=await resolveEvidence(tx,actor,c,{ref:{type:String(citation.resource_type),id:String(citation.chunk_id),version:String(citation.document_version_id)},hash:String(citation.source_hash),text:''},
    (citation.locator as { synthesis?: boolean } | null)?.synthesis !== true);
  if(!source) return unavailable;
  const file=(source.locator as {file?:FileLocator})?.file;
  return {id:String(citation.id),available:true,title:source.title,version:String(citation.document_version_id),versionNumber:Number(source.version_number),
    referenceCase:source.source_type==='reference_case',
    quote:source.text?String(citation.quote_snapshot):'',locator:citation.locator,isDraft:citation.is_draft,
    ...(file?{sourceLocation:`${file.name} · ${file.label}`,sourceFile:file,quoteSpans:fileQuoteSpans(String(source.text),String(citation.quote_snapshot),Number((source.locator as Row).start))}:{}),
    ...(source.professional ? {professional:{kind:(source.professional as Row).kind,origin:(source.professional as Row).origin,conditions:(source.professional as Row).conditions,prerequisites:(source.professional as Row).prerequisites,exceptions:(source.professional as Row).exceptions}} : {}),
    historical:String(source.published_version_id)!==String(citation.document_version_id)};
}
export async function webCitationProjection(tx: PostgresTransaction, actor: ActorContext, c: Row, citationId: string) {
  const ref = parseWebCitationId(citationId);
  const run = ref ? await one(tx, sql`select output_message_id from app.assistant_runs where enterprise_id=${actor.enterpriseId}
    and conversation_id=${String(c.id)} and id=${ref.runId}`) : null;
  if (!run?.output_message_id || !await agentMessageAvailable(tx, actor.enterpriseId, String(c.id), String(run.output_message_id),actor))
    return { id: citationId, available: false, reason: 'source_unavailable' };
  return await webCitationForAnswer(tx, actor, c, citationId) || { id: citationId, available: false, reason: 'source_unavailable' };
}
/** Explain why a saved answer can no longer be replayed. A retryable store
 * failure is not described as deleted content, and a lost grant is not
 * described as a changed version. */
export function unavailableNoticeText(reason?: string) {
  if (reason === 'source_changed') return '这条回答所依据的公开资料已更新，请重新查看最新版本。';
  if (reason === 'source_missing') return '这条回答所依据的原始记录已不存在，无法继续查看。';
  if (reason === 'source_forbidden') return '你已无权查看这条回答所依据的资料。';
  if (reason === 'source_withdrawn') return '这条回答所依据的公开内容已撤回，无法继续查看。';
  if (reason === 'source_unreadable') return '资料暂时无法读取，请稍后重试。';
  return '这条回答所依据的资料已不可用，请重新提问。';
}
export async function projectMessage(tx:PostgresTransaction,actor:ActorContext,c:Row,message:Row) {
  // Revoking an original also hides pre-revocation AI prose after it. This
  // conservative fence covers unstructured replies without inventing citations;
  // future turns can answer again from the remaining live sources.
  const speech = await one(tx, sql`select exists(select 1 from app.assistant_speech_assets a
    join app.assistant_messages original on original.enterprise_id=a.enterprise_id and original.id=a.message_id
    join app.assistant_messages target on target.enterprise_id=a.enterprise_id and target.conversation_id=a.conversation_id
    where a.enterprise_id=${actor.enterpriseId} and a.conversation_id=${String(c.id)} and a.deleted_at is not null and target.id=${String(message.id)}
      and (target.id=a.message_id or target.author_kind='assistant' and target.seq>=original.seq and target.created_at<=a.deleted_at)) as revoked`);
  const media = await one(tx, sql`select a.id,(a.deleted_at is null and (a.source_ref is null or exists(
      select 1 from app.leads l join app.floor_plans f on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id
      where l.enterprise_id=a.enterprise_id and l.id::text=a.source_ref->>'leadId' and l.customer_user_id=a.customer_user_id
      and l.archived_at is null and f.id::text=a.source_ref->>'floorPlanId' and f.status='completed'))) as available
    from app.assistant_media a join app.assistant_messages m
    on m.enterprise_id=a.enterprise_id and m.conversation_id=a.conversation_id and m.client_message_id='media:' || a.request_key
    where m.enterprise_id=${actor.enterpriseId} and m.id=${String(message.id)}`);
  const citations=await rows(tx,sql`select * from app.assistant_message_citations where enterprise_id=${actor.enterpriseId} and message_id=${String(message.id)} order by id`);
  const projected=[];
  for(const citation of citations)projected.push(await citationProjection(tx,actor,c,citation));
  const webIds = [...new Set(((message.content as { blocks?: Array<{ type?: string; citationId?: string }> })?.blocks || [])
    .filter(b => b.type === 'citation' && b.citationId && parseWebCitationId(b.citationId)).map(b => b.citationId!))];
  for (const citationId of webIds) projected.push(await webCitationProjection(tx, actor, c, citationId));
  const publicProjection = await publicMessageProjection(tx, actor, c, String(message.id));
  const planProjection = await planMessageProjection(tx, actor.enterpriseId, String(c.id), String(message.id));
  const available=speech?.revoked !== true && planProjection?.available !== false && publicProjection?.available !== false && !(message.answer_kind==='grounded' && !projected.length) && projected.every(x=>x.available)
    && await agentMessageAvailable(tx, actor.enterpriseId, String(c.id), String(message.id),actor);
  // Only a public-source denial names its reason; other blocks keep the generic
  // fallback. The client renders fallbackText, so no client change is needed.
  const publicReason = publicProjection && publicProjection.available === false ? publicProjection.reason : undefined;
  const designerRecommendation = available && actor.principal.kind === 'user'
    ? await designerMessageProjection(tx, actor, String(c.id), String(message.id)) : null;
  return {id:String(message.id),seq:String(message.seq),authorKind:message.author_kind,answerKind:message.answer_kind ?? null,available,
    ...(publicProjection ? { publicSourceBound: true } : {}),
    content:available?message.content:{version:1,blocks:[{type:'notice',code:'source_unavailable',
      ...(publicReason?{reason:publicReason}:{}),fallbackText:unavailableNoticeText(publicReason)}]},
    citations:publicReason ? [] : projected,createdAt:message.created_at,constructionReminder: available && message.purpose === 'construction.stage',
    constructionFollowUp: available && message.purpose === 'construction.followup',
    planDecision: available && planProjection?.available ? planProjection.planDecision : null,
    siteRecord: available && message.purpose === 'construction.record' ? await siteRecordProjection(tx, actor.enterpriseId, String(c.id), String(message.id)) : null,
    siteRecords: available && message.purpose === 'construction.result' ? await siteResultRecords(tx, actor.enterpriseId, String(c.id), String(message.id))
      : available && message.author_kind === 'assistant' ? await siteBusinessRecords(tx, actor.enterpriseId, String(c.id), String(message.id)) : [],
    siteWatch: available && message.purpose === 'construction.watch' ? await siteWatchProjection(tx, actor.enterpriseId, String(c.id), String(message.id)) : null,
    ...(available && publicProjection?.available && !publicProjection.opening ? { publicConsent: publicProjection.publicConsent || null, publicContext: publicProjection.publicContext || null, publicReferences: publicProjection.publicReferences || [] } : {}),
    ...(available && actor.principal.kind === 'user' ? { constructionContacts: await constructionMessageActions(tx, actor, String(c.id), String(message.id)) } : {}),
    ...(available ? { designerRecommendation } : {}),
    ...(media ? { mediaId: String(media.id), mediaAvailable: !!media.available } : {}) };
}
