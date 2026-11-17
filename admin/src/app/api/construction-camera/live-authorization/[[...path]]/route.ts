import { liveFailure, ownerLiveWebHttp } from '@/lib/construction/public-live/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path?: string[] }> };

async function handle(request: Request, context: Context) {
  try {
    return await ownerLiveWebHttp(request, (await context.params).path || []);
  } catch (error) {
    return liveFailure(error);
  }
}

export const GET = handle;
export const POST = handle;
