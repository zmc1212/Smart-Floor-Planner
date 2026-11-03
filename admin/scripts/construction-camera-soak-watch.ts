// One bounded test's cleanup owner. It never starts recording or touches a live
// controller; actual writes remain in the existing fixture/version-guarded CLI.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

async function run(){
 const out=path.resolve(process.env.CAMERA_TEST_OUTPUT||'../tmp/cloud-camera'),file=path.resolve(process.argv[2]);
 assert.equal(path.dirname(file),out);const initial=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.match(initial.runId,/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/);assert.ok(['driver-smoke','74h-soak'].includes(initial.mode));
 assert.equal(path.basename(file),(initial.mode==='driver-smoke'?'soak-smoke-':'soak-')+initial.runId+'.json');
 const receipt=path.join(out,'soak-cleanup-'+initial.runId+'.json'),result={runId:initial.runId,pid:process.pid,parentPid:initial.pid,started:new Date().toISOString(),status:'waiting-parent',attempts:0,finished:null as string|null,lastExit:null as number|null};
 const persist=()=>{const tmp=receipt+'.tmp';fs.writeFileSync(tmp,JSON.stringify(result,null,2));fs.renameSync(tmp,receipt);};persist();
 const alive=()=>{try{process.kill(initial.pid,0);return true;}catch{return false;}};
 while(alive())await delay(1000);
 const exited=path.join(out,'soak-main-exit-'+initial.runId+'.json');if(!fs.existsSync(exited))fs.copyFileSync(file,exited,fs.constants.COPYFILE_EXCL);
 for(;;){
  let report=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(report.runId,initial.runId);
  if(report.cleanupConfirmed){result.status=result.attempts?'cleaned':'already-clean';break;}
  result.status='cleanup-pending';result.attempts++;persist();
  const child=cp.spawn(process.execPath,['--import','tsx','scripts/construction-camera-soak-control.ts','--cleanup-orphan'],{cwd:process.cwd(),env:{...process.env,CAMERA_SOAK_REPORT:file},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
  const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});result.lastExit=code;
  report=JSON.parse(fs.readFileSync(file,'utf8'));
  if(report.cleanupConfirmed){result.status='cleaned';break;}
  if(/Policy ownership changed|Refuse a different fixture|Never take over a live test controller|camera_forbidden|construction_forbidden/.test(output)){result.status='refused-ownership-or-permission';break;}
  // Keep only a safe category. SQL/transport errors may contain private data.
  persist();await delay(Math.min(30000,result.attempts*1000));
 }
 result.finished=new Date().toISOString();persist();console.log(JSON.stringify(result));
}
run().catch(e=>{console.error((e as Error).name);process.exitCode=1;});
