import { NextRequest, NextResponse } from 'next/server';
import { withTenantRoute } from '@/lib/tenant-route';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { PortfolioService } from '@/lib/portfolio/service';
import { PORTFOLIO_ROLES } from '@/lib/portfolio/contracts';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path?: string[] }> };
const fields: Record<string, string[]> = {
  create: ['kind', 'authorId', 'content'], save: ['expectedVersion', 'content'], upload: ['expectedVersion', 'imageBase64'],
  newDraft: ['expectedVersion'], submit: ['expectedVersion'], publish: ['expectedVersion'], return: ['expectedVersion', 'note'], withdraw: ['expectedVersion'],
  saveProfile: ['expectedVersion', 'content'], bindCommunity: ['token', 'pageKey'], requestCommunity: ['content'],
  reviewCommunity: ['approve', 'note', 'existingCommunityId'],
};
async function handle(request: NextRequest, context: Context) {
  return withTenantRoute(request, { roles: [...PORTFOLIO_ROLES], requireEnterprise: true }, async actor => {
    try {
      const p = (await context.params).path || [], method = request.method;
      let action = ''; const ids: Record<string, unknown> = {};
      if (p[0] === 'works') {
        if (p.length === 1) action = method === 'GET' ? 'list' : method === 'POST' ? 'create' : '';
        if (p.length >= 2) ids.workId = p[1];
        if (p.length === 2) action = method === 'GET' ? 'detail' : method === 'PATCH' ? 'save' : '';
        if (p.length === 3 && method === 'POST') action = ({ assets: 'upload', draft: 'newDraft', submit: 'submit', publish: 'publish', return: 'return', withdraw: 'withdraw' } as Record<string, string>)[p[2]] || '';
        if (p.length === 4 && p[2] === 'assets' && method === 'GET') { action = 'asset'; ids.assetId = p[3]; }
      } else if (p.length === 1 && p[0] === 'authors' && method === 'GET') action = 'authors';
      else if (p.length === 2 && p[0] === 'profiles') { action = method === 'GET' ? 'profile' : method === 'PUT' ? 'saveProfile' : ''; ids.authorId = p[1]; }
      else if (p[0] === 'communities') {
        if (p.length === 1 && method === 'GET') action = 'communities';
        if (p.length === 2 && p[1] === 'search' && method === 'GET') action = 'providerSearch';
        if (p.length === 2 && p[1] === 'bind' && method === 'POST') action = 'bindCommunity';
        if (p.length === 2 && p[1] === 'requests') action = method === 'GET' ? 'communityRequests' : method === 'POST' ? 'requestCommunity' : '';
        if (p.length === 4 && p[1] === 'requests' && p[3] === 'review' && method === 'POST') { action = 'reviewCommunity'; ids.requestId = p[2]; }
      }
      if (!action) fail('portfolio_not_found', 404);
      let body: Record<string, unknown> = {};
      if (method !== 'GET') {
        let size = 0; const chunks: Uint8Array[] = [];
        if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) { size += chunk.length; if (size > (action === 'upload' ? 5650000 : 50000)) fail('invalid_portfolio', 413); chunks.push(chunk); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_portfolio', 422); }
        if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !fields[action]?.includes(k))) fail('invalid_portfolio', 422);
      } else {
        const allowed = action === 'list' ? ['limit', 'beforeId', 'status', 'query', 'style', 'authorId', 'kind', 'communityId']
          : action === 'providerSearch' ? ['cityCode', 'query', 'pageKey'] : action === 'communities' ? ['cityCode', 'query', 'communityId'] : [];
        for (const [name, value] of request.nextUrl.searchParams) { if (!allowed.includes(name)) fail('invalid_portfolio', 422); body[name] = name === 'limit' ? Number(value) : value; }
      }
      const service = new PortfolioService({ enterpriseId: actor.enterpriseId!, adminId: actor.userId });
      const result = action === 'providerSearch' ? await service.searchProvider(body) : await service.execute(action, { ...body, ...ids }, request.headers.get('idempotency-key') || undefined);
      if (action === 'asset') return new NextResponse(Buffer.from(String(result.image_base64), 'base64'), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      return NextResponse.json({ success: true, data: result }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return NextResponse.json({ success: false, error: error instanceof AssistantError ? error.code : 'portfolio_unavailable' }, { status: error instanceof AssistantError ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
    }
  });
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
