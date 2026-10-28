/* Isolated, fixed four-call D3 acceptance. The first request is entered through
 * the actual Admin UI; remaining independent repetitions use the same service.
 * No automatic model retries, fallback, or changes to the active3006 server. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import cp from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { deleteAssistantData } from '@/db/repositories/assistant-cleanup';
import { deletePortfolioData } from '@/db/repositories/portfolio-cleanup';
import { closePostgresPool } from '@/lib/postgresql';
import { getPlatformLlmOverrideRuntime } from '@/lib/platform-llm-config';
import { executeAgentChat, parseAgentUsage } from '@/lib/ai/providers/agent-chat';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCopyService, type CopyPorts } from '@/lib/portfolio/copy-service';
import { fingerprint } from '@/lib/assistant/contracts';
import { reviewBudget, type RetainedReviewHold } from './assistant-review-budget';
import { bindBailianReviewTestRuntime } from './bailian-review-test-runtime';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

const root = path.resolve(process.cwd(), '..'); loadEnvConfig(process.cwd(), true);
const isolated = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8').replace(/^\uFEFF/, ''));
process.env.DATABASE_URL = isolated.DATABASE_URL;
const now = new Date().toISOString().replace(/[:.]/g, '-'), runId = 'd3-copy-live-' + now;
const directory = path.join(root, 'tmp', runId), ledgerFile = path.join(root, 'tmp/agent-contract/trial-' + runId + '.json');
fs.mkdirSync(directory);
type Call = { id: string; runId: string; taskId: string; status: string; reservedTokens: number; usage?: { total_tokens: number } };
type Fixture = { enterpriseId: string; adminId: string; authorId: string; works: Array<{ id: string; kind: string; instruction: string }> };
const fixture: Fixture = { enterpriseId: '', adminId: '', authorId: '', works: [] };
const report = { delivery: 'D3', scope: 'Two fixed independent case-copy journeys, each twice: AI-render original, authorized external reference. First original through actual Admin input; no sampled repairs. Only synthetic public prose. Existing native human journey evidence is separate.',
  authorization: { cumulativeCapMicros: 100000000, model: 'qwen3.8-flash', fixedCalls: 4 }, calls: [] as Call[], cases: [] as Row[], fixture,
  before: {} as Record<string,string>, after: {} as Record<string,string>, drift: [] as string[], cleaned: false, runtimeRestored: false, budgetBefore: reviewBudget(root).usedMicros, budgetAfter: 0, error: null as string | null };
const hash = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');
const save = () => fs.writeFileSync(ledgerFile, JSON.stringify(report,null,2));
function sources() {
  const files: string[] = [];
  const walk = (folder: string) => { for (const item of fs.readdirSync(path.join(root,folder),{withFileTypes:true})) { const file = folder+'/'+item.name; if (item.isDirectory()) walk(file); else if (/\.(ts|tsx|js|mjs|json)$/.test(item.name)) files.push(file); } };
  for (const folder of ['admin/src/lib/portfolio','admin/src/components/portfolio','admin/src/lib/assistant','admin/src/lib/ai/providers','admin/src/db','admin/src/app/api/portfolio','admin/src/app/api/internal/assistant/jobs/run']) walk(folder);
  files.push('admin/scripts/portfolio-copy-live.ts','admin/scripts/assistant-review-budget.ts','admin/scripts/bailian-review-test-runtime.ts','admin/package-lock.json','admin/tsconfig.json','admin/next.config.ts','tmp/xiaok-vector/connection.private.json','tmp/xiaok-intelligent-consult/.env.qwen37');
  return Object.fromEntries(files.sort().map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
}
function holds(): RetainedReviewHold[] {
  return ['tmp/anythingllm-pilot','tmp/agent-comparison','tmp/agent-diagnosis','tmp/agent-contract'].flatMap(dir=>fs.readdirSync(path.join(root,dir)).filter(file=>/^trial-.*\.json$/.test(file))
    .flatMap(file=>(JSON.parse(fs.readFileSync(path.join(root,dir,file),'utf8')).calls || []).filter((c: Call)=>c.status!=='succeeded').map((c: Call)=>({id:c.id,runId:c.runId,reservedTokens:c.reservedTokens}))));
}
const retained = holds();
let release: (()=>Promise<void>) | undefined, restore: (()=>Promise<unknown>) | undefined, next: cp.ChildProcess | undefined, controller: http.Server | undefined;
let activeCall: Call | undefined, busy = false, finished = false, wire = 0;
const originalFetch = globalThis.fetch, tsconfig = fs.readFileSync(path.join(root,'admin/tsconfig.json'));
const username = 'synthetic-copy-' + randomUUID().slice(0,8), password = 'Synthetic-D3-Only-2026!';
let finishResolve: ()=>void;
const done = new Promise<void>(resolve=>{ finishResolve=resolve; });
process.once('SIGINT',()=>finishResolve());process.once('SIGTERM',()=>finishResolve());
async function processPrepared() {
  assert.ok(!busy); busy = true;
  try {
    const tasks = await withTenantTransaction(fixture.enterpriseId,tx=>rows(tx,sql`select id,request from app.assistant_model_tasks where enterprise_id=${fixture.enterpriseId}
      and created_by=${fixture.adminId} and kind='portfolio_copy' and state='prepared' order by id`));
    for (const task of tasks) {
      const work = fixture.works.find(w=>w.id===(task.request as Row).workId); assert.ok(work);
      assert.ok(!report.calls.some(c=>report.cases.some(cas=>cas.taskId===c.taskId&&cas.workId===work.id)), 'One fixed attempt per work');
      const runtime = (await getPlatformLlmOverrideRuntime('chat'))!;
      const ports: CopyPorts = { runtime: async()=>runtime, beforeDispatch: async current=>{
        assert.ok(report.calls.length<4,'Fixed four-call limit');
        reviewBudget(root).assertReservation(0,16000,retained);
        assert.ok(!report.calls.some(c=>c.status!=='succeeded'),'New unknown outcome blocks further dispatch');
        activeCall={id:runId+':'+String(current.id),runId:'model-task:'+String(current.id),taskId:String(current.id),status:'reserved',reservedTokens:16000};report.calls.push(activeCall);save();
      }, generate: async (runtime,input)=>{
        try { const output=await executeAgentChat(runtime,input); if(output.usage){activeCall!.usage={total_tokens:output.usage.inputTokens+output.usage.outputTokens};activeCall!.status='succeeded';}else activeCall!.status='unknown';save();return output; }
        catch(error){activeCall!.status=activeCall!.usage?'succeeded':'unknown';save();throw error;}
      } };
      await new PortfolioCopyService({enterpriseId:fixture.enterpriseId,adminId:fixture.adminId},ports).process(String(task.id));
      const result=await new PortfolioCopyService({enterpriseId:fixture.enterpriseId,adminId:fixture.adminId}).latest(work.id);
      report.cases.push({workId:work.id,kind:work.kind,taskId:String(task.id),firstDraft:result.task});save();
    }
  } finally { busy=false; }
}
async function main() {
  try {
    release=await lockAssistantAcceptance(isolated.DATABASE_URL);
    const bound=await bindBailianReviewTestRuntime(root,ledgerFile);restore=bound.restore;
    await withPlatformTransaction(async tx=>{
      fixture.enterpriseId=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('合成验收 · D3文案',${runId},'active') returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${fixture.enterpriseId},true,30,1000000,10000000,30)`);
      const passwordHash=await bcrypt.hash(password,10);
      fixture.adminId=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${fixture.enterpriseId},${username},${passwordHash},'enterprise_admin','active',false,'合成文案审核员') returning id`))!.id);
      fixture.authorId=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,must_change_password,display_name)
        values(${fixture.enterpriseId},${username+'-author'},'SYNTHETIC-NO-LOGIN','designer','active',false,'合成设计师') returning id`))!.id);
    });
    const service=new PortfolioService({enterpriseId:fixture.enterpriseId,adminId:fixture.adminId});
    const photo=(await sharp({create:{width:640,height:400,channels:3,background:'#c8baa5'}}).jpeg().toBuffer()).toString('base64');
    for(const kind of ['designer_work','designer_work','enterprise_reference','enterprise_reference']) {
      const work=await service.execute('create',{kind,...(kind==='designer_work'?{authorId:fixture.authorId}:{}),content:{showOnProfile:kind==='designer_work'}},randomUUID());
      const upload=await service.execute('upload',{workId:String(work.id),expectedVersion:1,imageBase64:photo},randomUUID());
      await service.execute('save',{workId:String(work.id),expectedVersion:1,content:{title:'客餐厅收纳方案',description:'客餐厅的整面收纳柜用于归拢日常杂物，餐桌与厨房之间留出通行空间。此处为AI生成效果图方案，实际材料尚未确定。',primaryStyle:'原木风',cityCode:'330100',cityName:'杭州市',area:96,rooms:'三室两厅',authorRole:kind==='designer_work'?'主创设计':'授权外部参考',source:kind==='designer_work'?'合成设计师测试方案':'外部合成作者的授权参考，不是本企业原创',authorization:'仅本隔离测试展示全部合成图',showOnProfile:kind==='designer_work',images:[{assetId:String(upload.assetId),kind:'render',aiGenerated:true,showroom:false,caption:'AI生成客餐厅效果图',space:'客厅'}],coverAssetId:String(upload.assetId)}},randomUUID());
      fixture.works.push({id:String(work.id),kind,instruction:kind==='designer_work'?'帮我把这套客餐厅方案介绍得自然些，突出家里东西多时怎么收纳，也写一段方便分享的短文。':'这是别人的授权参考，不是我们做的。介绍配色和收纳的思路，语气克制一点，方便我分享给正在看风格的客户。'});
    }
    next=cp.spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','-H','127.0.0.1','-p','3112'],{cwd:process.cwd(),env:{...process.env,NEXT_DIST_DIR:'.next/d3-copy-isolated'},stdio:['ignore','pipe','pipe'],windowsHide:true});
    const stream=fs.createWriteStream(path.join(directory,'next.log'));next.stdout!.pipe(stream);next.stderr!.pipe(stream);
    for(let i=0;i<80;i++){try{const response=await originalFetch('http://localhost:3112/login');if(response.ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));if(i===79)throw Error('Isolated Next server unavailable');}
    report.before=sources();save();
    globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
      if(url.hostname!=='dashscope.aliyuncs.com')return originalFetch(input,init);
      assert.ok(activeCall && report.calls.includes(activeCall));assert.ok(++wire<=4);
      const file=path.join(directory,`wire-${wire}.json`),body=JSON.parse(String(init?.body));assert.equal(body.model,'qwen3.8-flash');
      const record:Row={caseId:activeCall.id,url:url.href,body,requestHash:fingerprint(body)};fs.writeFileSync(file,JSON.stringify(record,null,2));
      const response=await originalFetch(input,init),raw=await response.clone().text();record.status=response.status;record.responseHash=hash(raw);
      if(response.ok){record.rawResponse=raw;const usage=parseAgentUsage(JSON.parse(raw).usage);if(usage){activeCall.usage={total_tokens:usage.inputTokens+usage.outputTokens};activeCall.status='succeeded';save();}}
      else {try{record.errorCode=JSON.parse(raw).error?.code;}catch{}}
      fs.writeFileSync(file,JSON.stringify(record,null,2));return response;
    };
    controller=http.createServer(async(request,response)=>{
      try {
        const pathname=new URL(request.url!,'http://localhost').pathname;
        if(request.method==='POST'&&pathname==='/process')await processPrepared();
        else if(request.method==='POST'&&pathname==='/remaining'){
          const service=new PortfolioCopyService({enterpriseId:fixture.enterpriseId,adminId:fixture.adminId});
          for(const work of fixture.works.slice(1))await service.create(work.id,{expectedVersion:2,instruction:work.instruction},randomUUID());
          await processPrepared();
        } else if(request.method==='POST'&&pathname==='/finish'){finished=true;finishResolve();}
        else if(request.method!=='GET'||pathname!=='/status')throw Error('Unknown local test operation');
        response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({runId,directory,username,work:fixture.works[0],calls:report.calls.length,cases:report.cases,busy,finished,isolatedUrl:'http://localhost:3112'}));
      } catch(error){response.writeHead(409,{'Content-Type':'application/json'});response.end(JSON.stringify({error:error instanceof Error?error.message:'test failed'}));}
    });
    await new Promise<void>(resolve=>controller!.listen(3188,'127.0.0.1',resolve));
    console.log(JSON.stringify({ready:true,runId,directory,username,workId:fixture.works[0].id,source:report.before['admin/scripts/portfolio-copy-live.ts'],url:'http://localhost:3112/login',controller:'loopback3188'}));
    await done;
  } catch(error){report.error=error instanceof Error?error.message:'Failed';process.exitCode=1;}
  finally {
    globalThis.fetch=originalFetch;
    report.after=sources();report.drift=Object.keys(report.before).filter(file=>report.before[file]!==report.after[file]);
    if(next?.pid){cp.spawnSync('taskkill',['/PID',String(next.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});}
    controller?.close();
    try {
      if(fixture.enterpriseId){
        const dump=await withTenantTransaction(fixture.enterpriseId,async tx=>({tasks:await rows(tx,sql`select * from app.assistant_model_tasks where enterprise_id=${fixture.enterpriseId}`),items:await rows(tx,sql`select * from app.assistant_model_task_items where enterprise_id=${fixture.enterpriseId}`),attempts:await rows(tx,sql`select a.* from app.ai_provider_attempts a join app.assistant_model_task_items i on i.enterprise_id=a.enterprise_id and i.attempt_id=a.id where i.enterprise_id=${fixture.enterpriseId}`)}));fs.writeFileSync(path.join(directory,'original-tasks-and-attempts.json'),JSON.stringify(dump,null,2));
        await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${fixture.enterpriseId}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${fixture.enterpriseId}`);await deletePortfolioData(tx,BigInt(fixture.enterpriseId));await deleteAssistantData(tx,BigInt(fixture.enterpriseId));await tx.execute(sql`delete from app.admin_users where enterprise_id=${fixture.enterpriseId}`);await tx.execute(sql`delete from app.enterprises where id=${fixture.enterpriseId}`);});report.cleaned=true;
      }
    }catch(error){report.error=String(error);process.exitCode=1;}
    try{if(restore){await restore();report.runtimeRestored=true;}}catch(error){report.error=String(error);process.exitCode=1;}
    fs.writeFileSync(path.join(root,'admin/tsconfig.json'),tsconfig);await closePostgresPool();await release?.();report.budgetAfter=reviewBudget(root).usedMicros;save();
    console.log(JSON.stringify({finished,calls:report.calls.length,cases:report.cases,cleaned:report.cleaned,restored:report.runtimeRestored,drift:report.drift,budgetAfter:report.budgetAfter,error:report.error}));
  }
}
void main();
