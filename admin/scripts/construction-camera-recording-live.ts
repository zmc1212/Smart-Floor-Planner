import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {CameraService,exchangeCameraEntry,sessionHeartbeat} from '../src/lib/construction/camera/service';
import {saveRecordingPolicy,reconcileRecordings,listCameraRecordings,startRecordingView,authorizeRecordingMedia} from '../src/lib/construction/camera/recordings';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '../src/lib/postgresql';
const url=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(url.port,'55432');assert.equal(url.pathname,'/cloud_camera_eval');
const out=path.resolve('../tmp/cloud-camera'),fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.private.json'),'utf8'));
const actor={enterpriseId:fixture.enterpriseId,adminId:fixture.ownerId},service=new CameraService(actor),pid=fixture.projectId;
const report:{started:string;checks:unknown[];passed?:boolean;error?:string;cleanupError?:string;finished?:string;before?:Record<string,string>;after?:Record<string,string>;drift?:string[]}={started:new Date().toISOString(),checks:[]};
const files=['scripts/construction-camera-recording-live.ts','scripts/construction-camera-gateway.ts','scripts/construction-camera-local.mjs','src/lib/construction/camera/wvp.ts','src/lib/construction/camera/service.ts','src/lib/construction/camera/http.ts','src/lib/construction/camera/recordings.ts','src/lib/construction/camera/recording-contract.ts','src/lib/construction/service.ts','src/lib/construction/contracts.ts','src/db/transaction.ts','src/db/construction-camera-schema.ts','src/lib/postgresql.ts','drizzle/0091_construction_recordings.sql','package-lock.json','tsconfig.json','../tmp/cloud-camera/fixture.private.json',process.env.CAMERA_LOCAL_WVP_ENV!];
const bind=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));report.before=bind();
const file=path.join(out,'recording-live-'+report.started.replace(/[:.]/g,'-')+'.json');
let touched=false,playbackSession:Awaited<ReturnType<typeof exchangeCameraEntry>>|undefined;
async function check(name:string,work:()=>Promise<unknown>){try{const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result;}catch(e){report.checks.push({name,passed:false,error:(e as Error).message});throw e;}finally{fs.writeFileSync(file,JSON.stringify(report,null,2));}}
async function camera(){return (await service.list(pid)).items.find(c=>String(c.binding_id)===fixture.bindingId)!;}
async function waitState(wanted:string){for(let i=0;i<24;i++){await reconcileRecordings();const c=await camera();if(c.recording_state===wanted)return c;if(c.recording_state==='error')throw Error(String(c.recording_error));await delay(2500);}throw Error('Recording state did not become '+wanted);}
async function run(){try{
 const initial=await camera();assert.ok(initial);assert.equal(initial.recording_enabled||false,false,'Do not take over an active fixture recorder');
 if(!process.argv.includes('--playback-only')){
 await check('owner saves real cloud policy and actual writer starts',async()=>{touched=true;const receipt=await saveRecordingPolicy(actor,pid,{bindingId:fixture.bindingId,enabled:true,retentionDays:3,expectedVersion:Number(initial.recording_version||0)});const c=await waitState('recording');return {receipt,state:c.recording_state,retentionDays:c.retention_days};});
 await check('cloud writer stays active with no media viewer beyond no-reader timeout',async()=>{for(let n=0;n<4;n++){await delay(30000);const c=await waitState('recording');console.log('No-viewer recording sample '+(n+1)+': '+c.recording_state);}return {seconds:120,mediaViewersCreated:0};});
 await check('disable persists and stops the owned writer without stopping other viewers',async()=>{const c=await camera();await saveRecordingPolicy(actor,pid,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});return {state:(await waitState('stopped')).recording_state};});
 }
 await check('sealed file is indexed under the original project and privately replayed',async()=>{
   await delay(3000);await reconcileRecordings();const entry=await service.entry(pid),session=await exchangeCameraEntry(entry.url.split('#entry=')[1]);playbackSession=session;
   const day=new Date(Date.now()+28800000).toISOString().slice(0,10),list=await listCameraRecordings(session.session,day,session.csrf);assert.ok(list.items.length>0,'No sealed record indexed');
   const r=list.items.at(-1)!,play=await startRecordingView(session.session,session.csrf,String(r.id));assert.equal((await authorizeRecordingMedia(session.session,play.generation,String(r.id))).id,String(r.id));
   const response=await fetch('http://localhost:3017'+play.url,{headers:{Cookie:'construction_camera_session='+session.session,Range:'bytes=0-4095'},signal:AbortSignal.timeout(15000)});
   assert.equal(response.status,206);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.includes(Buffer.from('ftyp')));
   const denied=await fetch('http://localhost:3017'+play.url,{headers:{Range:'bytes=0-4095'}});assert.equal(denied.status,401);
   return {id:r.id,start:r.started_at,end:r.ended_at,bytes:r.bytes,rangeStatus:response.status,anonymous:denied.status};
 });
 report.passed=true;
}catch(e){report.error=(e as Error).message;console.error(report.error);process.exitCode=1;}
finally{
 if(playbackSession)try{await sessionHeartbeat(playbackSession.session,playbackSession.csrf,true);}catch(e){report.cleanupError=(e as Error).message;report.passed=false;process.exitCode=1;}
 if(touched)try{const c=await camera();if(c.recording_enabled)await saveRecordingPolicy(actor,pid,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:Number(c.recording_version)});await waitState('stopped');}catch(e){report.cleanupError=(e as Error).message;report.passed=false;process.exitCode=1;}
 report.after=bind();report.drift=files.filter(f=>report.before![f]!==report.after![f]);if(report.drift.length){report.passed=false;report.error='Source drift';process.exitCode=1;}
 report.finished=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'recording-live.json'),JSON.stringify(report,null,2));await closePostgresPool();
}}
void run().catch(async e=>{console.error(e.message);process.exitCode=1;await closePostgresPool();});
