import { NextRequest, NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { AssistantError, fail, key } from '@/lib/assistant/contracts';
import { ConstructionService } from '@/lib/construction/service';
import { siteChatHttp } from '@/lib/construction/site-http';
import { CustomerProjectProgress, customerProgressTenant } from '@/lib/construction/family-progress';
import { staffCameraHttp, customerCameraHttp } from '@/lib/construction/camera/http';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path?: string[] }> };
async function readBody(request: Request): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Uint8Array[] = [];
  if (request.body) for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.length; if (size > 32000) fail('invalid_construction', 413); chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_construction', 422); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || 'projectId' in body) fail('invalid_construction', 422);
  return body;
}
async function handle(request: NextRequest, context: Context) {
  try {
    const actor = await resolveMiniProgramContext(request);
    if (!actor) fail('Unauthorized', 401);
    const token = await verifyMiniProgramToken(request.headers.get('authorization')!.slice(7));
    if (!token) fail('Unauthorized', 401);
    const p = (await context.params).path || [], read = request.method === 'GET';
    if (actor.mode === 'customer' && p[0] === 'video') {
      if (!actor.user.openid) fail('Unauthorized', 401);
      return await customerCameraHttp(request, { userId: actor.user._id, contextVersion: token.contextVersion }, p.slice(1));
    }
    if (actor.mode === 'customer' && p[0] === 'projects' && ['progress', 'family-viewers'].includes(p[2])) {
      if (!actor.user.openid) fail('Unauthorized', 401);
      if (request.nextUrl.search) fail('invalid_construction', 422);
      const progress = p.length === 3 && p[2] === 'progress' && read;
      const grant = p.length === 4 && p[2] === 'family-viewers' && request.method === 'POST';
      if (!progress && !grant) fail('construction_not_found', 404);
      const enterpriseId = await customerProgressTenant(p[1], actor.user._id);
      const service = new CustomerProjectProgress({ enterpriseId, principal: { kind: 'user', userId: actor.user._id },
        contextVersion: token.contextVersion, capabilities: [] });
      const data = progress ? await service.read(p[1]) : await service.grant(p[1], p[3], await readBody(request), key(request.headers.get('idempotency-key')));
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (actor.mode !== 'staff' || !actor.staff?._id || !actor.enterpriseId) fail('construction_forbidden', 403);
    if (token.source === 'password' && actor.staff.mustChangePassword) fail('construction_password_required', 403);
    if (p[0] === 'video') return await staffCameraHttp(request, {
      enterpriseId: actor.enterpriseId, adminId: actor.staff._id, miniProgramUserId: actor.user._id, miniProgramContextVersion: token.contextVersion,
    }, p.slice(1));
    if (p[0] === 'projects' && p[2] === 'chat') return await siteChatHttp(request, {
      enterpriseId: actor.enterpriseId, adminId: actor.staff._id, miniProgramUserId: actor.user._id, miniProgramContextVersion: token.contextVersion,
    }, p[1], p.slice(3));
    let action = '', ids: Record<string, string> = {};
    if (p[0] === 'projects' && p.length === 3 && p[2] === 'schedule') {
      action = read ? 'schedule' : request.method === 'POST' ? 'saveSchedule' : '';
      ids = { projectId: p[1] };
    }
    if (p.length === 1 && p[0] === 'brief' && read) action = 'brief';
    if (p[0] === 'projects') {
      if (p.length === 1 && read) action = 'list';
      if (p.length === 2 && read) { action = 'detail'; ids = { projectId: p[1] }; }
      if (p.length === 3 && p[2] === 'schedule') { action = read ? 'schedule' : request.method === 'POST' ? 'saveSchedule' : ''; ids = { projectId: p[1] }; }
      if (p.length === 3 && request.method === 'POST' && ['member', 'contact', 'progress'].includes(p[2])) { action = p[2]; ids = { projectId: p[1] }; }
    }
    if (!action) fail('construction_not_found', 404);
    if (request.nextUrl.search) fail('invalid_construction', 422);
    const body = read ? {} : await readBody(request);
    const data = await new ConstructionService({ enterpriseId: actor.enterpriseId, adminId: actor.staff._id,
      miniProgramUserId: actor.user._id, miniProgramContextVersion: token.contextVersion,
    }).execute(action, { ...body, ...ids }, request.headers.get('idempotency-key') || undefined);
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof AssistantError ? error.code : 'construction_unavailable' }, {
      status: error instanceof AssistantError ? error.status : 503, headers: { 'Cache-Control': 'no-store' },
    });
  }
}
export const GET = handle;
export const POST = handle;
