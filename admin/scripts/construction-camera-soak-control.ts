import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {sql} from 'drizzle-orm';
import {withTenantTransaction} from '../src/db/transaction';
import {one} from '../src/db/repositories/assistant-repository';
import {saveRecordingPolicy} from '../src/lib/construction/camera/recordings';
import {cameraWvp} from '../src/lib/construction/camera/wvp';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '../src/lib/postgresql';

async function run(){
 const database=new URL(resolvePostgresRuntimeConfig().connectionString);assert.ok(['localhost','127.0.0.1'].includes(database.hostname));assert.equal(database.port,'55432');assert.equal(database.pathname,'/cloud_camera_eval');
 const out=process.env.CAMERA_TEST_OUTPUT?path.resolve(process.env.CAMERA_TEST_OUTPUT):path.resolve('../tmp/cloud-camera'),alias=path.join(out,'soak.json'),report=JSON.parse(fs.readFileSync(alias,'utf8')),fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.private.json'),'utf8'));
 assert.equal(report.mode,'74h-soak');assert.match(report.runId,/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/);assert.ok(Number.isSafeInteger(report.pid)&&report.pid>0);
 for(const key of ['enterpriseId','projectId','bindingId','ownerId'])assert.equal(report.fixture[key],fixture[key],'Refuse a different fixture');
 let command='';
 if(process.platform==='win32')command=cp.execFileSync('powershell',['-NoProfile','-Command',`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${report.pid}';if($p){$p.CommandLine}`],{encoding:'utf8',windowsHide:true}).trim();
 else try{command=fs.readFileSync('/proc/'+report.pid+'/cmdline','utf8').replaceAll('\0',' ');}catch{}
 const controllerAlive=/node.*(?:--import\s+tsx|tsx).*scripts[\\/]construction-camera-soak\.ts/i.test(command);
 if(process.argv.includes('--request-stop')){
  assert.equal(controllerAlive,true,'Controller is absent; use orphan cleanup instead');fs.writeFileSync(path.join(out,'soak-stop-'+report.runId+'.json'),JSON.stringify({requestedAt:new Date().toISOString()}));console.log(JSON.stringify({runId:report.runId,stopRequested:true}));return;
 }
 if(process.argv.includes('--cleanup-orphan')){
  assert.equal(controllerAlive,false,'Never take over a live test controller');
  const actor={enterpriseId:fixture.enterpriseId,adminId:fixture.ownerId},policy=()=>withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select * from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`));
  let p=await policy();assert.equal(String(p?.project_id),fixture.projectId);
  if(p?.enabled){assert.equal(Number(p.version),Number(report.policyVersion),'Policy ownership changed; preserve the new human intent');const saved=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:3,expectedVersion:Number(p.version)});report.policyVersion=Number(saved!.version);}
  let actualWriter:boolean|null=null;
  for(let n=0;n<45;n++){p=await policy();actualWriter=await cameraWvp().isRecording({app:String(p?.stream_app),stream:String(p?.stream_id)});if(p?.enabled===false&&p.state==='stopped'&&actualWriter===false)break;await delay(2000);}
  report.orphanCleanupAt=new Date().toISOString();report.cleanup={enabled:p?.enabled,state:p?.state,actualWriter};report.status='failed';report.passed=false;report.soakPassed=false;report.error=report.error||'Test controller exited without a final receipt';
  fs.writeFileSync(path.join(out,'soak-'+report.runId+'.json'),JSON.stringify(report,null,2));fs.writeFileSync(alias,JSON.stringify(report,null,2));
  assert.equal(p?.enabled,false);assert.equal(p?.state,'stopped','Desired off saved; physical stop still unconfirmed');
  assert.equal(actualWriter,false,'Physical MP4 stop still unconfirmed');
  const original=report.originalPolicy;
  if(original?.recordingMode==='sd'&&p?.recording_mode==='cloud'&&Number(p.version)===Number(report.policyVersion)){
   const saved=await saveRecordingPolicy(actor,fixture.projectId,{bindingId:fixture.bindingId,enabled:false,retentionDays:Number(original.retentionDays),recordingMode:'sd',expectedVersion:Number(p.version)});
   report.policyVersion=Number(saved!.version);report.originalModeRestorePending=true;
   fs.writeFileSync(path.join(out,'soak-'+report.runId+'.json'),JSON.stringify(report,null,2));fs.writeFileSync(alias,JSON.stringify(report,null,2));
  }
 }
 console.log(JSON.stringify({runId:report.runId,status:report.status,controllerAlive,pid:report.pid,elapsedHours:report.elapsedHours,expectedFinish:report.expectedFinish,observations:report.observations,milestones:report.milestones,naturalExpiry:report.naturalExpiry,cleanup:report.cleanup,error:report.error}));
}
void run().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(closePostgresPool);
