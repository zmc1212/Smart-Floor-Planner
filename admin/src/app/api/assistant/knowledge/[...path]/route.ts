import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { KnowledgeService } from '@/lib/assistant/knowledge/service';
import { readOriginal } from '@/lib/assistant/knowledge/file-service';
export const runtime='nodejs';
type Context={params:Promise<{path:string[]}>};
const fields:Record<string,string[]>={
  create:['title','category','sourceType','audience','body','faq','effectiveFrom','effectiveTo','referenceCase','professional'],
  metadata:['expectedVersion','title','category','audience'], newVersion:['expectedVersion','fromVersionId'],
  edit:['expectedEditVersion','body','faq','effectiveFrom','effectiveTo','referenceCase','professional'], index:['expectedEditVersion'],
  publish:['expectedVersion','expectedEditVersion'],retire:['expectedVersion'],
  share:['expectedVersion','entryCode'],
  createFile:['title','category','audience','fileName','fileBase64','authorization'],
  replaceFile:['expectedEditVersion','fileName','fileBase64','authorization'],parse:['expectedEditVersion'],cancelParse:['expectedEditVersion'],
  reviewFile:['expectedEditVersion','acknowledgeWarnings','excludedBlockIds'],
};
async function handle(request:NextRequest,context:Context) {
  return withTenantRoute(request,{roles:['super_admin','admin','enterprise_admin'],requireEnterprise:true},async actor=>{
    try {
      const {path:p}=await context.params, method=request.method;
      let action='', ids:Record<string,string>={};
      if (p[0]==='documents') {
        if(p.length===1) action=method==='GET'?'list':method==='POST'?'create':'';
        if(p.length>=2) ids={documentId:p[1]};
        if(p.length===2) action=method==='GET'?'detail':method==='PATCH'?'metadata':'';
        if(p.length===3 && p[2]==='retire' && method==='POST') action='retire';
        if(p.length===3 && p[2]==='share' && method==='POST') action='share';
        if(p.length===2 && p[1]==='import' && method==='POST') {action='createFile';ids={};}
        if(p[2]==='versions') {
          if(p.length===3 && method==='POST') action='newVersion';
          if(p.length>=4) ids.versionId=p[3];
          if(p.length===4 && method==='PATCH') action='edit';
          if(p.length===5 && method==='POST' && ['index','publish'].includes(p[4])) action=p[4];
          if(p.length===5 && method==='POST' && ['file','parse','review','cancel-parse'].includes(p[4])) action=({'file':'replaceFile','parse':'parse','review':'reviewFile','cancel-parse':'cancelParse'} as Record<string,string>)[p[4]];
          if(p.length===5 && method==='GET' && p[4]==='original') action='original';
        }
      } else if(p[0]==='jobs' && p.length===2 && method==='GET') {action='job';ids={jobId:p[1]};}
      if(!action) fail('assistant_resource_not_found',404);
      if(action==='original') {
        const f=await readOriginal({enterpriseId:actor.enterpriseId!,adminId:actor.userId},ids.documentId,ids.versionId);
        return new NextResponse(new Uint8Array(f.data as Buffer),{headers:{'Content-Type':'application/octet-stream',
          'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(String(f.name))}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }
      let body:Record<string,unknown>={};
      if(method!=='GET') {
        let bytes=0;const chunks:Uint8Array[]=[];
        if(request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
          bytes+=chunk.length;if(bytes>6000000) fail('invalid_message',413);chunks.push(chunk);
        }
        try {body=JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {fail('invalid_message',422);}
        if(!body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).some(k=>!fields[action]?.includes(k))) fail('invalid_message',422);
      } else if(action==='list') {
        const params=request.nextUrl.searchParams;
        if([...params.keys()].some(k=>!['limit','beforeId'].includes(k))) fail('invalid_message',422);
        if(params.has('limit')) body.limit=Number(params.get('limit'));
        if(params.has('beforeId')) body.beforeId=params.get('beforeId');
      }
      const result=await new KnowledgeService({enterpriseId:actor.enterpriseId!,adminId:actor.userId}).execute(action,{...body,...ids},request.headers.get('idempotency-key') ?? undefined);
      return NextResponse.json({success:true,data:result},{headers:{'Cache-Control':'no-store'}});
    } catch(e) {
      const known=e instanceof AssistantError;
      return NextResponse.json({success:false,error:known?e.code:'knowledge_unavailable'},{status:known?e.status:503,headers:{'Cache-Control':'no-store'}});
    }
  });
}
export const GET=handle;
export const POST=handle;
export const PATCH=handle;
