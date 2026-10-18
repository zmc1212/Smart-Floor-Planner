import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, requireCapability, type ActorContext } from '../contracts';
import { knowledgeContext } from './applicability-context';
import { previewPolicy, resolveEvidence, validatePreviewSnapshot } from './sources';
import type { RetrievalDiagnostic } from './retrieval';

/** Own Admin previews only; every reopened trace is reauthorized and revalidated. */
export async function readRetrievalDiagnostics(actor:ActorContext,runId:string) {
  if (actor.principal.kind!=='admin') fail('assistant_capability_forbidden',403);
  requireCapability(actor,'assistant.preview.self');
  return withTenantTransaction(actor.enterpriseId,async tx=>{
    const repo=new AssistantRepository(tx,actor),settings=await repo.settings();
    const run=await one(tx,sql`select * from app.assistant_runs where enterprise_id=${actor.enterpriseId} and id=${id(runId)}`);
    if (!run) fail('assistant_resource_not_found',404);
    const c=await repo.conversation(String(run.conversation_id));
    const unavailable={available:false,reason:'source_changed',runId};
    if (Number(run.knowledge_epoch)!==Number(settings!.knowledge_epoch)) return unavailable;
    try {await validatePreviewSnapshot(tx,actor,c);} catch {return unavailable;}
    const steps=await rows(tx,sql`select step_seq,status,input_summary from app.assistant_run_steps where enterprise_id=${actor.enterpriseId}
      and run_id=${runId} and capability_name='knowledge.search.v1' order by step_seq`);
    const traces=[];
    for (const step of steps) {
      const summary=step.input_summary as Row|null, d=summary?.diagnostic as RetrievalDiagnostic|undefined;
      if (!d) {traces.push({status:summary?.knowledgeStatus==='not_ready'?'not_ready':'trace_unavailable'});continue;}
      if (fingerprint(d.context)!==fingerprint(await knowledgeContext(tx,actor,c))) return unavailable;
      const candidates=[];
      for (const candidate of d.candidates) {
        const source=await resolveEvidence(tx,actor,c,{ref:candidate.ref,hash:candidate.hash,text:''});
        if (!source || source.content_hash!==candidate.contentHash) return unavailable;
        candidates.push({...candidate,text:String(source.text)});
      }
      traces.push({...d,candidates,status:'retrieved'});
    }
    const policy=previewPolicy(c);
    // Counts explain legal exclusion; no out-of-scope candidate text/identifiers are retained.
    const coverage=await one(tx,sql`select count(*)::int as total,
      count(*) filter(where d.status='retired')::int as retired,
      count(*) filter(where d.published_version_id is null)::int as unpublished,
      count(*) filter(where ${policy.audience==='all'?sql`false`:sql`d.audience<>${policy.audience}`})::int as audience_filtered,
      count(*) filter(where v.effective_from>now() or v.effective_to<=now())::int as outside_validity,
      count(*) filter(where v.index_status<>'ready' or v.indexed_hash is distinct from v.content_hash or v.index_profile_id is distinct from s.active_index_profile_id)::int as index_not_ready
      from app.assistant_knowledge_documents d left join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id
      join app.assistant_enterprise_settings s on s.enterprise_id=d.enterprise_id
      where d.enterprise_id=${actor.enterpriseId} and d.source_type<>'reference_case'`);
    return {available:true,runId,scope:{audience:policy.audience,draftVersionIds:policy.drafts.map(d=>d.id)},traces,coverage,
      generation:{status:run.status,errorCode:run.error_code,answerKind:run.answer_kind,semanticCorrectness:'not_automatically_judged'},
      parser:'manual_entry_only',note:'计数可重叠；未召回只指当前授权候选，生成语义需核对回答与来源。'};
  });
}
