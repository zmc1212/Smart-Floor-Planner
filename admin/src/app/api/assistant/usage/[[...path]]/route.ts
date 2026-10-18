import { randomUUID } from 'node:crypto';
import { NextRequest,NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError,fail,id,key } from '@/lib/assistant/contracts';
import { UsageService } from '@/lib/assistant/core/usage';
export const runtime='nodejs';
async function handle(request:NextRequest,context:{params:Promise<{path?:string[]}>}) {
  return withTenantRoute(request,{roles:['enterprise_admin'],requireEnterprise:true},async principal=>{
    const requestId=randomUUID();
    try {
      const service=new UsageService({enterpriseId:principal.enterpriseId!,principal:{kind:'admin',adminId:principal.userId},contextVersion:1,capabilities:[]});
      const p=(await context.params).path || [],params=request.nextUrl.searchParams;
      let data:unknown;
      if(request.method==='GET' && p.length===0) {
        if([...params.keys()].some(k=>!['from','to'].includes(k)))fail('invalid_message',422);
        data=await service.summary(params.get('from'),params.get('to'));
      } else if(request.method==='GET' && p.length===1 && p[0]==='reconciliations') {
        if([...params.keys()].some(k=>!['cursor','limit'].includes(k)))fail('invalid_message',422);
        data=await service.pending(params.has('cursor')?id(params.get('cursor')):undefined,Number(params.get('limit') || 20));
      } else if(request.method==='GET' && p.length===2 && p[0]==='reconciliations') {
        if(params.size)fail('invalid_message',422);
        data=await service.detail(id(p[1]));
      } else if(request.method==='POST' && p.length===2 && p[0]==='reconciliations') {
        if(params.size)fail('invalid_message',422);
        const bytes=await request.text();if(Buffer.byteLength(bytes)>8000)fail('invalid_message',422);
        let body:Record<string,unknown>;try{body=JSON.parse(bytes);}catch{fail('invalid_message',422);}
        if(!body || Array.isArray(body) || typeof body!=='object')fail('invalid_message',422);
        data=await service.reconcile(id(p[1]),body,key(request.headers.get('Idempotency-Key')));
      } else fail('assistant_resource_not_found',404);
      return NextResponse.json({success:true,data,requestId},{headers:{'Cache-Control':'no-store'}});
    } catch(e) {
      const error=e instanceof AssistantError?e:new AssistantError('assistant_unavailable',503);
      return NextResponse.json({success:false,error:error.code,code:error.code,requestId},{status:error.status,headers:{'Cache-Control':'no-store'}});
    }
  });
}
export const GET=handle;export const POST=handle;
