import { NextRequest } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { staffLiveHttp, liveFailure } from '@/lib/construction/public-live/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{projectId:string;path?:string[]}>};
async function handle(request:NextRequest,context:Context){
  return withTenantRoute(request,{requireEnterprise:true},async actor=>{
    try{const p=await context.params;return await staffLiveHttp(request,{enterpriseId:actor.enterpriseId!,adminId:actor.userId},p.projectId,p.path||[]);}catch(error){return liveFailure(error);}
  });
}
export const GET=handle;
export const POST=handle;
