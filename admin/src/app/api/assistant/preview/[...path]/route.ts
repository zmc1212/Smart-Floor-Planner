import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail, id, key } from '@/lib/assistant/contracts';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { readRetrievalDiagnostics } from '@/lib/assistant/knowledge/diagnostics';
export const runtime='nodejs';
async function handle(request:NextRequest,context:{params:Promise<{path:string[]}>}) {
  return withTenantRoute(request,{roles:['super_admin','admin','enterprise_admin'],requireEnterprise:true},async principal=>{
    const requestId=randomUUID();
    try {
      const service=new ConversationService({enterpriseId:principal.enterpriseId!,principal:{kind:'admin',adminId:principal.userId},contextVersion:1,capabilities:['assistant.preview.self']});
      const {path:p}=await context.params,method=request.method;
      let body:Record<string,unknown>={};
      if(['POST','PATCH'].includes(method)) {
        const bytes=await request.text();if(Buffer.byteLength(bytes)>20000) fail('invalid_message',422);
        try {body=bytes?JSON.parse(bytes):{};}catch{fail('invalid_message',422);}
        if(!body || Array.isArray(body) || typeof body!=='object') fail('invalid_message',422);
      }
      const only=(fields:string[])=>{if(Object.keys(body).some(k=>!fields.includes(k)))fail('invalid_message',422);};
      const requestKey=()=>key(request.headers.get('Idempotency-Key'));
      const params=request.nextUrl.searchParams,limit=Number(params.get('limit') || 20);
      if(!Number.isInteger(limit) || limit<1 || limit>100)fail('invalid_message',422);
      const cursor=(name:string)=>params.has(name)?id(params.get(name)):undefined;
      let data:unknown,status=200;
      if(p[0]==='conversations' && p.length===1 && method==='POST') {only(['audience','draftVersionIds']);data=await service.create(requestKey(),body);}
      else if(p[0]==='conversations' && p.length===1 && method==='GET') data=await service.list(cursor('cursor'),limit);
      else if(p[0]==='conversations' && p.length===2 && method==='GET') data=await service.detail(id(p[1]));
      else if(p[0]==='conversations' && p.length===2 && method==='PATCH') {
        only(['action','expectedVersion']);if(body.action!=='archive' || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion)<1)fail('invalid_message',422);
        data=await service.archive(id(p[1]),Number(body.expectedVersion),requestKey());
      } else if(p[0]==='conversations' && p.length===3 && p[2]==='messages' && method==='GET') data=await service.messages(id(p[1]),cursor('beforeSeq'),limit);
      else if(p[0]==='conversations' && p.length===3 && p[2]==='messages' && method==='POST') {
        only(['clientMessageId','content']);if(requestKey()!==key(body.clientMessageId))fail('invalid_message',422);
        data=await service.send(id(p[1]),String(body.clientMessageId),body.content);status=202;
      } else if(p[0]==='runs' && p.length===2 && method==='GET') data=await service.run(id(p[1]));
      else if(p[0]==='runs' && p.length===3 && p[2]==='diagnostics' && method==='GET') data=await readRetrievalDiagnostics(service.actor,id(p[1]));
      else if(p[0]==='runs' && p.length===3 && ['cancel','retry'].includes(p[2]) && method==='POST') {
        only([]);data=await service.run(id(p[1]),p[2] as 'cancel'|'retry',requestKey());status=p[2]==='retry'?202:200;
      } else if(p[0]==='citations' && p.length===2 && method==='GET') data=await service.citation(id(p[1]));
      else fail('assistant_resource_not_found',404);
      return NextResponse.json({success:true,data,requestId},{status,headers:{'Cache-Control':'no-store'}});
    }catch(e){const error=e instanceof AssistantError?e:new AssistantError('assistant_unavailable',503);
      return NextResponse.json({success:false,error:error.code,code:error.code,requestId},{status:error.status,headers:{'Cache-Control':'no-store'}});}
  });
}
export const GET=handle;export const POST=handle;export const PATCH=handle;
