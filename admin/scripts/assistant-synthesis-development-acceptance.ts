/** Explicit development-only live model/HTTP/Worker/database acceptance. No credentials are persisted. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { safeText, type ActorContext } from '@/lib/assistant/contracts';
import { synthesisCases, synthesisPolicies } from './assistant-synthesis-cases';
import { agentPromptVersion } from '@/lib/assistant/agent/context';
import { professionalEntry, professionalCases, professionalMaterialPolicy } from './assistant-professional-cases';

const professionalMode=process.argv.includes('--professional');
const output = path.resolve(professionalMode?'../tmp/xiaok-kb1':'../tmp/xiaok-synthesis'), delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function wait<T>(work: () => Promise<T | null | false>, label: string): Promise<T> {
  for (let i = 0; i < 240; i++) { const result = await work(); if (result) return result; await delay(500); }
  throw Error('Timeout: ' + label);
}
async function main() {
  loadEnvConfig(process.cwd(), true);
  const [{ ConversationService, appendMessage }, { KnowledgeService }, { ConstructionService }, { SiteChatService }, { signMiniProgramToken }, { applyNeedDelta }] = await Promise.all([
    import('@/lib/assistant/core/conversation'), import('@/lib/assistant/knowledge/service'), import('@/lib/construction/service'), import('@/lib/construction/site-chat'),
    import('@/lib/miniprogram-jwt'), import('@/lib/assistant/agent/memory'),
  ]);
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
  fs.mkdirSync(output, { recursive: true });
  const prefix = 'synthetic-synthesis-live-' + randomUUID(), native = process.argv.includes('--native');
  const report: Row = { prefix, started: new Date().toISOString(), promptVersion: agentPromptVersion, model: 'configured existing DeepSeek/deepseek-flash',
    reality: { model: 'real', retrieval: 'real existing embedding service', database: 'approved development', http: 'real localhost:3006', worker: 'existing real Worker',
      fixtures: 'clearly labelled synthetic enterprise/users/projects/policies/formal graph/records', photos: 'synthetic JPEG, no image pixels sent to current model' },
    criteria: professionalMode?{...synthesisCases,...professionalCases}:synthesisCases, checks: [], runs: [], passed: false };
  const save = () => fs.writeFileSync(path.join(output, native ? 'native-driver.json' : 'live.json'), JSON.stringify(report, null, 2));
  let eid = '', aid = '';
  const customers: Array<{ uid: string; leadId: string; projectId: string; planId: string; cid: string; token: string; recordId: string; stage: string }> = [];
  let knowledge: InstanceType<typeof KnowledgeService>;
  const request = async (c: typeof customers[number], suffix: string, method = 'GET', body?: unknown) => {
    const key = randomUUID(), sending = suffix === '/messages' && method === 'POST';
    const response = await fetch('http://localhost:3006/api/miniprogram/assistant/conversations/' + c.cid + suffix, { method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.token, 'Idempotency-Key': key },
      ...(body ? { body: JSON.stringify(sending ? { clientMessageId: key, content: { version: 1, blocks: [{ type: 'text', text: body }] } } : body) } : {}), signal: AbortSignal.timeout(60000) });
    const result = await response.json(); assert.equal(response.status, sending ? 202 : 200, JSON.stringify(result)); return result.data;
  };
  const publish = async (title: string, body: string, audience = 'customer_public',professional?:Row) => {
    const d = await knowledge.execute('create', { title, body, audience, sourceType: 'manual_text',...(professional?{professional}:{}) }, randomUUID());
    const input = { documentId: String((d.document as Row).id), versionId: String((d.draft as Row).id), expectedVersion: 1, expectedEditVersion: 1 };
    const j = await knowledge.execute('index', input, randomUUID());
    await wait(async () => { const r = await knowledge.execute('job', { jobId: j.jobId }); if (['failed','indeterminate'].includes(String(r.status))) throw Error(JSON.stringify(r)); return r.status === 'succeeded' ? r : null; }, 'real knowledge index');
    await knowledge.execute('publish', input, randomUUID()); return input;
  };
  const audit = async (c: typeof customers[number], runId: string, caseName: keyof typeof synthesisCases|'material', round: number, started: number) => {
    const run = await wait(async () => {
      const r = await withTenantTransaction(eid, tx => one(tx, sql`select id,status,error_code,output_message_id from app.assistant_runs where enterprise_id=${eid} and id=${runId} and conversation_id=${c.cid}`));
      return r && !['queued','running'].includes(String(r.status)) ? r : null;
    }, 'actual model completion');
    const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select step_seq,kind,status,capability_name,input_summary,source_refs,private_checkpoint from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
    const usage = await withTenantTransaction(eid, tx => rows(tx, sql`select category,measurement_kind,quantity,input_tokens,output_tokens,cost_micros from app.assistant_usage_records where enterprise_id=${eid} and run_id=${runId} order by id`));
    const messages = await request(c, '/messages');
    const message = messages.items.find((m: Row) => String(m.id) === String(run.output_message_id));
    const entry: Row = { runId, caseName, round, stage: c.stage, projectId: c.projectId, conversationId: c.cid, elapsedMs: Date.now() - started,
      status: run.status, error: run.error_code, outputMessageId: String(run.output_message_id), message, steps, usage, cost: null };
    (report.runs as Row[]).push(entry); save();
    assert.equal(run.status, 'succeeded', JSON.stringify({runId,status:run.status,error:run.error_code}));
    const synthesis = steps.find(s => s.kind === 'agent_synthesis_context'); assert.ok(synthesis, 'Expected real synthesis, not displayText/excerpt fallback');
    assert.equal(message?.available, true); const text = safeText(message.content);
    assert.doesNotMatch(text, /PRIVATE_SYNTHESIS_DO_NOT_SEND/);
    assert.doesNotMatch(text,/INTERNAL_KB_REVIEW_NOTE/);
    const ctx = synthesis.source_refs as { knowledge: unknown[]; snapshots: Array<{ query: { domain: string }; data: unknown }> };
    assert.ok(ctx.knowledge.length, 'Expected real published enterprise knowledge');
    assert.ok(message.citations.length, 'Expected usable knowledge citations');
    if(professionalMode){
      assert.ok((ctx.knowledge as Row[]).some(e=>e.professional),'Expected structured professional entry in real model evidence');assert.ok(steps.some(s=>s.capability_name==='knowledge.search.v1'&&(s.input_summary as Row)?.diagnostic),'Expected actual shared retrieval diagnostic');
      const documents=report.documents as Row,required=caseName==='stage'?[documents.stage]:caseName==='material'?[documents.material]:caseName==='conflict'?[documents.office,report.conflict]:[documents.office];
      for(const document of required as Row[]){assert.ok((ctx.knowledge as Row[]).some(e=>String((e.ref as Row).version)===String(document.versionId)),'Required published source must reach synthesis');assert.ok(message.citations.some((c:Row)=>String(c.version)===String(document.versionId)),'Required source must support actual answer citations');}
    }
    if (caseName === 'office') {
      assert.match(text, /眩光|反光|强光/); assert.match(text, /两人|双人/); assert.match(text, /底盒|点位/);
      assert.ok(ctx.snapshots.some(s => s.query.domain === 'materials'));
      assert.match(JSON.stringify(ctx.snapshots), /formal_floorplan/); assert.match(JSON.stringify(ctx.snapshots), /site_record/);
    } else if (caseName === 'followup') {
      assert.match(text, /屏幕|显示器/); assert.match(text, /反光|眩光|强光/);
      assert.ok(ctx.snapshots.some(s => s.query.domain === 'materials'), 'Follow-ups must refresh current home evidence');
      assert.ok(steps.some(s => s.capability_name === 'synthesis.bound_materials.v1'), 'Server refresh is durable even if the model only searched knowledge');
    }
    else if (caseName === 'stage') { assert.match(text, new RegExp(c.stage === 'utilities' ? '水电' : '防水')); assert.match(text, /检查|闭水/); assert.ok(ctx.snapshots.some(s => s.query.domain === 'construction')); }
    else if (caseName === 'conflict') {
      assert.match(text, /不一致|冲突|矛盾|两份|不同说法/);
      assert.equal((synthesis.private_checkpoint as {segments:Array<{basis:string}>}).segments[0].basis,'uncertainty');
    } else if(caseName==='material') {
      assert.match(text,/地暖/);assert.match(text,/型号|材料/);assert.match(text,/核对|确认|未知|不能直接/);
      assert.ok((ctx.knowledge as Row[]).some(e=>((e.professional as Row)?.applicability as Row)?.status==='unknown'),'Unknown material condition must remain unknown');
    } else {
      assert.match(text, /点位图/); assert.match(text, /缺|待|不能|核对/);
      const first=(synthesis.private_checkpoint as {segments:Array<{text:string}>}).segments[0].text;
      assert.match(first,/底盒|点位|户型/);assert.doesNotMatch(first,/先回答屏幕/);
    }
    const generated = (synthesis.private_checkpoint as { segments: Array<{ text: string }> }).segments.map(s => s.text).join('\n');
    assert.ok(!(synthesis.source_refs as { sources: Array<{ text: string }> }).sources.some(s => s.text === generated), 'Explanation must exceed source selection');
    entry.semanticAssertions = 'passed fixed points; prose also retained for independent review'; save(); return entry;
  };
  try {
    await withPlatformTransaction(async tx => {
      const template = await one(tx, sql`select s.agent_config,e.code from app.assistant_enterprise_settings s join app.enterprises e on e.id=s.enterprise_id where s.enterprise_id=2404`);
      assert.ok(template && String(template.code).startsWith('p4b-development-'));
      const config = template.agent_config as Row; assert.equal(config.providerKey,'deepseek'); assert.equal(config.model,'deepseek-flash'); assert.equal(config.runtime,'langgraph-v1');
      eid = String((await one(tx, sql`insert into app.enterprises(name,code,status) values('测试专用 · 小K综合问答',${prefix},'active') returning id`))!.id);
      aid = String((await one(tx, sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password,display_name)
        values(${eid},${prefix},${'unusable:'+randomUUID()},'enterprise_admin','active',ARRAY['assistant-knowledge'],false,'合成综合问答负责人') returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days,agent_config)
        values(${eid},true,200,12000000,1000000000,30,${JSON.stringify({...config,imageInput:false})}::jsonb)`);
    });
    report.fixture = { enterpriseId: eid, ownerId: aid }; save(); knowledge = new KnowledgeService({enterpriseId:eid,adminId:aid});
    report.documents = { office:await publish('合成企业办公规则',synthesisPolicies.office,'customer_public',professionalMode?professionalEntry({kind:'explanation',topics:['书房','办公桌','显示器','眩光'],conditions:[{field:'room',operator:'in',values:['书房']}],claim:{key:'书房屏幕朝向',value:'避免正对强光，比较侧向'}}):undefined),
      stage:await publish('合成企业铺砖前提',synthesisPolicies.stage,'customer_public',professionalMode?professionalEntry({topics:['铺贴','瓷砖','防水','水电'],conditions:[{field:'stage',operator:'in',values:['utilities','waterproofing']}]}):undefined),
      private:await publish('合成内部不可信资料',synthesisPolicies.private,'staff_internal') };
    if(professionalMode){(report.documents as Row).material=await publish('合成地暖型粘结材料适用说明',professionalMaterialPolicy,'customer_public',professionalEntry({kind:'material',topics:['地暖型粘结材料','地砖','瓷砖铺贴'],conditions:[{field:'material',operator:'in',values:['地暖型粘结材料']}]}));
      (report.documents as Row).waterproofOnly=await publish('合成防水节点检查安排','本条仅说明防水阶段的施工和闭水检查安排，水电阶段不适用本条作为当前施工指令。进入防水节点仍不证明施工或检查完成。','customer_public',professionalEntry({conditions:[{field:'stage',operator:'in',values:['waterproofing']}]}));} save();
    const service = new ConstructionService({enterpriseId:eid,adminId:aid}), site = new SiteChatService(service.actor);
    const settings = await service.execute('stages');
    await service.execute('saveStages',{expectedVersion:settings.version,stages:[{key:'utilities',name:'水电',visitReminder:false,visitReason:'',watchPoints:''},{key:'waterproofing',name:'防水',visitReminder:false,visitReason:'',watchPoints:''}]},randomUUID());
    for (const stage of ['utilities','waterproofing']) {
      const uid = await withPlatformTransaction(async tx=>{const u=String((await one(tx,sql`insert into app.users(nickname,context_version) values('合成综合问答业主',1) returning id`))!.id);await tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${u},${prefix+u})`);return u;});
      const layout={version:4,measurementMode:'surveying',surveyGraph:{kind:'survey-wall-graph',activeFloorId:'f',floors:[{id:'f',name:'一层',ceilingHeightMm:2800,nodes:[{id:'a',xMm:0,yMm:0},{id:'b',xMm:4000,yMm:0},{id:'c',xMm:4000,yMm:3000},{id:'d',xMm:0,yMm:3000}],walls:[{id:'ab',startNodeId:'a',endNodeId:'b'},{id:'bc',startNodeId:'b',endNodeId:'c'},{id:'cd',startNodeId:'c',endNodeId:'d'},{id:'da',startNodeId:'d',endNodeId:'a'}],openings:[],spaces:[{id:'study',name:'书房',closed:true,wallIds:['ab','bc','cd','da']}]}]}};
      const {leadId,planId}=await withTenantTransaction(eid,async tx=>{const l=String((await one(tx,sql`insert into app.leads(enterprise_id,customer_user_id,name,phone,source,community_name) values(${eid},${uid},'合成综合问答客户','13800000000','natural',${'合成'+stage+'之家'}) returning id`))!.id);const p=String((await one(tx,sql`insert into app.floor_plans(enterprise_id,creator_id,name,source,status,layout_data) values(${eid},${uid},'合成书房正式户型','manual','completed',${JSON.stringify(layout)}::jsonb) returning id`))!.id);await tx.execute(sql`update app.leads set primary_floor_plan_id=${p} where enterprise_id=${eid} and id=${l}`);return{leadId:l,planId:p};});
      const actor: ActorContext={enterpriseId:eid,principal:{kind:'user',userId:uid},contextVersion:1,capabilities:['assistant.chat.self'],entry:{kind:'lead',id:leadId}};
      const chat=new ConversationService(actor),cid=String((await chat.create(randomUUID())).id);
      await withTenantTransaction(eid,async tx=>{const text='书房靠窗，偶尔两人办公，需要电脑和台灯。',m=await appendMessage(tx,actor,cid,{author:'user',clientMessageId:randomUUID(),content:{version:1,blocks:[{type:'text',text}]}});const memory=applyNeedDelta({version:0,facts:[]},{room:'书房',field:'desk',value:'靠窗，偶尔两人办公',quote:text,sourceMessageId:String(m.id),expectedVersion:0},{id:String(m.id),text},'fixture:'+randomUUID(),new Date().toISOString());await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify(memory)}::jsonb) where enterprise_id=${eid} and id=${cid}`);});
      const projectId=String((await service.execute('create',{leadId,name:'合成'+stage+'问答工地',managerId:aid,rooms:['书房']},randomUUID())).id),detail=await service.execute('detail',{projectId});
      await service.execute('progress',{projectId,expectedVersion:(detail.project as Row).version,stageKey:stage,note:'合成场景，检查结果待核对',sendReminder:false},randomUUID());
      const photo=await sharp({create:{width:40,height:32,channels:3,background:'#b9c4b4'}}).jpeg().toBuffer(),media=await site.upload(projectId,randomUUID(),photo);
      const original=await site.send(projectId,{text:'书房线管今天铺好了，底盒还没固定，等设计师核对位置。',mediaIds:[String(media.id)]},randomUUID()),recordId=String(original.recordId);
      const record=await wait(async()=>{const r=await withTenantTransaction(eid,tx=>one(tx,sql`select * from app.construction_site_records where enterprise_id=${eid} and id=${recordId}`));return r?.status==='draft'?r:null;},'configured real site-draft model');
      await site.mutate(projectId,recordId,'publish',{expectedVersion:Number(record.version),audience:'customer'},randomUUID());
      const token=await signMiniProgramToken({sub:uid,id:uid,mode:'customer',role:'user',contextVersion:1,source:'wechat'});
      customers.push({uid,leadId,planId,cid,token,projectId,recordId,stage});
      report.customers=customers.map(c=>({uid:c.uid,leadId:c.leadId,projectId:c.projectId,planId:c.planId,cid:c.cid,recordId:c.recordId,stage:c.stage})); save();
    }
    const execute = async (c: typeof customers[number], name: keyof typeof synthesisCases|'material', round: number) => {
      const started=Date.now(),sent=await request(c,'/messages','POST',name==='material'?professionalCases.material.question:synthesisCases[name].question);return audit(c,String(sent.runId),name,round,started);
    };
    if (native) {
      const {run}=await import('./assistant-synthesis-native.mjs');
      report.native=await run({root:path.resolve('..'),output,customer:{...customers[0],enterpriseId:eid},
        question:synthesisCases.office.question,followup:synthesisCases.followup.question,withdrawLabel:professionalMode?'withdrawn professional knowledge invalidates dependent explanation on actual native reentry':undefined,audit:(id:string,name:'office'|'followup',started:number)=>audit(customers[0],id,name,1,started),
        withdraw:async()=>{if(professionalMode){await knowledge.execute('retire',{documentId:((report.documents as Row).office as Row).documentId,expectedVersion:2},randomUUID());return;}const r=(await withTenantTransaction(eid,tx=>one(tx,sql`select version from app.construction_site_records where enterprise_id=${eid} and id=${customers[0].recordId}`)))!;await site.mutate(customers[0].projectId,customers[0].recordId,'withdraw',{expectedVersion:Number(r.version),reason:'合成自动验收撤回'},randomUUID());}}); save();
    } else {
      for(let round=1;round<=2;round++){await execute(customers[0],'office',round);await execute(customers[0],'followup',round);for(const c of customers)await execute(c,'stage',round);}
      if(professionalMode)for(let round=1;round<=2;round++)await execute(customers[0],'material',round);
      const conflict=await publish('合成规则冲突待核实',professionalMode?'书房办公屏幕必须正对强光窗户，不采用侧向布置。':synthesisPolicies.conflict,'customer_public',professionalMode?professionalEntry({kind:'explanation',topics:['书房','屏幕','窗户'],conditions:[{field:'room',operator:'in',values:['书房']}],claim:{key:'书房屏幕朝向',value:'必须正对强光，不采用侧向'}}):undefined);report.conflict=conflict;save();
      for(let round=1;round<=2;round++)await execute(customers[0],'conflict',round);
      await knowledge.execute('retire',{documentId:conflict.documentId,expectedVersion:2},randomUUID());
      for(let round=1;round<=2;round++)await execute(customers[0],'missing',round);
      const old=(report.runs as Row[]).filter(r=>r.caseName==='conflict').map(r=>r.outputMessageId);
      const reread=await request(customers[0],'/messages');assert.ok(old.every(id=>reread.items.find((m:Row)=>m.id===id)?.available===false));
      (report.checks as Row[]).push({name:'withdrawn consulted conflict hides derived answers on authenticated HTTP reentry',passed:true});
    }
    const operations=await withTenantTransaction(eid,tx=>rows(tx,sql`select type,count(*)::int n from app.domain_event_outbox where enterprise_id=${eid} and type like 'construction.%issue.%' group by type`));
    assert.equal(operations.length,0);report.noHandlingSideEffects=true;report.passed=true;
  } finally {
    if(eid)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);for(const c of customers)await tx.execute(sql`update app.users set context_version=context_version+1 where id=${c.uid}`);report.finalState=await one(tx,sql`select (select count(*) from app.admin_users where enterprise_id=${eid} and status='active') active_staff,(select count(*) from app.assistant_runs where enterprise_id=${eid} and status in ('queued','running')) active_runs`);});
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
