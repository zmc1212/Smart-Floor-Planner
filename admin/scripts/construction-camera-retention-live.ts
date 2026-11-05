import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {withTenantTransaction} from '../src/db/transaction';
import {one,rows} from '../src/db/repositories/assistant-repository';
import {closePostgresPool,resolvePostgresRuntimeConfig} from '../src/lib/postgresql';
import {purgeCameraRecordings,reconcileRecordings} from '../src/lib/construction/camera/recordings';
import {cameraWvp} from '../src/lib/construction/camera/wvp';
import {cameraLiveDeployment} from './construction-camera-environment.mjs';

async function run(){
 const db=new URL(resolvePostgresRuntimeConfig().connectionString);assert.equal(db.port,'55432');assert.equal(db.pathname,'/cloud_camera_eval');
 const out=path.resolve('../tmp/cloud-camera'),fixture=JSON.parse(fs.readFileSync(path.join(out,'fixture.private.json'),'utf8'));
 const files=['scripts/construction-camera-retention-live.ts','src/lib/construction/camera/recordings.ts','src/lib/construction/camera/wvp.ts','src/lib/construction/camera/recording-contract.ts','src/db/transaction.ts','src/lib/postgresql.ts','drizzle/0091_construction_recordings.sql','../tmp/cloud-camera/fixture.private.json',process.env.CAMERA_LOCAL_WVP_ENV!,'scripts/construction-camera-environment.mjs'];
 const batch=cameraLiveDeployment(process.env);
 const bind=()=>Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(f)).digest('hex')]));
 const report:Record<string,unknown>={started:new Date().toISOString(),before:bind(),deployment:batch.context,recordingHostPath:batch.recordingHostPath,transport:batch.transport,imagesBefore:batch.images,checks:[]};
 try{
  const record=await withTenantTransaction(fixture.enterpriseId,async tx=>{
   const enterprise=await one(tx,sql`select name from app.enterprises where id=${fixture.enterpriseId}`);assert.equal(enterprise?.name,'测试专用 · 云工地摄像头');
   const policy=await one(tx,sql`select enabled,state from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`);assert.equal(policy?.enabled,false);assert.equal(policy?.state,'stopped');
   const records=await rows(tx,sql`select * from app.construction_recordings where binding_id=${fixture.bindingId} and state='ready' order by started_at`);assert.ok(records.length>=2,'Keep a newer real recording for UI acceptance');
   const r=records[0];assert.ok(new Date(String(r.started_at)).getTime()>Date.now()-86400000,'Only recordings made by this isolated test today');
   assert.equal(String(r.project_id),fixture.projectId);
   assert.equal((await rows(tx,sql`select token_hash from app.construction_camera_sessions where recording_id=${String(r.id)} and view_expires_at>now() and closed_at is null`)).length,0);
   return r;
  });
  const source=cameraWvp();assert.equal(await source.cloudPath(Number(record.source_id)),record.file_path);assert.equal(await source.recordingFileStatus(String(record.file_path)),206);
  report.fixture={id:record.id,sourceId:record.source_id,originalStart:record.started_at,originalEnd:record.ended_at,bytes:record.bytes,syntheticExpiry:true};
  // Accelerate only this labelled test record's expiry; no claim of wall-clock soak.
  await withTenantTransaction(fixture.enterpriseId,tx=>tx.execute(sql`update app.construction_recordings set started_at=now()-interval '4 days 2 minutes',ended_at=now()-interval '4 days' where id=${String(record.id)}`));
  await purgeCameraRecordings();
  const state=await withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select state,last_error from app.construction_recordings where id=${String(record.id)}`));assert.equal(state?.state,'deleted',String(state?.last_error));
  const status=await source.recordingFileStatus(String(record.file_path));assert.ok([404,410].includes(status));assert.equal(await source.cloudPath(Number(record.source_id)),null);
  await reconcileRecordings();const retained=await withTenantTransaction(fixture.enterpriseId,tx=>one(tx,sql`select state from app.construction_recordings where id=${String(record.id)}`));assert.equal(retained?.state,'deleted');
  report.checks=[{name:'expired synthetic fixture deletes real bytes and WVP index; reconciliation does not resurrect it',passed:true,physicalStatus:status}];report.passed=true;
 }catch(e){report.error=(e as Error).message;report.passed=false;process.exitCode=1;}
 finally{report.after=bind();report.drift=files.filter(f=>(report.before as Record<string,string>)[f]!== (report.after as Record<string,string>)[f]);let deploymentError='';try{report.imagesAfter=batch.capture();}catch(e){deploymentError=(e as Error).message;}if((report.drift as string[]).length||deploymentError||JSON.stringify(report.imagesAfter)!==JSON.stringify(report.imagesBefore)){report.passed=false;report.bindingError=deploymentError||'Source or deployment drift';process.exitCode=1;}report.finished=new Date().toISOString();fs.writeFileSync(path.join(out,'retention-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,checks:report.checks,error:report.error,drift:report.drift}));await closePostgresPool();}
}
void run().catch(async e=>{console.error(e.message);process.exitCode=1;await closePostgresPool();});
