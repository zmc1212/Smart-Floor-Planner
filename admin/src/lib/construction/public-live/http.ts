import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '../contracts';
import { publishedPublicMaterial } from '../public-read';
import { PublicLiveService } from './service';
import { PublicLiveCustomer } from './customer';
import { liveKey } from './contract';
import { openLiveSession, publicLiveDetail, publicLiveMedia, reconcileLiveProxies, stopLiveProxies, type LiveViewer } from './media';

const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export const liveJson=(data:unknown)=>NextResponse.json({success:true,data},{headers});
export function liveFailure(error:unknown) {
  return NextResponse.json({success:false,code:error instanceof AssistantError?error.code:'public_live_unavailable',error:error instanceof AssistantError?error.code:'public_live_unavailable'},
    {status:error instanceof AssistantError?error.status:503,headers});
}
async function body(request:Request) {
  let size=0;const chunks:Uint8Array[]=[];
  if(request.body)for await(const chunk of request.body as unknown as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>4096)fail('invalid_public_live',413);chunks.push(chunk);}
  try{const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v as Record<string,unknown>;}catch{fail('invalid_public_live',422);}
}
function noQuery(request:Request) {if(new URL(request.url).search)fail('invalid_public_live',422);}
async function sessionFor(eid:string,lid:string,vid:string,viewer:LiveViewer) {
  return liveJson(await openLiveSession(eid,id(lid),id(vid),viewer));
}
export async function staffLiveHttp(request:Request,actor:ConstructionActor,pid:string,path:string[]) {
  noQuery(request);id(pid);const service=new PublicLiveService(actor);
  if(!path.length&&request.method==='GET')return liveJson(await service.read(pid));
  if(request.method!=='POST'||path.length>1)fail('public_live_unavailable',404);
  const value=await body(request);
  if(path[0]==='session'){
    if(Object.keys(value).some(k=>!['id','versionId'].includes(k)))fail('invalid_public_live',422);
    return sessionFor(actor.enterpriseId,id(value.id),id(value.versionId),{kind:'staff',actor,projectId:pid});
  }
  if(path[0]==='reconcile'){
    if(Object.keys(value).length)fail('invalid_public_live',422);
    const view=await service.read(pid),m=view.material;
    if(!m)fail('public_live_unavailable',404);
    if(!['withdrawn','declined','rejected'].includes(m.status))fail('public_live_stop_required');
    return liveJson(await stopLiveProxies(actor.enterpriseId,m.id));
  }
  const result=!path.length?await service.save(pid,value,key(request.headers.get('Idempotency-Key')))
    :await service.mutate(pid,path[0],value,key(request.headers.get('Idempotency-Key')));
  if(['withdraw','reject'].includes(path[0]))return liveJson({...result,...await stopLiveProxies(actor.enterpriseId,String(result.id))});
  return liveJson(result);
}
export async function ownerLiveHttp(request:Request,actor:ActorContext,cid:string,path:string[]) {
  noQuery(request);const service=new PublicLiveCustomer(actor,id(cid));
  if(!path.length&&request.method==='GET')return liveJson(await service.read());
  if(request.method!=='POST'||path.length!==2)fail('public_live_unavailable',404);
  const lid=id(path[0]),value=await body(request);
  if(path[1]==='session'){
    if(Object.keys(value).some(k=>k!=='versionId'))fail('invalid_public_live',422);
    return sessionFor(actor.enterpriseId,lid,id(value.versionId),{kind:'owner',actor,conversationId:cid});
  }
  const result=await service.decide(lid,path[1],value,key(request.headers.get('Idempotency-Key')));
  if(['withdraw','decline'].includes(path[1]))return liveJson({...result,...await stopLiveProxies(actor.enterpriseId,lid)});
  return liveJson(result);
}
export async function anonymousLiveHttp(request:Request,eid:string,path:string[]) {
  noQuery(request);id(eid);
  if(path[0]==='site'&&path.length===2&&request.method==='GET'){
    const result=await withTenantTransaction(eid,async tx=>{
      const photo=await publishedPublicMaterial(tx,eid,id(path[1]));
      if(!photo)fail('public_live_unavailable',404);
      const l=await one(tx,sql`select public_key from app.construction_public_live where enterprise_id=${eid} and project_id=${String(photo.site.project_id)} and status='published'`);
      return l?String(l.public_key):null;
    });
    return liveJson(result?await publicLiveDetail(eid,result):null);
  }
  const publicKey=liveKey(path[0]);
  if(path.length===1&&request.method==='GET')return liveJson(await publicLiveDetail(eid,publicKey));
  if(path.length===2&&path[1]==='session'&&request.method==='POST'){
    if(Object.keys(await body(request)).length)fail('invalid_public_live',422);
    const l=await withTenantTransaction(eid,tx=>one(tx,sql`select id,current_version_id from app.construction_public_live where enterprise_id=${eid} and public_key=${publicKey}`));
    if(!l)fail('public_live_unavailable',404);
    return sessionFor(eid,String(l.id),String(l.current_version_id),{kind:'public'});
  }
  if(path[1]==='media'&&path.length>=4&&request.method==='GET')return publicLiveMedia(request,eid,publicKey,path[2],path.slice(3).join('/'));
  fail('public_live_unavailable',404);
}
export {reconcileLiveProxies};
