import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, rows } from '@/db/repositories/assistant-repository';
import { fail, id, requireCapability, type ActorContext, type EmbeddingGateway, type Evidence } from '../contracts';
import type { KnowledgeContext, ProfessionalKnowledge } from '../contracts/professional';
import { embeddingGateway } from '../infrastructure/embedding-gateway';
import { activeProfile, text } from './service';
import { chineseQueryTerms, fuseAuthorizedCandidates } from './chinese-lexical';
import { sourceScope, sourceReady, validatePreviewSnapshot } from './sources';
import { applicability } from './professional';
import { knowledgeContext } from './applicability-context';
import type { FileLocator } from '../contracts/source-file';
import { selectContextCandidates } from './context-selection';

export const retrievalConfiguration = {version:'professional-hybrid-v4',perBranch:30,limit:5,rrfK:60,minSimilarity:0.3,reranker:'none',agentQuery:'current_question_and_model_terms_v1',contextSelection:'server_applicability_document_coverage',maxPerDocumentFirstPass:1,parser:'manual_text_faq_or_local_file_v1'} as const;
export type RetrievalDiagnostic = {
  configuration:typeof retrievalConfiguration; profileId:string; epoch:number; query:string; terms:string[]; context:KnowledgeContext; elapsedMs:number; embeddingUsage:{inputTokens:number}|null;costMicros:null;
  candidates:Array<{ref:Evidence['ref'];hash:string;title:string;documentId:string;contentHash:string;similarity:number;semanticRank:number|null;lexicalRank:number|null;fusionRank:number;
    disposition:'selected'|'below_similarity'|'ranked_out';selectionRank:number|null;applicability:ReturnType<typeof applicability>|null;contextIncluded?:boolean;contextChars?:number}>;
};
async function authorize(tx: PostgresTransaction, actor: ActorContext, conversationId: string, epoch: number) {
  const repo=new AssistantRepository(tx,actor), settings=await repo.settings(true), conversation=await repo.conversation(id(conversationId));
  if (conversation.status!=='open' || conversation.mode!=='ai' || Number(settings!.knowledge_epoch)!==epoch) fail('context_changed');
  await validatePreviewSnapshot(tx,actor,conversation);
  return {profile:await activeProfile(tx,actor.enterpriseId,settings!),conversation};
}
/** The Agent, legacy wrapper and Admin diagnostic use this exact authorized retrieval. */
export async function retrieveKnowledge(conversationId:string,actor:ActorContext,query:string,epoch:number,gateway?:EmbeddingGateway) {
  text(query,1000); requireCapability(actor,actor.principal.kind==='user'?'assistant.chat.self':'assistant.preview.self');
  if (!Number.isSafeInteger(epoch) || epoch<0) fail('invalid_message',422);
  const started=Date.now();
  await withTenantTransaction(actor.enterpriseId,tx=>authorize(tx,actor,conversationId,epoch));
  const result=await (gateway ?? embeddingGateway()).embed([query],'query');
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    const {profile,conversation}=await authorize(tx,actor,conversationId,epoch),context=await knowledgeContext(tx,actor,conversation),terms=chineseQueryTerms(query);
    type Candidate={id:string;distance:number;terms:string[];text:string;text_hash:string;document_version_id:string;document_id:string;title:string;content_hash:string;professional:ProfessionalKnowledge|null;lexical:number;locator:{file?:FileLocator}};
    const candidates=await rows<Candidate>(tx,sql`with authorized as materialized (
      select c.id::text,c.text,c.text_hash,c.content_hash,c.document_version_id::text,c.terms,c.locator,d.id::text as document_id,d.title,v.professional,
        c.embedding <=> ${JSON.stringify(result.vectors[0])}::vector as distance,
        (select count(*) from unnest(c.terms) t where t in (select jsonb_array_elements_text(${JSON.stringify(terms)}::jsonb))) as lexical
      from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
      join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
      join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
      join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
      where c.enterprise_id=${actor.enterpriseId} and d.source_type<>'reference_case' and c.index_profile_id=${String(profile.id)} and ${sourceReady} and ${sourceScope(actor,conversation)}
    ), semantic as (select * from authorized order by distance,id limit 30), lexical as (
      select * from authorized where lexical>0 order by lexical desc,id limit 30)
    select * from semantic union select * from lexical`);
    const semantic=[...candidates].sort((a,b)=>a.distance-b.distance||a.id.localeCompare(b.id));
    const lexical=[...candidates].filter(c=>Number(c.lexical)>0).sort((a,b)=>Number(b.lexical)-Number(a.lexical)||a.id.localeCompare(b.id));
    const fused=fuseAuthorizedCandidates(candidates,query,60);
    const conditions=new Map(fused.map(c=>[c.id,c.professional?applicability(c.professional,context):null]));
    // Apply current applicability before the context limit. Missing conditions
    // stay usable; incompatible rules can explain a mismatch only in spare slots.
    const selected=selectContextCandidates(fused.filter(c=>1-c.distance>=retrievalConfiguration.minSimilarity),conditions,retrievalConfiguration.limit);
    const evidence:Evidence[]=selected.map(c=>({ref:{type:'knowledge_chunk',id:c.id,version:c.document_version_id},text:c.text,hash:c.text_hash,similarity:1-c.distance,
      ...(c.locator?.file?{file:c.locator.file}:{}),
      ...(c.professional?{professional:{documentId:c.document_id,title:c.title,contentHash:c.content_hash,entry:c.professional,applicability:applicability(c.professional,context),context}}:{})}));
    const diagnostic:RetrievalDiagnostic={configuration:retrievalConfiguration,profileId:String(profile.id),epoch,query,terms,context,elapsedMs:Date.now()-started,embeddingUsage:result.usage,costMicros:null,
      candidates:fused.map((c,i)=>({ref:{type:'knowledge_chunk',id:c.id,version:c.document_version_id},hash:c.text_hash,title:c.title,documentId:c.document_id,contentHash:c.content_hash,similarity:1-c.distance,
        semanticRank:semantic.indexOf(c)<30?semantic.indexOf(c)+1:null,lexicalRank:lexical.includes(c)&&lexical.indexOf(c)<30?lexical.indexOf(c)+1:null,fusionRank:i+1,
        disposition:1-c.distance<0.3?'below_similarity':evidence.some(e=>e.ref.id===c.id)?'selected':'ranked_out',selectionRank:selected.includes(c)?selected.indexOf(c)+1:null,applicability:conditions.get(c.id)??null}))};
    return {evidence,diagnostic};
  });
}
