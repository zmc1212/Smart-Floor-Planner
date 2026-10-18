import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, type ActorContext } from '../contracts';
import { ConversationService, idempotent } from '../core/conversation';
import { knowledgeManager, text, expected, type KnowledgeActor } from './service';
import { readRetrievalDiagnostics } from './diagnostics';
import { projectMessage, resolveEvidence, validatePreviewSnapshot } from './sources';
import type { RetrievalDiagnostic } from './retrieval';
import { checkKnowledgeEvaluation, type ExpectedSource, type KnowledgeExpectation } from './evaluation-check';
import { evaluationBatchCases, type EvaluationBatchPreparation } from './evaluation-batch';

const json=(value:unknown)=>JSON.stringify(value);
type EvaluationSnapshot={question:string;title:string;expectation:KnowledgeExpectation;required:ExpectedSource[]};
type EvaluationReview={outcome:string;note:string;adminId:string;reviewedAt:string;semanticCorrectness:string};
type KnowledgeCase=Row&{id:string;title:string;question:string;expectation:KnowledgeExpectation;version:number;revision:number;gap_status:string;gap_note:string};
function expectation(value:unknown):KnowledgeExpectation {
  if(!value || typeof value!=='object' || Array.isArray(value))fail('invalid_message',422);
  const v=value as Row;
  if(Object.keys(v).some(k=>!['kind','requiredDocumentIds','forbiddenDocumentIds'].includes(k)) || !['grounded','missing'].includes(String(v.kind)))fail('invalid_message',422);
  const ids=(x:unknown)=>{if(!Array.isArray(x)||x.length>5)fail('invalid_message',422);const a=x.map(id);if(new Set(a).size!==a.length)fail('invalid_message',422);return a;};
  const requiredDocumentIds=ids(v.requiredDocumentIds),forbiddenDocumentIds=ids(v.forbiddenDocumentIds);
  if(requiredDocumentIds.some(d=>forbiddenDocumentIds.includes(d)) || (v.kind==='grounded'?!requiredDocumentIds.length:requiredDocumentIds.length>0))fail('invalid_message',422);
  return {kind:v.kind as KnowledgeExpectation['kind'],requiredDocumentIds,forbiddenDocumentIds};
}
function page(input:Row) {const limit=input.limit===undefined?20:expected(input.limit);if(limit>50)fail('invalid_message',422);return{limit,before:input.beforeId===undefined?'9223372036854775807':id(input.beforeId)};}
function caseDto(c:Row,epoch:unknown):KnowledgeCase {
  return {...c,id:String(c.id),gap_status:c.gap_status==='verified'&&Number(c.verified_epoch)!==Number(epoch)?'needs_recheck':c.gap_status} as KnowledgeCase;
}
export class KnowledgeOperations {
  readonly actor:ActorContext;
  constructor(readonly manager:KnowledgeActor) {this.actor={enterpriseId:manager.enterpriseId,principal:{kind:'admin',adminId:manager.adminId},contextVersion:1,capabilities:['assistant.preview.self']};}
  private tx<T>(work:(tx:PostgresTransaction,settings:Row)=>Promise<T>,enabled=false) {
    return withTenantTransaction(this.manager.enterpriseId,async tx=>work(tx,await knowledgeManager(tx,this.manager,enabled)));
  }
  private async case(tx:PostgresTransaction,caseId:unknown) {
    const c=await one(tx,sql`select * from app.assistant_knowledge_cases where enterprise_id=${this.manager.enterpriseId} and id=${id(caseId)} for update`);
    if(!c)fail('assistant_resource_not_found',404);return c;
  }
  private async evaluation(tx:PostgresTransaction,evaluationId:unknown) {
    const e=await one(tx,sql`select * from app.assistant_knowledge_evaluations where enterprise_id=${this.manager.enterpriseId}
      and id=${id(evaluationId)} and created_by=${this.manager.adminId} for update`);
    if(!e)fail('assistant_resource_not_found',404);return e;
  }
  private async sources(tx:PostgresTransaction,e:KnowledgeExpectation) {
    const required:ExpectedSource[]=[];
    for(const documentId of [...e.requiredDocumentIds,...e.forbiddenDocumentIds]) {
      const d=await one(tx,sql`select d.id,d.audience,d.status,v.id version_id,v.content_hash,
        (v.effective_from<=now() and (v.effective_to is null or v.effective_to>now()) and v.index_status='ready'
         and v.indexed_hash=v.content_hash and v.index_profile_id=s.active_index_profile_id) ready
        from app.assistant_knowledge_documents d left join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id
        join app.assistant_enterprise_settings s on s.enterprise_id=d.enterprise_id where d.enterprise_id=${this.manager.enterpriseId} and d.id=${documentId}`);
      if(!d)fail('assistant_resource_not_found',404);
      if(e.requiredDocumentIds.includes(documentId)) {
        if(d.status!=='active'||d.audience!=='customer_public'||!d.ready)fail('knowledge_not_ready');
        required.push({documentId,versionId:String(d.version_id),hash:String(d.content_hash)});
      }
    }
    return required;
  }
  private async current(tx:PostgresTransaction,e:Row,settings:Row) {
    const c=await this.case(tx,String(e.case_id));
    if(Number(e.knowledge_epoch)!==Number(settings.knowledge_epoch)||Number(e.case_revision)!==Number(c.revision))return false;
    // Epoch is the broad fence. Exact required-version/hash checks also reject corrupt or mismatched pointers.
    for(const source of (e.snapshot as {required:ExpectedSource[]}).required) {
      const v=await one(tx,sql`select v.id from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v
        on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id where d.enterprise_id=${this.manager.enterpriseId}
        and d.id=${source.documentId} and d.status='active' and d.audience='customer_public' and v.id=${source.versionId}
        and v.content_hash=${source.hash} and v.indexed_hash=v.content_hash and v.index_status='ready'
        and v.index_profile_id=${settings.active_index_profile_id} and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`);
      if(!v)return false;
    }
    return true;
  }
  async list(input:Row={}) {const p=page(input);return this.tx(async(tx,s)=>{
    const items=await rows(tx,sql`select * from app.assistant_knowledge_cases where enterprise_id=${this.manager.enterpriseId} and id<${p.before} order by id desc limit ${p.limit+1}`);
    return {items:items.slice(0,p.limit).map(c=>caseDto(c,s.knowledge_epoch)),nextCursor:items.length>p.limit?String(items[p.limit-1].id):null};
  });}
  async detail(caseId:string) {return this.tx(async(tx,s)=>caseDto(await this.case(tx,caseId),s.knowledge_epoch));}
  async save(input:Row,requestKey:string,caseId?:string) {return this.tx(async(tx,s)=>idempotent(tx,this.actor,'knowledge-case:'+ (caseId||'create'),requestKey,input,async()=>{
    const title=text(input.title,120),question=text(input.question,2000),e=expectation(input.expectation),note=text(input.gapNote??'',2000,true);
    // Validate IDs here; required unpublished documents can be curated as a gap but cannot yet be evaluated.
    for(const did of [...e.requiredDocumentIds,...e.forbiddenDocumentIds])if(!await one(tx,sql`select id from app.assistant_knowledge_documents where enterprise_id=${this.manager.enterpriseId} and id=${did}`))fail('assistant_resource_not_found',404);
    let c:Row|undefined;
    if(caseId){const old=await this.case(tx,caseId);if(Number(old.version)!==expected(input.expectedVersion))fail('version_conflict');
      c=await one(tx,sql`update app.assistant_knowledge_cases set title=${title},question=${question},expectation=${json(e)}::jsonb,gap_note=${note},
        gap_status='open',verified_epoch=null,revision=revision+1,version=version+1,updated_by=${this.manager.adminId},updated_at=now() where enterprise_id=${this.manager.enterpriseId} and id=${caseId} returning *`);
    }else{
      const n=await one(tx,sql`select count(*)::int n from app.assistant_knowledge_cases where enterprise_id=${this.manager.enterpriseId}`);if(Number(n!.n)>=100)fail('knowledge_case_limit',422);
      c=await one(tx,sql`insert into app.assistant_knowledge_cases(enterprise_id,title,question,expectation,gap_note,created_by,updated_by)
        values(${this.manager.enterpriseId},${title},${question},${json(e)}::jsonb,${note},${this.manager.adminId},${this.manager.adminId}) returning *`);
    }return caseDto(c!,s.knowledge_epoch);
  }));}
  private async reserveEvaluation(tx:PostgresTransaction,s:Row,c:Row) {
    const e=c.expectation as KnowledgeExpectation,required=await this.sources(tx,e);
    const snapshot={question:c.question,title:c.title,expectation:e,required};
    const row=await one(tx,sql`insert into app.assistant_knowledge_evaluations(enterprise_id,case_id,case_revision,snapshot,knowledge_epoch,created_by,create_key,send_key)
      values(${this.manager.enterpriseId},${String(c.id)},${Number(c.revision)},${json(snapshot)}::jsonb,
      ${Number(s.knowledge_epoch)},${this.manager.adminId},${randomUUID()},${randomUUID()}) returning id`);
    return {caseId:String(c.id),caseVersion:Number(c.version),caseRevision:Number(c.revision),evaluationId:String(row!.id),snapshotHash:fingerprint(snapshot)};
  }
  /** Internal preparation seam only: persists original item keys, dispatches no chat/model jobs. */
  async prepareBatch(input:Row,requestKey:string):Promise<EvaluationBatchPreparation> {
    if(Object.keys(input).some(k=>k!=='cases'))fail('invalid_message',422);
    const cases=evaluationBatchCases(input.cases);
    return this.tx(async(tx,s)=>idempotent(tx,this.actor,'knowledge-batch-prepare',requestKey,input,async()=>{
      const n=await one(tx,sql`select count(*)::int n from app.assistant_knowledge_evaluations where enterprise_id=${this.manager.enterpriseId}`);
      if(Number(n!.n)+cases.length>2000)fail('knowledge_evaluation_limit',422);
      const profile=s.active_index_profile_id?await one(tx,sql`select id,configuration from app.assistant_knowledge_index_profiles
        where enterprise_id=${this.manager.enterpriseId} and id=${String(s.active_index_profile_id)}`):null;
      if(!profile)fail('knowledge_not_ready');
      const items=[];
      for(const item of cases) {
        const c=await this.case(tx,item.caseId);if(Number(c.version)!==item.expectedVersion)fail('version_conflict');
        items.push(await this.reserveEvaluation(tx,s,c));
      }
      return {batchId:requestKey,enterpriseId:this.manager.enterpriseId,adminId:this.manager.adminId,
        knowledgeEpoch:Number(s.knowledge_epoch),profileId:String(profile.id),profileHash:fingerprint(profile.configuration),policyVersion:Number(s.policy_version),items};
    }),true) as Promise<EvaluationBatchPreparation>;
  }
  async start(caseId:string,input:Row,requestKey:string) {
    const created=await this.tx(async(tx,s)=>idempotent(tx,this.actor,'knowledge-evaluate:'+caseId,requestKey,input,async()=>{
      const c=await this.case(tx,caseId);if(Number(c.version)!==expected(input.expectedVersion))fail('version_conflict');
      const n=await one(tx,sql`select count(*)::int n from app.assistant_knowledge_evaluations where enterprise_id=${this.manager.enterpriseId}`);if(Number(n!.n)>=2000)fail('knowledge_evaluation_limit',422);
      const prepared=await this.reserveEvaluation(tx,s,c);return {evaluationId:prepared.evaluationId};
    }),true);
    // A crash at either boundary resumes with the same create/send keys, never a parallel model/usage pipeline.
    await this.resume(String(created.evaluationId));return {evaluationId:String(created.evaluationId)};
  }
  async resume(evaluationId:string) {
    const e=await this.tx(async(tx,s)=>{const row=await this.evaluation(tx,evaluationId);if(!await this.current(tx,row,s))fail('context_changed');return row;},true);
    if(e.run_id)return {evaluationId,runId:String(e.run_id)};
    const chat=new ConversationService(this.actor),snapshot=e.snapshot as Row;
    const c=await chat.create(String(e.create_key),{audience:'customer_public',draftVersionIds:[]});
    await this.tx(async(tx,s)=>{const row=await this.evaluation(tx,evaluationId);if(!await this.current(tx,row,s))fail('context_changed');
      await tx.execute(sql`update app.assistant_knowledge_evaluations set conversation_id=${String(c.id)} where enterprise_id=${this.manager.enterpriseId} and id=${evaluationId}`);});
    const sent=await chat.send(String(c.id),String(e.send_key),{version:1,blocks:[{type:'text',text:String(snapshot.question)}]});
    await this.tx(async tx=>{await this.evaluation(tx,evaluationId);await tx.execute(sql`update app.assistant_knowledge_evaluations set run_id=${String(sent.runId)} where enterprise_id=${this.manager.enterpriseId} and id=${evaluationId}`);});
    return {evaluationId,runId:String(sent.runId)};
  }
  async history(caseId:string,input:Row={}) {const p=page(input);return this.tx(async tx=>{
    await this.case(tx,caseId);const items=await rows(tx,sql`select e.id::text,e.case_revision,e.created_at,e.run_id::text from app.assistant_knowledge_evaluations e
      where e.enterprise_id=${this.manager.enterpriseId} and e.case_id=${caseId} and e.created_by=${this.manager.adminId} and e.id<${p.before} order by e.id desc limit ${p.limit+1}`);
    return {items:items.slice(0,p.limit),nextCursor:items.length>p.limit?String(items[p.limit-1].id):null};
  });}
  async read(evaluationId:string) {
    const e=await this.tx(async(tx,s)=>{const e=await this.evaluation(tx,evaluationId);return await this.current(tx,e,s)?e:null;});
    if(!e)return {id:evaluationId,available:false,reason:'source_changed'};
    if(!e.run_id)return {id:evaluationId,available:true,status:'dispatch_pending',snapshot:e.snapshot as EvaluationSnapshot};
    const chat=new ConversationService(this.actor),run=await chat.run(String(e.run_id));
    const diagnostic=await readRetrievalDiagnostics(this.actor,String(e.run_id));
    const detail=await chat.detail(String(e.conversation_id));
    const answer=await this.tx(async tx=>{
      const c=await new AssistantRepository(tx,this.actor).conversation(String(e.conversation_id));
      const m=await one(tx,sql`select * from app.assistant_messages where enterprise_id=${this.manager.enterpriseId}
        and conversation_id=${String(e.conversation_id)} and id=${run.outputMessageId??null}`);
      return m?projectMessage(tx,this.actor,c,m):undefined;
    });
    const traces='traces' in diagnostic?diagnostic.traces:[];
    const candidates=traces.flatMap(t=>'candidates' in t?t.candidates??[]:[]);
    const snapshot=e.snapshot as EvaluationSnapshot;
    const selected=candidates.filter(c=>c.disposition==='selected').map(c=>String(c.ref.version));
    const recalled=candidates.map(c=>String(c.ref.version));
    const citations=await this.tx(tx=>rows(tx,sql`select document_id::text,document_version_id::text from app.assistant_message_citations where enterprise_id=${this.manager.enterpriseId} and run_id=${String(e.run_id)}`));
    const forbidden=snapshot.expectation.forbiddenDocumentIds.filter(d=>candidates.some(c=>c.documentId===d)||citations.some(c=>c.document_id===d));
    const structural=checkKnowledgeEvaluation({expectation:snapshot.expectation,required:snapshot.required,selected,recalled,
      cited:citations.map(c=>String(c.document_version_id)),status:String(run.status),answerKind:run.answerKind as string|null,
      diagnosticAvailable:diagnostic.available===true&&traces.length>0&&traces.every(t=>t.status==='retrieved')});
    structural.passed=structural.passed&&!forbidden.length&&Boolean(answer?.available || snapshot.expectation.kind==='missing'&&run.status==='succeeded');
    const usage=await this.tx(tx=>rows(tx,sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text from app.assistant_usage_records where enterprise_id=${this.manager.enterpriseId} and run_id=${String(e.run_id)} order by id`));
    // Recheck after every asynchronous read before returning any stored answer/trace/review.
    const current=await this.tx(async(tx,s)=>await this.current(tx,e,s)&&await this.validCandidates(tx,e,candidates));
    if(!current || !diagnostic.available || (answer&&!answer.available))return {id:evaluationId,available:false,reason:'source_changed'};
    return {id:evaluationId,available:true,status:run.status,run,conversationId:String(e.conversation_id),snapshot,
      caseRevision:e.case_revision,answer:answer??null,structural:{...structural,forbidden},diagnostic,usage,review:e.review as EvaluationReview|null,
      knowledgeEpoch:e.knowledge_epoch,previewScope:detail.previewScope,costMicros:null};
  }
  private async validCandidates(tx:PostgresTransaction,e:Row,candidates:RetrievalDiagnostic['candidates']) {
    const c=await one(tx,sql`select * from app.assistant_conversations where enterprise_id=${this.manager.enterpriseId} and id=${String(e.conversation_id)}`);
    if(!c)return false;
    try{await validatePreviewSnapshot(tx,this.actor,c);}catch{return false;}
    for(const candidate of candidates){const source=await resolveEvidence(tx,this.actor,c,{ref:candidate.ref,hash:candidate.hash,text:''});if(!source||source.content_hash!==candidate.contentHash)return false;}
    return true;
  }
  async review(evaluationId:string,input:Row,requestKey:string) {
    const evidence=await this.read(evaluationId);
    if(!evidence.available || !evidence.structural)fail('context_changed');
    if(!['accepted','rejected'].includes(String(input.outcome)))fail('invalid_message',422);
    const note=text(input.note,2000);if(note.length<5)fail('invalid_message',422);
    if(input.outcome==='accepted'&&!evidence.structural.passed)fail('knowledge_evaluation_not_passed');
    return this.tx(async(tx,s)=>idempotent(tx,this.actor,'knowledge-review:'+evaluationId,requestKey,input,async()=>{
      const e=await this.evaluation(tx,evaluationId),c=await this.case(tx,String(e.case_id));
      const candidates=('traces' in evidence.diagnostic?evidence.diagnostic.traces:[]).flatMap(t=>'candidates' in t?t.candidates??[]:[]);
      if(!await this.current(tx,e,s)||!await this.validCandidates(tx,e,candidates)||Number(c.version)!==expected(input.expectedVersion))fail('version_conflict');
      const review={outcome:input.outcome,note,adminId:this.manager.adminId,reviewedAt:new Date().toISOString(),semanticCorrectness:'manager_reviewed'};
      await tx.execute(sql`update app.assistant_knowledge_evaluations set review=${json(review)}::jsonb where enterprise_id=${this.manager.enterpriseId} and id=${evaluationId}`);
      const updated=await one(tx,sql`update app.assistant_knowledge_cases set gap_status=${input.outcome==='accepted'?'verified':'open'},gap_note=${note},
        verified_epoch=${input.outcome==='accepted'?Number(s.knowledge_epoch):null},version=version+1,updated_by=${this.manager.adminId},updated_at=now()
        where enterprise_id=${this.manager.enterpriseId} and id=${String(c.id)} returning *`);
      return caseDto(updated!,s.knowledge_epoch);
    }));
  }
  async health() {return this.tx(async(tx,s)=>{
    const eid=this.manager.enterpriseId;
    const sources=await rows(tx,sql`select d.id::text,d.title,d.audience,d.status,d.published_version_id::text from app.assistant_knowledge_documents d where d.enterprise_id=${eid} order by d.id desc limit 200`);
    const indexes=await one(tx,sql`select count(*)::int documents,count(*) filter(where d.status='active' and v.id is not null and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())
      and v.index_status='ready' and v.indexed_hash=v.content_hash and v.index_profile_id=s.active_index_profile_id)::int effective_ready,
      count(*) filter(where d.source_type='file')::int files,count(*) filter(where v.id is not null and (v.index_status<>'ready' or v.indexed_hash is distinct from v.content_hash or v.index_profile_id is distinct from s.active_index_profile_id))::int index_mismatch
      from app.assistant_knowledge_documents d left join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id
      join app.assistant_enterprise_settings s on s.enterprise_id=d.enterprise_id where d.enterprise_id=${eid}`);
    const jobs=await rows(tx,sql`select kind,status,count(*)::int count,min(created_at) oldest_at,count(*) filter(where lease_expires_at<now() and status='running')::int expired_leases
      from app.assistant_jobs where enterprise_id=${eid} and kind in ('knowledge_index','knowledge_parse') group by kind,status order by kind,status`);
    const attempts=await rows(tx,sql`select operation,status,count(*)::int calls,sum(input_tokens)::text known_input_tokens,count(*) filter(where input_tokens is null)::int unknown_input_calls
      from app.assistant_knowledge_attempts where enterprise_id=${eid} and started_at>=now()-interval '30 days' group by operation,status order by operation,status`);
    const profile=await one(tx,sql`select id::text,profile_key,status,configuration->>'dimensions' dimensions,configuration->>'revision' model_revision
      from app.assistant_knowledge_index_profiles where enterprise_id=${eid} and id=${s.active_index_profile_id??null}`);
    return {sources,indexes,jobs,attempts,profile:profile??null,knowledgeEpoch:s.knowledge_epoch,costMicros:null,windowDays:30,parser:{supported:['docx','text_pdf'],ocr:false,complexPdfTables:false},
      limits:{cases:100,evaluations:2000,sourcesShown:200},note:'健康计数不是外部服务实时探测；索引调用单列，未知用量与费用不记零。'};
  });}
}
