import {sql} from 'drizzle-orm';
import {withPlatformTransaction} from '@/db/transaction';
import {one,type Row} from '@/db/repositories/assistant-repository';
import {fail} from '@/lib/assistant/contracts';

export type StorageLevel='ok'|'warning'|'critical'|'blocked'|'unavailable';
export type StorageSample={node:string;sampledAt:string;totalBytes:string;availableBytes:string;freeBytes:string;files:string;availableFiles:string};
export type StorageHealth={level:StorageLevel;blocked:boolean;reason:string|null;totalBytes:string|null;availableBytes:string|null;usedPercent:number|null;sampledAt:string|null;checkedAt:string|null};
const GiB=1024n**3n;
export const storageThresholds={warningPercent:80,criticalPercent:90,pausePercent:95,resumePercent:90,pauseFreeGiB:5,resumeFreeGiB:8,pauseFreeFiles:128,resumeFreeFiles:512};
function count(value:unknown){if(typeof value!=='string'||!/^\d{1,19}$/.test(value))fail('camera_storage_unavailable',503);return BigInt(value);}
export function validateStorageSample(value:unknown,expectedNode:string,now=Date.now()):StorageSample{
  if(!value||typeof value!=='object')fail('camera_storage_unavailable',503);
  const r=value as Record<string,unknown>,stamp=typeof r.sampledAt==='string'?Date.parse(r.sampledAt):NaN;
  if(r.version!==1||r.node!==expectedNode||!Number.isFinite(stamp)||Math.abs(stamp-now)>60000)fail('camera_storage_unavailable',503);
  const total=count(r.totalBytes),available=count(r.availableBytes),free=count(r.freeBytes),files=count(r.files),availableFiles=count(r.availableFiles);
  if(total===0n||total>9223372036854775807n||available>free||free>total||availableFiles>files)fail('camera_storage_unavailable',503);
  return {node:expectedNode,sampledAt:String(r.sampledAt),totalBytes:String(total),availableBytes:String(available),freeBytes:String(free),files:String(files),availableFiles:String(availableFiles)};
}
export function evaluateStorage(sample:StorageSample,wasBlocked=false){
  const total=count(sample.totalBytes),available=count(sample.availableBytes),files=count(sample.files),freeFiles=count(sample.availableFiles);
  const usedPercent=Number((total-available)*100000n/total)/1000;
  const low=usedPercent>=95||available<5n*GiB||(files>0n&&freeFiles<128n);
  const recovered=usedPercent<90&&available>=8n*GiB&&(files===0n||freeFiles>=512n);
  const blocked=low||(wasBlocked&&!recovered);
  const level:StorageLevel=blocked?'blocked':usedPercent>=90?'critical':usedPercent>=80?'warning':'ok';
  return {level,blocked,usedPercent,reason:blocked?'camera_storage_low':level==='ok'?null:'camera_storage_warning'};
}
export async function readStorageProbe(transport:typeof fetch=fetch){
  let origin:URL;const token=process.env.CAMERA_STORAGE_TOKEN;
  try{origin=new URL(process.env.CAMERA_STORAGE_ORIGIN||'');}catch{fail('camera_storage_unavailable',503);}
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||!token||token.length<32)fail('camera_storage_unavailable',503);
  try{
    const response=await transport(new URL('/storage',origin),{headers:{Authorization:'Bearer '+token},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(3000)});
    if(!response.ok||Number(response.headers.get('content-length'))>4096)fail('camera_storage_unavailable',503);
    const reader=response.body?.getReader();if(!reader)fail('camera_storage_unavailable',503);let size=0;const buffers:Uint8Array[]=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)fail('camera_storage_unavailable',503);buffers.push(value);}}finally{await reader.cancel();}
    return validateStorageSample(JSON.parse(Buffer.concat(buffers).toString('utf8')),process.env.CAMERA_MEDIA_SERVER_ID||'wvp-zlm-01');
  }catch{fail('camera_storage_unavailable',503);}
}
const date=(v:unknown)=>v?new Date(v instanceof Date?v.getTime():String(v)).toISOString():null;
function health(row:Row|null|undefined):StorageHealth{
  const current=!!row&&row.fresh!==false;
  return {level:current?row!.level as StorageLevel:'unavailable',blocked:!current||!!row!.blocked,reason:current?row!.reason as string|null:'camera_storage_unavailable',
    totalBytes:row?.total_bytes==null?null:String(row.total_bytes),availableBytes:row?.available_bytes==null?null:String(row.available_bytes),usedPercent:row?.used_percent==null?null:Number(row.used_percent),sampledAt:date(row?.sampled_at),checkedAt:date(row?.checked_at)};
}
export async function currentStorageHealth(){
  return withPlatformTransaction(async tx=>health(await one(tx,sql`select *,checked_at>now()-interval '15 seconds' fresh from app.construction_camera_storage_health where node_key='default'`)));
}
export async function refreshStorageHealth(probe=readStorageProbe){
  return withPlatformTransaction(async tx=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('camera-storage:default',0))`);
    const previous=await one(tx,sql`select * from app.construction_camera_storage_health where node_key='default' for update`);
    let sample:StorageSample|undefined,state:{level:StorageLevel;blocked:boolean;usedPercent:number|null;reason:string|null};
    try{sample=await probe();state=evaluateStorage(sample,!!previous?.blocked);}catch{state={level:'unavailable',blocked:true,usedPercent:previous?.used_percent==null?null:Number(previous.used_percent),reason:'camera_storage_unavailable'};}
    const saved=await one(tx,sql`insert into app.construction_camera_storage_health(node_key,media_server_id,level,blocked,reason,total_bytes,available_bytes,used_percent,sampled_at)
      values('default',${process.env.CAMERA_MEDIA_SERVER_ID||'wvp-zlm-01'},${state.level},${state.blocked},${state.reason},${sample?.totalBytes??previous?.total_bytes??null},${sample?.availableBytes??previous?.available_bytes??null},${state.usedPercent},${sample?new Date(sample.sampledAt):previous?.sampled_at??null})
      on conflict(node_key) do update set media_server_id=excluded.media_server_id,level=excluded.level,blocked=excluded.blocked,reason=excluded.reason,total_bytes=excluded.total_bytes,available_bytes=excluded.available_bytes,used_percent=excluded.used_percent,sampled_at=excluded.sampled_at,checked_at=now() returning *`);
    return health(saved);
  });
}
// Reconciliation includes bounded but serial provider/index calls. Capacity
// evidence has a shorter lifetime and must keep sampling while those await.
export function startStorageHealthSampler(refresh:()=>Promise<unknown>=refreshStorageHealth,onError:()=>void=()=>{}){
  let stopped=false,pending:Promise<void>|null=null;
  const tick=()=>{
    if(stopped||pending)return;
    pending=Promise.resolve().then(refresh).then(()=>{},onError).finally(()=>{pending=null;});
  };
  const timer=setInterval(tick,5000);tick();
  return async()=>{stopped=true;clearInterval(timer);await pending;};
}
export async function requireStorageReady(){
  let current=await currentStorageHealth();
  if(current.level==='unavailable')current=await refreshStorageHealth();
  if(current.blocked)fail(current.reason==='camera_storage_low'?'camera_storage_low':'camera_storage_unavailable',503);
  return current;
}
