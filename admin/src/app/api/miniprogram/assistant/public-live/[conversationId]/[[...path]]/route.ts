import { customerIdentity, locate } from '@/lib/assistant/application/auth';
import { assertPrivateScope } from '@/lib/assistant/application/public-scope';
import { liveFailure, ownerLiveHttp } from '@/lib/construction/public-live/http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Context={params:Promise<{conversationId:string;path?:string[]}>};
async function handle(request:Request,context:Context){
  try {
    const p = await context.params;
    const identity = await customerIdentity(request);
    const actor = await locate(identity, 'conversation', p.conversationId);
    assertPrivateScope(actor);
    return await ownerLiveHttp(request, actor, p.conversationId, p.path || []);
  } catch (error) { return liveFailure(error); }
}
export const GET=handle;
export const POST=handle;
