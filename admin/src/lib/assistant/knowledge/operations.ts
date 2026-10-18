import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, fingerprint, id, key, principalKey, type ActorContext } from '../contracts';
import { ConversationService, idempotent } from '../core/conversation';
import { knowledgeManager, text, expected, type KnowledgeActor } from './service';
import { readRetrievalDiagnostics } from './diagnostics';
import { projectMessage, resolveEvidence, validatePreviewSnapshot } from './sources';
import { retrievalConfiguration, type RetrievalDiagnostic } from './retrieval';
import { checkKnowledgeEvaluation, type ExpectedSource, type KnowledgeExpectation } from './evaluation-check';
import { evaluationBatchCases, evaluationBatchManifest, MAX_EVALUATION_BATCH_CONCURRENCY, type EvaluationBatchPreparation } from './evaluation-batch';
import { KnowledgeBatchExecutionAdapter, executionPrepareOperation, executionCancelOperation,
  type KnowledgeBatchSharedPort, type BatchExecutionReceipt, type BatchExecutionContext, type BatchExecutionState,
  type BatchCancellationIntent, type BatchRunReceipt } from './batch-execution-adapter';
import { knowledgeBatchCounts, knowledgeBatchStates, type KnowledgeBatchList, type KnowledgeBatchProgress,
  type KnowledgeBatchProgressItem, type KnowledgeBatchState } from './operation-batch-view';

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
  constructor(readonly manager:KnowledgeActor,private readonly sharedExecution?:KnowledgeBatchSharedPort<PostgresTransaction>) {this.actor={enterpriseId:manager.enterpriseId,principal:{kind:'admin',adminId:manager.adminId},contextVersion:1,capabilities:['assistant.preview.self']};}
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
  private async publishedSources(tx:PostgresTransaction,documentIds:string[],settings:Row) {
    const ids=[...new Set(documentIds.map(id))];if(!ids.length)return new Map<string,ExpectedSource>();
    const current=await rows(tx,sql`select d.id::text document_id,v.id::text version_id,v.content_hash
      from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v
      on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id where d.enterprise_id=${this.manager.enterpriseId}
      and d.id in (${sql.join(ids.map(value=>sql`${value}`),sql`,`)}) and d.status='active' and d.audience='customer_public'
      and v.indexed_hash=v.content_hash and v.index_status='ready' and v.index_profile_id=${settings.active_index_profile_id}
      and v.effective_from<=now() and (v.effective_to is null or v.effective_to>now())`);
    return new Map(current.map(source=>[String(source.document_id),{documentId:String(source.document_id),versionId:String(source.version_id),hash:String(source.content_hash)}]));
  }
  private requiredCurrent(required:ExpectedSource[],current:Map<string,ExpectedSource>) {
    return required.every(source=>{const live=current.get(source.documentId);return live?.versionId===source.versionId&&live.hash===source.hash;});
  }
  private async current(tx:PostgresTransaction,e:Row,settings:Row) {
    const c=await this.case(tx,String(e.case_id));
    if(Number(e.knowledge_epoch)!==Number(settings.knowledge_epoch)||Number(e.case_revision)!==Number(c.revision))return false;
    // Same exact publication/hash/profile/effective-time fence, loaded once for all required documents.
    const required=(e.snapshot as EvaluationSnapshot).required;
    return this.requiredCurrent(required,await this.publishedSources(tx,required.map(source=>source.documentId),settings));
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
  /** Persists original item keys without dispatching chat/model jobs. */
  async prepareBatch(input:Row,requestKey:string):Promise<EvaluationBatchPreparation> {
    if(Object.keys(input).some(k=>k!=='cases'))fail('invalid_message',422);
    evaluationBatchCases(input.cases);
    return this.tx((tx,s)=>this.prepareBatchTx(tx,s,input,requestKey),true);
  }
  private async prepareBatchTx(tx:PostgresTransaction,s:Row,input:Row,requestKey:string) {
    const cases=evaluationBatchCases(input.cases);
    return idempotent(tx,this.actor,'knowledge-batch-prepare',requestKey,input,async()=>{
      const n=await one(tx,sql`select count(*)::int n from app.assistant_knowledge_evaluations where enterprise_id=${this.manager.enterpriseId}`);
      if(Number(n!.n)+cases.length>2000)fail('knowledge_evaluation_limit',422);
      const profile=s.active_index_profile_id?await one(tx,sql`select id,configuration from app.assistant_knowledge_index_profiles
        where enterprise_id=${this.manager.enterpriseId} and id=${String(s.active_index_profile_id)} and status='active'`):null;
      if(!profile)fail('knowledge_not_ready');
      const items=[];
      for(const item of cases) {
        const c=await this.case(tx,item.caseId);if(Number(c.version)!==item.expectedVersion)fail('version_conflict');
        items.push(await this.reserveEvaluation(tx,s,c));
      }
      return {batchId:requestKey,enterpriseId:this.manager.enterpriseId,adminId:this.manager.adminId,
        knowledgeEpoch:Number(s.knowledge_epoch),profileId:String(profile.id),profileHash:fingerprint(profile.configuration),policyVersion:Number(s.policy_version),items};
    }) as Promise<EvaluationBatchPreparation>;
  }
  /** Server-only opt-in. No route/UI or default shared implementation is enabled here. */
  async prepareExecutionBatch(input:Row,requestKey:string):Promise<BatchExecutionReceipt> {
    if(!this.sharedExecution)fail('batch_execution_unavailable',503);
    if(Object.keys(input).some(k=>!['cases','concurrency'].includes(k)))fail('invalid_message',422);
    const cases=evaluationBatchCases(input.cases),concurrency=input.concurrency??2;
    if(!Number.isInteger(concurrency)||Number(concurrency)<1||Number(concurrency)>MAX_EVALUATION_BATCH_CONCURRENCY)fail('invalid_message',422);
    return this.tx(async(tx,s)=>idempotent(tx,this.actor,executionPrepareOperation,requestKey,{cases,concurrency},async()=>{
      // Never retrofit an execution pin onto an old manual batch with a possible in-flight legacy send.
      if(await one(tx,sql`select id from app.assistant_idempotency_records where enterprise_id=${this.manager.enterpriseId}
        and principal_key=${principalKey(this.actor)} and operation='knowledge-batch-prepare' and key=${requestKey}`))fail('batch_already_prepared');
      const preparation=await this.prepareBatchTx(tx,s,{cases},requestKey);
      const context:BatchExecutionContext={mode:'knowledge_preview',profile:{id:preparation.profileId,hash:preparation.profileHash},retrievalConfiguration};
      const execution=await this.sharedExecution!.executionRevision(tx,this.actor,context);
      if(execution.mode!=='knowledge_preview')fail('execution_changed');
      return {version:1 as const,manifest:evaluationBatchManifest(preparation,execution.revision),concurrency:Number(concurrency)};
    }),true) as Promise<BatchExecutionReceipt>;
  }
  private async executionState(tx:PostgresTransaction,s:Row,batchId:string):Promise<BatchExecutionState> {
    const row=await one(tx,sql`select result from app.assistant_idempotency_records where enterprise_id=${this.manager.enterpriseId}
      and principal_key=${principalKey(this.actor)} and operation=${executionPrepareOperation} and key=${key(batchId)}`);
    if(!row)fail('assistant_resource_not_found',404);
    const receipt=row.result as BatchExecutionReceipt,{preparation}=await this.batchReceipt(tx,batchId);
    if(!receipt||receipt.version!==1||!receipt.manifest||!Number.isInteger(receipt.concurrency)
      ||receipt.concurrency<1||receipt.concurrency>MAX_EVALUATION_BATCH_CONCURRENCY
      ||evaluationBatchManifest(preparation,receipt.manifest.executionRevision).hash!==receipt.manifest.hash)fail('invalid_batch_manifest');
    const manifest=evaluationBatchManifest(preparation,receipt.manifest.executionRevision);
    const evaluations=await rows(tx,sql`select e.*,c.revision current_revision from app.assistant_knowledge_evaluations e
      left join app.assistant_knowledge_cases c on c.enterprise_id=e.enterprise_id and c.id=e.case_id
      where e.enterprise_id=${this.manager.enterpriseId} and e.created_by=${this.manager.adminId}
      and e.id in (${sql.join(preparation.items.map(item=>sql`${item.evaluationId}`),sql`,`)}) for update of e`);
    const byId=new Map(evaluations.map(e=>[String(e.id),e]));
    const items=preparation.items.map(item=>{
      const e=byId.get(item.evaluationId);
      if(!e||String(e.case_id)!==item.caseId||Number(e.case_revision)!==item.caseRevision
        ||Number(e.knowledge_epoch)!==preparation.knowledgeEpoch||fingerprint(e.snapshot)!==item.snapshotHash)fail('invalid_batch_manifest');
      return {...item,createKey:key(e.create_key),sendKey:key(e.send_key),question:String((e.snapshot as EvaluationSnapshot).question),
        conversationId:e.conversation_id?String(e.conversation_id):null,runId:e.run_id?String(e.run_id):null};
    });
    const profile=s.active_index_profile_id?await one(tx,sql`select configuration from app.assistant_knowledge_index_profiles
      where enterprise_id=${this.manager.enterpriseId} and id=${String(s.active_index_profile_id)} and status='active'`):null;
    const required=evaluations.flatMap(e=>(e.snapshot as EvaluationSnapshot).required);
    const published=await this.publishedSources(tx,required.map(source=>source.documentId),s);
    const current=preparation.knowledgeEpoch===Number(s.knowledge_epoch)&&preparation.policyVersion===Number(s.policy_version)
      &&preparation.profileId===String(s.active_index_profile_id)&&Boolean(profile)&&preparation.profileHash===fingerprint(profile?.configuration)
      &&evaluations.every(e=>Number(e.case_revision)===Number(e.current_revision))&&this.requiredCurrent(required,published);
    const cancelled=await one(tx,sql`select result from app.assistant_idempotency_records where enterprise_id=${this.manager.enterpriseId}
      and principal_key=${principalKey(this.actor)} and operation=${executionCancelOperation} and key=${batchId}`);
    const cancellation=cancelled?.result as BatchCancellationIntent|null;
    if(cancellation&&(cancellation.batchId!==batchId||cancellation.manifestHash!==receipt.manifest.hash||cancellation.cancelled!==true))fail('invalid_batch_manifest');
    return {receipt:{version:1,manifest,concurrency:receipt.concurrency},items,current,enabled:Boolean(s.enabled),cancellation:cancellation??null,
      context:{mode:'knowledge_preview',profile:{id:preparation.profileId,hash:preparation.profileHash},retrievalConfiguration}};
  }
  private executionAdapter() {
    if(!this.sharedExecution)fail('batch_execution_unavailable',503);
    const settings=new Map<PostgresTransaction,Row>();
    return new KnowledgeBatchExecutionAdapter<PostgresTransaction>({actor:this.actor,
      transaction:work=>this.tx(async(tx,s)=>{settings.set(tx,s);try{return await work(tx);}finally{settings.delete(tx);}}),
      load:(tx,batchId)=>this.executionState(tx,settings.get(tx)!,batchId),
      link:(tx,binding,receipt)=>this.linkEvaluation(tx,binding,receipt),
      persistCancellation:(tx,state,requestKey)=>idempotent(tx,this.actor,executionCancelOperation,state.receipt.manifest.batchId,
        {batchId:state.receipt.manifest.batchId,manifestHash:state.receipt.manifest.hash},async()=>({batchId:state.receipt.manifest.batchId,
          manifestHash:state.receipt.manifest.hash,requestKey,cancelled:true})) as Promise<BatchCancellationIntent>,
    },this.sharedExecution);
  }
  private async pinnedEvaluationBatch(tx:PostgresTransaction,evaluationId:string) {
    const row=await one(tx,sql`select key from app.assistant_idempotency_records where enterprise_id=${this.manager.enterpriseId}
      and principal_key=${principalKey(this.actor)} and operation=${executionPrepareOperation}
      and result->'manifest'->'items' @> ${json([{evaluationId}])}::jsonb limit 1`);
    return row?String(row.key):null;
  }
  executionBatchAdapter() {return this.executionAdapter();}
  advanceExecutionBatch(batchId:string) {return this.executionAdapter().advance(batchId);}
  cancelExecutionBatch(batchId:string,requestKey:string) {return this.executionAdapter().cancelBatch(batchId,requestKey);}
  private async linkEvaluation(tx:PostgresTransaction,binding:{evaluationId:string;createKey:string;sendKey:string},receipt:BatchRunReceipt) {
    const linked=await one(tx,sql`update app.assistant_knowledge_evaluations set conversation_id=${receipt.conversationId},run_id=${receipt.runId}
      where enterprise_id=${this.manager.enterpriseId} and created_by=${this.manager.adminId} and id=${binding.evaluationId}
      and create_key=${binding.createKey} and send_key=${binding.sendKey}
      and (conversation_id is null or conversation_id=${receipt.conversationId}) and (run_id is null or run_id=${receipt.runId}) returning id`);
    if(!linked)fail('invalid_batch_receipt');
  }
  /** Original receipt lookup only; works for legacy evaluations without inventing an execution pin. */
  async recoverEvaluation(evaluationId:string) {
    if(!this.sharedExecution)fail('batch_execution_unavailable',503);
    return this.tx(async tx=>{
      const e=await this.evaluation(tx,evaluationId),content={version:1 as const,blocks:[{type:'text' as const,text:String((e.snapshot as EvaluationSnapshot).question)}]};
      if(e.run_id&&!e.conversation_id)fail('invalid_batch_receipt');
      const receipt=e.run_id&&e.conversation_id?{runId:String(e.run_id),conversationId:String(e.conversation_id)}
        :await this.sharedExecution!.lookupReceipt(tx,this.actor,{createKey:key(e.create_key),sendKey:key(e.send_key),
          conversationId:e.conversation_id?String(e.conversation_id):null,content});
      if(receipt===null)return {evaluationId,runId:null,conversationId:e.conversation_id?String(e.conversation_id):null,recovered:false};
      if(!receipt)fail('invalid_batch_receipt');
      id(receipt.runId);id(receipt.conversationId);
      if(e.run_id&&String(e.run_id)!==receipt.runId||e.conversation_id&&String(e.conversation_id)!==receipt.conversationId)fail('invalid_batch_receipt');
      await this.sharedExecution!.observeRun(tx,this.actor,receipt);
      if(!e.run_id)await this.linkEvaluation(tx,{evaluationId,createKey:key(e.create_key),sendKey:key(e.send_key)},receipt);
      return {evaluationId,...receipt,recovered:!e.run_id};
    });
  }
  async batchHistory(input:Row={}):Promise<KnowledgeBatchList> {
    const pagination=page(input);
    return this.tx(async tx=>{
      const items=await rows(tx,sql`select r.id::text,r.key,r.created_at,jsonb_array_length(r.result->'items') item_count,
        r.result->>'knowledgeEpoch' knowledge_epoch from app.assistant_idempotency_records r
        where r.enterprise_id=${this.manager.enterpriseId} and r.principal_key=${principalKey(this.actor)}
        and r.operation='knowledge-batch-prepare' and r.id<${pagination.before} order by r.id desc limit ${pagination.limit+1}`);
      return {scope:{...this.manager},items:items.slice(0,pagination.limit).map(row=>({batchId:String(row.key),
        createdAt:new Date(row.created_at as string).toISOString(),count:Number(row.item_count),knowledgeEpoch:Number(row.knowledge_epoch)})),
        nextCursor:items.length>pagination.limit?String(items[pagination.limit-1].id):null};
    });
  }
  private async batchReceipt(tx:PostgresTransaction,batchId:string) {
    const receipt=await one(tx,sql`select key,result,created_at from app.assistant_idempotency_records
      where enterprise_id=${this.manager.enterpriseId} and principal_key=${principalKey(this.actor)}
      and operation='knowledge-batch-prepare' and key=${key(batchId)}`);
    if(!receipt)fail('assistant_resource_not_found',404);
    const preparation=receipt.result as EvaluationBatchPreparation;
    if(!preparation||preparation.batchId!==batchId||preparation.enterpriseId!==this.manager.enterpriseId||preparation.adminId!==this.manager.adminId
      ||!Array.isArray(preparation.items)||!preparation.items.length||preparation.items.length>50)fail('assistant_resource_not_found',404);
    for(const item of preparation.items){id(item.caseId);id(item.evaluationId);expected(item.caseVersion);expected(item.caseRevision);}
    if(new Set(preparation.items.map(item=>item.evaluationId)).size!==preparation.items.length)fail('assistant_resource_not_found',404);
    return {preparation,createdAt:new Date(receipt.created_at as string).toISOString()};
  }
  /** Metadata only. The original read endpoint remains the answer/citation/review authority. */
  async readBatch(batchId:string):Promise<KnowledgeBatchProgress> {
    return this.tx(async(tx,settings)=>{
      const {preparation,createdAt}=await this.batchReceipt(tx,batchId);
      const evaluations=await rows(tx,sql`select e.*,c.title current_title,c.revision current_revision,r.status run_status,
        exists(select 1 from app.assistant_quota_reservations q where q.enterprise_id=e.enterprise_id and q.run_id=e.run_id and q.status='reconciling') awaiting_reconciliation
        from app.assistant_knowledge_evaluations e left join app.assistant_knowledge_cases c on c.enterprise_id=e.enterprise_id and c.id=e.case_id
        left join app.assistant_runs r on r.enterprise_id=e.enterprise_id and r.id=e.run_id and r.conversation_id=e.conversation_id
        where e.enterprise_id=${this.manager.enterpriseId} and e.created_by=${this.manager.adminId}
        and e.id in (${sql.join(preparation.items.map(item=>sql`${item.evaluationId}`),sql`,`)})`);
      const byId=new Map(evaluations.map(e=>[String(e.id),e]));
      const required=evaluations.flatMap(e=>(e.snapshot as EvaluationSnapshot).required);
      const current=await this.publishedSources(tx,required.map(source=>source.documentId),settings);
      const profile=settings.active_index_profile_id?await one(tx,sql`select configuration from app.assistant_knowledge_index_profiles
        where enterprise_id=${this.manager.enterpriseId} and id=${String(settings.active_index_profile_id)} and status='active'`):null;
      const contextChanged=preparation.knowledgeEpoch!==Number(settings.knowledge_epoch)||preparation.profileId!==String(settings.active_index_profile_id)
        ||!profile||preparation.profileHash!==fingerprint(profile.configuration)||preparation.policyVersion!==Number(settings.policy_version);
      const readable=new Set<string>(),repo=new AssistantRepository(tx,this.actor);
      for(const conversationId of new Set(evaluations.filter(e=>e.conversation_id).map(e=>String(e.conversation_id)))){
        try{await repo.conversation(conversationId);readable.add(conversationId);}
        catch(error){if(!(error instanceof AssistantError)||error.code!=='assistant_resource_not_found')throw error;}
      }
      const items:KnowledgeBatchProgressItem[]=preparation.items.map(item=>{
        const e=byId.get(item.evaluationId);
        const scopeValid=Boolean(e&&String(e.case_id)===item.caseId&&Number(e.case_revision)===item.caseRevision
          &&fingerprint(e.snapshot)===item.snapshotHash&&(!e.conversation_id||readable.has(String(e.conversation_id))));
        const sourcesValid=scopeValid&&!contextChanged&&Number(e!.case_revision)===Number(e!.current_revision)
          &&Number(e!.knowledge_epoch)===Number(settings.knowledge_epoch)&&this.requiredCurrent((e!.snapshot as EvaluationSnapshot).required,current);
        let status:KnowledgeBatchState=!scopeValid||!e?.current_revision?'unavailable':!sourcesValid?'source_changed':e.run_id?String(e.run_status) as KnowledgeBatchState:'dispatch_pending';
        if(!knowledgeBatchStates.includes(status))status='unavailable';
        const available=scopeValid&&sourcesValid&&status!=='unavailable';
        return {caseId:item.caseId,evaluationId:item.evaluationId,caseRevision:item.caseRevision,currentRevision:e?.current_revision?Number(e.current_revision):null,
          title:e?.current_title?String(e.current_title):'问题不可用',available,status,runId:available&&e?.run_id?String(e.run_id):null,
          dispatchState:available?(e?.run_id?'linked':e?.conversation_id?'receipt_pending':'not_started'):null,
          awaitingReconciliation:available&&Boolean(e?.awaiting_reconciliation)};
      });
      await knowledgeManager(tx,this.manager);
      return {scope:{...this.manager},batchId,createdAt,contextChanged,knowledgeEpoch:Number(settings.knowledge_epoch),preparedEpoch:preparation.knowledgeEpoch,
        items,counts:knowledgeBatchCounts(items),contentIncluded:false,semanticCorrectness:'requires_review',costMicros:null};
    });
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
    const e=await this.tx(async(tx,s)=>{const row=await this.evaluation(tx,evaluationId);if(!await this.current(tx,row,s))fail('context_changed');
      return Object.assign(row,{executionBatchId:await this.pinnedEvaluationBatch(tx,evaluationId)});},true);
    if(e.executionBatchId){
      const adapter=this.executionAdapter(),receipt=await adapter.receipt(e.executionBatchId);
      const item=receipt.manifest.items.find(item=>item.evaluationId===evaluationId);if(!item)fail('invalid_batch_manifest');
      await adapter.resume(receipt.manifest,item);
      const observed=await adapter.observe(receipt.manifest,item);if(!observed.runId)fail('context_changed');
      return {evaluationId,runId:observed.runId};
    }
    if(this.sharedExecution){const recovered=await this.recoverEvaluation(evaluationId);if(recovered.runId)return {evaluationId,runId:recovered.runId};}
    if(e.run_id)return {evaluationId,runId:String(e.run_id)};
    const chat=new ConversationService(this.actor),snapshot=e.snapshot as Row;
    const c=await chat.create(String(e.create_key),{audience:'customer_public',draftVersionIds:[]});
    await this.tx(async(tx,s)=>{const row=await this.evaluation(tx,evaluationId);if(!await this.current(tx,row,s))fail('context_changed');
      await tx.execute(sql`update app.assistant_knowledge_evaluations set conversation_id=${String(c.id)} where enterprise_id=${this.manager.enterpriseId} and id=${evaluationId}`);});
    const sent=await chat.send(String(c.id),String(e.send_key),{version:1,blocks:[{type:'text',text:String(snapshot.question)}]});
    await this.tx(async tx=>{await this.evaluation(tx,evaluationId);await tx.execute(sql`update app.assistant_knowledge_evaluations set run_id=${String(sent.runId)} where enterprise_id=${this.manager.enterpriseId} and id=${evaluationId}`);});
    return {evaluationId,runId:String(sent.runId)};
  }
  /** Only an already linked private preview run; this creates no pending-item cancellation fence. */
  async cancel(evaluationId:string,requestKey:string) {
    if(this.sharedExecution)await this.recoverEvaluation(evaluationId);
    const e=await this.tx(async tx=>{
      const row=await this.evaluation(tx,evaluationId);
      const executionBatchId=await this.pinnedEvaluationBatch(tx,evaluationId);
      if(executionBatchId)return Object.assign(row,{executionBatchId});
      if(!row.run_id||!row.conversation_id)fail('context_changed');
      await new AssistantRepository(tx,this.actor).conversation(String(row.conversation_id));
      if(!await one(tx,sql`select id from app.assistant_runs where enterprise_id=${this.manager.enterpriseId}
        and id=${String(row.run_id)} and conversation_id=${String(row.conversation_id)}`))fail('assistant_resource_not_found',404);
      return Object.assign(row,{executionBatchId:null});
    });
    if(e.executionBatchId){
      const adapter=this.executionAdapter(),receipt=await adapter.receipt(e.executionBatchId);
      const item=receipt.manifest.items.find(item=>item.evaluationId===evaluationId);if(!item)fail('invalid_batch_manifest');
      const run=await adapter.cancelItem(receipt.manifest,item,requestKey);
      return {evaluationId,runId:run.runId,status:'cancel_requested'};
    }
    // The shared service rechecks current identity/participation and owns cancellation, jobs and quota reconciliation.
    const run=await new ConversationService(this.actor).run(String(e.run_id),'cancel',requestKey);
    return {evaluationId,runId:String(e.run_id),status:run.status};
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
