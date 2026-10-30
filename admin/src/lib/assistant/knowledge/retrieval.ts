import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, rows } from '@/db/repositories/assistant-repository';
import { fail, id, requireCapability, type ActorContext, type EmbeddingGateway, type Evidence } from '../contracts';
import type { KnowledgeContext, ProfessionalKnowledge } from '../contracts/professional';
import { embeddingGateway } from '../infrastructure/embedding-gateway';
import { activeProfile, text } from './service';
import { expandChineseQuery, queryExpansionConfiguration, queryTermWeights, type QueryExpansionTrace } from './chinese-lexical';
import { sourceScope, sourceReady, validatePreviewSnapshot } from './sources';
import { applicability } from './professional';
import { knowledgeContext } from './applicability-context';
import type { FileLocator } from '../contracts/source-file';
import { selectContextCandidates } from './context-selection';
import { fuseBranchCandidates, hybridFusionConfiguration } from './hybrid-fusion';

export const retrievalConfiguration = {version:'professional-hybrid-v5',perBranch:hybridFusionConfiguration.perBranch,limit:5,rrfK:hybridFusionConfiguration.rrfK,fusion:hybridFusionConfiguration.rankSource,minSimilarity:0.3,reranker:'none',queryExpansion:queryExpansionConfiguration,agentQuery:'current_question_and_model_terms_v1',contextSelection:'server_applicability_document_coverage',maxPerDocumentFirstPass:2,parser:'manual_text_faq_or_local_file_v1'} as const;
export type RetrievalDiagnostic = {
  configuration:typeof retrievalConfiguration; profileId:string; epoch:number; query:string; terms:string[]; expansion:QueryExpansionTrace; context:KnowledgeContext; elapsedMs:number; embeddingUsage:{inputTokens:number}|null;costMicros:null;
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
  text(query,1000); requireCapability(actor,actor.principal.kind==='user'?'assistant.chat.self'
    :actor.capabilities.includes('assistant.project.shared')?'assistant.project.shared':'assistant.preview.self');
  if (!Number.isSafeInteger(epoch) || epoch<0) fail('invalid_message',422);
  const started=Date.now();
  await withTenantTransaction(actor.enterpriseId,tx=>authorize(tx,actor,conversationId,epoch));
  const result=await (gateway ?? embeddingGateway()).embed([query],'query');
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    const {profile,conversation}=await authorize(tx,actor,conversationId,epoch),context=await knowledgeContext(tx,actor,conversation),expanded=expandChineseQuery(query),terms=expanded.terms;
    type Candidate={id:string;distance:number;terms:string[];text:string;text_hash:string;document_version_id:string;document_id:string;title:string;content_hash:string;professional:ProfessionalKnowledge|null;lexical:number;semantic_rank:number|null;lexical_rank:number|null;locator:{file?:FileLocator}};
    const candidates=await rows<Candidate>(tx,sql`with authorized as materialized (
      select c.id::text,c.text,c.text_hash,c.content_hash,c.document_version_id::text,c.terms,c.locator,d.id::text as document_id,d.title,v.professional,
        c.embedding <=> ${JSON.stringify(result.vectors[0])}::vector as distance,
        (select coalesce(sum((${JSON.stringify(queryTermWeights(expanded))}::jsonb->>t)::int),0)
          from unnest(c.terms) t where t in (select jsonb_array_elements_text(${JSON.stringify(terms)}::jsonb))) as lexical
      from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
      join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
      join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
      join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
      where c.enterprise_id=${actor.enterpriseId} and d.source_type<>'reference_case' and c.index_profile_id=${String(profile.id)} and ${sourceReady} and ${sourceScope(actor,conversation)}
    ), semantic as (
      select id,(row_number() over(order by distance,id))::int as semantic_rank from authorized order by distance,id limit ${retrievalConfiguration.perBranch}
    ), lexical as (
      select id,(row_number() over(order by lexical desc,id))::int as lexical_rank from authorized where lexical>0 order by lexical desc,id limit ${retrievalConfiguration.perBranch}
    ), branch_ids as (select id from semantic union select id from lexical)
    select a.*,s.semantic_rank,l.lexical_rank from authorized a join branch_ids b on b.id=a.id
      left join semantic s on s.id=a.id left join lexical l on l.id=a.id`);
    const ranks=new Map(candidates.map(c=>[c.id,{semanticRank:c.semantic_rank,lexicalRank:c.lexical_rank}]));
    const fused=fuseBranchCandidates(candidates,ranks,retrievalConfiguration.perBranch*2);
    const conditions=new Map(fused.map(c=>[c.id,c.professional?applicability(c.professional,context):null]));
    // Apply current applicability before the context limit. Missing conditions
    // stay usable; incompatible rules can explain a mismatch only in spare slots.
    const selected=selectContextCandidates(fused.filter(c=>1-c.distance>=retrievalConfiguration.minSimilarity),conditions,retrievalConfiguration.limit);
    const evidence:Evidence[]=selected.map(c=>({ref:{type:'knowledge_chunk',id:c.id,version:c.document_version_id},text:c.text,hash:c.text_hash,similarity:1-c.distance,
      ...(c.locator?.file?{file:c.locator.file}:{}),
      ...(c.professional?{professional:{documentId:c.document_id,title:c.title,contentHash:c.content_hash,entry:c.professional,applicability:applicability(c.professional,context),context}}:{})}));
    const diagnostic:RetrievalDiagnostic={configuration:retrievalConfiguration,profileId:String(profile.id),epoch,query,terms,expansion:expanded.expansion,context,elapsedMs:Date.now()-started,embeddingUsage:result.usage,costMicros:null,
      candidates:fused.map((c,i)=>({ref:{type:'knowledge_chunk',id:c.id,version:c.document_version_id},hash:c.text_hash,title:c.title,documentId:c.document_id,contentHash:c.content_hash,similarity:1-c.distance,
        semanticRank:c.semantic_rank,lexicalRank:c.lexical_rank,fusionRank:i+1,
        disposition:1-c.distance<0.3?'below_similarity':evidence.some(e=>e.ref.id===c.id)?'selected':'ranked_out',selectionRank:selected.includes(c)?selected.indexOf(c)+1:null,applicability:conditions.get(c.id)??null}))};
    return {evidence,diagnostic};
  });
}
