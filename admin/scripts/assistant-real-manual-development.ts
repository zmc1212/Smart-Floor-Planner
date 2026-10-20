/** User-designated original; approved development only. Never customer-public. */
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
import { safeText } from '@/lib/assistant/contracts';
import { parseSourceFile } from '@/lib/assistant/knowledge/source-file';

const source=path.resolve('../docs/装修施工标准手册制度规范/04 质量管理/00 管理文件/03 金螳螂家施工工艺手册2.0.pdf');
const expectedHash='fdbdaad5b5253c7b58c65e70c7fd49c584e7762323de03bf945bc72b78d73010';
const output=path.resolve('../tmp/xiaok-real-manual');
type PreviewTestEntry={
  name:string;round:number;question:string;cid:string;runId:string;elapsedMs:number;run:Row;
  message:{id:string;available:boolean;answerKind:string;content:Parameters<typeof safeText>[0];citations:{id:string}[]};
  text?:string;sources?:{available:boolean;sourceFile:{sourceHash:string;page:number}}[];
  diagnostics?:unknown;usage?:Row[];passed?:boolean;
};
type ManualReport={
  started:string;source:{path:string;sha256:string;bytes?:number;pages?:number;blocks?:number;parser?:string;authorization?:string};
  scope:string;checks:{name:string;passed:boolean}[];runs:PreviewTestEntry[];passed:boolean;
  fixture?:{enterpriseId:string;ownerId:string;foreignEnterpriseId:string;foreignOwnerId:string};
  document?:{documentId:string;versionId:string;parseJobId:string;indexJobId?:string};
  finalDocument?:{documentId:string;versionId:string;status:string;audience:string;sha256:string};
  finalState?:Row|null;finished?:string;error?:string;
};
const report:ManualReport={started:new Date().toISOString(),source:{path:source,sha256:expectedHash},scope:'original internal manual; development-only synthetic tenants; conservative Admin preview, not customer Agent semantic acceptance',checks:[],runs:[],passed:false};
const save=()=>fs.writeFileSync(path.join(output,'live.json'),JSON.stringify(report,null,2));
const check=(name:string)=>{report.checks.push({name,passed:true});save();};
async function wait<T>(work:()=>Promise<T|null|false>,label:string):Promise<T>{
  const end=Date.now()+240000;
  while(Date.now()<end){const r=await work();if(r)return r;await new Promise(r=>setTimeout(r,500));}
  throw Error('Timeout: '+label);
}
async function main(){
  loadEnvConfig(process.cwd(),true);
  const target=new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development')&&['localhost','127.0.0.1'].includes(target.hostname)&&target.port==='5432'&&target.pathname==='/smart_floor_planner');
  const bytes=fs.readFileSync(source);assert.equal(createHash('sha256').update(bytes).digest('hex'),expectedHash);
  fs.mkdirSync(output,{recursive:true});
  const parsed=await parseSourceFile(bytes,'pdf');assert.equal(parsed.pages,9);
  assert.ok(parsed.blocks.length<=128);assert.ok(parsed.blocks.some(b=>b.page===6&&/48.*20mm[\s\S]*24.*2-3/.test(b.text)));
  report.source={...report.source,bytes:bytes.length,pages:parsed.pages,blocks:parsed.blocks.length,parser:parsed.parser,authorization:'User selected this local original for internal development knowledge testing; preserve original internal/no-redistribution marking and provenance.'};save();
  const prefix='synthetic-real-manual-'+randomUUID();
  const tenants:string[]=[],admins:string[]=[];let token='',otherToken='',documentId='',versionId='';
  const request=async(p:string,method='GET',body?:unknown,expected=200,bearer=token,key=randomUUID())=>{
    const response=await fetch('http://localhost:3006/api/assistant/'+p,{method,headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(90000)});
    const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));assert.match(response.headers.get('cache-control')||'',/no-store/);return result.data;
  };
  const job=async(id:string)=>wait(async()=>{const value=await request('knowledge/jobs/'+id);if(['failed','cancelled','indeterminate'].includes(value.status))throw Error(JSON.stringify(value));return value.status==='succeeded'?value:null;},'original Worker '+id);
  try{
    await withPlatformTransaction(async tx=>{
      for(let i=0;i<2;i++){
        const eid=String((await one(tx,sql`insert into app.enterprises(name,code,status) values(${i?'测试专用 · 手册跨企业隔离':'测试专用 · 金螳螂原件知识库'},${prefix+i},'active') returning id`))!.id);tenants.push(eid);
        await tx.execute(sql`insert into app.assistant_enterprise_settings(enterprise_id,enabled,daily_requests,daily_tokens,daily_cost_micros,retention_days) values(${eid},true,200,12000000,1000000000,30)`);
        admins.push(String((await one(tx,sql`insert into app.admin_users(enterprise_id,username,password_hash,role,status,menu_permissions,must_change_password) values(${eid},${prefix+i},'unusable-synthetic','enterprise_admin','active',ARRAY['assistant-knowledge'],false) returning id`))!.id));
      }
    });
    report.fixture={enterpriseId:tenants[0],ownerId:admins[0],foreignEnterpriseId:tenants[1],foreignOwnerId:admins[1]};save();
    const jwt=async(i:number)=>new SignJWT({id:admins[i],enterpriseId:tenants[i],role:'enterprise_admin'}).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
    token=await jwt(0);otherToken=await jwt(1);
    const importKey=randomUUID(),input={title:'金螳螂家施工工艺标准2.0 · 用户指定原件测试',category:'外部手册参考 / 内部测试',fileName:path.basename(source),fileBase64:bytes.toString('base64'),authorization:report.source.authorization,audience:'staff_internal'};
    const imported=await request('knowledge/documents/import','POST',input,200,token,importKey),again=await request('knowledge/documents/import','POST',input,200,token,importKey);
    assert.equal(imported.jobId,again.jobId);documentId=String(imported.document.id);versionId=String(imported.draft.id);
    const base='knowledge/documents/'+documentId,vpath=base+'/versions/'+versionId;report.document={documentId,versionId,parseJobId:imported.jobId};save();
    await job(imported.jobId);
    const detail=await request(base),version=detail.versions.find((v:Row)=>v.id===versionId);
    assert.equal(detail.document.audience,'staff_internal');assert.equal(version.source_file.hash,expectedHash);
    assert.equal(version.source_file.parsed.pages,9);assert.equal(version.source_file.parsed.blocks.length,parsed.blocks.length);
    const raw=await fetch('http://localhost:3006/api/assistant/'+vpath+'/original',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});assert.equal(raw.status,200);assert.deepEqual(Buffer.from(await raw.arrayBuffer()),bytes);
    await request(vpath+'/index','POST',{expectedEditVersion:2},409);
    await request(vpath+'/review','POST',{expectedEditVersion:2,acknowledgeWarnings:true,excludedBlockIds:[]});
    const indexing=await request(vpath+'/index','POST',{expectedEditVersion:3});report.document.indexJobId=indexing.jobId;save();await job(indexing.jobId);
    await request(vpath+'/publish','POST',{expectedVersion:1,expectedEditVersion:3});
    check('complete original/hash/idempotency/review/index/publication; all nine pages, internal only');
    await request(base,'GET',undefined,404,otherToken);await request(vpath+'/original','GET',undefined,404,otherToken);
    check('other enterprise cannot read original or document');
    const examples=[
      {key:'heights',question:'按这份施工工艺标准2.0，卫生间防水沿墙上翻、淋浴房、台盆柜和浴缸区域的涂刷高度分别是多少？',page:6,required:[/300\s*mm/i,/1800\s*mm/i,/1200\s*mm/i]},
      {key:'water-test',question:'那防水施工后应保养多久再蓄水？水深、蓄水时长、楼下检查频率及发现渗漏时怎么处理，手册分别怎么规定？',page:6,required:[/48\s*小时/,/20\s*mm/i,/24\s*小时/,/2-3\s*小时/,/立即停止/,/楼下/]},
      {key:'electric',question:'按这份手册，强电与弱电管线平行布置的间距、交叉屏蔽及能否同槽共用线盒分别有什么要求？',page:3,required:[/300\s*mm/i,/150\s*mm/i,/不得同槽/,/不得共用线盒/]},
    ];
    const query=async(cid:string,name:string,question:string,round:number,required:RegExp[]=[],page?:number)=>{
      const key=randomUUID(),started=Date.now();const sent=await request('preview/conversations/'+cid+'/messages','POST',{clientMessageId:key,content:{version:1,blocks:[{type:'text',text:question}]}},202,token,key);
      const run=await wait(async()=>{const r=await request('preview/runs/'+sent.runId);return ['queued','running'].includes(r.status)?null:r;},'preview '+sent.runId);
      const messages=await request('preview/conversations/'+cid+'/messages');const message=messages.items.find((m:Row)=>m.id===String(run.outputMessageId));
      const entry:PreviewTestEntry={name,round,question,cid,runId:String(sent.runId),elapsedMs:Date.now()-started,run,message};report.runs.push(entry);save();
      assert.equal(run.status,'succeeded',JSON.stringify(run));assert.ok(message?.available);
      const body=safeText(message.content);entry.text=body;
      const citations=[];for(const c of message.citations)citations.push(await request('preview/citations/'+c.id));entry.sources=citations;
      if(required.length){assert.equal(message.answerKind,'grounded');for(const pattern of required)assert.match(body,pattern);assert.ok(citations.length);assert.ok(citations.every(c=>c.available&&c.sourceFile.sourceHash===expectedHash&&c.sourceFile.page===page));}
      else {assert.equal(message.answerKind,'insufficient_evidence');assert.equal(citations.length,0);}
      const diagnostics=await request('preview/runs/'+sent.runId+'/diagnostics');entry.diagnostics=diagnostics;
      entry.usage=await withTenantTransaction(tenants[0],tx=>rows(tx,sql`select category,quantity,measurement_kind,input_tokens,output_tokens,cost_micros from app.assistant_usage_records where enterprise_id=${tenants[0]} and run_id=${String(sent.runId)}`));
      entry.passed=true;save();return entry;
    };
    for(let round=1;round<=2;round++){
      const conversation=await request('preview/conversations','POST',{audience:'staff_internal',draftVersionIds:[]});
      for(const c of examples.slice(0,2))await query(String(conversation.id),c.key,c.question,round,c.required,c.page);
      await query(String(conversation.id),'no-site-acceptance','那能据此认定我家现在已经验收合格、直接安排铺砖了吗？',round);
      const separate=await request('preview/conversations','POST',{audience:'staff_internal',draftVersionIds:[]});const c=examples[2];
      await query(String(separate.id),c.key,c.question,round,c.required,c.page);
    }
    const publicPreview=await request('preview/conversations','POST',{audience:'customer_public',draftVersionIds:[]});
    await query(String(publicPreview.id),'internal-not-customer-public',examples[0].question,0);
    check('two rounds of real configured-model internal preview and no unsupported site acceptance; customer-public scope excludes manual');
    const positive=report.runs.filter(r=>r.sources?.length);assert.ok(positive.length===6);
    for(const run of positive){const reentry=await request('preview/conversations/'+run.cid+'/messages');assert.ok(reentry.items.some((m:Row)=>m.id===run.message.id&&m.available));}
    await request(base+'/retire','POST',{expectedVersion:2});
    for(const run of positive)for(const c of run.message.citations)assert.equal((await request('preview/citations/'+c.id)).available,false);
    check('persisted real-original citations reenter and become unavailable on withdrawal');
    await request(vpath+'/publish','POST',{expectedVersion:3,expectedEditVersion:3});
    await request(vpath,'PATCH',{expectedEditVersion:3,body:'replace original with generated text'},409);
    const final=await request(base);assert.equal(final.document.audience,'staff_internal');assert.equal(final.document.status,'active');assert.equal(final.versions.find((v:Row)=>v.id===versionId).source_file.hash,expectedHash);
    report.finalDocument={documentId,versionId,status:'active',audience:'staff_internal',sha256:expectedHash};
    check('same reviewed original restored for authorized internal testing; published original remains immutable');report.passed=true;
  }finally{
    if(tenants.length)await withPlatformTransaction(async tx=>{
      for(const id of admins)await tx.execute(sql`update app.admin_users set status='disabled' where id=${id}`);
      for(const id of tenants.slice(1))await tx.execute(sql`update app.assistant_enterprise_settings set enabled=false where enterprise_id=${id}`);
      report.finalState=await one(tx,sql`select (select count(*) from app.admin_users where enterprise_id=${tenants[0]} and status='active') active_test_staff,(select count(*) from app.assistant_runs where enterprise_id=${tenants[0]} and status in ('queued','running')) active_runs`);
    });
    report.finished=new Date().toISOString();save();await closePostgresPool();
  }
}
main().catch(error=>{report.error=(error as Error).message;if(fs.existsSync(output))save();console.error((error as Error).message);process.exitCode=1;});
