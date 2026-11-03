import { anonymousLiveHttp, liveFailure } from '@/lib/construction/public-live/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{enterpriseId:string;path?:string[]}>};
async function handle(request:Request,context:Context){
  try{const p=await context.params;return await anonymousLiveHttp(request,p.enterpriseId,p.path||[]);}catch(error){return liveFailure(error);}
}
export const GET=handle;
export const POST=handle;
export const OPTIONS=handle;
