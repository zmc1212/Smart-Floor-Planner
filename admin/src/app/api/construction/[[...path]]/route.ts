import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { ConstructionService } from '@/lib/construction/service';
import { siteChatHttp } from '@/lib/construction/site-http';
import { staffPublicHttp } from '@/lib/construction/public-http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path?: string[] }> };
async function handle(request: NextRequest, context: Context) {
  return withTenantRoute(request, { requireEnterprise: true }, async actor => {
    try {
      const p = (await context.params).path || [], read = request.method === 'GET';
      if (p[0] === 'projects' && p[2] === 'public-materials') return await staffPublicHttp(request,
        { enterpriseId: actor.enterpriseId!, adminId: actor.userId }, p[1], p.slice(3));
      if (p[0] === 'projects' && p[2] === 'chat') return await siteChatHttp(request,
        { enterpriseId: actor.enterpriseId!, adminId: actor.userId }, p[1], p.slice(3));
      let action = '', ids: Record<string, string> = {};
      if (p.length === 1 && p[0] === 'options' && read) action = 'options';
      if (p.length === 2 && p[0] === 'leads' && read) { action = 'lead'; ids = { leadId: p[1] }; }
      if (p.length === 1 && p[0] === 'stages') action = read ? 'stages' : request.method === 'PATCH' ? 'saveStages' : '';
      if (p[0] === 'projects') {
        if (p.length === 1) action = read ? 'list' : request.method === 'POST' ? 'create' : '';
        if (p.length === 2) { action = read ? 'detail' : request.method === 'PATCH' ? 'update' : ''; ids = { projectId: p[1] }; }
        if (p.length === 3 && request.method === 'POST' && ['member', 'room', 'progress', 'contact'].includes(p[2])) { action = p[2]; ids = { projectId: p[1] }; }
      }
      if (!action) fail('construction_not_found', 404);
      if (request.nextUrl.search) fail('invalid_construction', 422);
      let body: Record<string, unknown> = {};
      if (!read) {
        let size = 0; const chunks: Uint8Array[] = [];
        if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > (action === 'saveStages' ? 128000 : 32000)) fail('invalid_construction', 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_construction', 422); }
        if (!body || typeof body !== 'object' || Array.isArray(body) || 'projectId' in body) fail('invalid_construction', 422);
      }
      const data = await new ConstructionService({ enterpriseId: actor.enterpriseId!, adminId: actor.userId }).execute(action, { ...body, ...ids }, request.headers.get('idempotency-key') || undefined);
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof AssistantError ? error.code : 'construction_unavailable' }, { status: error instanceof AssistantError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
    }
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
