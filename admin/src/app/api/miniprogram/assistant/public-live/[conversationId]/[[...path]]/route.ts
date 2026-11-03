import { customerIdentity, locate } from '@/lib/assistant/application/auth';
import { liveFailure, ownerLiveHttp } from '@/lib/construction/public-live/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{conversationId:string;path?:string[]}>};
async function handle(request:Request,context:Context){
  try{const p=await context.params,identity=await customerIdentity(request);return await ownerLiveHttp(request,await locate(identity,'conversation',p.conversationId),p.conversationId,p.path||[]);}catch(error){return liveFailure(error);}
}
export const GET=handle;
export const POST=handle;
