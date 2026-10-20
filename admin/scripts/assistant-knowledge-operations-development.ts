/** Synthetic-only KB4 HTTP/Worker/configured-model acceptance. No tokens/connection secrets are persisted. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {SignJWT} from 'jose';
import {loadEnvConfig} from '@next/env';
import {sql} from 'drizzle-orm';
import {withPlatformTransaction,withTenantTransaction} from '@/db/transaction';
import {one,rows,type Row} from '@/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '@/lib/postgresql';
import {safeText,type ActorContext} from '@/lib/assistant/contracts';
import {syntheticFormattedXlsx} from './assistant-file-fixtures';

const batches=process.argv.includes('--batches'),fixture=process.argv.includes('--fixture'),closeFixture=process.argv.includes('--close-fixture');
const evidence=process.argv.find(a=>a.startsWith('--evidence='))?.slice('--evidence='.length);
if(evidence&&!/^xiaok-[a-z0-9-]{1,80}$/.test(evidence))throw Error('Invalid XiaoK evidence directory name');
const output=path.resolve('../tmp',evidence||(batches?'xiaok-kb4-batches':'xiaok-kb4')),native=process.argv.includes('--native'),prefix='synthetic-kb4-live-'+randomUUID();
const question='书房靠窗办公应先核对什么？通道怎么核对，这些建议是否表示插座点位已经获批？';
const v1='合成企业办公知识：书房靠窗办公先核对屏幕眩光和通道，插座点位仍需设计师核对点位图。本条是方案讨论建议，不代表现场已检查或点位获批。';
const v2=v1+' 修订补充：通道应结合实际家具尺寸核对，不能由“书房”名称推断尺寸；屏幕可比较侧向摆放。';
const report:Row={started:new Date().toISOString(),prefix,model:'existing configured DeepSeek/deepseek-flash',reality:{fixtures:'clearly labelled synthetic; no customer documents',database:'approved development5432',embedding:'real existing1024-dimensional provider',worker:'existing real Worker',preview:'existing evidence-selection preview; not customer Agent semantic acceptance',mini:'actual original customer Agent'},checks:[],evaluations:[],runs:[],requests:[],passed:false};
const save=()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,fixture?'chrome-fixture.json':native?'native-driver.json':'live.json'),JSON.stringify(report,null,2));};
async function wait<T>(read:()=>Promise<T|false|null>,label:string):Promise<T>{for(let i=0;i<240;i++){const r=await read();if(r)return r;await new Promise(r=>setTimeout(r,500));}throw Error('Timeout '+label);}
let eid='',aid='',uid='',token='',customerToken='',cid='',did='',vid='',documentVersion=1;
let batchTargets:Row[]=[];
const check=(name:string)=>{(report.checks as Row[]).push({name,passed:true});save();console.log('PASS '+name);};
async function api(suffix:string,method='GET',body?:unknown,status=200,key=randomUUID(),authorization=token){
  const response=await fetch('http://localhost:3006/api/assistant/'+suffix,{method,headers:{Authorization:'Bearer '+authorization,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
  const data=await response.json();(report.requests as Row[]).push({suffix,method,status:response.status,noStore:response.headers.get('cache-control')});save();assert.equal(response.status,status,JSON.stringify(data));assert.match(response.headers.get('cache-control')||'',/no-store/);return data.data;
}
async function mini(suffix:string,method='GET',body?:unknown){const key=randomUUID();const r=await fetch('http://localhost:3006/api/miniprogram/assistant/conversations/'+cid+suffix,{method,headers:{Authorization:'Bearer '+customerToken,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify({clientMessageId:key,content:{version:1,blocks:[{type:'text',text:body}]}})}:{}),signal:AbortSignal.timeout(60000)});const j=await r.json();assert.equal(r.status,method==='POST'?202:200,JSON.stringify(j));return j.data;}
async function index(versionId:string,edit=1){const q=await api(`knowledge/documents/${did}/versions/${versionId}/index`,'POST',{expectedEditVersion:edit});await wait(async()=>{const j=await api('knowledge/jobs/'+q.jobId);if(['failed','cancelled','indeterminate'].includes(j.status))throw Error(JSON.stringify(j));return j.status==='succeeded'?j:false;},'index');}
async function replace(body:string){const draft=await api(`knowledge/documents/${did}/versions`,'POST',{expectedVersion:documentVersion,fromVersionId:vid});documentVersion++;const next=String(draft.id);await api(`knowledge/documents/${did}/versions/${next}`,'PATCH',{expectedEditVersion:1,body});
  await api(`knowledge/documents/${did}/versions/${next}/publish`,'POST',{expectedVersion:documentVersion,expectedEditVersion:2},409);assert.equal((await api('knowledge/documents/'+did)).document.published_version_id,vid);check('failed unindexed revision preserves the effective old publication');
  await index(next,2);await api(`knowledge/documents/${did}/versions/${next}/publish`,'POST',{expectedVersion:documentVersion,expectedEditVersion:2});documentVersion++;vid=next;return next;}
async function evaluate(caseId:string,caseVersion:number,round:number){const start=Date.now(),key=randomUUID(),p=`knowledge/operations/cases/${caseId}/evaluations`,input={expectedVersion:caseVersion};const created=await api(p,'POST',input,200,key);assert.deepEqual(await api(p,'POST',input,200,key),created);
  const result=await wait(async()=>{const r=await api('knowledge/operations/evaluations/'+created.evaluationId);if(!r.available)throw Error('Evaluation became unavailable');return ['queued','running'].includes(r.status)?false:r;},'actual preview model');
  (report.evaluations as Row[]).push({round,elapsedMs:Date.now()-start,...result});save();assert.equal(result.status,'succeeded');assert.equal(result.structural.passed,true);assert.equal(result.structural.semanticCorrectness,'requires_review');assert.equal(result.snapshot.required[0].versionId,vid);assert.equal(result.costMicros,null);assert.deepEqual(result.structural.forbidden,[]);return result;}
async function evaluateBatch(caseId:string,caseVersion:number,round:number){
  if(batchTargets.length<2)batchTargets.push(await api('knowledge/operations/cases','POST',{title:'合成批量第二题 · 插座边界',question:'合成办公资料里的屏幕、通道和插座点位分别应核对什么，能当作已经获批吗？',expectation:{kind:'grounded',requiredDocumentIds:[did],forbiddenDocumentIds:[]}}));
  const start=Date.now(),key=randomUUID(),input={title:'合成批量回归 · '+round,concurrency:2,cases:batchTargets.map(c=>({id:String(c.id),expectedVersion:String(c.id)===caseId?caseVersion:Number(c.version)}))};
  const created=await api('knowledge/operations/batches','POST',input,200,key);assert.deepEqual(await api('knowledge/operations/batches','POST',input,200,key),created);
  const b=await wait(async()=>{const r=await api('knowledge/operations/batches/'+created.batchId);if(!r.available||r.state==='blocked')throw Error('Real batch unavailable: '+JSON.stringify(r));return r.state==='completed'?r:false;},'background batch Worker without page polling dispatch');
  assert.equal(b.items.length,2);assert.equal(new Set(b.items.map((i:Row)=>i.runId)).size,2);assert.equal(b.costMicros,null);
  const results=[];for(const item of b.items){const r=await api('knowledge/operations/evaluations/'+item.evaluationId);assert.equal(r.status,'succeeded');assert.equal(r.structural.passed,true);assert.equal(r.snapshot.required[0].versionId,vid);assert.equal(r.structural.semanticCorrectness,'requires_review');results.push(r);}
  const entry={round,elapsedMs:Date.now()-start,...b,evaluations:results};if(!report.batches)report.batches=[];(report.batches as Row[]).push(entry);save();
  const primary=results.find(r=>r.snapshot.question===question)!;assert.ok(primary);(report.evaluations as Row[]).push({round,...primary});return primary;
}
async function audit(runId:string,label:string,start:number){
  const run=await wait(async()=>{const r=await withTenantTransaction(eid,tx=>one(tx,sql`select id,status,error_code,output_message_id from app.assistant_runs where enterprise_id=${eid} and id=${runId} and conversation_id=${cid}`));return r&&!['queued','running'].includes(String(r.status))?r:false;},'configured customer Agent');
  const history=await mini('/messages'),message=history.items.find((m:Row)=>String(m.id)===String(run.output_message_id));
  const citations=await withTenantTransaction(eid,tx=>rows(tx,sql`select id::text,document_id::text,document_version_id::text,quote_snapshot from app.assistant_message_citations where enterprise_id=${eid} and run_id=${runId}`));
  const usage=await withTenantTransaction(eid,tx=>rows(tx,sql`select category,measurement_kind,quantity::text,input_tokens::text,output_tokens::text,cost_micros::text from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`));
  const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select kind,capability_name,status,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
  const result={runId,label,expectedVersionId:vid,elapsedMs:Date.now()-start,status:run.status,error:run.error_code,outputMessageId:String(run.output_message_id),message,citations,usage,steps,costMicros:null};
  (report.runs as Row[]).push(result);save();assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(message?.available,true);assert.ok(citations.some(c=>c.document_id===did&&c.document_version_id===vid),'required current source must actually be cited');assert.ok(steps.some(s=>s.kind==='agent_synthesis_context'),'must use real synthesis, not legacy excerpt preview');
  const text=safeText(message.content);assert.match(text,/眩光|反光|强光/);assert.match(text,/通道/);assert.match(text,/点位|插座/);assert.match(text,/不能|不代表|不等于|不意味着|未|需|待/);assert.doesNotMatch(text,/PRIVATE_KB4_SENTINEL/);if(vid!==(report.originalVersionId as string))assert.match(text,/家具|尺寸/);
  assert.doesNotMatch(text,/本轮依据：本咨询原话、正式户型与已发布现场资料/,'missing home materials must not produce a positive consulted-drawing/record footer');
  return result;
}
async function main(){loadEnvConfig(process.cwd(),true);const [{signMiniProgramToken},{KnowledgeService},{ConversationService}]=await Promise.all([import('@/lib/miniprogram-jwt'),import('@/lib/assistant/knowledge/service'),import('@/lib/assistant/core/conversation')]);const target=new URL(resolvePostgresRuntimeConfig().connectionString);assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5432'&&target.pathname==='/smart_floor_planner');
if(closeFixture){
  const file=path.join(output,'chrome-fixture.json'),saved=JSON.parse(fs.readFileSync(file,'utf8')),f=saved.fixture as Row;
  assert.ok(String(saved.prefix).startsWith('synthetic-kb4-live-')&&f.enterpriseId&&f.ownerId);
  await withPlatformTransaction(async tx=>{const e=await one(tx,sql`select code from app.enterprises where id=${String(f.enterpriseId)}`);assert.equal(e?.code,saved.prefix);
    await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${String(f.enterpriseId)}`);
    await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${String(f.enterpriseId)}`);
    await tx.execute(sql`update app.users set context_version=context_version+1 where id=${String(f.userId)} and exists(select 1 from app.wechat_identities w where w.user_id=app.users.id and w.openid=${saved.prefix})`);
    saved.finalState=await one(tx,sql`select (select count(*) from app.assistant_runs where enterprise_id=${String(f.enterpriseId)} and status in ('queued','running')) active_runs,(select count(*) from app.admin_users where enterprise_id=${String(f.enterpriseId)} and status='active') active_staff`);
    saved.batchAudit=await rows(tx,sql`select b.id::text,b.created_by::text,b.state,b.concurrency,
      i.ordinal,i.state item_state,e.id::text evaluation_id,e.case_id::text,e.run_id::text,r.status run_status,q.status reservation_status
      from app.assistant_knowledge_batches b join app.assistant_knowledge_batch_items i on i.enterprise_id=b.enterprise_id and i.batch_id=b.id
      join app.assistant_knowledge_evaluations e on e.enterprise_id=i.enterprise_id and e.id=i.evaluation_id
      left join app.assistant_runs r on r.enterprise_id=e.enterprise_id and r.id=e.run_id
      left join app.assistant_quota_reservations q on q.enterprise_id=r.enterprise_id and q.run_id=r.id
      where b.enterprise_id=${String(f.enterpriseId)} order by b.id,i.ordinal`);
  });saved.fixtureClosedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(saved,null,2));await closePostgresPool();return;
}save();
try{
  await withPlatformTransaction(async tx=>{const template=await one(tx,sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`);assert.ok(template&&String(template.code).startsWith('p4b-development-'));const config=template.agent_config as Row;assert.equal(config.providerKey,'deepseek');assert.equal(config.model,'deepseek-flash');assert.equal(config.runtime,'langgraph-v1');
    eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${batches?'测试专用 · KB4批量回归 '+prefix.slice(-6):'测试专用 · KB4运营回归'},${prefix},'active') returning id`))!.id);
    aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix},${'unusable:'+randomUUID()},'enterprise_admin','active',ARRAY['assistant-knowledge','assistant-usage'],false) returning id`))!.id);
    await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config) values(${eid},true,200,12000000,1000000000,30,${JSON.stringify({...config,imageInput:false})}::jsonb)`);
    uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values(${prefix},1) returning id`))!.id);await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
  });report.fixture={enterpriseId:eid,ownerId:aid,userId:uid};save();
  token=await new SignJWT({id:aid,enterpriseId:eid,role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const k=new KnowledgeService({enterpriseId:eid,adminId:aid});const created=await api('knowledge/documents','POST',{title:'合成KB4办公知识',sourceType:'manual_text',audience:'customer_public',body:v1});did=String(created.document.id);vid=String(created.draft.id);report.documentId=did;report.originalVersionId=vid;
  await index(vid);await api(`knowledge/documents/${did}/versions/${vid}/publish`,'POST',{expectedVersion:1,expectedEditVersion:1});documentVersion=2;
  const hidden=await k.execute('create',{title:'合成KB4内部资料',sourceType:'manual_text',audience:'staff_internal',body:'PRIVATE_KB4_SENTINEL 书房靠窗办公、屏幕眩光、通道与插座点位内部资料。'},randomUUID());
  const hid=String((hidden.document as Row).id),hvid=String((hidden.draft as Row).id);const job=await k.execute('index',{documentId:hid,versionId:hvid,expectedEditVersion:1},randomUUID());await wait(async()=>{const j=await k.execute('job',{jobId:job.jobId});return j.status==='succeeded'?j:false;},'internal fixture');await k.execute('publish',{documentId:hid,versionId:hvid,expectedVersion:1,expectedEditVersion:1},randomUUID());
  const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self']};cid=String((await new ConversationService(actor).create(randomUUID())).id);
  customerToken=await signMiniProgramToken({sub:uid,id:uid,mode:'customer',role:'user',contextVersion:1,source:'wechat'});report.conversationId=cid;save();
  await mini('/messages');check('synthetic customer identity passes the real Mini HTTP guard before model evaluation');
  const evaluateCurrent=batches?evaluateBatch:evaluate;
  if(native){const driver=await import(pathToFileURL(path.resolve('scripts/assistant-synthesis-native.mjs')).href);let priorVersion=vid;
    if(batches){batchTargets=[await api('knowledge/operations/cases','POST',{title:'合成批量主问',question,expectation:{kind:'grounded',requiredDocumentIds:[did],forbiddenDocumentIds:[hid]}})];await evaluateBatch(String(batchTargets[0].id),Number(batchTargets[0].version),1);}
    await driver.run({root:path.resolve('..'),output,customer:{cid,token:customerToken,enterpriseId:eid},question,followup:question,
      firstLabel:'KB4 native original question uses the real effective knowledge',followupLabel:'KB4 same native question uses the repaired source version',withdrawTarget:'followup',withdrawLabel:'KB4 withdrawal hides the repaired answer on actual C01 reentry',
      audit:(runId:string,label:string,start:number)=>audit(runId,label,start),citationCheck:async(c:Row)=>{assert.equal(String(c.version),priorVersion);},
      beforeFollowup:async()=>{priorVersion=await replace(v2);if(batches)await evaluateBatch(String(batchTargets[0].id),Number(batchTargets[0].version),2);const h=await mini('/messages');const first=(report.runs as Row[])[0];assert.equal(h.items.find((m:Row)=>String(m.id)===String(first.outputMessageId)).available,false);return{versionId:vid};},
      withdraw:async()=>{await api(`knowledge/documents/${did}/retire`,'POST',{expectedVersion:documentVersion});documentVersion++;},
    });
  }else{
    const caseBody={title:'合成KB4 · 办公问答修订回归',question,expectation:{kind:'grounded',requiredDocumentIds:[did],forbiddenDocumentIds:[hid]},gapNote:'原条目缺少通道核对对象；只做知识修订，不自动批准点位'};
    const key=randomUUID();let c=await api('knowledge/operations/cases','POST',caseBody,200,key);assert.deepEqual(await api('knowledge/operations/cases','POST',caseBody,200,key),c);report.caseId=c.id;await api('knowledge/operations/cases','POST',{...caseBody,tenantId:'all'},422);await api('knowledge/operations/cases/'+c.id,'PATCH',{...caseBody,expectedVersion:999},409);check('real Admin question write, reentry, idempotency and invalid-scope/conflict handling');
    if(batches)batchTargets=[c];
    if(fixture){
      assert.ok(batches);await api('knowledge/operations/cases','POST',{...caseBody,title:'合成批量第二题 · Chrome'});
      const imported=await api('knowledge/documents/import','POST',{title:'合成数字显示核对',fileName:'合成数字显示.xlsx',fileBase64:syntheticFormattedXlsx().toString('base64'),authorization:'SYNTHETIC ONLY; number-display browser fixture',audience:'customer_public'});
      const fid=String(imported.document.id),fvid=String(imported.draft.id),fp=`knowledge/documents/${fid}/versions/${fvid}`;
      const waitJob=(jobId:string)=>wait(async()=>{const j=await api('knowledge/jobs/'+jobId);if(['failed','cancelled','indeterminate'].includes(j.status))throw Error('Fixture file job failed: '+JSON.stringify(j));return j.status==='succeeded'?j:false;},'synthetic Chrome number-display file');
      await waitJob(imported.jobId);const detail=await api('knowledge/documents/'+fid),parsed=detail.versions[0].source_file.parsed;
      const row=parsed.blocks.find((b:Row)=>b.sheet==='材料核对'&&b.row===3);assert.equal(row.cells[1].text,'12.50%');assert.equal(row.cells[2].text,'2.35 mm');
      await api(fp+'/review','POST',{expectedEditVersion:2,acknowledgeWarnings:true,excludedBlockIds:[]});const job=await api(fp+'/index','POST',{expectedEditVersion:3});await waitJob(job.jobId);
      await api(fp+'/publish','POST',{expectedVersion:1,expectedEditVersion:3});report.numericDocument={documentId:fid,versionId:fvid,parsed};
      report.fixtureReady=true;report.primaryCase=c;save();check('persistent synthetic Chrome fixture ready; close with --close-fixture');return;
    }
    const before=[];for(let round=1;round<=2;round++)before.push(await evaluateCurrent(c.id,c.version,round));
    c=await api(`knowledge/operations/evaluations/${before[1].id}/review`,'POST',{expectedVersion:c.version,outcome:'rejected',note:'合成运营流程验收：通道核对对象尚未写清，先补充来源；本注记不代表人工业务验收'});assert.equal(c.gap_status,'open');check('explicit semantic gap persists separately from successful structural recall/citation checks');
    for(let i=1;i<=2;i++){const start=Date.now(),sent=await mini('/messages','POST',question);await audit(String(sent.runId),'before-'+i,start);}check('two real customer Agent answers use the original source without inventing site approval');
    await replace(v2);for(const e of before){const old=await api('knowledge/operations/evaluations/'+e.id);assert.equal(old.available,false);assert.ok(!('answer' in old));assert.ok(!('review' in old));}
    const after=[];for(let round=1;round<=2;round++)after.push(await evaluateCurrent(c.id,c.version,round+2));
    c=await api(`knowledge/operations/evaluations/${after[1].id}/review`,'POST',{expectedVersion:c.version,outcome:'accepted',note:'合成运营流程验收注记：修订版召回及引用检查通过，专业含义由本批独立语义审阅另记；不代表人类验收'});assert.equal(c.gap_status,'verified');check('same saved question reruns twice against the repaired immutable version and records an explicit review');
    for(let i=1;i<=2;i++){const start=Date.now(),sent=await mini('/messages','POST',question);await audit(String(sent.runId),'after-'+i,start);}check('two real customer Agent answers cite the repair and explain furniture dimensions without assuming site facts');
    const health=await api('knowledge/operations/health'),usage=await api('usage');assert.equal(health.parser.ocr,false);assert.ok(health.attempts.length);assert.equal(health.costMicros,null);assert.ok(usage.indexing.length);report.health=health;report.usage=usage;check('index health and separately authorized usage expose real calls and unknown costs');
    await api(`knowledge/documents/${did}/retire`,'POST',{expectedVersion:documentVersion});documentVersion++;const stale=await api('knowledge/operations/evaluations/'+after[1].id);assert.equal(stale.available,false);assert.equal((await api('knowledge/operations/cases/'+c.id)).gap_status,'needs_recheck');const reentry=await mini('/messages');for(const r of report.runs as Row[])assert.equal(reentry.items.find((m:Row)=>String(m.id)===String(r.outputMessageId))?.available,false);check('withdrawal invalidates operation results, gap verification and actual customer history');
  }
  report.finalVersionId=vid;report.passed=true;
}finally{
  if(eid&&!(fixture&&report.fixtureReady))await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);if(uid)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
    report.finalState={activeRuns:Number((await one(tx,sql`select count(*) n from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')`))!.n),activeStaff:Number((await one(tx,sql`select count(*) n from app.admin_users where enterprise_id=${eid} and status='active'`))!.n)};});report.finished=new Date().toISOString();save();await closePostgresPool();
}}
main().catch(e=>{report.error=(e as Error).message;save();console.error((e as Error).message);process.exitCode=1;});
