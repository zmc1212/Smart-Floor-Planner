import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, rows } from '@/db/repositories/assistant-repository';
import { fail, id, requireCapability, type ActorContext, type EmbeddingGateway, type Evidence, type KnowledgeRetriever } from '../contracts';
import { embeddingGateway } from '../infrastructure/embedding-gateway';
import { activeProfile, text } from './service';
import { chineseQueryTerms, fuseAuthorizedCandidates } from './chinese-lexical';
import { sourceScope, sourceReady, validatePreviewSnapshot } from './sources';

async function authorize(tx: PostgresTransaction, actor: ActorContext, conversationId: string, epoch: number) {
  const repo=new AssistantRepository(tx,actor), settings=await repo.settings(true);
  const conversation=await repo.conversation(id(conversationId));
  if (conversation.status!=='open' || conversation.mode!=='ai' || Number(settings!.knowledge_epoch)!==epoch) fail('context_changed');
  await validatePreviewSnapshot(tx,actor,conversation);
  return {profile:await activeProfile(tx,actor.enterpriseId,settings!),conversation};
}
/** Bound to a server-authorized conversation. No client tenant selector or unfiltered candidate cache. */
export function conversationKnowledgeRetriever(conversationId: string, gateway?: EmbeddingGateway): KnowledgeRetriever {
  return { async retrieve(actor, query, epoch): Promise<Evidence[]> {
    text(query,1000);
    requireCapability(actor,actor.principal.kind==='user'?'assistant.chat.self':'assistant.preview.self');
    if (!Number.isSafeInteger(epoch) || epoch<0) fail('invalid_message',422);
    await withTenantTransaction(actor.enterpriseId,tx=>authorize(tx,actor,conversationId,epoch));
    const result=await (gateway ?? embeddingGateway()).embed([query],'query');
    return withTenantTransaction(actor.enterpriseId,async tx=>{
      // Re-read identity, membership, switch, epoch and profile after remote I/O.
      const {profile,conversation}=await authorize(tx,actor,conversationId,epoch);
      type Candidate={id:string;distance:number;terms:string[];text:string;text_hash:string;document_version_id:string};
      const candidates=await rows<Candidate>(tx,sql`with authorized as materialized (
        select c.id::text,c.text,c.text_hash,c.document_version_id::text,c.terms,c.embedding <=> ${JSON.stringify(result.vectors[0])}::vector as distance,
          (select count(*) from unnest(c.terms) t where t in (select jsonb_array_elements_text(${JSON.stringify(chineseQueryTerms(query))}::jsonb))) as lexical
        from app.assistant_knowledge_chunks c join app.assistant_knowledge_versions v on v.enterprise_id=c.enterprise_id and v.id=c.document_version_id
        join app.assistant_knowledge_documents d on d.enterprise_id=v.enterprise_id and d.id=v.document_id
        join app.assistant_enterprise_settings s on s.enterprise_id=c.enterprise_id
        join app.assistant_knowledge_index_profiles ip on ip.enterprise_id=c.enterprise_id and ip.id=c.index_profile_id
        where c.enterprise_id=${actor.enterpriseId} and d.source_type<>'reference_case' and c.index_profile_id=${String(profile.id)} and ${sourceReady} and ${sourceScope(actor,conversation)}
      ), semantic as (select * from authorized order by distance,id limit 30), lexical as (
        select * from authorized where lexical>0 order by lexical desc,id limit 30)
      select * from semantic union select * from lexical`);
      return fuseAuthorizedCandidates(candidates,query).map(c=>({ref:{type:'knowledge_chunk',id:c.id,version:c.document_version_id},text:c.text,hash:c.text_hash,similarity:1-c.distance}));
    });
  }};
}
