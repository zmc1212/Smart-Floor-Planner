/** Two genuinely independent synthetic tenants, one identical user-selected PDF.
 * Reuses the real manual workflow and actual HTTP/Worker/model, not a new Agent. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { writeAcceptanceReport } from './assistant-acceptance-report.mjs';
import { manualScenarioNames } from './assistant-manual-cases.mjs';

const root=path.resolve('..'),name=process.argv.find(arg=>arg.startsWith('--evidence='))?.slice('--evidence='.length)||'xiaok-citation-protocol',directory=path.join(root,'tmp',name);
assert.match(name,/^xiaok-[a-z0-9-]{1,80}$/);
const firstDraftRequired=!process.argv.includes('--allow-bounded-repair');
const caseSet=process.argv.find(arg=>arg.startsWith('--case-set='))?.slice('--case-set='.length)||'all';
manualScenarioNames(caseSet);
const coordination='xiaok-citation-control-'+Date.now(),control=path.join(root,'tmp',coordination);
const batchId=randomUUID();
type Live={started:string;finished?:string;passed:boolean;error?:string;promptVersion:string;readyForIsolation?:boolean;retiredForIsolation?:boolean;batchId?:string;
  source:{sha256:string};fixture:{enterpriseId:string;ownerId:string;userId:string;profile:string;providerKey?:string;model?:string};document:{documentId:string;versionId:string};
  conversationIds:string[];codeHashes:Record<string,string>;codeHashesAfter?:Record<string,string>;finalState?:Record<string,string>;
  runs:Array<{runId:string;conversationId:string;status:string;fixedChecksPassed?:boolean;firstDraftPassed?:boolean;firstDraftCatalog?:boolean;repairCount?:number;
    outputMessageId:string;message?:{citations:Array<{id:string}>};caseFailure?:string}>};
const report:{started:string;finished?:string;passed:boolean;checks:Array<{name:string;passed:boolean;status?:number}>;
  children:Array<{evidence:string;profile:string;exit?:number;enterpriseId?:string}>;firstDrafts?:{passed:number;total:number};
  delivered?:{passed:number;total:number};quality:string;firstDraftRequired:boolean;error?:string;sourceHash?:string;reportHashes?:Record<string,string>}=
  {started:new Date().toISOString(),passed:false,checks:[],children:[],quality:'pending independent prose review',firstDraftRequired};
const save=()=>writeAcceptanceReport(path.join(directory, 'evaluation.json'), report);
const live=(evidence:string):Live=>JSON.parse(fs.readFileSync(path.join(root,'tmp',evidence,'live.json'),'utf8'));
const signal=(evidence:string,phase:'retire'|'cleanup')=>fs.writeFileSync(path.join(control,`${evidence}-${phase}.json`),'{}');
async function waitFor<T>(check:()=>T|false,label:string,timeout=1200000):Promise<T>{
  const deadline=Date.now()+timeout;while(Date.now()<deadline){const found=check();if(found)return found;await new Promise(r=>setTimeout(r,500));}
  throw Error('Timeout '+label);
}
async function main(){
  loadEnvConfig(process.cwd(),true);
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5432'&&target.pathname==='/smart_floor_planner');
  const {signMiniProgramToken}=await import('@/lib/miniprogram-jwt');
  fs.mkdirSync(directory,{recursive:true});fs.mkdirSync(control,{recursive:true});
  const prior=path.join(directory,'evaluation.json');if(fs.existsSync(prior)){
    const old=JSON.parse(fs.readFileSync(prior,'utf8'));
    fs.copyFileSync(prior,path.join(directory,'attempt-'+String(old.started).replace(/[:.]/g,'-')+'.json'));
  }
  const children= ['a','b'].map(profile=>{
    const evidence=name+'-'+profile,p=path.join(root,'tmp',evidence,'live.json'),args=['--import','tsx','scripts/assistant-real-manual-synthesis-development.ts',
      '--development',...(firstDraftRequired?['--require-first-draft']:[]),'--case-set='+caseSet,'--profile='+profile,'--evidence='+evidence,'--coordinate='+coordination,'--batch='+batchId];
    if(fs.existsSync(p)){const old=live(evidence);assert.ok(old.finished&&old.finalState?.active_runs==='0','Previous child must finish cleanup before reuse');
      args.push(old.passed?'--recheck':'--resume');}
    const entry:{evidence:string;profile:string;exit?:number;enterpriseId?:string}={evidence,profile};report.children.push(entry);
    const child=spawn(process.execPath,args,{cwd:process.cwd(),env:process.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const log=path.join(directory,profile+'-process.log');fs.writeFileSync(log,'');
    const write=(data:Buffer)=>fs.appendFileSync(log,data);child.stdout.on('data',write);child.stderr.on('data',write);
    const done=new Promise<number>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>{entry.exit=code??1;save();resolve(entry.exit);});});
    return {evidence,entry,done};
  });save();
  try{
    await waitFor(()=>{
      const states=children.map(c=>fs.existsSync(path.join(root,'tmp',c.evidence,'live.json'))?live(c.evidence):null);
      const failed=states.find(s=>s?.batchId===batchId&&s?.finished&&!s.readyForIsolation);if(failed)throw Error(failed.error||'Child failed before isolation barrier');
      return states.every(s=>s?.batchId===batchId&&s?.readyForIsolation)?states as Live[]:false;
    },'both independent registered-case batches');
    const [a,b]=children.map(c=>live(c.evidence));
    assert.notEqual(a.fixture.enterpriseId,b.fixture.enterpriseId);assert.notEqual(a.fixture.userId,b.fixture.userId);
    assert.notEqual(a.document.documentId,b.document.documentId);assert.notEqual(a.document.versionId,b.document.versionId);
    assert.equal(a.source.sha256,b.source.sha256);assert.deepEqual(a.codeHashes,b.codeHashes);
    assert.ok(a.fixture.providerKey && a.fixture.model); assert.equal(a.fixture.providerKey,b.fixture.providerKey); assert.equal(a.fixture.model,b.fixture.model);
    report.sourceHash=a.source.sha256;children.forEach((c,i)=>{c.entry.enterpriseId=[a,b][i].fixture.enterpriseId;});
    report.checks.push({name:'two independent tenants/identities/projects and one PDF hash, one knowledge document per tenant, identical Agent code',passed:true});save();
    const tokens=await Promise.all([a,b].map(async s=>{
      const version=await withPlatformTransaction(tx=>one(tx,sql`select context_version from app.users where id=${s.fixture.userId}`));assert.ok(version);
      const mini=await signMiniProgramToken({sub:s.fixture.userId,id:s.fixture.userId,mode:'customer',role:'user',contextVersion:Number(version.context_version),source:'wechat'});
      const admin=await new SignJWT({id:s.fixture.ownerId,enterpriseId:s.fixture.enterpriseId,role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
      return {mini,admin};
    }));
    const get=async(p:string,token:string)=>{
      const response=await fetch('http://localhost:3006/api/'+p,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
      assert.match(response.headers.get('cache-control')||'',/no-store/);return {status:response.status,body:await response.json()};
    };
    const verifyVisible=async(s:Live,token:string,available:boolean)=>{
      for(const cid of s.conversationIds){const value=await get('miniprogram/assistant/conversations/'+cid+'/messages',token);assert.equal(value.status,200);
        for(const run of s.runs.filter(r=>r.conversationId===cid&&r.outputMessageId!=='null'))
          assert.ok(value.body.data.items.some((m:{id:string;available:boolean})=>m.id===run.outputMessageId&&m.available===available));}
    };
    // Explicit owner positives precede negative probes, avoiding false passes on
    // misspelled/nonexistent endpoints. Never persist bearer tokens or foreign data.
    for(const [i,s] of [a,b].entries()){
      const foreign=tokens[1-i],own=tokens[i],citation=s.runs.flatMap(r=>r.message?.citations||[])[0];assert.ok(citation);
      const endpoints=[{path:'miniprogram/assistant/conversations/'+s.conversationIds[0]+'/messages',own:own.mini,foreign:foreign.mini,citation:false},
        {path:'miniprogram/assistant/citations/'+citation.id,own:own.mini,foreign:foreign.mini,citation:true},
        {path:'assistant/knowledge/documents/'+s.document.documentId,own:own.admin,foreign:foreign.admin,citation:false}];
      for(const endpoint of endpoints){const positive=await get(endpoint.path,endpoint.own);assert.equal(positive.status,200);
        const negative=await get(endpoint.path,endpoint.foreign),data=negative.body.data;
        const unavailable=endpoint.citation&&negative.status===200&&data?.available===false
          &&!['quote','title','sourceFile','sourceLocation','text','ref'].some(key=>data[key]);
        assert.ok([403,404].includes(negative.status)||unavailable,'Foreign resource must expose no content: '+endpoint.path);
        report.checks.push({name:'cross-enterprise denial '+i+' '+endpoint.path,passed:true,status:negative.status});save();}
    }
    signal(children[0].evidence,'retire');
    await waitFor(()=>{const value=live(children[0].evidence);if(value.finished&&!value.retiredForIsolation)throw Error(value.error||'A failed withdrawal');return value.retiredForIsolation?true:false;},'A withdrawn before B',240000);
    await verifyVisible(a,tokens[0].mini,false);await verifyVisible(b,tokens[1].mini,true);
    report.checks.push({name:'withdrawing A hides only A; B remains readable with its own current sources',passed:true});save();
    signal(children[0].evidence,'cleanup');signal(children[1].evidence,'retire');
    await waitFor(()=>{const value=live(children[1].evidence);if(value.finished&&!value.retiredForIsolation)throw Error(value.error||'B failed withdrawal');return value.retiredForIsolation?true:false;},'B withdrawal',240000);
    await verifyVisible(b,tokens[1].mini,false);report.checks.push({name:'B withdrawal also invalidates its own dependent answers',passed:true});
  }finally{
    for(const child of children){signal(child.evidence,'retire');signal(child.evidence,'cleanup');}
    await Promise.allSettled(children.map(c=>c.done));
    const final=children.map(c=>live(c.evidence)),runs=final.flatMap(s=>s.runs);
    report.firstDrafts={passed:runs.filter(r=>r.firstDraftPassed).length,total:runs.length};
    report.delivered={passed:runs.filter(r=>r.fixedChecksPassed).length,total:runs.length};
    report.reportHashes=Object.fromEntries(children.map(c=>[c.evidence,createHash('sha256').update(fs.readFileSync(path.join(root,'tmp',c.evidence,'live.json'))).digest('hex')]));
    report.passed=final.every(s=>s.passed&&s.finalState?.active_runs==='0'&&s.finalState?.active_jobs==='0'&&s.finalState?.unknown_jobs==='0'&&s.finalState?.active_customer_documents==='0'
      &&s.finalState?.active_test_staff==='0'&&s.finalState?.knowledge_documents==='1'&&JSON.stringify(s.codeHashes)===JSON.stringify(s.codeHashesAfter))
      &&report.checks.length===9;
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
  if(!report.passed)throw Error('Configured-model first drafts/isolation did not all pass; original outputs retained');
}
main().catch(error=>{report.passed=false;report.error=(error as Error).message;if(fs.existsSync(directory))save();console.error(report.error);process.exitCode=1;});
