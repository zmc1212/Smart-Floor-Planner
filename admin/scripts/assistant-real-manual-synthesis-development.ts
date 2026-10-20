/** One user-selected original only, real customer Agent, synthetic development project. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import { agentReadProtocol } from '@/lib/assistant/agent/runtime';
import { agentSourceFinalProtocol } from '@/lib/assistant/agent/worker';
import { synthesisRepairProjectionVersion } from '@/lib/assistant/agent/synthesis';
import type { SynthesisAnswer, SynthesisContext } from '@/lib/assistant/agent/synthesis';
import { writeAcceptanceReport } from './assistant-acceptance-report.mjs';
import { expectedManualRunCount, manualScenarioNames, manualBatchComplete } from './assistant-manual-cases.mjs';
import { getPlatformLlmRuntimeConfig } from '@/lib/platform-llm-config';

const source = path.resolve('../docs/装修施工标准手册制度规范/04 质量管理/00 管理文件/03 金螳螂家施工工艺手册2.0.pdf');
const sourceHash = 'fdbdaad5b5253c7b58c65e70c7fd49c584e7762323de03bf945bc72b78d73010';
const evidenceArg = process.argv.find(a => a.startsWith('--evidence='))?.slice(11) || 'xiaok-real-manual-synthesis';
assert.match(evidenceArg, /^xiaok-[a-z0-9-]{1,80}$/);
const output = path.resolve('../tmp', evidenceArg);
const profile=process.argv.includes('--profile=b')?'b':'a';
const caseSet=process.argv.find(a=>a.startsWith('--case-set='))?.slice('--case-set='.length)||'all';
const selectedCaseNames=manualScenarioNames(caseSet),expectedRuns=expectedManualRunCount(caseSet);
const observed=profile==='b'?{shower:'1600',basin:'1100',spacing:'200'}:{shower:'1500',basin:'1000',spacing:'100'};
const requireFirstDraft=process.argv.includes('--require-first-draft');
const manualSiteFixtures = process.argv.includes('--manual-site-fixtures');
const siteFixtureMode = manualSiteFixtures ? 'manual_staff_edit' : 'model_draft';
const coordination=process.argv.find(a=>a.startsWith('--coordinate='))?.slice('--coordinate='.length);
if(coordination)assert.match(coordination,/^xiaok-[a-z0-9-]{1,80}$/);
const batchId=process.argv.find(a=>a.startsWith('--batch='))?.slice('--batch='.length);
const recheck=process.argv.includes('--recheck');
assert.ok(!(recheck&&process.argv.includes('--resume')),'Choose --recheck for a completed pass or --resume for a completed failure');
const codeRoot=path.resolve('src/lib/assistant/agent');
const codeHashes=()=>Object.fromEntries([
  ...fs.readdirSync(codeRoot).filter(f=>f.endsWith('.ts')).map(f=>'src/lib/assistant/agent/'+f),
  'src/lib/assistant/contracts/index.ts','src/lib/assistant/contracts/model.ts','src/lib/assistant/contracts/source-file.ts',
  'src/lib/assistant/knowledge/retrieval.ts','src/lib/assistant/knowledge/sources.ts','src/lib/ai/providers/agent-chat.ts',
  'src/lib/assistant/knowledge/source-file.ts','src/lib/assistant/knowledge/index-worker.ts','src/lib/assistant/knowledge/chunk-gateway.ts',
  'src/lib/construction/site-contract.ts','src/lib/construction/site-worker.ts',
  'scripts/assistant-real-manual-synthesis-development.ts','scripts/assistant-citation-protocol-development.ts','scripts/assistant-acceptance-report.mjs',
  'scripts/assistant-manual-cases.mjs',
].sort().map(file=>[file,createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
type Message = { id:string; available:boolean; content:Parameters<typeof safeText>[0]; citations:{id:string;version:string}[] };
type RunRecord = { name:string;round:number;conversationId:string;runId:string;elapsedMs:number;status:unknown;error:unknown;
  outputMessageId:string;message:Message|undefined;steps:Row[];usage:Row[];sources:Row[];text?:string;answer?:SynthesisAnswer;fullSourceSelections?:number;fixedChecksPassed?:boolean;caseFailure?:string;
  firstDraftText?:string;firstDraftKind?:string;firstDraftCatalog?:boolean;firstDraftPassed?:boolean;repairCount?:number;validationFailureCount?:number;repairAttempts?:number;firstDraftError?:unknown };
type Report = { started:string;promptVersion:string;source:{path:string;sha256:string};scope:string;checks:{name:string;passed:boolean}[];
  caseSet:string;siteFixtureMode?:string;
  runs:RunRecord[];passed:boolean;fixture?:Row;document?:{documentId:string;versionId:string;parseJobId:string;indexJobId?:string};
  records:Row[];conversationIds:string[];finalState?:Row|null;originalEnterprise?:Row[];finished?:string;error?:string;
  codeHashes?:Record<string,string>;codeHashesAfter?:Record<string,string>;readyForIsolation?:boolean;retiredForIsolation?:boolean;batchId?:string };
const report:Report = { started:new Date().toISOString(),promptVersion:agentPromptVersion,source:{path:source,sha256:sourceHash},
  caseSet,siteFixtureMode,
  scope:'single original only; real configured customer Agent/HTTP/Worker; synthetic project/observations, no real homeowner facts; temporary test-only customer-readable copy, retired and disabled at end; existing internal enterprise2567 unchanged'
    + (manualSiteFixtures ? '; site records explicitly edited/published through existing staff services as fixtures; generative site drafting ungraded, actual attempts/cancellations retained' : ''),
  checks:[],runs:[],records:[],conversationIds:[],passed:false,codeHashes:codeHashes(),batchId };
const previous:Report|null=(recheck||process.argv.includes('--resume'))?JSON.parse(fs.readFileSync(path.join(output,'live.json'),'utf8')):null;
const save = () => writeAcceptanceReport(path.join(output, 'live.json'), report);
const check = (name:string) => { report.checks.push({name,passed:true}); save(); };
async function wait<T>(work:()=>Promise<T|null|false>,label:string):Promise<T> {
  const deadline=Date.now()+240000;
  while(Date.now()<deadline){const result=await work();if(result)return result;await new Promise(r=>setTimeout(r,500));}
  throw Error('Timeout: '+label);
}
async function isolationBarrier(phase:'retire'|'cleanup'){
  if(!coordination)return;
  const signal=path.resolve('../tmp',coordination,`${evidenceArg}-${phase}.json`);
  await wait(async()=>fs.existsSync(signal)?true:null,'two-enterprise isolation '+phase);
}
async function main(){
  loadEnvConfig(process.cwd(),true);
  const [{ConversationService},{ConstructionService},{SiteChatService},{signMiniProgramToken}]=await Promise.all([
    import('@/lib/assistant/core/conversation'),import('@/lib/construction/service'),import('@/lib/construction/site-chat'),import('@/lib/miniprogram-jwt'),
  ]);
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5432'&&target.pathname==='/smart_floor_planner');
  // Synthetic fixtures follow the explicitly selected live provider instead
  // of silently inheriting an old tenant's DeepSeek-only capability marker.
  const provider = await getPlatformLlmRuntimeConfig(), model = process.env.ASSISTANT_TEXT_MODEL?.trim() || provider.model;
  assert.ok(provider.enabled && model === provider.model, 'Assistant override must match the user-selected platform model');
  assert.ok(provider.providerKey === 'siliconflow' && new URL(provider.baseUrl).origin === 'https://api.siliconflow.cn'
    || provider.providerKey === 'deepseek' && new URL(provider.baseUrl).origin === 'https://api.deepseek.com', 'Explicit supported development provider required');
  const configuredAgent = { runtime: 'langgraph-v1', model, providerKey: provider.providerKey, imageInput: false, tools: true,
    probeVersion: `synthetic-user-selected:${agentPromptVersion}:${provider.providerKey}:${model}` };
  const bytes=fs.readFileSync(source);assert.equal(createHash('sha256').update(bytes).digest('hex'),sourceHash);
  fs.mkdirSync(output,{recursive:true});
  if(previous){
    assert.equal(previous.caseSet||'all',caseSet,'Cannot mix acceptance case sets');
    assert.equal(previous.siteFixtureMode || 'model_draft', siteFixtureMode, 'Cannot mix model drafts and manual staff fixtures');
    assert.ok(previous.finished&&(recheck?previous.passed:!previous.passed)&&previous.finalState?.active_runs==='0');
    assert.equal(previous.source.sha256,sourceHash);assert.ok(previous.fixture&&previous.document);
    assert.ok(previous.runs.every(r=>!['queued','running','indeterminate'].includes(String(r.status))));
    const priorConfig = await withTenantTransaction(String(previous.fixture!.enterpriseId), tx => one(tx, sql`select agent_config from app.assistant_enterprise_settings where enterprise_id=${String(previous.fixture!.enterpriseId)}`));
    assert.equal((priorConfig?.agent_config as Row)?.providerKey, provider.providerKey, 'A provider change requires a fresh fixture/report');
    assert.equal((priorConfig?.agent_config as Row)?.model, model, 'A model change requires a fresh fixture/report');
    fs.copyFileSync(path.join(output,'live.json'),path.join(output,'attempt-'+previous.started.replace(/[:.]/g,'-')+'.json'));
    report.fixture=previous.fixture;report.document=previous.document;report.records=previous.records;
  }
  save();
  let eid='',aid='',uid='',documentId='',adminToken='',customerToken='',contextVersion=1;
  const request=async(p:string,method='GET',body?:unknown,status=200,token=adminToken,key:string=randomUUID())=>{
    const response=await fetch('http://localhost:3006/api/'+p,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));assert.match(response.headers.get('cache-control')||'',/no-store/);return result.data;
  };
  const admin=(p:string,method='GET',body?:unknown,status=200,key?:string)=>request('assistant/'+p,method,body,status,adminToken,key);
  const job=async(id:string)=>wait(async()=>{const value=await admin('knowledge/jobs/'+id);if(['failed','cancelled','indeterminate'].includes(value.status))throw Error(JSON.stringify(value));return value.status==='succeeded'?value:null;},'original Worker '+id);
  try{
    const original=await withTenantTransaction('2567',tx=>rows(tx,sql`select d.id,d.audience,d.status,v.source_file->>'hash' hash from app.assistant_knowledge_documents d
      join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id where d.enterprise_id=2567 order by d.id`));
    assert.equal(original.length,1);assert.equal(original[0].hash,sourceHash);assert.equal(original[0].audience,'staff_internal');report.originalEnterprise=original;
    const prefix='synthetic-single-manual-'+randomUUID();
    if(previous){
      eid=String(previous.fixture!.enterpriseId);aid=String(previous.fixture!.ownerId);uid=String(previous.fixture!.userId);
      await withPlatformTransaction(async tx=>{
        const enterprise=await one(tx,sql`select code from app.enterprises where id=${eid}`);
        assert.ok(String(enterprise?.code).startsWith('synthetic-single-manual-'));
        const staff=await one(tx,sql`select enterprise_id,status from app.admin_users where id=${aid}`);assert.equal(String(staff?.enterprise_id),eid);assert.equal(staff?.status,'disabled');
        const user=await one(tx,sql`select context_version from app.users where id=${uid}`);assert.ok(user);contextVersion=Number(user.context_version);
        assert.equal((await one(tx,sql`select count(*) n from app.assistant_knowledge_documents where enterprise_id=${eid}`))?.n,'1');
        assert.equal((await one(tx,sql`select count(*) n from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running','indeterminate')`))?.n,'0');
        assert.equal((await one(tx,sql`select count(*) n from app.assistant_jobs where enterprise_id=${eid} and status in ('queued','running','indeterminate')`))?.n,'0');
        // Fixture-only recovery of a setup aborted before any question. Never
        // reactivate an unknown call or publish/index by manufacturing results.
        const draft=await one(tx,sql`select d.id,d.status,d.published_version_id,v.index_status,v.source_file->>'hash' hash
          from app.assistant_knowledge_documents d join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.id=${previous.document!.versionId}
          where d.enterprise_id=${eid} and d.id=${previous.document!.documentId}`);
        assert.ok(draft);assert.equal(draft.hash,sourceHash);
        if(!draft.published_version_id&&draft.status==='retired'){
          assert.equal(previous.runs.length,0,'Only unpublished setup fixtures with no natural questions may be recovered');
          if(draft.index_status!=='ready'){
            const indexing=await one(tx,sql`select id,status,last_error,attempts from app.assistant_jobs where enterprise_id=${eid} and id=${previous.document!.indexJobId!}`);
            assert.ok(indexing);assert.equal(indexing.status,'failed');assert.equal(indexing.last_error,'assistant_disabled');assert.ok(Number(indexing.attempts)<3);
            await tx.execute(sql`update app.assistant_jobs set status='queued',last_error=null,lease_token=null,lease_expires_at=null,
              provider_started_at=null,available_at=now(),updated_at=now() where enterprise_id=${eid} and id=${String(indexing.id)}`);
            await tx.execute(sql`update app.assistant_knowledge_versions set index_status='indexing',updated_at=now() where enterprise_id=${eid} and id=${previous.document!.versionId}`);
          }
          await tx.execute(sql`update app.assistant_knowledge_documents set status='draft',version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(draft.id)}`);
          report.fixture={...report.fixture,setupRecovery:'unpublished, no questions; terminal assistant_disabled index retried by original Worker; no new document/source'};
        }
        await tx.execute(sql`update app.assistant_enterprise_settings set enabled=true where enterprise_id=${eid}`);
        await tx.execute(sql`update app.admin_users set status='active' where id=${aid} and enterprise_id=${eid}`);
      });
    }else await withPlatformTransaction(async tx=>{
      eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · 单一手册自然综合',${prefix},'active') returning id`))!.id);
      aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password,display_name)
        values(${eid},${prefix},${'unusable:'+randomUUID()},'enterprise_admin','active',ARRAY['assistant-knowledge'],false,'合成手册测试负责人') returning id`))!.id);
      uid=String((await one(tx,sql`insert into app.users(nickname,context_version) values('合成单一手册测试业主',1) returning id`))!.id);
      await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${uid},${prefix})`);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,100,12000000,1000000000,30,${JSON.stringify(configuredAgent)}::jsonb)`);
    });
    if(previous)assert.equal(previous.fixture!.profile||'a',profile);
    report.fixture={...report.fixture,enterpriseId:eid,ownerId:aid,userId:uid,profile,observed,providerKey:provider.providerKey,model};save();
    adminToken=await new SignJWT({id:aid,enterpriseId:eid,role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    customerToken=await signMiniProgramToken({sub:uid,id:uid,mode:'customer',role:'user',contextVersion,source:'wechat'});
    const importKey=randomUUID(),input={title:'外部参考手册 · 金螳螂家施工工艺标准2.0 · 单一原件测试',category:'用户指定原件 / 隔离开发测试',
      fileName:path.basename(source),fileBase64:bytes.toString('base64'),audience:'customer_public',
      authorization:'User explicitly requested natural Agent testing with this original. Only synthetic development homeowner/project may read this temporary test copy; no actual customer/public release. Preserve internal/no-redistribution source marking; retire after test.'};
    const imported=previous?null:await admin('knowledge/documents/import','POST',input,200,importKey);
    documentId=previous?previous.document!.documentId:String(imported.document.id);
    const versionId=previous?previous.document!.versionId:String(imported.draft.id),base='knowledge/documents/'+documentId,vpath=base+'/versions/'+versionId;
    if(!previous){report.document={documentId,versionId,parseJobId:String(imported.jobId)};save();await job(imported.jobId);}
    const originalDetail=await admin(base),storedVersion=originalDetail.versions.find((v:Row)=>v.id===versionId),file=storedVersion.source_file;
    assert.equal(file.hash,sourceHash);assert.equal(file.parsed.pages,9);assert.equal(file.parsed.blocks.length,74);
    if(!previous){
      await admin(vpath+'/review','POST',{expectedEditVersion:2,acknowledgeWarnings:true,excludedBlockIds:[]});
      const indexing=await admin(vpath+'/index','POST',{expectedEditVersion:3});report.document!.indexJobId=String(indexing.jobId);save();await job(indexing.jobId);
    }else if(storedVersion.index_status!=='ready')await job(previous.document!.indexJobId!);
    await admin(vpath+'/publish','POST',{expectedVersion:Number(originalDetail.document.version),expectedEditVersion:previous?Number(storedVersion.edit_version):3});
    const corpus=await withTenantTransaction(eid,tx=>rows(tx,sql`select d.id,d.title,d.published_version_id,v.source_file->>'hash' hash from app.assistant_knowledge_documents d
      left join app.assistant_knowledge_versions v on v.enterprise_id=d.enterprise_id and v.id=d.published_version_id where d.enterprise_id=${eid} order by d.id`));
    assert.equal(corpus.length,1);assert.equal(String(corpus[0].id),documentId);assert.equal(corpus[0].hash,sourceHash);check('one knowledge document only: exact nine-page original, no other manuals/FAQs/synthetic policies');
    const leadId=previous?.fixture!.leadId?String(previous.fixture!.leadId):String((await withTenantTransaction(eid,tx=>one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name)
      values(${eid},${uid},'合成手册测试客户','13800000000','natural','合成手册测试之家') returning id`)))!.id);
    report.fixture={...report.fixture,leadId};save();
    const construction=new ConstructionService({enterpriseId:eid,adminId:aid}),site=new SiteChatService(construction.actor),settings=await construction.execute('stages');
    if(!previous?.fixture!.projectId)await construction.execute('saveStages',{expectedVersion:settings.version,stages:[{key:'utilities',name:'水电',visitReminder:false,visitReason:'',watchPoints:''},
      {key:'waterproofing',name:'防水',visitReminder:false,visitReason:'',watchPoints:''}]},randomUUID());
    const projectId=previous?.fixture!.projectId?String(previous.fixture!.projectId):String((await construction.execute('create',{leadId,name:'合成单一手册核对工地',managerId:aid,rooms:['主卫','厨房']},randomUUID())).id);
    if(!previous?.fixture!.projectId){const detail=await construction.execute('detail',{projectId});await construction.execute('progress',{projectId,expectedVersion:(detail.project as Row).version,
      stageKey:'waterproofing',note:'仅合成测试：防水阶段，未记录验收结论',sendReminder:false},randomUUID());}
    report.fixture={...report.fixture,leadId,projectId};save();
    const rooms=await withTenantTransaction(eid,tx=>rows(tx,sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${projectId}`));
    const observations=[
      {room:'主卫',title:'合成主卫防水观察',completed:`今天主卫防水涂刷已完成，现场抽测淋浴区涂刷高度${observed.shower}mm，台盆柜区域${observed.basin}mm。`,
        pending:'尚未进行蓄水试验，施工完成时间、保养时长及验收结果均未核实。',coordination:'需负责人复核防水范围、测量位置和试验安排。'},
      {room:'厨房',title:'合成厨房管线观察',completed:`厨房强弱电管线已布置，现场记录平行间距${observed.spacing}mm，局部同槽并共用线盒，交叉处仅见一小段屏蔽包裹。`,
        pending:'交叉屏蔽两侧延伸长度未量测，整改和验收均未完成。',coordination:'需负责人核对布线和隐蔽工程资料。'},
    ];
    for(const observation of observations){
      const roomId=String(rooms.find(r=>r.name===observation.room)!.id),note='合成开发测试观察，不是真实工地报告，不代表已验收。';
      const existing=report.records.find(r=>r.room===observation.room);
      if(existing){const current=await withTenantTransaction(eid,tx=>one(tx,sql`select room_id,status,data from app.construction_site_records where enterprise_id=${eid} and project_id=${projectId} and id=${String(existing.recordId)}`));
        assert.equal(current?.status,'published');assert.equal(String(current.room_id),roomId);assert.deepEqual(current.data,existing.data);continue;}
      const sent=await site.send(projectId,{text:[observation.room,observation.completed,observation.pending,observation.coordination,note].join(' '),mediaIds:[]},randomUUID());
      assert.ok(sent.recordId,'Expected actual site-record workflow');const recordId=String(sent.recordId);
      // The optional fixture mode uses the existing authorized edit-during-
      // generation path. It never coerces/accepts a provider draft or scores
      // site generation as passed; edit cancels that record's queued work.
      const currentRecord = () => withTenantTransaction(eid,tx=>one(tx,sql`select status,version,run_id from app.construction_site_records where enterprise_id=${eid} and id=${recordId}`));
      const draft=manualSiteFixtures ? await currentRecord() : await wait(async()=>{const record=await currentRecord();
        if(record?.status==='draft')return record;if(record?.run_id){const run=await withTenantTransaction(eid,tx=>one(tx,sql`select status,error_code from app.assistant_runs where enterprise_id=${eid} and id=${String(record.run_id)}`));if(run&&['failed','cancelled','indeterminate'].includes(String(run.status)))throw Error(JSON.stringify(run));}return null;},'real site draft '+recordId);
      assert.ok(draft);
      const data={title:observation.title,roomId,completed:observation.completed,pending:observation.pending,coordination:observation.coordination,note};
      const edited=await site.mutate(projectId,recordId,'edit',{expectedVersion:Number(draft.version),data},randomUUID());
      await site.mutate(projectId,recordId,'publish',{expectedVersion:Number(edited.version),audience:'customer'},randomUUID());
      report.records.push({recordId,roomId,room:observation.room,data,siteFixtureMode});save();
    }
    check('real service-created project/stage and two explicitly reviewed published synthetic observations; no additional knowledge documents');
    const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:leadId}};
    const questions=[
      {name:'waterproof-heights',page:6,question:'我家主卫地方小，工人说防水刷低一点也够。请结合已经发布的主卫现场记录和这份施工工艺标准2.0，解释淋浴区、台盆柜的现状与手册要求有什么差别，接下来先核对什么。请自然解释，不要只抄条文，也不要把这份参考手册说成我们已采纳的合同标准。',required:[new RegExp(observed.shower),new RegExp(observed.basin),/1800/,/1200/,/主卫|淋浴/,/核对|复核|确认/]},
      {name:'water-test-followup',page:6,question:'那主卫今晚直接蓄水、明早就贴砖行不行？结合我家现有记录和手册，说明为什么，并说清保养时长、蓄水深度和时长、楼下检查及漏水处理这些条件。不要把施工阶段或涂刷完成当成验收通过。',required:[/48\s*小时/,/24\s*小时/,/20\s*(?:mm|毫米)/i,/漏|渗/,/停止|停下/,/核对|确认|不足|不能/]},
      {name:'kitchen-electrical',page:3,question:'厨房那条已发布的管线记录也让我担心。请结合记录和这份手册，解释平行间距、同槽共盒和交叉屏蔽分别有什么问题、该让负责人核对什么。不要只贴原文，不要声称你已安排返工或验收。',required:[new RegExp(observed.spacing+'\\s*(?:mm|毫米)','i'),/300\s*(?:mm|毫米)/i,/150\s*(?:mm|毫米)/i,/同槽/,/线盒/,/核对|复核|确认/]},
    ];
    for(let round=1;round<=2;round++){
      const cid=String((await new ConversationService(actor).create(randomUUID())).id);report.conversationIds.push(cid);save();
      for(const question of questions.filter(q=>selectedCaseNames.includes(q.name))){
        let entry:RunRecord|undefined;
        try{
        assert.deepEqual(codeHashes(),report.codeHashes,'Agent source changed; do not mix versions within an acceptance batch');
        const key=randomUUID(),started=Date.now(),sent=await request(`miniprogram/assistant/conversations/${cid}/messages`,'POST',
          {clientMessageId:key,content:{version:1,blocks:[{type:'text',text:question.question}]}},202,customerToken,key);
        const runId=String(sent.runId),run=await wait(async()=>{const value=await withTenantTransaction(eid,tx=>one(tx,sql`select id,status,error_code,output_message_id from app.assistant_runs where enterprise_id=${eid} and conversation_id=${cid} and id=${runId}`));return value&&!['queued','running'].includes(String(value.status))?value:null;},'real Agent '+runId);
        const steps=await withTenantTransaction(eid,tx=>rows(tx,sql`select step_seq,kind,status,capability_name,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
        const usage=await withTenantTransaction(eid,tx=>rows(tx,sql`select category,quantity,measurement_kind,input_tokens,output_tokens,cost_micros from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId}`));
        const messages=await request(`miniprogram/assistant/conversations/${cid}/messages`,'GET',undefined,200,customerToken);
        const message=messages.items.find((m:Message)=>m.id===String(run.output_message_id)) as Message|undefined;
        entry={name:question.name,round,conversationId:cid,runId,elapsedMs:Date.now()-started,status:run.status,error:run.error_code,outputMessageId:String(run.output_message_id),message,steps,usage,sources:[]};report.runs.push(entry);save();
        entry.validationFailureCount=steps.filter(s=>s.kind==='agent_validation').length;
        entry.repairCount=entry.validationFailureCount; // Legacy report field; failed final validation is not another repair attempt.
        entry.repairAttempts=Number((steps.find(s=>s.kind==='agent_checkpoint')?.private_checkpoint as Row)?.validationRepairs||0);
        entry.firstDraftError=steps.find(s=>s.kind==='agent_validation')?.input_summary||run.error_code;
        const first=steps.find(s=>s.kind==='agent_model'&&s.status==='succeeded'&&typeof (s.private_checkpoint as Row)?.text==='string'
          &&(s.private_checkpoint as Row).text&&!((s.private_checkpoint as Row).toolCalls as unknown[]|undefined)?.length);
        if(first){
          try{const draft=JSON.parse((first.private_checkpoint as Row).text as string);entry.firstDraftKind=draft.kind;
            if(Array.isArray(draft.segments)){entry.firstDraftText=draft.segments.map((s:{text?:string})=>s.text||'').join('\n');
              const citations=draft.segments.flatMap((s:{citations?:Record<string,unknown>[]})=>s.citations||[]);
              entry.firstDraftCatalog=citations.length>0&&citations.every((c:Record<string,unknown>)=>Object.keys(c).length===1&&typeof c.citationId==='string');}
          }catch{/* Invalid first drafts stay failures, not silently repaired by this harness. */}
        }
        entry.firstDraftPassed=false;save();
        for (const step of steps.filter(s => s.kind === 'agent_model' && (s.input_summary as Row)?.purpose === 'answer')) {
          const runtime = step.input_summary as Row;
          assert.equal(runtime.promptVersion, agentPromptVersion, 'Running HTTP Worker must use this source version');
          assert.equal(runtime.readProtocol, agentReadProtocol);
          assert.equal(runtime.finalProtocol, agentSourceFinalProtocol);
          if (runtime.repairProtocol === 'synthesis-edit-v1') assert.equal(runtime.repairProjection, synthesisRepairProjectionVersion);
        }
        assert.equal(run.status,'succeeded',JSON.stringify({runId,error:run.error_code}));assert.ok(message?.available);
        entry.text=safeText(message.content);for(const citation of message.citations)entry.sources.push(await request('miniprogram/assistant/citations/'+citation.id,'GET',undefined,200,customerToken));
        const synthesis=steps.find(s=>s.kind==='agent_synthesis_context');assert.ok(synthesis,'Expected original customer Agent natural synthesis, not Admin excerpts');
        const context=synthesis.source_refs as SynthesisContext,answer=synthesis.private_checkpoint as SynthesisAnswer;entry.answer=answer;save();
        const finalModel=steps.filter(s=>s.kind==='agent_model'&&s.status==='succeeded').at(-1)?.private_checkpoint as {text?:string}|undefined;
        if(finalModel?.text){const selected=JSON.parse(finalModel.text);entry.fullSourceSelections=(selected.segments||[]).flatMap((s:{citations?:Array<{quoteFromSource?:boolean}>})=>s.citations||[]).filter((c:{quoteFromSource?:boolean})=>c.quoteFromSource===true).length;}
        assert.equal(answer.kind,'synthesis');assert.ok(context.knowledge.length);
        assert.ok(context.knowledge.every(k=>k.ref.version===versionId&&k.file?.sourceHash===sourceHash),'No second manual, FAQ or test policy may enter any consulted knowledge');
        assert.ok(context.snapshots.some(s=>s.query.domain==='construction'));assert.ok(context.snapshots.some(s=>s.query.domain==='materials'));
        const used=new Set(answer.segments.flatMap(s=>s.citations.map(c=>c.sourceId)));
        assert.ok(context.sources.some(s=>s.kind==='project'&&used.has(s.sourceId)),'Actual authorized project record must inform explanation');
        assert.ok(context.sources.some(s=>s.kind==='knowledge'&&used.has(s.sourceId)),'Manual must inform explanation');
        assert.ok(answer.segments.some(s=>s.basis==='evidence'&&!context.sources.some(source=>source.text.includes(s.text.trim()))),'Answer must explain, not just select an original excerpt');
        assert.ok(entry.sources.some(s=>s.available&&s.version===versionId&&(s.sourceFile as Row)?.page===question.page));
        for(const pattern of question.required)assert.match(entry.text,pattern);
        assert.doesNotMatch(entry.text,/(?:我已|我已经|已为你|已经为你)(?:安排|通知|联系|验收|返工)|(?:你家|主卫|厨房)(?:已经|已)(?:验收合格|验收通过)/);
        entry.fixedChecksPassed=true;
        entry.firstDraftPassed=entry.repairCount===0&&entry.firstDraftKind==='synthesis'&&entry.firstDraftCatalog===true
          &&question.required.every(pattern=>pattern.test(entry!.firstDraftText||''));save();
        }catch(error){
          const detail=(error as Error).message;
          // Collect known case failures so one imperfect answer cannot suppress
          // the other scenarios. Never continue after scope/auth/unknown calls.
          const knownModelFailures=['unsupported_model_commitment','invalid_model_citation','ungrounded_response_scope','agent_input_limit','invalid_model_answer','agent_iteration_limit'];
          if(!entry||String(entry.status)==='indeterminate'||(entry.status!=='succeeded'&&!knownModelFailures.includes(String(entry.error)))
            ||detail.includes('No second manual'))throw error;
          entry.caseFailure=detail;save();
        }
      }
    }
    check('two separate three-turn conversations executed; per-case successes and failures retained without substituting Admin excerpts');
    for(const cid of report.conversationIds){const history=await request(`miniprogram/assistant/conversations/${cid}/messages`,'GET',undefined,200,customerToken);
      assert.ok(report.runs.filter(r=>r.conversationId===cid&&r.message?.available).every(r=>history.items.some((m:Message)=>m.id===r.outputMessageId&&m.available)));}
    report.readyForIsolation=true;save();await isolationBarrier('retire');
    await admin(base+'/retire','POST',{expectedVersion:Number((await admin(base)).document.version)});
    for(const cid of report.conversationIds){const history=await request(`miniprogram/assistant/conversations/${cid}/messages`,'GET',undefined,200,customerToken);
      assert.ok(report.runs.filter(r=>r.conversationId===cid&&r.message?.available).every(r=>history.items.some((m:Message)=>m.id===r.outputMessageId&&!m.available)));}
    const effects=await withTenantTransaction(eid,tx=>rows(tx,sql`select type from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.%issue.%'`));assert.equal(effects.length,0);
    check('persisted reentry, manual withdrawal invalidates all delivered dependent natural answers; ordinary explanations create no handling/acceptance effects');
    report.retiredForIsolation=true;save();await isolationBarrier('cleanup');
    report.codeHashesAfter=codeHashes();assert.deepEqual(report.codeHashesAfter,report.codeHashes,'Agent source changed during the acceptance batch');
    check('all Agent source hashes remain unchanged for the complete configured-model batch');
    report.passed=manualBatchComplete(report.runs,caseSet,requireFirstDraft);
    if(!report.passed){report.error=`Delivered fixed checks ${report.runs.filter(r=>r.fixedChecksPassed).length}/${expectedRuns}; first drafts ${report.runs.filter(r=>r.firstDraftPassed).length}/${expectedRuns}; all failures retained`;process.exitCode=1;}
  }finally{
    if(eid)await withPlatformTransaction(async tx=>{
      // The test copy must never remain customer-readable, even after a failed model/test.
      const doc=documentId?await one(tx,sql`select id,version,status from app.assistant_knowledge_documents where enterprise_id=${eid} and id=${documentId}`):null;
      if(doc&&doc.status!=='retired'){
        const {KnowledgeService}=await import('@/lib/assistant/knowledge/service');
        await new KnowledgeService({enterpriseId:eid,adminId:aid}).execute('retire',{documentId,expectedVersion:Number(doc.version)},randomUUID());
      }
      await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);
      await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);
      if(uid)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${uid}`);
      report.finalState=await one(tx,sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_test_staff,
        (select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs,
        (select count(*) from app.assistant_jobs where enterprise_id=${eid} and status in ('queued','running')) active_jobs,
        (select count(*) from app.assistant_jobs where enterprise_id=${eid} and status='indeterminate') unknown_jobs,
        (select count(*) from app.assistant_knowledge_documents where enterprise_id=${eid}) knowledge_documents,
        (select count(*) from app.assistant_knowledge_documents where enterprise_id=${eid} and status='active' and audience='customer_public') active_customer_documents`);
    });
    report.codeHashesAfter=codeHashes();
    if(JSON.stringify(report.codeHashesAfter)!==JSON.stringify(report.codeHashes)){report.passed=false;report.error='Agent source changed during acceptance/cleanup';process.exitCode=1;}
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(error=>{report.error=(error as Error).message;if(fs.existsSync(output))save();console.error((error as Error).message);process.exitCode=1;});
