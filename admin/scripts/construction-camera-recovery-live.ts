import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {sql} from 'drizzle-orm';
import {withTenantTransaction} from '../src/db/transaction';
import {one,rows} from '../src/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '../src/lib/postgresql';
import {CameraService,exchangeCameraEntry,sessionHeartbeat} from '../src/lib/construction/camera/service';
import {saveRecordingPolicy,reconcileRecordings,listCameraRecordings,startRecordingView} from '../src/lib/construction/camera/recordings';
import {cameraWvp} from '../src/lib/construction/camera/wvp';
import {cameraLiveDeployment} from './construction-camera-environment.mjs';

async function run(){
 const db=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(db.port,'55432');assert.equal(db.pathname,'/cloud_camera_eval');
 assert.equal(process.env.CAMERA_PUBLIC_ORIGIN,'http://localhost:3017');assert.equal(process.env.CAMERA_APP_ORIGIN,'http://127.0.0.1:3018');
 const root=path.resolve('..'),out=path.join(root,'tmp/cloud-camera'),fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.private.json'),'utf8'));
 const actor={enterpriseId:fixture.enterpriseId,adminId:fixture.ownerId},service=new CameraService(actor),source=cameraWvp();
 const checks:Record<string,unknown>[]=[],report:Record<string,unknown>={started:new Date().toISOString(),checks};
 const prior=JSON.parse(fs.readFileSync(path.join(out,'verification.json'),'utf8'));
 const files=[...new Set([...Object.keys(prior.before),'admin/drizzle/0092_construction_recording_recovery.sql','admin/drizzle/0093_construction_recording_clock.sql','admin/src/lib/construction/camera/recording-index.ts','admin/src/lib/construction/camera/recording-clock.ts','admin/scripts/construction-camera-recovery-live.ts','admin/package-lock.json','admin/tsconfig.json','tmp/cloud-camera/fixture.private.json',process.env.CAMERA_LOCAL_WVP_ENV!,'admin/scripts/construction-camera-environment.mjs'])] as string[];
 const bind=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.resolve(root,f))).digest('hex')]));
 const before=bind();report.before=before;
 const batch=cameraLiveDeployment(process.env);report.deployment=batch.context;report.recordingHostPath=batch.recordingHostPath;report.transport=batch.transport;report.imagesBefore=batch.images;
 const deadlocks=async()=>String((await withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select deadlocks from pg_stat_database where datname=current_database()`)))!.deadlocks);report.deadlocksBefore=await deadlocks();
 const evidence=path.join(out,'recovery-live-'+String(report.started).replace(/[:.]/g,'-')+'.json');
 let touched=false,sourceStart=0,session:Awaited<ReturnType<typeof exchangeCameraEntry>>|undefined;
 const persist=()=>fs.writeFileSync(evidence,JSON.stringify(report,null,2));
 async function check(name:string,work:()=>Promise<unknown>){try{const result=await work();checks.push({name,passed:true,result});console.log(name+': PASS');return result;}catch(e){checks.push({name,passed:false,error:(e as Error).message});throw e;}finally{persist();}}
 const policy=()=>withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select p.*,c.device_id,c.channel_id from app.construction_camera_recording_policies p join app.construction_cameras c on c.enterprise_id=p.enterprise_id and c.id=p.camera_id where p.binding_id=${fixture.bindingId}`));
 const camera=async()=> (await service.list(fixture.projectId)).items.find(c=>String(c.binding_id)===fixture.bindingId)!;
 async function waitState(wanted:string,after=0){let last;const deadline=Date.now()+90000;while(Date.now()<deadline){last=await policy();if(last?.state===wanted&&new Date(String(last.checked_at)).getTime()>after){const actual=await source.isRecording({app:String(last.stream_app),stream:String(last.stream_id)});if(actual===(wanted==='recording'))return last;}await delay(2000);}throw Error('Worker recovery timeout: '+wanted+'/'+String(last?.last_error));}
 function spawnGateway(){const child=cp.spawn(process.execPath,['--import','tsx','scripts/construction-camera-gateway.ts'],{cwd:process.cwd(),env:process.env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();report.replacementGatewayPid=child.pid;}
 function listener(){
  const command='$listener=Get-NetTCPConnection -LocalPort 3017 -State Listen -ErrorAction SilentlyContinue; if($listener){Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress}else{[pscustomobject]@{ProcessId=0;CommandLine=""}|ConvertTo-Json -Compress}';
  return JSON.parse(cp.execFileSync('powershell',['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true}));
 }
 async function waitGateway(oldPid:number){const deadline=Date.now()+30000;while(Date.now()<deadline){const next=listener();if(next.ProcessId&&next.ProcessId!==oldPid)try{const r=await fetch('http://localhost:3017/camera-gateway-health',{signal:AbortSignal.timeout(2000)});if(r.ok&&(await r.json()).service==='construction-camera-gateway')return next;}catch{}await delay(1000);}throw Error('Replacement gateway did not become ready');}
 try{
  await withTenantTransaction(fixture.enterpriseId,async tx=>{
   assert.equal((await one(tx,sql`select name from app.enterprises where id=${fixture.enterpriseId}`))?.name,'测试专用 · 云工地摄像头');
   const c=await camera();assert.ok(c);assert.equal(c.recording_enabled,false,'Refuse to take over an active recorder');
   assert.equal((await rows(tx,sql`select token_hash from app.construction_camera_sessions where project_id=${fixture.projectId} and view_expires_at>now() and closed_at is null`)).length,0,'No other fixture viewers during forced media loss');
  });
  await check('real worker starts the saved owner policy without driver reconciliation',async()=>{
   const c=await camera(),previous=(await policy())!;await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:true,retentionDays:3,expectedVersion:Number(c.recording_version)});touched=true;
   const p=await waitState('recording',new Date(String(previous.checked_at)).getTime());
   const period=await withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select source_started_at,clock_offset_min_ms,clock_offset_max_ms from app.construction_camera_recording_periods where binding_id=${fixture.bindingId} and ended_at is null`));assert.ok(period?.source_started_at);sourceStart=new Date(String(period.source_started_at)).getTime();
   return {state:p.state,actualWriter:true,sourceStart:period.source_started_at,clockOffsetMinMs:period.clock_offset_min_ms,clockOffsetMaxMs:period.clock_offset_max_ms};
  });
  await check('controlled loss of only the owned media stream recovers automatically',async()=>{
   await delay(12000);const p=(await policy())!;assert.equal(p.stream_app,'rtp');assert.equal(p.stream_id,String(p.device_id)+'_'+String(p.channel_id));
   const url=new URL('/index/api/close_stream',source.mediaOrigin);url.search=new URLSearchParams({secret:process.env.CAMERA_ZLM_SECRET!,schema:'rtsp',vhost:'__defaultVhost__',app:String(p.stream_app),stream:String(p.stream_id),force:'1'}).toString();
   const began=Date.now(),response=await fetch(url,{signal:AbortSignal.timeout(10000)}),result=await response.json();assert.equal(result.code,0,JSON.stringify(result));assert.equal(result.result,0,'The owned stream must actually close');
   const recovered=await waitState('recording',new Date(String(p.checked_at)).getTime());return {closedStreams:1,closeResult:result.result,state:recovered.state,recoveryMs:Date.now()-began};
  });
  await check('gateway process restart preserves recording and resumes durable reconciliation',async()=>{
   const old=listener();assert.ok(old.ProcessId);assert.ok(/node.*--import tsx scripts[\\/]construction-camera-gateway\.ts/i.test(old.CommandLine));
   const began=Date.now();process.kill(Number(old.ProcessId),'SIGKILL');
   let previousCheck=0;
   try{await delay(2000);const p=(await policy())!;previousCheck=new Date(String(p.checked_at)).getTime();assert.equal(await source.isRecording({app:String(p.stream_app),stream:String(p.stream_id)}),true,'Gateway shutdown must not stop the WVP writer');}
   finally{spawnGateway();}
   const next=await waitGateway(Number(old.ProcessId)),recovered=await waitState('recording',previousCheck);assert.notEqual(next.ProcessId,old.ProcessId);
   return {oldPid:old.ProcessId,newPid:next.ProcessId,state:recovered.state,recoveryMs:Date.now()-began};
  });
  await check('stopping seals recovered footage and fresh authorized playback works',async()=>{
   await delay(12000);const c=await camera();await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});await waitState('stopped');
   const entry=await service.entry(fixture.projectId);session=await exchangeCameraEntry(entry.url.split('#entry=')[1]);const day=new Date(Date.now()+28800000).toISOString().slice(0,10);
   let list;const deadline=Date.now()+30000;do{list=await listCameraRecordings(session.session,day,session.csrf);if(list.items.filter(r=>new Date(String(r.started_at)).getTime()>=sourceStart).length>=2)break;await delay(2000);}while(Date.now()<deadline);
   const fresh=list!.items.filter(r=>new Date(String(r.started_at)).getTime()>=sourceStart);assert.ok(fresh.length>=2,'Expected sealed media on both sides of the controlled loss');
   const old=list!.items.find(r=>new Date(String(r.started_at)).getTime()<sourceStart);assert.ok(old,'Prior owned history must remain accessible after reenable');
   const play=await startRecordingView(session.session,session.csrf,String(fresh.at(-1)!.id));
   const media=await fetch('http://localhost:3017'+play.url,{headers:{Cookie:'construction_camera_session='+session.session,Range:'bytes=0-4095'},signal:AbortSignal.timeout(15000)});assert.equal(media.status,206);assert.ok(Buffer.from(await media.arrayBuffer()).includes(Buffer.from('ftyp')));
   const denied=await fetch('http://localhost:3017'+play.url,{headers:{Range:'bytes=0-4095'}});assert.equal(denied.status,401);
   return {newSegments:fresh.map(r=>({id:r.id,start:r.started_at,end:r.ended_at,bytes:r.bytes})),priorRecordingId:old.id,range:206,anonymous:401};
  });
  report.passed=true;
 }catch(e){report.error=(e as Error).message;const cause=(e as Error).cause as {code?:string;detail?:string;message?:string}|undefined;report.failureCause=cause?{code:cause.code,detail:cause.detail,message:cause.message}:undefined;report.passed=false;process.exitCode=1;console.error(report.error);if(report.failureCause)console.error(JSON.stringify(report.failureCause));}
 finally{
  if(session)try{await sessionHeartbeat(session.session,session.csrf,true);}catch(e){report.sessionCleanupError=(e as Error).message;report.passed=false;process.exitCode=1;}
  if(touched)try{const c=await camera();if(c.recording_enabled)await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});await reconcileRecordings();const p=await waitState('stopped');report.cleanup={enabled:p.enabled,state:p.state};}catch(e){report.cleanupError=(e as Error).message;report.passed=false;process.exitCode=1;}
  report.after=bind();report.drift=files.filter(f=>before[f]!== (report.after as Record<string,string>)[f]);try{report.imagesAfter=batch.capture();}catch(e){report.bindingError=(e as Error).message;}report.deadlocksAfter=await deadlocks();if((report.drift as string[]).length||report.bindingError||JSON.stringify(report.imagesAfter)!==JSON.stringify(report.imagesBefore)||report.deadlocksBefore!==report.deadlocksAfter){report.passed=false;process.exitCode=1;report.bindingError=(report.bindingError as string)||'Source/media drift or a new deadlock';}
  report.finished=new Date().toISOString();persist();fs.writeFileSync(path.join(out,'recovery-live.json'),JSON.stringify(report,null,2));await closePostgresPool();
 }
}
void run().catch(async e=>{console.error(e.message);process.exitCode=1;await closePostgresPool();});
