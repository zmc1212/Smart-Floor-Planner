import { assistantHttp } from '@/lib/assistant/application/http';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) { return assistantHttp(request, (await context.params).path); }
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
