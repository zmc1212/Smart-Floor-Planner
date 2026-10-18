/** Real development HTTP/Worker/model; synthetic-only enterprise. Tokens stay in memory. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool,resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { professionalEntry } from './assistant-professional-cases';
const output=path.resolve('../tmp/xiaok-kb1'),report:Row={started:new Date().toISOString(),model:'real configured preview provider',database:'development; synthetic enterprise',checks:[],requests:[],passed:false};
const save=()=>fs.writeFileSync(path.join(output,'admin-http.json'),JSON.stringify(report,null,2));
async function main(){
  loadEnvConfig(process.cwd(),true);const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='5432'&&url.pathname==='/smart_floor_planner');
  fs.mkdirSync(output,{recursive:true});let eid='',aid='',token='';const prefix='synthetic-kb1-admin-'+randomUUID();
  const check=(name:string)=>{(report.checks as Row[]).push({name,passed:true});save();};
  const request=async(p:string,method='GET',body?:unknown,expected=200,authorization=token)=>{
    const response=await fetch('http://localhost:3006/api/assistant/'+p,{method,headers:{Authorization:'Bearer '+authorization,'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(60000)});
    const json=await response.json();(report.requests as Row[]).push({path:p,method,status:response.status,noStore:response.headers.get('cache-control')});save();assert.equal(response.status,expected,JSON.stringify(json));assert.match(response.headers.get('cache-control')||'',/no-store/);return json.data;
  };
  const wait=async(work:()=>Promise<Row>,label:string)=>{for(let i=0;i<180;i++){const r=await work();if(['failed','indeterminate','cancelled'].includes(String(r.status)))throw Error(label+': '+JSON.stringify(r));if(r.status==='succeeded')return r;await new Promise(r=>setTimeout(r,500));}throw Error('Timeout: '+label);};
  try{
    await withPlatformTransaction(async tx=>{
      eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · KB1后台HTTP',${prefix},'active') returning id`))!.id);
      aid=String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id);
      await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,100,12000000,1000000000,30)`);
    });report.fixture={enterpriseId:eid,ownerId:aid};save();
    token=await new SignJWT({id:aid,enterpriseId:eid,role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('30m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const body='书房靠窗办公时，应核对屏幕眩光和通道，再与设计师核对点位图。不能只凭户型名称认定插座位置已经批准。';
    const created=await request('knowledge/documents','POST',{title:'合成KB1后台专业条目',sourceType:'manual_text',audience:'customer_public',body,professional:professionalEntry({kind:'explanation',topics:['书房','靠窗办公','屏幕眩光'],conditions:[{field:'room',operator:'in',values:['书房']}]})});
    const did=String(created.document.id),vid=String(created.draft.id),base=`knowledge/documents/${did}`,version=`${base}/versions/${vid}`;report.document={documentId:did,versionId:vid};
    assert.equal(created.draft.professional.review.adminId,aid);check('real Admin create stamps current reviewer and persists professional structure');
    await request('knowledge/documents','POST',{title:'非法扩权',sourceType:'manual_text',audience:'customer_public',body,professional:{...professionalEntry(),tenant:'all'}},422);check('untrusted metadata cannot widen tenant scope');
    const job=await request(version+'/index','POST',{expectedEditVersion:1});await wait(()=>request('knowledge/jobs/'+job.jobId),'real index');await request(version+'/publish','POST',{expectedVersion:1,expectedEditVersion:1});
    const detail=await request(base);assert.equal(detail.document.published_version_id,vid);assert.equal(detail.versions[0].professional.origin.version,'synthetic-v1');check('real Worker indexing, publication and reentry preserve source version');
    const preview=await request('preview/conversations','POST',{audience:'customer_public',draftVersionIds:[]}),cid=String(preview.id),key=randomUUID();report.preview={conversationId:cid};
    const response=await fetch(`http://localhost:3006/api/assistant/preview/conversations/${cid}/messages`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({clientMessageId:key,content:{version:1,blocks:[{type:'text',text:'书房靠窗办公的屏幕和插座应核对什么？'}]}})});assert.equal(response.status,202);const sent=(await response.json()).data;report.preview={conversationId:cid,runId:sent.runId};save();
    await wait(()=>request('preview/runs/'+sent.runId),'real preview model');const history=await request(`preview/conversations/${cid}/messages`);const answer=history.items.find((m:Row)=>m.authorKind==='assistant');assert.ok(answer?.available&&answer.citations?.length);assert.doesNotMatch(JSON.stringify(answer),/INTERNAL_KB_REVIEW_NOTE/);report.answer=answer;check('configured real preview model returns persisted authorized citations');
    const diagnostic=await request(`preview/runs/${sent.runId}/diagnostics`);assert.equal(diagnostic.available,true);assert.equal(diagnostic.traces[0].configuration.version,'professional-hybrid-v1');assert.ok(diagnostic.traces[0].candidates.some((c:Row)=>c.documentId===did&&((c.applicability as Row)?.status==='unknown')));report.diagnostic=diagnostic;check('actual preview run exposes real ranks, context gaps, configuration and source chunks');
    const citation=await request('preview/citations/'+answer.citations[0].id);assert.equal(citation.professional.origin.version,'synthetic-v1');check('source read exposes the reviewed origin and declared conditions without private review notes');
    await request(version,'PATCH',{expectedEditVersion:1,body:'篡改发布正文'},409);check('published version is immutable through HTTP');
    await request(base,'PATCH',{expectedVersion:2,audience:'staff_internal'});const after=await request(`preview/runs/${sent.runId}/diagnostics`);assert.equal(after.available,false);assert.ok(!('traces' in after));const reread=await request(`preview/conversations/${cid}/messages`);assert.equal(reread.items.find((m:Row)=>m.id===answer.id)?.available,false);check('audience change withdraws old diagnostics, citations and derived answer on real HTTP reentry');
    const staffToken=await new SignJWT({id:aid,enterpriseId:eid,role:'designer'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const denial=await fetch(`http://localhost:3006/api/assistant/preview/runs/${sent.runId}/diagnostics`,{headers:{Authorization:'Bearer '+staffToken}});assert.equal(denial.status,403);check('staff credentials cannot access the manager diagnostic route');
    report.passed=true;
  }finally{
    if(eid)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);});
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(e=>{report.error=(e as Error).message;save();console.error((e as Error).message);process.exitCode=1;});
