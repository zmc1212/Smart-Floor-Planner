import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {createServer} from 'node:http';
import {randomBytes,createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {sql} from 'drizzle-orm';
import {withTenantTransaction,withPlatformTransaction} from '../src/db/transaction';
import {one,rows} from '../src/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '../src/lib/postgresql';
import {CameraService,exchangeCameraEntry,startCameraView,sessionHeartbeat} from '../src/lib/construction/camera/service';
import {saveRecordingPolicy,listCameraRecordings,startRecordingView} from '../src/lib/construction/camera/recordings';
import {cameraWvp} from '../src/lib/construction/camera/wvp';
import {currentStorageHealth} from '../src/lib/construction/camera/storage';
import {cameraLiveDeployment, ownedGateway} from './construction-camera-environment.mjs';

async function run(){
 const database=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(database.port,'55432');assert.equal(database.pathname,'/cloud_camera_eval');
 assert.equal(process.env.CAMERA_PUBLIC_ORIGIN,'http://localhost:3017');assert.equal(process.env.CAMERA_APP_ORIGIN,'http://127.0.0.1:3018');
 const root=path.resolve('..'),out=path.join(root,'tmp/cloud-camera'),fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.private.json'),'utf8'));
 const actor={enterpriseId:fixture.enterpriseId,adminId:fixture.ownerId},service=new CameraService(actor),source=cameraWvp();
 const realOrigin=process.env.CAMERA_STORAGE_ORIGIN!,realToken=process.env.CAMERA_STORAGE_TOKEN!,token=randomBytes(32).toString('hex');assert.ok(realOrigin&&realToken);
 let mode='actual',touched=false,ownedVersion=0,fixtureGateway=0,session:Awaited<ReturnType<typeof exchangeCameraEntry>>|undefined;
 const report:Record<string,unknown>={started:new Date().toISOString(),scenario:'Simulated capacity/outage evidence; real WVP writer, live FLV and private playback. The physical disk is never filled.',checks:[]};
 const checks=report.checks as Record<string,unknown>[],evidence=path.join(out,'storage-live-'+String(report.started).replace(/[:.]/g,'-')+'.json');
 const verification=JSON.parse(fs.readFileSync(path.join(out,'verification.json'),'utf8'));
 const files=[...new Set([...Object.keys(verification.before),'admin/drizzle/0094_construction_camera_storage.sql','admin/src/lib/construction/camera/storage.ts','admin/src/lib/construction/camera/writer-policy.ts','admin/src/lib/construction/camera/__tests__/storage.test.ts','admin/scripts/construction-camera-storage-live.ts','admin/docker/camera-storage/server.py','admin/docker/camera-storage/Dockerfile','admin/docker-compose.camera-storage.yml','admin/scripts/construction-camera-storage-local.mjs','admin/scripts/construction-camera-environment.mjs','tmp/cloud-camera/storage.private.json'])] as string[];
 const bind=()=>Object.fromEntries(files.map(f=>[f,fs.existsSync(path.resolve(root,f))?createHash('sha256').update(fs.readFileSync(path.resolve(root,f))).digest('hex'):'missing']));report.before=bind();
 const batch=cameraLiveDeployment(process.env);report.deployment=batch.context;report.recordingHostPath=batch.recordingHostPath;report.transport=batch.transport;report.imagesBefore=batch.images;
 const persist=()=>fs.writeFileSync(evidence,JSON.stringify(report,null,2));
 const server=createServer(async(req,res)=>{
  if(req.url!=='/storage'||req.headers.authorization!=='Bearer '+token){res.writeHead(401).end();return;}
  if(mode==='unavailable'){res.writeHead(503).end();return;}
  try{
   let body;if(mode==='actual'){const r=await fetch(realOrigin+'/storage',{headers:{Authorization:'Bearer '+realToken},signal:AbortSignal.timeout(3000)});assert.equal(r.status,200);body=await r.json();}
   else {const available=({warning:150n,critical:80n,blocked:40n,hysteresis:70n,recovered:120n} as Record<string,bigint>)[mode];assert.ok(available);body={version:1,node:'wvp-zlm-01',sampledAt:new Date().toISOString(),totalBytes:String(1000n*1024n**3n),availableBytes:String(available*1024n**3n),freeBytes:String(available*1024n**3n),files:'100000',availableFiles:'90000'};}
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
  }catch{res.writeHead(503).end();}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const fixtureOrigin='http://127.0.0.1:'+(server.address() as {port:number}).port;
 const policy=()=>withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select * from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`));
 function listener(){const cmd='$p=Get-NetTCPConnection -LocalPort 3017 -State Listen -ErrorAction SilentlyContinue; if($p){Get-CimInstance Win32_Process -Filter "ProcessId=$($p.OwningProcess)"|Select-Object ProcessId,CommandLine|ConvertTo-Json -Compress}else{[pscustomobject]@{ProcessId=0;CommandLine=""}|ConvertTo-Json -Compress}';return JSON.parse(cp.execFileSync('powershell',['-NoProfile','-Command',cmd],{encoding:'utf8',windowsHide:true}));}
 function stopOwned(pid:number){const current=listener();assert.equal(Number(current.ProcessId),pid);assert.match(current.CommandLine,ownedGateway);process.kill(pid,'SIGKILL');}
 function spawnGateway(){const child=cp.spawn(process.execPath,['--import','tsx','scripts/construction-camera-gateway.ts'],{cwd:process.cwd(),env:process.env,windowsHide:true,detached:true,stdio:'ignore'});child.unref();return Number(child.pid);}
 async function gatewayReady(){for(let n=0;n<30;n++){try{const r=await fetch('http://localhost:3017/camera-gateway-health',{signal:AbortSignal.timeout(1500)});if(r.ok)return;}catch{}await delay(1000);}throw Error('Gateway not ready');}
 async function waitState(level:string,state:string,actual:boolean){let last,lastActual;for(let n=0;n<45;n++){last=await policy();if(last?.storage_level===level&&last.state===state&&(await currentStorageHealth()).level===level){lastActual=await source.isRecording({app:String(last.stream_app),stream:String(last.stream_id)});if(lastActual===actual)return last;}await delay(2000);}throw Error('Storage transition timeout '+JSON.stringify({wanted:{level,state,actual},observed:{level:last?.storage_level,state:last?.state,error:last?.last_error,actual:lastActual}}));}
 async function check(name:string,work:()=>Promise<unknown>){try{const result=await work();checks.push({name,passed:true,result});console.log(name+': PASS');return result;}catch(e){checks.push({name,passed:false,error:(e as Error).message});throw e;}finally{persist();}}
 try{
  await withPlatformTransaction(async tx=>{const enterprise=await one(tx,sql`select name from app.enterprises where id=${fixture.enterpriseId}`);assert.ok(enterprise?.name==='测试专用 · 云工地摄像头'||(String(fixture.enterpriseId)==='1454'&&enterprise?.name==='微云'),'Approved isolated test enterprise only');assert.equal((await rows(tx,sql`select binding_id from app.construction_camera_recording_policies where enabled`)).length,0,'Refuse other active recorders');assert.equal((await rows(tx,sql`select binding_id from app.construction_camera_recording_policies where enterprise_id not in ('3','1454')`)).length,0,'Dedicated fixture database only');assert.equal((await rows(tx,sql`select camera_id from app.construction_camera_controls where stop_required`)).length,0);assert.equal((await rows(tx,sql`select token_hash from app.construction_camera_sessions where view_expires_at>now() and closed_at is null`)).length,0);});
  await check('real media-volume metrics and independent worker start the owned recorder',async()=>{
   const old=listener();stopOwned(Number(old.ProcessId));process.env.CAMERA_STORAGE_ORIGIN=fixtureOrigin;process.env.CAMERA_STORAGE_TOKEN=token;fixtureGateway=spawnGateway();await gatewayReady();await waitState('ok','stopped',false);
   const p=(await policy())!,receipt=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:true,retentionDays:3,expectedVersion:Number(p.version)});ownedVersion=Number(receipt!.version);touched=true;const active=await waitState('ok','recording',true);return {level:'ok',actualWriter:true,version:active.version};
  });
  await check('80-percent warning and 90-percent critical alerts preserve actual recording',async()=>{
   mode='warning';await waitState('warning','recording',true);const warning=await service.list(fixture.projectId);assert.equal(warning.storage!.level,'warning');mode='critical';await waitState('critical','recording',true);
   return {simulatedUsedPercent:[85,92],warningVisible:warning.storage!.level,persistedOnReentry:(await service.list(fixture.projectId)).storage!.level};
  });
  await check('low-space protection actually stops writing while authorized playback and live FLV remain usable',async()=>{
   await delay(3000);mode='blocked';const stopped=await waitState('blocked','error',false);assert.equal(stopped.enabled,true);assert.equal(stopped.last_error,'camera_storage_low');
   const entry=await service.entry(fixture.projectId);session=await exchangeCameraEntry(entry.url.split('#entry=')[1]);const day=new Date(Date.now()+28800000).toISOString().slice(0,10),list=await listCameraRecordings(session.session,day,session.csrf);assert.equal(list.recordingNotice,'camera_storage_low');assert.ok(list.items.length);
   const play=await startRecordingView(session.session,session.csrf,String(list.items.at(-1)!.id)),headers={Cookie:'construction_camera_session='+session.session,Range:'bytes=0-4095'};
   const mp4=await fetch('http://localhost:3017'+play.url,{headers,signal:AbortSignal.timeout(15000)});assert.equal(mp4.status,206);assert.ok(Buffer.from(await mp4.arrayBuffer()).includes(Buffer.from('ftyp')));
   const live=await startCameraView(session.session,session.csrf,fixture.bindingId),abort=new AbortController();const response=await fetch('http://localhost:3017/camera-media/'+live.generation+'/live.flv',{headers:{Cookie:'construction_camera_session='+session.session},signal:abort.signal});assert.equal(response.status,200);const reader=response.body!.getReader();try{const first=await reader.read();assert.equal(Buffer.from(first.value!).subarray(0,3).toString(),'FLV');}finally{await reader.cancel();abort.abort();}
   const afterLive=await policy();const [planDevice,planChannel]=String(stopped.stream_id).split('_');report.afterLiveProtection={actualWriter:await source.isRecording({app:String(stopped.stream_app),stream:String(stopped.stream_id)}),state:afterLive?.state,level:afterLive?.storage_level,providerPlan:(await source.recordingChannel(planDevice,planChannel,Number(stopped.plan_id))).planId};persist();
   assert.equal((report.afterLiveProtection as {actualWriter:boolean}).actualWriter,false,'Opening live must not restart a protected MP4 writer');await sessionHeartbeat(session.session,session.csrf,true);session=undefined;
   if(process.argv.includes('--ui-hold')){const marker=evidence.replace(/\.json$/,'.ui-complete');report.uiHoldUntil=new Date(Date.now()+600000).toISOString();report.uiHoldFile=marker;persist();console.log('UI hold: simulated low space, confirmed writer stopped; '+marker);const deadline=Date.now()+600000;while(!fs.existsSync(marker)&&Date.now()<deadline)await delay(1000);}
   return {simulatedUsedPercent:96,actualWriter:false,savedIntent:true,notice:list.recordingNotice,privatePlayback:206,live:'FLV',historyCount:list.items.length};
  });
  await check('hysteresis keeps 93-percent storage paused and 88-percent storage resumes the original intent',async()=>{mode='hysteresis';await waitState('blocked','error',false);mode='recovered';const active=await waitState('warning','recording',true);assert.equal(Number(active.version),ownedVersion);return {heldAt:93,resumedAt:88,actualWriter:true,unchangedVersion:true};});
  await check('unavailable capacity evidence stops the actual writer and exposes the durable failure',async()=>{mode='unavailable';const stopped=await waitState('unavailable','error',false);assert.equal(stopped.last_error,'camera_storage_unavailable');return {actualWriter:false,error:stopped.last_error,level:(await service.list(fixture.projectId)).storage!.level};});
  await check('saved off remains stopped after the real media-volume probe recovers',async()=>{const p=(await policy())!,saved=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:Number(p.version)});ownedVersion=Number(saved!.version);await waitState('unavailable','stopped',false);mode='actual';const stopped=await waitState('ok','stopped',false);assert.equal(stopped.enabled,false);return {enabled:false,state:stopped.state,retentionDays:stopped.retention_days};});
  report.passed=true;
 }catch(e){report.passed=false;report.error=(e as Error).message;process.exitCode=1;console.error(report.error);}
 finally{
  if(session)try{await sessionHeartbeat(session.session,session.csrf,true);}catch{}
  try{if(touched){const p=await policy();if(p?.enabled){assert.equal(Number(p.version),ownedVersion,'Do not overwrite a human policy change');await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:ownedVersion});}}}catch(e){report.cleanupError=(e as Error).message;report.passed=false;process.exitCode=1;}
  try{if(fixtureGateway){stopOwned(fixtureGateway);process.env.CAMERA_STORAGE_ORIGIN=realOrigin;process.env.CAMERA_STORAGE_TOKEN=realToken;report.restoredGatewayPid=spawnGateway();await gatewayReady();await waitState('ok','stopped',false);}}catch(e){report.gatewayCleanupError=(e as Error).message;report.passed=false;process.exitCode=1;}
  process.env.CAMERA_STORAGE_ORIGIN=realOrigin;process.env.CAMERA_STORAGE_TOKEN=realToken;await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});
  report.after=bind();report.drift=files.filter(f=>(report.before as Record<string,string>)[f]!== (report.after as Record<string,string>)[f]);try{report.imagesAfter=batch.capture();}catch(e){report.bindingError=(e as Error).message;}if((report.drift as string[]).length||report.bindingError||JSON.stringify(report.imagesAfter)!==JSON.stringify(report.imagesBefore)){report.passed=false;report.bindingError=(report.bindingError as string)||'Source or deployment drift';process.exitCode=1;}
  report.finished=new Date().toISOString();persist();fs.writeFileSync(path.join(out,'storage-live.json'),JSON.stringify(report,null,2));await closePostgresPool();
 }
}
void run().catch(async e=>{console.error(e.message);process.exitCode=1;await closePostgresPool();});
