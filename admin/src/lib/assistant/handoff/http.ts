import { NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { AssistantError, fail, id, key, type ActorContext } from '../contracts';
import { HandoffService } from './service';
import { mediaHttp } from '../media/http';

export async function staffHandoffHttp(request:Request,path:string[]) {
  try {
    const context=await resolveMiniProgramContext(request);
    const token=await verifyMiniProgramToken(request.headers.get('authorization')?.slice(7)||'');
    if(!context || !token) fail('identity_context_invalid',401);
    if(context.mode!=='staff' || !context.staff || !context.enterpriseId || !['designer','enterprise_admin'].includes(context.staff.role)) fail('assistant_capability_forbidden',403);
    const actor:ActorContext={enterpriseId:context.enterpriseId,principal:{kind:'admin',adminId:context.staff._id},contextVersion:token.contextVersion,
      capabilities:['assistant.handoff.staff'],entry:{staffUserId:context.user._id}};
    const data=await handleHandoff(request,path,actor);
    if(data instanceof Response)return data;
    return NextResponse.json({success:true,data},{headers:{'Cache-Control':'no-store'}});
  }catch(e){return handoffError(e);}
}
export async function handleHandoff(request:Request,path:string[],actor:ActorContext) {
  const service=new HandoffService(actor);
  if(request.method==='GET' && path[1]==='media' && [2,3].includes(path.length))return mediaHttp(request,actor,id(path[0]),path.slice(2));
  if(request.method==='GET' && !path.length)return service.staffList();
  if(path.length!==1)fail('assistant_resource_not_found',404);
  const conversationId=id(path[0]);
  if(request.method==='GET')return service.staffRead(conversationId);
  if(request.method!=='POST')fail('assistant_resource_not_found',404);
  const text=await request.text();if(text.length>12000)fail('invalid_message',422);
  let body;try{body=JSON.parse(text);}catch{fail('invalid_message',422);}
  if(!body || typeof body!=='object' || Array.isArray(body))fail('invalid_message',422);
  return service.staffWrite(conversationId,key(request.headers.get('Idempotency-Key')),body);
}
export function handoffError(error:unknown) {
  const e=error instanceof AssistantError?error:new AssistantError('assistant_unavailable',503);
  return NextResponse.json({success:false,error:e.code,code:e.code},{status:e.status,headers:{'Cache-Control':'no-store'}});
}
