// Actual elapsed time only. --smoke verifies this driver, never 24/72h acceptance.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import {sql} from 'drizzle-orm';
import {withTenantTransaction,withPlatformTransaction} from '../src/db/transaction';
import {one,rows} from '../src/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '../src/lib/postgresql';
import {CameraService,exchangeCameraEntry,sessionHeartbeat} from '../src/lib/construction/camera/service';
import {saveRecordingPolicy,listCameraRecordings,startRecordingView} from '../src/lib/construction/camera/recordings';
import {cameraWvp} from '../src/lib/construction/camera/wvp';
import {currentStorageHealth} from '../src/lib/construction/camera/storage';

async function run(){
 const connection=resolvePostgresRuntimeConfig().connectionString,database=new URL(connection);assert.ok(['127.0.0.1','localhost'].includes(database.hostname));assert.equal(database.port,'55432');assert.equal(database.pathname,'/cloud_camera_eval');
 assert.equal(process.env.CAMERA_PUBLIC_ORIGIN,'http://localhost:3017');assert.equal(process.env.CAMERA_APP_ORIGIN,'http://127.0.0.1:3018');
 const root=path.resolve('..'),out=process.env.CAMERA_TEST_OUTPUT?path.resolve(process.env.CAMERA_TEST_OUTPUT):path.join(root,'tmp/cloud-camera'),fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.private.json'),'utf8'));
 const actor={enterpriseId:fixture.enterpriseId,adminId:fixture.ownerId},service=new CameraService(actor),source=cameraWvp(),smoke=process.argv.includes('--smoke');
 const durationMs=smoke?180000:74*3600000,intervalMs=smoke?10000:60000;
 const preflight=process.argv.includes('--preflight'),prefix=preflight?'soak-preflight':smoke?'soak-smoke':'soak';
 const started=new Date().toISOString(),runId=started.replace(/[:.]/g,'-'),file=path.join(out,prefix+'-'+runId+'.json'),alias=path.join(out,prefix+'.json');
 const report:Record<string,unknown>={runId,mode:preflight?'read-only-preflight':smoke?'driver-smoke':'74h-soak',started,pid:process.pid,controllerScript:path.resolve(process.argv[1]),status:'starting',targetHours:preflight?0:durationMs/3600000,intervalMs,observations:0,milestones:[],checks:[],fixture:{enterpriseId:fixture.enterpriseId,projectId:fixture.projectId,bindingId:fixture.bindingId,ownerId:fixture.ownerId}};
 const milestones=report.milestones as Record<string,unknown>[],checks=report.checks as Record<string,unknown>[];
 const folders=['admin/src/lib/construction/camera','admin/public/construction-camera'];
 const walk=(folder:string):string[]=>fs.readdirSync(path.join(root,folder),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(folder+'/'+e.name):[folder+'/'+e.name]);
 const files=[...folders.flatMap(walk),'admin/src/db/transaction.ts','admin/src/db/repositories/assistant-repository.ts','admin/src/db/construction-camera-schema.ts','admin/src/lib/postgresql.ts','admin/src/lib/construction/service.ts','admin/src/lib/construction/contracts.ts','admin/src/lib/assistant/contracts/index.ts','admin/src/lib/admin-user-roles.ts','admin/scripts/construction-camera-gateway.ts','admin/scripts/construction-camera-local.mjs','admin/scripts/construction-camera-soak.ts','admin/docker/camera-storage/server.py','admin/docker/camera-storage/Dockerfile','admin/docker-compose.camera-storage.yml','admin/drizzle/0090_construction_cameras.sql','admin/drizzle/0091_construction_recordings.sql','admin/drizzle/0092_construction_recording_recovery.sql','admin/drizzle/0093_construction_recording_clock.sql','admin/drizzle/0094_construction_camera_storage.sql','tmp/cloud-camera/storage.private.json',process.env.CAMERA_LOCAL_WVP_ENV!];
 const bind=()=>Object.fromEntries(files.map(f=>[f,fs.existsSync(path.resolve(root,f))?createHash('sha256').update(fs.readFileSync(path.resolve(root,f))).digest('hex'):'missing']));report.before=bind();
 files.push('admin/docker-compose.camera-media.local.yml','admin/docker-compose.camera-storage.host.yml','admin/scripts/construction-camera-soak-control.ts','tmp/cloud-camera/storage-deployment.json');report.before=bind();
 // A new batch supplements the original binding before execution; it never
 // rewrites the frozen scope or receipts of a historical run.
 if(process.env.CAMERA_SOAK_BINDING_MANIFEST){const manifest=path.resolve(process.env.CAMERA_SOAK_BINDING_MANIFEST),extra=JSON.parse(fs.readFileSync(manifest,'utf8'));assert.ok(Array.isArray(extra.files)&&extra.files.every((f:unknown)=>typeof f==='string'&&fs.statSync(path.resolve(root,f)).isFile()));files.push(...extra.files,manifest);report.before=bind();}
 const images=()=>{
  const snapshot=JSON.parse(cp.execFileSync('docker',['--context','desktop-linux','inspect','--format','{"name":{{json .Name}},"image":{{json .Image}},"mounts":{{json .Mounts}}}','wvp-stack-zlm-1','wvp-stack-wvp-1','sfp-camera-storage-storage-1'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/).map(l=>l.trim()).join(',').replace(/^/,'[').replace(/$/,']')) as {name:string;image:string;mounts:{Destination:string}[]}[];
  // Docker's mount order is not stable. Retain every field but compare by target.
  return snapshot.map(s=>({...s,mounts:s.mounts.sort((a,b)=>a.Destination.localeCompare(b.Destination))})).sort((a,b)=>a.name.localeCompare(b.name));
 };
 report.imagesBefore=images();
 const persist=()=>{const data=JSON.stringify(report,null,2),temporary=file+'.tmp';fs.writeFileSync(temporary,data);fs.renameSync(temporary,file);fs.writeFileSync(alias,data);};
 const lock=new pg.Client({connectionString:connection,application_name:'construction-camera-soak'});let locked=false,touched=false,version=0,sourceStart=0,interrupted=false,originalMode='cloud',originalDays=3;
 const policy=()=>withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select *,checked_at>clock_timestamp()-interval '30 seconds' fresh from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`));
 const history=()=>withTenantTransaction(fixture.enterpriseId,tx=>rows(tx,sql`select id,source_id,started_at,ended_at,bytes,state,file_path,clock_offset_max_ms from app.construction_recordings where binding_id=${fixture.bindingId} and started_at>=${new Date(sourceStart)} order by started_at,id`));
 async function waitState(state:string){for(let n=0;n<45;n++){const p=await policy();if(p?.state===state&&p.fresh&&await source.isRecording({app:String(p.stream_app),stream:String(p.stream_id)})===(state==='recording'))return p;await delay(2000);}throw Error('Independent worker did not confirm '+state);}
 async function playback(){
  const entry=await service.entry(fixture.projectId),session=await exchangeCameraEntry(entry.url.split('#entry=')[1]);
  try{
   const latest=(await history()).filter(r=>r.state==='ready').at(-1);assert.ok(latest,'A new sealed segment must exist');
   const day=new Date(new Date(String(latest.started_at)).getTime()+28800000).toISOString().slice(0,10),list=await listCameraRecordings(session.session,day,session.csrf);assert.ok(list.items.length,'A fresh sealed segment must be indexed');
   const own=list.items.filter(r=>new Date(String(r.started_at)).getTime()>=sourceStart);assert.ok(own.length,'This run must produce its own sealed media');
   const record=own.at(-1)!,view=await startRecordingView(session.session,session.csrf,String(record.id));
   const result=await fetch('http://localhost:3017'+view.url,{headers:{Cookie:'construction_camera_session='+session.session,Range:'bytes=0-4095'},signal:AbortSignal.timeout(15000)});assert.equal(result.status,206);assert.ok(Buffer.from(await result.arrayBuffer()).includes(Buffer.from('ftyp')));
   const denied=await fetch('http://localhost:3017'+view.url,{headers:{Range:'bytes=0-4095'},signal:AbortSignal.timeout(5000)});assert.equal(denied.status,401);return {recordingId:record.id,range:206,anonymous:401};
  }finally{await sessionHeartbeat(session.session,session.csrf,true);}
 }
 function coverage(records:Awaited<ReturnType<typeof history>>){
  const spans=records.map(r=>({start:new Date(String(r.started_at)).getTime(),end:new Date(String(r.ended_at)).getTime()}));
  const gaps=spans.slice(1).map((s,i)=>Math.max(0,s.start-spans[i].end));
  return {segments:spans.length,first:spans[0]?.start??null,last:spans.at(-1)?.end??null,recordedSeconds:spans.reduce((n,s)=>n+(s.end-s.start)/1000,0),maxGapSeconds:Math.max(0,...gaps)/1000};
 }
 const signal=()=>{interrupted=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
 try{
  await lock.connect();locked=!!(await lock.query('select pg_try_advisory_lock(hashtextextended($1,0)) ok',['camera-soak:'+fixture.bindingId])).rows[0].ok;assert.ok(locked,'Another soak controller owns this binding');
  await withPlatformTransaction(async tx=>{
   const enterprise=await one(tx,sql`select name from app.enterprises where id=${fixture.enterpriseId}`);
   assert.ok(enterprise?.name==='测试专用 · 云工地摄像头'||(String(fixture.enterpriseId)==='1454'&&enterprise?.name==='微云'),'Approved isolated test enterprise only');
   const target=await one(tx,sql`select p.name,c.device_id,c.channel_id from app.construction_projects p join app.construction_camera_bindings b on b.enterprise_id=p.enterprise_id and b.project_id=p.id join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id where p.enterprise_id=${fixture.enterpriseId} and p.id=${fixture.projectId} and b.id=${fixture.bindingId} and p.status='active' and b.ended_at is null and c.enabled`);
   assert.ok(target&&String(target.name).startsWith('测试专用 ·'),'Retained labelled active project/binding only');
   if(String(fixture.enterpriseId)==='1454'){assert.equal(target.device_id,'34020000001320000005');assert.equal(target.channel_id,'34020000001320000006');}
   assert.equal((await rows(tx,sql`select binding_id from app.construction_camera_recording_policies where enabled or state<>'stopped'`)).length,0,'Never take over an existing or unconfirmed recorder');
   assert.equal((await rows(tx,sql`select id from app.construction_camera_sd_playbacks where state<>'stopped'`)).length,0,'Never take over pending SD playback');
  });
  const storage=await currentStorageHealth();assert.equal(storage.level,'ok');assert.equal(storage.blocked,false);assert.ok(BigInt(storage.availableBytes!)>100n*1024n**3n,'Long test needs at least100GiB free before starting');
  const before=(await policy())!;assert.ok(before,'Retained policy required');originalMode=String(before.recording_mode);originalDays=Number(before.retention_days);report.originalPolicy={recordingMode:originalMode,enabled:before.enabled,retentionDays:originalDays,version:Number(before.version)};
  if(preflight){report.status='preflight-complete';report.passed=true;report.soakPassed=false;report.storage={level:storage.level,availableBytes:storage.availableBytes};console.log(JSON.stringify({runId,status:report.status,policyUnchanged:true}));return;}
  const saved=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:true,retentionDays:3,recordingMode:'cloud',expectedVersion:Number(before.version)});version=Number(saved!.version);touched=true;report.policyVersion=version;
  await waitState('recording');const period=await withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select id,source_started_at from app.construction_camera_recording_periods where binding_id=${fixture.bindingId} and ended_at is null`));assert.ok(period?.source_started_at);sourceStart=new Date(String(period.source_started_at)).getTime();report.periodId=period.id;report.sourceStartedAt=period.source_started_at;
  const began=performance.now();let last=began,hour=0;report.status='running';report.recordingStarted=new Date().toISOString();report.expectedFinish=new Date(Date.now()+durationMs).toISOString();persist();console.log(JSON.stringify({runId,status:'running',mode:report.mode,pid:process.pid,expectedFinish:report.expectedFinish}));
  while(performance.now()-began<durationMs){
   if(interrupted||fs.existsSync(path.join(out,'soak-stop-'+runId+'.json')))throw Error('Soak interrupted by an explicit stop request');
   const now=performance.now(),gap=now-last;report.maxObservationGapMs=Math.max(Number(report.maxObservationGapMs||0),gap);if(gap>120000)throw Error('Unobserved interval exceeds120s; continuous operation cannot be claimed');last=now;
   const current=bind(),drift=files.filter(f=>(report.before as Record<string,string>)[f]!==current[f]);if(drift.length){report.drift=drift;throw Error('Bound source/configuration changed during soak');}
   const p=(await policy())!;assert.equal(Number(p.version),version,'Policy changed externally; do not overwrite its new intent');assert.equal(p.recording_mode,'cloud');assert.equal(p.enabled,true);assert.equal(p.retention_days,3);assert.equal(p.state,'recording',String(p.last_error));assert.equal(p.fresh,true,'Worker observation must remain fresh');
   const health=await currentStorageHealth();assert.equal(health.blocked,false,String(health.reason));assert.equal(await source.isRecording({app:String(p.stream_app),stream:String(p.stream_id)}),true);
   const records=await history(),covered=coverage(records),elapsed=performance.now()-began;
   assert.ok(covered.maxGapSeconds<=2,'A sealed recording gap exceeds2s');
   if(elapsed>3660000){assert.ok(covered.last);assert.ok(Date.now()-covered.last<3660000,'No fresh sealed segment within the1h node segment window');}
   report.observations=Number(report.observations)+1;report.lastObserved=new Date().toISOString();report.elapsedHours=elapsed/3600000;report.coverage=covered;report.storage={level:health.level,usedPercent:health.usedPercent,availableBytes:health.availableBytes};
   const currentHour=Math.floor(elapsed/3600000);
   if(currentHour>hour){hour=currentHour;assert.deepEqual(images(),report.imagesBefore,'Media/probe image changed');if(records.length)checks.push({name:'hourly private playback',hour,...await playback()});console.log(JSON.stringify({runId,hour,segments:records.length,status:'running'}));}
   for(const target of [24,72])if(!smoke&&elapsed>=target*3600000&&!milestones.some(m=>m.hours===target)){assert.ok(records.length>=target-1);milestones.push({hours:target,at:new Date().toISOString(),passed:true,coverage:covered,observations:report.observations});persist();}
   if(!smoke){const expired=records.find(r=>r.state==='deleted');if(expired&&!report.naturalExpiry){assert.ok(await source.cloudPath(Number(expired.source_id))===null);assert.ok([404,410].includes(await source.recordingFileStatus(String(expired.file_path))));report.naturalExpiry={recordingId:expired.id,at:new Date().toISOString(),bytesMissing:true,indexMissing:true};}}
   persist();await delay(Math.min(intervalMs,Math.max(0,durationMs-(performance.now()-began))));
  }
  report.status='finishing';const p=(await policy())!;assert.equal(Number(p.version),version);const stopped=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:version});version=Number(stopped!.version);report.policyVersion=version;await waitState('stopped');
  // Stop seals the tail. Only this run's new files count toward acceptance.
  let records=await history();for(let n=0;n<15&&(!records.length||Date.now()-new Date(String(records.at(-1)!.ended_at)).getTime()>20000);n++){await delay(2000);records=await history();}
  const covered=coverage(records);assert.ok(records.length);assert.ok(covered.maxGapSeconds<=2);checks.push({name:'final private playback',...await playback()});report.coverage=covered;
  if(!smoke){assert.deepEqual(milestones.map(m=>m.hours),[24,72]);assert.ok(report.naturalExpiry,'Natural three-day physical expiry was not confirmed');assert.ok(covered.recordedSeconds>=durationMs/1000-30);}
  report.status='completed';report.passed=true;report.soakPassed=!smoke;report.driverSmokePassed=smoke;
 }catch(e){report.status='failed';report.passed=false;report.soakPassed=false;report.error=(e as Error).message;process.exitCode=1;console.error(report.error);}
 finally{
  if(touched)try{const p=await policy();if(p?.enabled){if(Number(p.version)!==version){report.cleanupSkipped='External policy change; ownership lost';}else{const saved=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:version});version=Number(saved!.version);report.policyVersion=version;await waitState('stopped');}}report.cleanup={enabled:(await policy())?.enabled,state:(await policy())?.state};}catch(e){report.cleanupError=(e as Error).message;report.passed=false;report.soakPassed=false;report.status='failed';process.exitCode=1;}
  if(touched&&originalMode==='sd')try{const p=await policy();if(p?.enabled===false&&p.state==='stopped'&&p.recording_mode==='cloud'&&Number(p.version)===version){const restored=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:originalDays,recordingMode:'sd',expectedVersion:version});version=Number(restored!.version);report.policyVersion=version;await waitState('stopped');report.originalModeRestored=true;report.cleanup={enabled:false,state:'stopped',recordingMode:'sd'};}}catch(e){report.cleanupError=(e as Error).message;report.passed=false;report.soakPassed=false;report.status='failed';process.exitCode=1;}
  report.after=bind();report.drift=files.filter(f=>(report.before as Record<string,string>)[f]!== (report.after as Record<string,string>)[f]);if((report.drift as string[]).length){report.passed=false;report.soakPassed=false;report.driverSmokePassed=false;report.status='failed';process.exitCode=1;}
  try{report.imagesAfter=images();assert.deepEqual(report.imagesAfter,report.imagesBefore);}catch(e){report.imageError=(e as Error).message;report.passed=false;report.soakPassed=false;report.driverSmokePassed=false;report.status='failed';process.exitCode=1;}
  report.finished=new Date().toISOString();persist();if(locked)try{await lock.query('select pg_advisory_unlock(hashtextextended($1,0))',['camera-soak:'+fixture.bindingId]);}catch{}await lock.end();await closePostgresPool();process.off('SIGINT',signal);process.off('SIGTERM',signal);
 }
}
void run().catch(async e=>{console.error(e.message);process.exitCode=1;await closePostgresPool();});
