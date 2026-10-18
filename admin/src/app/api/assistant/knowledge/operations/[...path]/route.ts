import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { KnowledgeOperations } from '@/lib/assistant/knowledge/operations';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
const fields:Record<string,string[]>={save:['title','question','expectation','gapNote'],edit:['title','question','expectation','gapNote','expectedVersion'],start:['expectedVersion'],resume:[],review:['expectedVersion','outcome','note']};
async function handle(request:NextRequest,context:Context) {
  return withTenantRoute(request,{roles:['super_admin','admin','enterprise_admin'],requireEnterprise:true},async actor=>{
    try{
      const {path:p}=await context.params,method=request.method,service=new KnowledgeOperations({enterpriseId:actor.enterpriseId!,adminId:actor.userId});
      let action='';
      if(p[0]==='health'&&p.length===1&&method==='GET')action='health';
      if(p[0]==='cases'){
        if(p.length===1)action=method==='GET'?'list':method==='POST'?'save':'';
        if(p.length===2)action=method==='GET'?'detail':method==='PATCH'?'edit':'';
        if(p.length===3&&p[2]==='evaluations')action=method==='GET'?'history':method==='POST'?'start':'';
      }
      if(p[0]==='evaluations'){
        if(p.length===2&&method==='GET')action='read';
        if(p.length===3&&method==='POST'&&['resume','review'].includes(p[2]))action=p[2];
      }
      if(!action)fail('assistant_resource_not_found',404);
      let body:Record<string,unknown>={};
      if(method==='GET'){
        const params=request.nextUrl.searchParams,allowed=['list','history'].includes(action)?['limit','beforeId']:[];
        if([...params.keys()].some(k=>!allowed.includes(k)))fail('invalid_message',422);
        if(params.has('limit'))body.limit=Number(params.get('limit'));
        if(params.has('beforeId'))body.beforeId=params.get('beforeId');
      }else{
        let bytes=0;const chunks:Uint8Array[]=[];
        if(request.body)for await(const chunk of request.body as unknown as AsyncIterable<Uint8Array>){bytes+=chunk.length;if(bytes>24000)fail('invalid_message',413);chunks.push(chunk);}
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('invalid_message',422);}
        if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!fields[action]?.includes(k)))fail('invalid_message',422);
      }
      const key=request.headers.get('idempotency-key')??'';
      const result=action==='health'?await service.health():action==='list'?await service.list(body):action==='detail'?await service.detail(p[1]):
        action==='save'?await service.save(body,key):action==='edit'?await service.save(body,key,p[1]):
        action==='history'?await service.history(p[1],body):action==='start'?await service.start(p[1],body,key):
        action==='read'?await service.read(p[1]):action==='resume'?await service.resume(p[1]):await service.review(p[1],body,key);
      return NextResponse.json({success:true,data:result},{headers:{'Cache-Control':'no-store'}});
    }catch(e){const known=e instanceof AssistantError;return NextResponse.json({success:false,error:known?e.code:'knowledge_unavailable'},
      {status:known?e.status:503,headers:{'Cache-Control':'no-store'}});}
  });
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
