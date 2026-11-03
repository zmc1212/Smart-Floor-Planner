/** Real HTTP journey on 3019, plus retained photo consent for native reentry. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { SiteChatService, siteActor } from '@/lib/construction/site-chat';
import { PublicMaterialService } from '@/lib/construction/public-service';
import { PublicCustomerService } from '@/lib/construction/public-customer';
import { PublicSiteCatalog } from '@/lib/construction/public-read';
import { bindPublicLive,comparePublicLive } from './public-live-bindings.mjs';
import type { createLiveFixture } from './public-live-fixture';
loadEnvConfig(process.cwd(),true);
const f=JSON.parse(fs.readFileSync('../tmp/public-live-package/fixture.json','utf8')) as Awaited<ReturnType<typeof createLiveFixture>>;
const output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'../tmp/public-live-package/http01');
assert.ok(!fs.existsSync(path.join(output,'report.json')));fs.mkdirSync(output,{recursive:true});
const report:{checks:Row[];before?:unknown;drift?:string[];passed?:boolean;error?:string;nativeFixture?:unknown}={checks:[]};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const actor={enterpriseId:f.eid,adminId:f.adminIds.enterprise_admin};
let state:Row,photo:Row;
const body=()=>({versionId:state.versionId,expectedRevision:state.revision});
async function step(name:string,fn:()=>Promise<unknown>){try{const data=await fn();report.checks.push({name,passed:true,data});}catch(e){report.checks.push({name,passed:false,error:e instanceof Error?e.stack:String(e)});throw e;}finally{save();console.log(name+': '+(report.checks.at(-1)?.passed?'PASS':'FAIL'));}}
async function main(){
  const tokens:Record<string,string>={};
  // This runner imports service modules before loadEnvConfig. Sign directly
  // after loading the same test server environment, avoiding an early-cached
  // fallback secret in the imported application JWT singleton.
  for(const [label,uid]of Object.entries(f.users))tokens[label]=await new SignJWT({sub:uid,id:uid,mode:'customer',role:'user',contextVersion:1,source:'wechat'})
    .setProtectedHeader({alg:'HS256'}).setSubject(uid).setAudience('miniprogram').setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  for(const [role,aid]of Object.entries(f.adminIds))tokens[role]=await new SignJWT({id:aid,role,enterpriseId:f.eid,permissions:['construction-projects']}).setProtectedHeader({alg:'HS256'}).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const req=async(url:string,identity='',method='GET',value?:unknown,key=randomUUID())=>{
    const isOwner=['owner','visitor'].includes(identity),response=await fetch('http://127.0.0.1:3019'+url,{method,
      headers:{'Content-Type':'application/json','Idempotency-Key':key,...(identity?isOwner?{Authorization:'Bearer '+tokens[identity]}:{Cookie:'auth_token='+tokens[identity]}:{})},
      ...(value!==undefined?{body:JSON.stringify(value)}:{}),signal:AbortSignal.timeout(45000)});
    const payload=await response.json();return {status:response.status,payload,cache:response.headers.get('cache-control')};
  };
  const ok=(r:Awaited<ReturnType<typeof req>>)=>{assert.equal(r.status,200,JSON.stringify(r.payload));assert.ok(r.cache?.includes('no-store'));return r.payload.data as Row;};
  const staff='/api/construction/public-live/'+f.pid,owner='/api/miniprogram/assistant/public-live/'+f.cid;
  report.before=bindPublicLive(['admin/scripts/public-live-http.ts','admin/src/proxy.ts','admin/src/app/api/construction/public-live/[projectId]/[[...path]]/route.ts',
    'admin/src/app/api/miniprogram/assistant/public-live/[conversationId]/[[...path]]/route.ts','admin/src/app/api/public/construction-live/[enterpriseId]/[[...path]]/route.ts']);save();
  try{
    if(process.argv.includes('--recover-prior')){
      const view=ok(await req(staff,'enterprise_admin')),m=view.material as Row|null;
      if(m&&m.status!=='withdrawn')assert.equal(ok(await req(staff+'/withdraw','enterprise_admin','POST',{versionId:m.versionId,expectedRevision:view.revision})).stopped,true);
    }
    await step('real independent photo version and homeowner grant',async()=>{
      const reuse=process.argv.find(a=>a.startsWith('--reuse-photo='))?.slice(14);
      if(reuse){
        const prior=JSON.parse(fs.readFileSync(reuse,'utf8')),data=prior.checks.find((c:Row)=>c.passed&&c.name==='real independent photo version and homeowner grant')?.data;
        assert.ok(data);photo={id:String(data.photoId),versionId:String(data.versionId),status:'published'};
        assert.equal((await new PublicSiteCatalog(f.eid).detail(String(photo.id))).versionId,photo.versionId);
        return {...data,reusedFrom:reuse};
      }
      const shared=new SiteChatService(actor);await shared.read(f.pid);
      const image=await sharp({create:{width:640,height:360,channels:4,background:{r:210,g:219,b:200,alpha:1}}}).png().toBuffer();
      const media=await shared.upload(f.pid,randomUUID(),image);
      const rid=await withTenantTransaction(f.eid,async tx=>{
        const c=(await one(tx,sql`select conversation_id from app.construction_chats where enterprise_id=${f.eid} and project_id=${f.pid}`))!;
        const message=await appendMessage(tx,siteActor(actor),String(c.conversation_id),{author:'admin',content:{version:1,blocks:[{type:'text',text:'合成测试记录：客厅线管已铺好，底盒等核对。'}]}});
        const record=(await one(tx,sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data)
          values(${f.eid},${f.pid},${String(c.conversation_id)},${String(message.id)},${actor.adminId},'draft','{}'::jsonb) returning id`))!;
        await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${f.eid},${f.pid},${String(record.id)},${String(media.id)},0)`);return String(record.id);
      });
      await shared.mutate(f.pid,rid,'edit',{expectedVersion:1,data:{title:'合成水电进展',roomId:null,completed:'客厅线管已铺好',pending:'底盒等核对',coordination:'请核对点位',note:''}},randomUUID());
      await shared.mutate(f.pid,rid,'publish',{expectedVersion:2,audience:'customer'},randomUUID());
      const materials=new PublicMaterialService(actor),view=await materials.read(f.pid),source=(view.sourceItems as Row[]).find(r=>r.id===rid)!;
      assert.ok(source);
      photo=await materials.save(f.pid,{expectedRevision:view.revision,material:{name:'合成公开工地 · 水电阶段',cityCode:'420500',district:'伍家岗区',
        sources:[{kind:source.kind,id:source.id,sourceHash:source.sourceHash,text:source.text}],photos:[{recordId:rid,mediaId:String(media.id),masks:[]}]}},randomUUID());
      const decide=new PublicCustomerService(f.actor,f.cid),a=()=>({versionId:photo.versionId,expectedRevision:photo.revision});
      photo=await materials.mutate(f.pid,'submit',a(),randomUUID());photo=await decide.decide(String(photo.id),'preview',a(),randomUUID());photo=await decide.decide(String(photo.id),'approve',a(),randomUUID());photo=await materials.mutate(f.pid,'publish',a(),randomUUID());
      assert.equal((await new PublicSiteCatalog(f.eid).detail(String(photo.id))).photos.length,1);
      return {photoId:photo.id,versionId:photo.versionId,status:photo.status,agentRunsCreated:0};
    });
    await step('HTTP staff save, same-key readback, original homeowner preview and three-role gates',async()=>{
      const view=ok(await req(staff,'enterprise_admin'));
      const draft={expectedRevision:view.revision,bindingId:f.bindingId,alias:'客厅机位',name:'合成公开工地 · 水电阶段'},key=randomUUID();
      state=ok(await req(staff,'enterprise_admin','POST',draft,key));assert.deepEqual(ok(await req(staff,'enterprise_admin','POST',draft,key)),state);
      state=ok(await req(staff+'/submit','enterprise_admin','POST',body()));
      const cards=ok(await req(owner,'owner'));assert.equal((cards.items as Row[]).length,1);
      assert.equal((await req(owner,'visitor')).status,404);
      assert.equal((await req(owner+'/'+state.id+'/approve','owner','POST',body())).status,422);
      state=ok(await req(owner+'/'+state.id+'/preview','owner','POST',body()));state=ok(await req(owner+'/'+state.id+'/approve','owner','POST',body()));
      assert.equal((await req(staff+'/publish','construction_staff','POST',body())).status,403);
      state=ok(await req(staff+'/publish','super_admin','POST',body()));return {status:state.status,ownerReadback:true,visitorDenied:true,workerReviewDenied:true};
    });
    await step('anonymous real HLS, retained photo independence, stop and permanent old-link invalidation',async()=>{
      const base='/api/public/construction-live/'+f.eid+'/'+state.key;
      const detail=ok(await req(base));assert.equal(detail.alias,'客厅机位');
      const session=ok(await req(base+'/session','','POST',{}));assert.ok(String(session.url).startsWith('http://127.0.0.1:3019/api/public/construction-live/'));
      const playlist=await fetch(String(session.url),{headers:{Range:'bytes=0-'}});assert.equal(playlist.status,200);const text=await playlist.text();
      const first=text.split(/\r?\n/).find(l=>l&&!l.startsWith('#'))!;const segment=await fetch(new URL(first,String(session.url)));assert.equal(segment.status,200);assert.ok((await segment.arrayBuffer()).byteLength>188);
      const oldKey=state.key;
      state=ok(await req(owner+'/'+state.id+'/withdraw','owner','POST',body()));assert.equal(state.stopped,true);
      assert.equal((await fetch(String(session.url))).status,404);assert.equal((await req(base)).status,404);
      assert.equal(ok(await req('/api/public/construction/'+f.eid+'/sites/'+photo.id)).versionId,photo.versionId);
      const view=ok(await req(staff,'admin'));state=ok(await req(staff,'admin','POST',{expectedRevision:view.revision,bindingId:f.bindingId,alias:'客厅机位',name:'合成公开工地 · 水电阶段'}));
      assert.notEqual(state.key,oldKey);state=ok(await req(staff+'/submit','admin','POST',body()));
      const photoView=await new PublicSiteCatalog(f.eid).detail(String(photo.id));
      report.nativeFixture={...f,photoId:String(photo.id),photoVersionId:String(photo.versionId),liveId:String(state.id),versionId:String(state.versionId),revision:Number(state.revision),key:String(state.key),photoName:photoView.name};
      fs.writeFileSync('../tmp/public-live-package/native-fixture.json',JSON.stringify(report.nativeFixture,null,2)+'\n');
      assert.equal((await req(base)).status,404);return {rangePlaylist:200,segment:200,oldLink:404,photoStillPublished:true,newGrant:'pending_owner'};
    });
    report.drift=comparePublicLive(report.before);assert.deepEqual(report.drift,[]);report.passed=true;
  }catch(e){report.passed=false;report.error=e instanceof Error?e.stack:String(e);throw e;}
  finally{if(report.before)report.drift=comparePublicLive(report.before);save();await closePostgresPool();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
