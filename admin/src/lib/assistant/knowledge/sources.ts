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
import { siteResultProjection } from '@/lib/construction/site-results';
import type { FileLocator } from '../contracts/source-file';
import type { ProfessionalKnowledge } from '../contracts/professional';
import { fileQuoteSpans } from './source-file';
import { knowledgeProvenance, knowledgeRowAllowed } from './provenance';
import { sourceIndexReady } from './managed-store';
import { platformKnowledgeScope, platformKnowledgeSupplement, readPlatformKnowledge } from './platform-library';
import { citationWebSource, parseWebCitationId, webCitationForAnswer, webSourceErrorCode, type WebSourceChecks } from '../agent/web-evidence';
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
      and v.index_status='ready' and v.indexed_hash=v.content_hash and ${sourceIndexReady}
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now()) and d.scope='enterprise'`);
    if(!v || (audience!=='all' && v.audience!==audience) || drafts.some(d=>d.documentId===String(v.document_id))) fail('knowledge_not_ready');
    drafts.push({id:String(v.id),documentId:String(v.document_id),hash:String(v.content_hash),editVersion:Number(v.edit_version)});
  }
  return {audience:audience as PreviewPolicy['audience'],drafts};
}
/** The same predicate protects candidates, final commits and later citation reads. */
export function sourceScope(actor:ActorContext,c:Row,historical=false,projectId?:string) {
  const published = sql`v.published_at is not null and (d.published_version_id=v.id
    or (${historical} and d.scope='enterprise'))`;
  const scope = actor.entry?.kind === 'wechat_personal' ? sql`d.scope='enterprise'` : sql`(d.scope='enterprise' or (d.scope='project' and d.project_id=${projectId ?? null}
    and exists(select 1 from app.construction_projects kp where kp.enterprise_id=d.enterprise_id
      and kp.id=d.project_id and kp.status='active')))`;
  if(actor.principal.kind==='user') return sql`${scope} and d.status='active' and d.audience='customer_public' and ${published}`;
  // A project conversation is not an owner-private draft preview. Its live
  // membership is checked by AssistantRepository before retrieval or replay.
  if(c.purpose==='project_collaboration' && actor.capabilities.includes('assistant.project.shared')
    || c.purpose==='construction_followup' && actor.capabilities.includes('assistant.followup.self'))
    return sql`${scope} and d.status='active' and d.audience in ('customer_public','staff_internal') and ${published}`;
  const policy=previewPolicy(c);
  const selected=policy.drafts.length?sql`(${sql.join(policy.drafts.map(p=>sql`(v.id=${p.id} and v.content_hash=${p.hash} and v.edit_version=${p.editVersion})`),sql` or `)})`:sql`false`;
  const excluded=policy.drafts.length?sql`and d.id not in (${sql.join(policy.drafts.map(p=>sql`${p.documentId}`),sql`,`)})`:sql``;
  return sql`d.scope='enterprise' and d.status<>'retired' and ${policy.audience==='all'?sql`true`:sql`d.audience=${policy.audience}`}
    and (${selected} or (d.status='active' and ${published} ${excluded}))`;
}
export const sourceReady=sql`v.index_status='ready' and v.indexed_hash=v.content_hash and c.content_hash=v.content_hash
  and c.index_profile_id=v.index_profile_id and ${sourceIndexReady}
  and ip.status='active' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`;
export function sourceStage(stage?: string) {
  if (!stage) return sql`true`;
  return sql`not exists (select 1 from jsonb_array_elements(v.professional->'conditions') condition
    where condition->>'field'='stage' and (
      (condition->>'operator'='in' and not (condition->'values' ? ${stage}::text))
      or (condition->>'operator'='not_in' and (condition->'values' ? ${stage}::text))))`;
}
export async function resolveEvidence(tx:PostgresTransaction,actor:ActorContext,conversation:Row,evidence:Evidence,historical=false) {
  if(evidence.ref.type!=='knowledge_chunk') return undefined;
  const stageContext = evidence.reportStage ? await reportStageKnowledgeContext(tx,actor,conversation,evidence.reportStage) : undefined;
  if (evidence.reportStage && !stageContext) return undefined;
  const context = stageContext ?? await knowledgeContext(tx,actor,conversation);
  const lookup = (enterpriseId: string, platform: boolean) => one(tx,sql`select c.*,d.id as document_id,d.title,d.source_type,d.scope,d.project_id,d.category,d.published_version_id,
    ${platform}::boolean as platform_knowledge,
    v.published_at,v.version_number,v.edit_version,v.professional,v.effective_from,v.effective_to,e.name as enterprise_name
    from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
    join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
    join app.enterprises e on e.id=d.enterprise_id
    join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
    join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
    where c.enterprise_id=${enterpriseId} and c.id=${id(evidence.ref.id)} and v.id=${id(evidence.ref.version)} and e.status='active'
    and c.text_hash=${evidence.hash} and ${sourceReady} and ${sourceStage(context.stage)}
    and ${platform ? platformKnowledgeScope : sourceScope(actor,conversation,historical,context.projectId)}`);
  let row = evidence.knowledge?.scope === 'platform' ? undefined : await lookup(actor.enterpriseId, false);
  if (!row) {
    const corpus = await platformKnowledgeSupplement(tx, actor, conversation);
    if (corpus) row = await readPlatformKnowledge(tx, corpus, () => lookup(corpus, true));
  }
  if (row && (!knowledgeRowAllowed(row) || fingerprint(row.text) !== row.text_hash)) return undefined;
  if (row && evidence.professional && (fingerprint(evidence.professional.entry)!==fingerprint(row.professional)
    || evidence.professional.contentHash!==row.content_hash || fingerprint(evidence.professional.context)!==fingerprint(context))) return undefined;
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
      and ${sourceIndexReady} and d.scope='enterprise' and d.status<>'retired' and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`);
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
  if(!source || String(source.enterprise_id)!==String(citation.source_enterprise_id ?? citation.enterprise_id)) return unavailable;
  const file=(source.locator as {file?:FileLocator})?.file;
  const professional = source.professional as ProfessionalKnowledge | null, origin = professional?.origin;
  const location = origin ? `${origin.title} · ${origin.locator}` : file ? `${file.name} · ${file.label}` : undefined;
  const sourceLocation = source.platform_knowledge ? ['平台公共知识', location].filter(Boolean).join(' · ') : location;
  return {id:String(citation.id),available:true,title:source.title,version:String(citation.document_version_id),versionNumber:Number(source.version_number),
    sourceHash:String(citation.source_hash),contentHash:String(source.content_hash),
    knowledge:knowledgeProvenance(source),chapter:file?.section ?? [],page:file?.extraction?.pdfPage ?? file?.page ?? origin?.page ?? null,
    referenceCase:source.source_type==='reference_case',
    quote:source.text?String(citation.quote_snapshot):'',locator:citation.locator,isDraft:citation.is_draft,
    ...(sourceLocation ? { sourceLocation } : {}),
    ...(file ? { sourceFile:file, quoteSpans:fileQuoteSpans(String(source.text),String(citation.quote_snapshot),Number((source.locator as Row).start)) } : {}),
    ...(professional ? { professional: {kind:professional.kind,origin,conditions:professional.conditions,
      prerequisites:professional.prerequisites,exceptions:professional.exceptions} } : {}),
    historical:String(source.published_version_id)!==String(citation.document_version_id)};
}
export async function webCitationProjection(tx: PostgresTransaction, actor: ActorContext, c: Row, citationId: string, checked?: WebSourceChecks) {
  const ref = parseWebCitationId(citationId);
  const run = ref ? await one(tx, sql`select output_message_id from app.assistant_runs where enterprise_id=${actor.enterpriseId}
    and conversation_id=${String(c.id)} and id=${ref.runId}`) : null;
  if (!run?.output_message_id || !await agentMessageAvailable(tx, actor.enterpriseId, String(c.id), String(run.output_message_id),actor))
    return { id: citationId, available: false, reason: 'source_unavailable' };
  const citation = await webCitationForAnswer(tx, actor, c, citationId);
  if (!citation) return { id: citationId, available: false, reason: 'source_unavailable' };
  const source = citationWebSource(citation);
  const reason = checked && source ? checked.has(source.hash) ? checked.get(source.hash) : 'source_unreadable' : null;
  if (!reason) return citation;
  const errorCode = checked && source && webSourceErrorCode(checked, source.hash);
  return { id: citationId, available: false, reason, ...(errorCode ? { errorCode } : {}) };
}

type CitationPageGroup = { page: number; ids: string[] };
type MessageCitation = Awaited<ReturnType<typeof citationProjection | typeof webCitationProjection>>;

/** Only group the authorized citations of one saved message. Keep their IDs
 * and exact excerpts intact for the existing citation endpoint. */
export function citationPageGroups(citations: MessageCitation[]): CitationPageGroup[] {
  const groups = new Map<string, CitationPageGroup>();
  for (const citation of citations) {
    if (!citation.available) continue;
    const web = citationWebSource(citation);
    const pdf = web?.document?.mediaType === 'application/pdf' ? web.document : undefined;
    const knowledge = 'knowledge' in citation ? citation.knowledge : undefined;
    const page = pdf?.page ?? ('page' in citation ? citation.page : undefined);
    if (typeof page !== 'number' || !Number.isSafeInteger(page) || page < 1) continue;
    const source = knowledge ? ['knowledge', knowledge.scope, knowledge.documentId, knowledge.versionId]
      : pdf && web ? ['web', web.url, pdf.hash] : undefined;
    if (!source) continue;
    const key = JSON.stringify([...source, page]);
    const group = groups.get(key);
    if (group) group.ids.push(citation.id);
    else groups.set(key, { page, ids: [citation.id] });
  }
  return [...groups.values()].filter(group => group.ids.length > 1);
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
export async function projectMessage(tx:PostgresTransaction,actor:ActorContext,c:Row,message:Row,webChecks?:WebSourceChecks) {
  if (message.purpose !== 'reply.regenerate') return projectSavedMessage(tx, actor, c, message, webChecks);
  const original = await one(tx, sql`select original.* from app.assistant_messages variant
    join app.assistant_messages original on original.enterprise_id=variant.enterprise_id and original.conversation_id=variant.conversation_id
      and original.id=variant.reply_to_message_id and original.seq<variant.seq and original.purpose='reply' and original.author_kind='assistant'
    where variant.enterprise_id=${actor.enterpriseId} and variant.conversation_id=${String(c.id)} and variant.id=${String(message.id)}`);
  const available = !!original && (await projectSavedMessage(tx, actor, c, original, webChecks)).available;
  return projectSavedMessage(tx, actor, c, message, webChecks, available);
}

async function projectSavedMessage(tx:PostgresTransaction, actor:ActorContext, c:Row, message:Row, webChecks?:WebSourceChecks, originalAvailable = true) {
  // Revoking an original also hides pre-revocation AI prose after it. This
  // conservative fence covers unstructured replies without inventing citations;
  // future turns can answer again from the remaining live sources.
  const deleted = (message.content as Row)?.deleted === true;
  const speech = await one(tx, sql`select exists(select 1 from app.assistant_speech_assets a
    join app.assistant_messages original on original.enterprise_id=a.enterprise_id and original.id=a.message_id
    join app.assistant_messages target on target.enterprise_id=a.enterprise_id and target.conversation_id=a.conversation_id
    where a.enterprise_id=${actor.enterpriseId} and a.conversation_id=${String(c.id)} and a.deleted_at is not null and target.id=${String(message.id)}
      and (target.id=a.message_id or target.author_kind='assistant' and target.seq>=original.seq and target.created_at<=a.deleted_at)) as revoked,
    exists(select 1 from app.assistant_speech_assets a where a.enterprise_id=${actor.enterpriseId}
      and a.conversation_id=${String(c.id)} and a.message_id=${String(message.id)}) as bound`);
  const media = await one(tx, sql`select a.id,(a.deleted_at is null and (a.source_ref is null or exists(
      select 1 from app.leads l join app.floor_plans f on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id
      where l.enterprise_id=a.enterprise_id and l.id::text=a.source_ref->>'leadId' and l.customer_user_id=a.customer_user_id
      and l.archived_at is null and f.id::text=a.source_ref->>'floorPlanId' and f.status='completed'))) as available
    from app.assistant_media a join app.assistant_messages m
    on m.enterprise_id=a.enterprise_id and m.conversation_id=a.conversation_id and m.client_message_id='media:' || a.request_key
    where m.enterprise_id=${actor.enterpriseId} and m.id=${String(message.id)}`);
  const citations=await rows(tx,sql`select * from app.assistant_message_citations where enterprise_id=${actor.enterpriseId} and message_id=${String(message.id)} order by id`);
  const projected: MessageCitation[] = [];
  for(const citation of citations)projected.push(await citationProjection(tx,actor,c,citation));
  const webIds = [...new Set(((message.content as { blocks?: Array<{ type?: string; citationId?: string }> })?.blocks || [])
    .filter(b => b.type === 'citation' && b.citationId && parseWebCitationId(b.citationId)).map(b => b.citationId!))];
  for (const citationId of webIds) projected.push(await webCitationProjection(tx, actor, c, citationId, webChecks));
  const publicProjection = await publicMessageProjection(tx, actor, c, String(message.id));
  const planProjection = await planMessageProjection(tx, actor.enterpriseId, String(c.id), String(message.id));
  const sourceAvailable=!deleted && originalAvailable && speech?.revoked !== true && planProjection?.available !== false && publicProjection?.available !== false && !(message.answer_kind==='grounded' && !projected.length) && projected.every(x=>x.available)
    && await agentMessageAvailable(tx, actor.enterpriseId, String(c.id), String(message.id),actor);
  const siteResult = sourceAvailable && message.purpose === 'construction.result'
    ? await siteResultProjection(tx, actor.enterpriseId, String(c.id), String(message.id)) : null;
  const available = sourceAvailable && siteResult?.available !== false;
  const citationGroups = available ? citationPageGroups(projected) : [];
  // Only a public-source denial names its reason; other blocks keep the generic
  // fallback. The client renders fallbackText, so no client change is needed.
  const webReason = projected.find(x => !x.available && 'reason' in x && webIds.includes(x.id) && x.reason !== 'source_unavailable');
  const publicReason = publicProjection && publicProjection.available === false ? publicProjection.reason
    : webReason && 'reason' in webReason ? webReason.reason : undefined;
  const designerProjection = available && actor.principal.kind === 'user'
    ? await designerMessageProjection(tx, actor, String(c.id), String(message.id)) : null;
  const designerRecommendation = designerProjection?.items.length ? designerProjection : null;
  const designerDiscovery = designerProjection && !designerProjection.items.length
    ? { needContext: designerProjection.needContext === true } : null;
  return {id:String(message.id),seq:String(message.seq),authorKind:message.author_kind,answerKind:message.answer_kind ?? null,available,
    ...(publicProjection ? { publicSourceBound: true } : {}),
    ...(deleted ? { deleted: true } : {}), ...(speech?.bound ? { speechMessage: true } : {}),
    content:available || deleted ? message.content : {version:1,blocks:[{type:'notice',code:'source_unavailable',
      ...(publicReason?{reason:publicReason}:{}),fallbackText:unavailableNoticeText(publicReason)}]},
    citations:publicReason ? [] : projected, ...(citationGroups.length ? { citationGroups } : {}),
    createdAt:message.created_at,constructionReminder: available && message.purpose === 'construction.stage',
    constructionFollowUp: available && message.purpose === 'construction.followup',
    planDecision: available && planProjection?.available ? planProjection.planDecision : null,
    siteRecord: available && message.purpose === 'construction.record' ? await siteRecordProjection(tx, actor.enterpriseId, String(c.id), String(message.id)) : null,
    siteRecords: siteResult?.available ? siteResult.records
      : available && message.author_kind === 'assistant' ? await siteBusinessRecords(tx, actor.enterpriseId, String(c.id), String(message.id)) : [],
    ...(siteResult?.available && siteResult.closure ? { constructionClosure: siteResult.closure } : {}),
    siteWatch: available && message.purpose === 'construction.watch' ? await siteWatchProjection(tx, actor.enterpriseId, String(c.id), String(message.id)) : null,
    ...(available && publicProjection?.available && !publicProjection.opening ? { publicConsent: publicProjection.publicConsent || null, publicContext: publicProjection.publicContext || null, publicReferences: publicProjection.publicReferences || [] } : {}),
    ...(available && actor.principal.kind === 'user' ? { constructionContacts: await constructionMessageActions(tx, actor, String(c.id), String(message.id)) } : {}),
    ...(available ? { designerRecommendation, ...(designerDiscovery ? { designerDiscovery } : {}) } : {}),
    ...(media ? { mediaId: String(media.id), mediaAvailable: !!media.available } : {}) };
}
