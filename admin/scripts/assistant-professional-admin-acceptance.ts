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
import { retrievalConfiguration } from '@/lib/assistant/knowledge/retrieval';
const output=path.resolve('../tmp/xiaok-kb1'),report:Row={started:new Date().toISOString(),model:'real configured preview provider',database:'development; synthetic enterprise',checks:[],requests:[],passed:false};
const save=()=>fs.writeFileSync(path.join(output,'admin-http.json'),JSON.stringify(report,null,2));
async function main(){
  loadEnvConfig(process.cwd(),true);const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(url.hostname)&&url.port==='5432'&&url.pathname==='/smart_floor_planner');
  fs.mkdirSync(output,{recursive:true});let eid='',aid='',token='',otherEid='';const platform:Array<{id:string;role:string}>=[],prefix='synthetic-kb1-admin-'+randomUUID();
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
      otherEid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values('测试专用 · KB1跨企业隔离',${prefix+'-other'},'active') returning id`))!.id);
      for(const role of ['admin','super_admin'])platform.push({role,id:String((await one(tx,sql`insert into app.admin_users(username,password_hash,role,status,menu_permissions,must_change_password)
        values(${prefix+'-'+role},'unusable-synthetic',${role},'active',ARRAY[]::text[],false) returning id`))!.id)});
    });report.fixture={enterpriseId:eid,ownerId:aid,otherEnterpriseId:otherEid,platform};save();
    token=await new SignJWT({id:aid,enterpriseId:eid,role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('30m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const body='书房靠窗办公时，应核对屏幕眩光和通道，再与设计师核对点位图。不能只凭户型名称认定插座位置已经批准。等电位联结资料须核对设计文件和实际施工记录，不能把提问当作已验收。合成材料样例瓷砖胶 C2TE 应核对厂家产品说明及完整型号，不能把提问当作已使用或已批准。';
    const created=await request('knowledge/documents','POST',{title:'合成KB1后台专业条目',sourceType:'manual_text',audience:'customer_public',body,professional:professionalEntry({kind:'explanation',topics:['书房','靠窗办公','屏幕眩光'],conditions:[{field:'room',operator:'in',values:['书房']}]})});
    const did=String(created.document.id),vid=String(created.draft.id),base=`knowledge/documents/${did}`,version=`${base}/versions/${vid}`;report.document={documentId:did,versionId:vid};
    assert.equal(created.draft.professional.review.adminId,aid);check('real Admin create stamps current reviewer and persists professional structure');
    await request('knowledge/documents','POST',{title:'非法扩权',sourceType:'manual_text',audience:'customer_public',body,professional:{...professionalEntry(),tenant:'all'}},422);check('untrusted metadata cannot widen tenant scope');
    const job=await request(version+'/index','POST',{expectedEditVersion:1});await wait(()=>request('knowledge/jobs/'+job.jobId),'real index');await request(version+'/publish','POST',{expectedVersion:1,expectedEditVersion:1});
    const detail=await request(base);assert.equal(detail.document.published_version_id,vid);assert.equal(detail.versions[0].professional.origin.version,'synthetic-v1');check('real Worker indexing, publication and reentry preserve source version');
    const preview=await request('preview/conversations','POST',{audience:'customer_public',draftVersionIds:[]}),cid=String(preview.id),key=randomUUID();report.preview={conversationId:cid};
    const response=await fetch(`http://localhost:3006/api/assistant/preview/conversations/${cid}/messages`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({clientMessageId:key,content:{version:1,blocks:[{type:'text',text:'C 2 T E 瓷砖黏结剂、卫生间等电位连接与书房靠窗办公的屏幕和插座应核对什么？'}]}})});assert.equal(response.status,202);const sent=(await response.json()).data;report.preview={conversationId:cid,runId:sent.runId};save();
    await wait(()=>request('preview/runs/'+sent.runId),'real preview model');const history=await request(`preview/conversations/${cid}/messages`);const answer=history.items.find((m:Row)=>m.authorKind==='assistant');assert.ok(answer?.available&&answer.citations?.length);assert.doesNotMatch(JSON.stringify(answer),/INTERNAL_KB_REVIEW_NOTE/);report.answer=answer;check('configured real preview model returns persisted authorized citations');
    const diagnostic=await request(`preview/runs/${sent.runId}/diagnostics`);assert.equal(diagnostic.available,true);assert.equal(diagnostic.traces[0].configuration.version,retrievalConfiguration.version);assert.ok(diagnostic.traces[0].candidates.some((c:Row)=>c.documentId===did&&((c.applicability as Row)?.status==='unknown')));report.diagnostic=diagnostic;check('actual preview run exposes real ranks, context gaps, configuration and source chunks');
    assert.ok(diagnostic.traces[0].expansion.matches.some((m:Row)=>m.rule==='equipotential_bonding'));check('real preview persists bounded spelling expansion in the original reauthorized diagnostic');
    assert.ok(diagnostic.traces[0].expansion.matches.some((m:Row)=>m.rule==='adhesive_designation_spacing'&&Array.isArray(m.addedTerms)&&m.addedTerms.includes('c2te')));check('direct real preview normalizes the complete spaced designation without an Agent-provided canonical term');
    for(const operator of platform){
      const session=await new SignJWT({id:operator.id,enterpriseId:null,role:operator.role,permissions:[]}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
      const platformRequest=async(p:string,selected=eid,method='GET',input?:Row,expected=200)=>{
        const response=await fetch('http://localhost:3006/api/assistant/'+p,{method,headers:{cookie:`auth_token=${session}; global_tenant_id=${selected}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},...(input?{body:JSON.stringify(input)}:{}),signal:AbortSignal.timeout(30000)});
        const json=await response.json();(report.requests as Row[]).push({path:p,method,status:response.status,role:operator.role,selectedEnterpriseId:selected});save();assert.equal(response.status,expected,JSON.stringify(json));assert.match(response.headers.get('cache-control')||'',/no-store/);return json.data;
      };
      assert.equal((await platformRequest(base)).document.id,did);
      const created=await platformRequest('knowledge/documents',eid,'POST',{title:'合成平台继承术语草稿',sourceType:'manual_text',audience:'customer_public',body,professional:professionalEntry()});
      assert.equal(created.draft.professional.review.adminId,operator.id);
      check(operator.role+' inherits real knowledge reads/writes in the selected enterprise without employment');
      await platformRequest(`preview/runs/${sent.runId}/diagnostics`,eid,'GET',undefined,404);check(operator.role+' cannot read another manager preview trace');
      await platformRequest(base,otherEid,'GET',undefined,404);check(operator.role+' cannot read a source from a different selected enterprise');
    }
    const citation=await request('preview/citations/'+answer.citations[0].id);assert.equal(citation.professional.origin.version,'synthetic-v1');check('source read exposes the reviewed origin and declared conditions without private review notes');
    await request(version,'PATCH',{expectedEditVersion:1,body:'篡改发布正文'},409);check('published version is immutable through HTTP');
    await request(base,'PATCH',{expectedVersion:2,audience:'staff_internal'});const after=await request(`preview/runs/${sent.runId}/diagnostics`);assert.equal(after.available,false);assert.ok(!('traces' in after));const reread=await request(`preview/conversations/${cid}/messages`);assert.equal(reread.items.find((m:Row)=>m.id===answer.id)?.available,false);check('audience change withdraws old diagnostics, citations and derived answer on real HTTP reentry');
    const staffToken=await new SignJWT({id:aid,enterpriseId:eid,role:'designer'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('5m').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    const denial=await fetch(`http://localhost:3006/api/assistant/preview/runs/${sent.runId}/diagnostics`,{headers:{Authorization:'Bearer '+staffToken}});assert.equal(denial.status,403);check('staff credentials cannot access the manager diagnostic route');
    report.passed=true;
  }finally{
    if(eid)await withPlatformTransaction(async tx=>{await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${eid}`);await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid}`);for(const operator of platform)await tx.execute(sql`update app.admin_users set status='disabled' where id=${operator.id}`);});
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(e=>{report.error=(e as Error).message;save();console.error((e as Error).message);process.exitCode=1;});
