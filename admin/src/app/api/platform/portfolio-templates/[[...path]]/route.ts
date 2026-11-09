import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import {
  listPlatformTemplates,
  platformTemplateAsset,
  platformTemplateDetail,
  setPlatformTemplateStatus,
  type PlatformTemplateStatus,
} from '@/lib/portfolio/platform-templates';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path?: string[] }> };
const headers = { 'Cache-Control': 'no-store' };

async function handle(request: NextRequest, context: Context) {
  return withTenantRoute(request, { roles: ['super_admin', 'admin'] }, async actor => {
    try {
      const p = (await context.params).path || [], method = request.method;
      if (!p.length && method === 'GET') {
        const filters: Record<string, unknown> = {};
        for (const [name, value] of request.nextUrl.searchParams) {
          if (!['status', 'query', 'style', 'layoutType', 'limit'].includes(name)) fail('invalid_portfolio', 422);
          filters[name] = name === 'limit' ? Number(value) : value;
        }
        return NextResponse.json({ success: true, data: await listPlatformTemplates(filters) }, { headers });
      }
      if (p.length === 1 && method === 'GET') {
        return NextResponse.json({ success: true, data: await platformTemplateDetail(p[0]) }, { headers });
      }
      if (p.length === 3 && p[1] === 'assets' && method === 'GET') {
        const asset = await platformTemplateAsset(p[0], p[2]);
        return new NextResponse(Buffer.from(String(asset.image_base64), 'base64'), {
          headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      if (p.length === 2 && p[1] === 'status' && method === 'PATCH') {
        let size = 0; const chunks: Uint8Array[] = [];
        if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
          size += chunk.length; if (size > 5000) fail('invalid_portfolio', 413); chunks.push(chunk);
        }
        let body: Record<string, unknown>;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_portfolio', 422); }
        if (!body || Array.isArray(body) || typeof body !== 'object'
          || Object.keys(body).some(k => !['status', 'expectedVersion'].includes(k))) fail('invalid_portfolio', 422);
        return NextResponse.json({
          success: true,
          data: await setPlatformTemplateStatus(p[0], body.status as PlatformTemplateStatus, body.expectedVersion, actor.userId),
        }, { headers });
      }
      fail('portfolio_template_not_found', 404);
    } catch (error) {
      return NextResponse.json(
        { success: false, error: error instanceof AssistantError ? error.code : 'portfolio_unavailable' },
        { status: error instanceof AssistantError ? error.status : 503, headers },
      );
    }
  });
}

export const GET = handle;
export const PATCH = handle;
