/** Bounded deterministic journey; synthetic-only DB and real silent ZLM media. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { AssistantError } from '@/lib/assistant/contracts';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { PublicLiveCustomer } from '@/lib/construction/public-live/customer';
import { ZlmPublicLive } from '@/lib/construction/public-live/upstream';
import { openLiveSession, publicLiveDetail, stopLiveProxies, reconcileLiveProxies } from '@/lib/construction/public-live/media';
import { ConstructionService } from '@/lib/construction/service';
import { CameraService } from '@/lib/construction/camera/service';
import { bindPublicLive, comparePublicLive } from './public-live-bindings.mjs';
import type { createLiveFixture } from './public-live-fixture';
loadEnvConfig(process.cwd(),true);
const output=path.resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'../tmp/public-live-package/service01');
assert.ok(!fs.existsSync(path.join(output,'report.json')),'Preserve original attempts');fs.mkdirSync(output,{recursive:true});
const f=JSON.parse(fs.readFileSync('../tmp/public-live-package/fixture.json','utf8')) as Awaited<ReturnType<typeof createLiveFixture>>;
const report:{at:string;checks:Row[];before?:unknown;drift?:string[];passed?:boolean;error?:string;cleanup?:unknown;mediaConfiguration?:unknown;mediaConfigurationAfter?:unknown}={at:new Date().toISOString(),checks:[]};
const save=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
const staff={enterpriseId:f.eid,adminId:f.adminIds.construction_staff},service=new PublicLiveService(staff),customer=new PublicLiveCustomer(f.actor,f.cid);
const admin=(role:string)=>new PublicLiveService({enterpriseId:f.eid,adminId:f.adminIds[role]});
const upstream=new ZlmPublicLive({origin:'http://127.0.0.1:18084',secret:process.env.PUBLIC_LIVE_ZLM_SECRET!,sourceOrigin:'rtsp://127.0.0.1:554/'});
let state:Row;
const args=()=>({versionId:state.versionId,expectedRevision:state.revision});
const act=async(action:string,role='enterprise_admin')=>state=await admin(role).mutate(f.pid,action,args(),randomUUID());
const decide=async(action:string)=>state=await customer.decide(String(state.id),action,args(),randomUUID());
const prepare=async()=>{
  const view=await service.read(f.pid);
  return state=await service.save(f.pid,{expectedRevision:view.revision,bindingId:f.bindingId,alias:'客厅机位',name:'合成公开工地 · 水电阶段'},randomUUID());
};
async function step(name:string,fn:()=>Promise<unknown>){try{const data=await fn();report.checks.push({name,passed:true,data});}catch(e){report.checks.push({name,passed:false,error:e instanceof Error?e.stack:String(e)});throw e;}finally{save();console.log(name+': '+(report.checks.at(-1)?.passed?'PASS':'FAIL'));}}
async function publish(role='enterprise_admin'){
  await prepare();await act('submit');await decide('preview');await decide('approve');return act('publish',role);
}
async function mediaConfiguration(){
  const u=new URL('/index/api/getServerConfig','http://127.0.0.1:18084');u.searchParams.set('secret',process.env.PUBLIC_LIVE_ZLM_SECRET!);
  const r=await (await fetch(u)).json();assert.equal(r.code,0);const config=r.data[0];
  const keys=['http.rootPath','protocol.hls_save_path','protocol.enable_audio','protocol.enable_mp4','hls.segDur','hls.segNum','hook.enable'];
  return {config:Object.fromEntries(keys.map(k=>[k,config[k]??null])),image:execFileSync('docker',['inspect','sfp-public-live-media-20261103','--format','{{.Image}}'],{encoding:'utf8'}).trim()};
}
async function main(){
  report.before=bindPublicLive(['admin/scripts/public-live-check.ts','admin/scripts/public-live-fixture.ts','admin/src/proxy.ts',
    'admin/src/app/api/public/construction-live/[enterpriseId]/[[...path]]/route.ts','admin/src/app/api/construction/public-live/[projectId]/[[...path]]/route.ts',
    'admin/src/app/api/miniprogram/assistant/public-live/[conversationId]/[[...path]]/route.ts','admin/drizzle/0114_construction_public_live.sql','tmp/public-live-package/media.ini','tmp/public-live-package/compose.yml']);
  report.mediaConfiguration=await mediaConfiguration();save();
  try{
    await step('isolated non-bypass role, forced tenant RLS and immutable scope',async()=>{
      const role=await withTenantTransaction(f.eid,tx=>one(tx,sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`));assert.equal(role?.rolsuper,false);assert.equal(role?.rolbypassrls,false);
      await prepare();const first={...state};
      const hidden=await withTenantTransaction(f.control,tx=>rows(tx,sql`select id from app.construction_public_live where id=${String(state.id)}`));assert.equal(hidden.length,0);
      await assert.rejects(withTenantTransaction(f.eid,tx=>tx.execute(sql`update app.construction_public_live_versions set alias='changed' where enterprise_id=${f.eid} and id=${String(state.versionId)}`)));
      return {id:first.id,versionId:first.versionId,role:'sfp_app',otherTenantRows:hidden.length};
    });
    await step('save idempotency, conflict, original-chat delivery and explicit owner preview',async()=>{
      const view=await service.read(f.pid),body={expectedRevision:view.revision,bindingId:f.bindingId,alias:'客厅机位',name:'合成公开工地 · 水电阶段'},key=randomUUID();
      state=await service.save(f.pid,body,key);assert.deepEqual(await service.save(f.pid,body,key),state);
      await assert.rejects(service.save(f.pid,{...body,alias:'other'},key));
      await assert.rejects(admin('enterprise_admin').mutate(f.pid,'publish',args(),randomUUID()),e=>(e as AssistantError).code==='public_live_consent_required');
      await act('submit');
      const cards=await customer.read();assert.equal(cards.items.length,1);assert.equal(cards.items[0].status,'pending_owner');
      await assert.rejects(new PublicLiveCustomer(f.visitor,f.cid).read());
      await assert.rejects(customer.decide(String(state.id),'approve',args(),randomUUID()),e=>(e as AssistantError).code==='public_live_preview_required');
      await decide('later');assert.equal((await customer.read()).items[0].status,'pending_owner');
      await decide('preview');await decide('approve');await assert.rejects(service.mutate(f.pid,'publish',args(),randomUUID()),e=>(e as AssistantError).code==='public_live_forbidden');
      await act('publish');return {id:state.id,status:state.status,originalConversation:f.cid};
    });
    await step('real public media: source contains audio, relay video decodes without any audio track',async()=>{
      const raw=JSON.parse(execFileSync('ffprobe',['-v','error','-rtsp_transport','tcp','-show_entries','stream=codec_type,codec_name','-of','json','rtsp://127.0.0.1:18554/synthetic/live_source'],{encoding:'utf8',timeout:12000}));
      assert.ok(raw.streams.some((s:Row)=>s.codec_type==='audio'));assert.ok(raw.streams.some((s:Row)=>s.codec_type==='video'));
      const detail=await publicLiveDetail(f.eid,String(state.key));assert.equal(detail.alias,'客厅机位');assert.ok(!JSON.stringify(detail).includes(f.deviceId));
      const s=await openLiveSession(f.eid,String(state.id),String(state.versionId),{kind:'public'},upstream);
      const url='http://127.0.0.1:3019'+s.url;
      let playlist='';for(let i=0;i<8;i++){const r=await fetch(url);if(r.ok){playlist=await r.text();break;}await new Promise(r=>setTimeout(r,1000));}
      assert.ok(playlist.startsWith('#EXTM3U'),playlist);assert.ok(!playlist.includes('synthetic')&&!playlist.includes('rtsp:'));
      const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height','-of','json',url],{encoding:'utf8',timeout:20000}));
      assert.ok(probe.streams.some((s:Row)=>s.codec_type==='video'));assert.ok(!probe.streams.some((s:Row)=>s.codec_type==='audio'));
      execFileSync('ffmpeg',['-v','error','-i',url,'-t','2','-an','-f','null','-'],{timeout:20000});
      fs.writeFileSync(path.join(output,'media.json'),JSON.stringify({source:raw,public:probe,playlist:playlist.replace(/[A-Za-z0-9_-]{43}/g,'[session]'),decodedSeconds:2},null,2));
      const oldUrl=url;await decide('withdraw');assert.equal((await fetch(oldUrl)).status,404);await assert.rejects(publicLiveDetail(f.eid,String(state.key)));
      const stop=await stopLiveProxies(f.eid,String(state.id),upstream);assert.equal(stop.stopped,true);
      assert.equal((await upstream.inspect('synthetic','live_source')).exists,true);
      return {sourceAudio:true,publicAudio:false,decodedSeconds:2,oldSessionDenied:true,sharedSourcePreserved:true};
    });
    await step('three management roles review real independent grants; camera/PTZ mutation guarded',async()=>{
      for(const role of ['enterprise_admin','admin','super_admin']){
        await publish(role);assert.equal((await publicLiveDetail(f.eid,String(state.key))).alias,'客厅机位');
        const camera=await withTenantTransaction(f.eid,tx=>one(tx,sql`select version from app.construction_cameras where enterprise_id=${f.eid} and id=${f.cameraId}`));
        await assert.rejects(new CameraService({enterpriseId:f.eid,adminId:f.adminIds.enterprise_admin}).configure(f.pid,{cameraId:f.cameraId,expectedVersion:Number(camera!.version),ptzEnabled:true}));
        await assert.rejects(withTenantTransaction(f.eid,tx=>tx.execute(sql`insert into app.construction_camera_controls(enterprise_id,camera_id,session_hash,sequence,expires_at,stop_required) values(${f.eid},${f.cameraId},'synthetic',1,now(),true)`)));
        await decide('withdraw');assert.equal((await stopLiveProxies(f.eid,String(state.id),upstream)).stopped,true);
      }return {roles:['enterprise_admin','admin','super_admin'],ptzBlocked:true};
    });
    await step('unknown relay acknowledgement is reconciled by ownership, never replayed',async()=>{
      await publish();let calls=0;
      class LostAck extends ZlmPublicLive {async create(app:string,stream:string,s:{app:string;stream:string}){calls++;await super.create(app,stream,s);throw new AssistantError('public_live_media_unknown',503);}}
      const lost=new LostAck(upstream.config);
      await assert.rejects(openLiveSession(f.eid,String(state.id),String(state.versionId),{kind:'public'},lost));
      await assert.rejects(openLiveSession(f.eid,String(state.id),String(state.versionId),{kind:'public'},lost));assert.equal(calls,1);
      await reconcileLiveProxies(upstream);
      const p=await withTenantTransaction(f.eid,tx=>rows(tx,sql`select state from app.construction_public_live_proxies where enterprise_id=${f.eid} and live_id=${String(state.id)} and version_id=${String(state.versionId)}`));assert.ok(p.every(r=>r.state==='stopped'));
      return {createCalls:calls,retainedAttempts:p.length,reconciled:true};
    });
    await step('membership revocation persists across restoration; photos remain independent',async()=>{
      const photosBefore=await withTenantTransaction(f.eid,tx=>rows(tx,sql`select * from app.construction_public_sites where enterprise_id=${f.eid} and project_id=${f.pid}`));
      const owner=new ConstructionService({enterpriseId:f.eid,adminId:f.adminIds.enterprise_admin});
      let p=await owner.execute('detail',{projectId:f.pid});
      await owner.execute('member',{projectId:f.pid,expectedVersion:(p.project as Row).version,adminId:staff.adminId,role:'manager',active:false,workLabel:''},randomUUID());
      await assert.rejects(publicLiveDetail(f.eid,String(state.key)));
      p=await owner.execute('detail',{projectId:f.pid});await owner.execute('member',{projectId:f.pid,expectedVersion:(p.project as Row).version,adminId:staff.adminId,role:'manager',active:true,workLabel:''},randomUUID());
      await assert.rejects(publicLiveDetail(f.eid,String(state.key)));
      const current=await admin('enterprise_admin').read(f.pid);assert.equal(current.material?.status,'withdrawn');
      assert.deepEqual(await withTenantTransaction(f.eid,tx=>rows(tx,sql`select * from app.construction_public_sites where enterprise_id=${f.eid} and project_id=${f.pid}`)),photosBefore);
      return {restorationRevives:false,photoRowsUnchanged:true};
    });
    report.mediaConfigurationAfter=await mediaConfiguration();assert.deepEqual(report.mediaConfigurationAfter,report.mediaConfiguration);
    report.drift=comparePublicLive(report.before);assert.deepEqual(report.drift,[]);report.passed=true;
  }catch(e){report.passed=false;report.error=e instanceof Error?e.stack:String(e);throw e;}
  finally{
    try{if(state){const view=await admin('enterprise_admin').read(f.pid);if(view.material&&view.material.status!=='withdrawn')await admin('enterprise_admin').mutate(f.pid,'withdraw',{versionId:view.material.versionId,expectedRevision:view.revision},randomUUID());report.cleanup=await stopLiveProxies(f.eid,String(state.id),upstream);}}
    catch(e){report.cleanup={stopped:false,error:e instanceof Error?e.message:String(e)};}
    if(report.before)report.drift=comparePublicLive(report.before);report.mediaConfigurationAfter=await mediaConfiguration().catch(()=>null);save();await closePostgresPool();
  }
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
