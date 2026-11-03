import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

export type SoakMediaImage={name:string;mounts:{Destination:string;Type?:string;Source?:string;RW?:boolean}[]};
export function assertSoakStorageMounts(images:SoakMediaImage[],approvedHostPath:string){
 const normalize=(value:string)=>value.replaceAll('\\','/').replace(/^([a-z]):\//i,(_all,drive:string)=>'/run/desktop/mnt/host/'+drive.toLowerCase()+'/').replace(/\/$/,'').toLowerCase();
 const recorder=images.find(i=>i.name==='/wvp-stack-zlm-1')?.mounts.find(m=>m.Destination==='/opt/media/www/record');
 const probe=images.find(i=>i.name==='/sfp-camera-storage-storage-1')?.mounts.find(m=>m.Destination==='/media/record');
 assert.ok(recorder?.Type==='bind'&&recorder.RW===true&&probe?.Type==='bind'&&probe.RW===false,'Recorder and probe require the approved read-write/read-only host overlays');
 assert.equal(normalize(recorder.Source||''),normalize(approvedHostPath),'Recorder is not writing to the approved physical storage');
 assert.equal(normalize(probe.Source||''),normalize(approvedHostPath),'Probe does not observe the recorder physical storage');
}

export type SoakReadFailure={phase:string;attempt:number;at:string;code:string|null;transient:boolean};
export function transientSoakDatabaseError(error:unknown):boolean{
 const seen=new Set<unknown>();let current=error;
 for(let n=0;n<5&&current&&typeof current==='object'&&!seen.has(current);n++){
  seen.add(current);const e=current as {code?:unknown;message?:unknown;cause?:unknown};
  if(typeof e.code==='string'&&['ECONNREFUSED','ECONNRESET','ETIMEDOUT','EPIPE','57P01','57P02','57P03','53300'].includes(e.code))return true;
  if(typeof e.message==='string'&&['Connection terminated due to connection timeout','Connection terminated unexpectedly','timeout expired','timeout exceeded when trying to connect','Connection timeout'].includes(e.message))return true;
  current=e.cause;
 }
 return false;
}

// Callers must supply observational database reads only. Configuration saves,
// entry/session writes and provider control/start/stop are never replayed here.
export async function retrySoakRead<T>(phase:string,read:()=>Promise<T>,failures:SoakReadFailure[],pause:(ms:number)=>Promise<unknown>=delay):Promise<T>{
 const started=performance.now();
 for(let attempt=1;;attempt++)try{return await read();}catch(error){
  const transient=transientSoakDatabaseError(error);
  failures.push({phase,attempt,at:new Date().toISOString(),code:typeof (error as {code?:unknown})?.code==='string'?(error as {code:string}).code:null,transient});
  if(!transient||attempt>=3||performance.now()-started>=20000)throw error;
  await pause(attempt*500);
 }
}
