import { sessionCameraHttp } from '@/lib/construction/camera/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: Request, context: Context) { return sessionCameraHttp(request, (await context.params).path || []); }
export const GET = handle;
export const POST = handle;
