import { NextRequest, NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyFamilyInvite, verifyMiniProgramToken, type FamilyInvitePayload } from '@/lib/miniprogram-jwt';
import { AssistantError, fail, id, key } from '@/lib/assistant/contracts';
import { ConstructionService } from '@/lib/construction/service';
import { siteChatHttp } from '@/lib/construction/site-http';
import { SiteChatService } from '@/lib/construction/site-chat';
import { inspectionRouteStops, inspectionStops, listInspection, setInspectionPin } from '@/lib/construction/inspection';
import { createInspectionMapSession } from '@/lib/construction/inspection-map-session';
import { CustomerProjectProgress, customerConstructionProjects, customerProgressTenant, familyInviteTarget } from '@/lib/construction/family-progress';
import { signFamilyInviteCode, verifyFamilyInviteCode } from '@/lib/construction/family-invite-code';
import { createFamilyInviteCode, getMiniProgramCodeContentType } from '@/lib/wechat-miniprogram-code';
import { staffMiniCameraHttp, customerCameraHttp } from '@/lib/construction/camera/http';
import { ownerSiteHome, ownerSiteList } from '@/lib/construction/owner-home';
import { ownerSiteCover } from '@/lib/construction/camera/owner-cover';
import { issueOwnerLiveWebTicket, ownerApplicationSummary } from '@/lib/construction/public-live/project-owner';

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
/**
 * A shared card carries a signed JWT, while a Mini Program code can only carry
 * 32 scene characters. Both resolve to the same invitation payload; the project
 * row supplies the tenant and owner so a scanned code cannot name another one.
 */
async function familyInviteFromCode(value: string): Promise<FamilyInvitePayload | null> {
  const code = verifyFamilyInviteCode(value);
  if (!code) return null;
  const target = await familyInviteTarget(code.projectId);
  if (!target) return null;
  return {
    kind: 'construction-family-invite',
    projectId: code.projectId,
    ownerId: target.ownerId,
    enterpriseId: target.enterpriseId,
    jti: value,
  } as FamilyInvitePayload;
}
async function handle(request: NextRequest, context: Context) {
  try {
    const actor = await resolveMiniProgramContext(request);
    if (!actor) fail('Unauthorized', 401);
    const token = await verifyMiniProgramToken(request.headers.get('authorization')!.slice(7));
    if (!token) fail('Unauthorized', 401);
    const p = (await context.params).path || [], read = request.method === 'GET';
    if (p[0] === 'owner-sites') {
      // Owner-site data is resolved by the underlying user id (owner or an
      // explicit camera grant), so any identity mode of the same user works.
      if (!actor.user.openid) fail('construction_not_found', 404);
      const identity = { userId: actor.user._id, contextVersion: token.contextVersion };
      if (p[2] === 'public-live') {
        if (request.nextUrl.search) fail('construction_not_found', 404);
        const projectId = id(p[1]);
        let data;
        if (read && p.length === 3) {
          data = await ownerApplicationSummary(identity, projectId);
        } else if (request.method === 'POST' && p[3] === 'entry' && p.length === 4) {
          const body = await readBody(request);
          if (Object.keys(body).some(field => field !== 'liveId' && field !== 'versionId')) fail('invalid_construction', 422);
          data = await issueOwnerLiveWebTicket(identity, projectId, id(body.liveId), id(body.versionId));
        } else fail('construction_not_found', 404);
        return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (!read || request.nextUrl.search || p.length > 3 || (p.length === 3 && p[2] !== 'cover')) fail('construction_not_found', 404);
      const data = p.length === 1 ? await ownerSiteList(identity.userId)
        : p.length === 2 ? await ownerSiteHome(identity, id(p[1]), actor.mode === 'customer') : await ownerSiteCover(identity, id(p[1]));
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    // The construction customer flows are keyed by the underlying user id
    // (owner gate and family-view bindings live inside the service), so any
    // mini program identity mode carries the same user and the same access.
    // Without this, an account whose default context is staff/referrer (any
    // employee or referrer identity) can never open the family flow.
    if (p.length === 1 && p[0] === 'customer-projects' && read) {
      if (!actor.user.openid) fail('Unauthorized', 401);
      const params = request.nextUrl.searchParams;
      if ([...params.keys()].some(name => !['leadId', 'projectId'].includes(name))) fail('invalid_construction', 422);
      const data = await customerConstructionProjects(actor.user._id, {
        leadId: params.get('leadId') || undefined,
        projectId: params.get('projectId') || undefined,
      });
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (p[0] === 'projects' && p.length === 3 && p[2] === 'family-invite-code' && read) {
      if (!actor.user.openid) fail('Unauthorized', 401);
      if ([...request.nextUrl.searchParams.keys()].some(name => name !== 'env')) fail('invalid_construction', 422);
      const env = request.nextUrl.searchParams.get('env') || '';
      // The family code must open the build that generated it: developers get
      // the develop build, testers the trial build, everyone else the release.
      if (env !== 'develop' && env !== 'trial' && env !== 'release') fail('invalid_construction', 422);
      const enterpriseId = await customerProgressTenant(p[1], actor.user._id);
      const service = new CustomerProjectProgress({ enterpriseId, principal: { kind: 'user', userId: actor.user._id },
        contextVersion: token.contextVersion, capabilities: [] });
      // Minting a card is the owner-only gate. The card itself is not returned.
      await service.invite(p[1]);
      const scene = signFamilyInviteCode(p[1]);
      const image = await createFamilyInviteCode(scene.code, { envVersion: env });
      const contentType = getMiniProgramCodeContentType(image) ?? 'application/octet-stream';
      return new NextResponse(image, { headers: { 'Content-Type': contentType,
        'Cache-Control': 'private, no-store, max-age=0' } });
    }
    if (p[0] === 'family-invites' && p.length === 3 && p[2] === 'accept' && request.method === 'POST') {
      if (!actor.user.openid) fail('Unauthorized', 401);
      if (request.nextUrl.search) fail('invalid_construction', 422);
      const invite = await familyInviteFromCode(p[1]) || await verifyFamilyInvite(p[1]);
      if (!invite) fail('construction_invite_invalid', 404);
      const service = new CustomerProjectProgress({ enterpriseId: invite.enterpriseId,
        principal: { kind: 'user', userId: actor.user._id }, contextVersion: token.contextVersion, capabilities: [] });
      const data = await service.acceptInvite(invite);
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (p[0] === 'video') {
      if (!actor.user.openid) fail('Unauthorized', 401);
      return await customerCameraHttp(request, { userId: actor.user._id, contextVersion: token.contextVersion }, p.slice(1));
    }
    // The same progress path accepts stage writes from authorized staff below.
    if (p[0] === 'projects' && ((p[2] === 'progress' && read) || ['family-viewers', 'family-invite'].includes(p[2]))) {
      if (!actor.user.openid) fail('Unauthorized', 401);
      if (request.nextUrl.search) fail('invalid_construction', 422);
      const progress = p.length === 3 && p[2] === 'progress' && read;
      const grant = p.length === 4 && p[2] === 'family-viewers' && request.method === 'POST';
      const viewers = p.length === 3 && p[2] === 'family-viewers' && read;
      const invite = p.length === 3 && p[2] === 'family-invite' && request.method === 'POST';
      if (!progress && !grant && !viewers && !invite) fail('construction_not_found', 404);
      const enterpriseId = await customerProgressTenant(p[1], actor.user._id);
      const service = new CustomerProjectProgress({ enterpriseId, principal: { kind: 'user', userId: actor.user._id },
        contextVersion: token.contextVersion, capabilities: [] });
      const data = progress ? await service.read(p[1])
        : viewers ? await service.viewers(p[1])
        : invite ? await service.invite(p[1])
        : await service.grant(p[1], p[3], await readBody(request), key(request.headers.get('idempotency-key')));
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (actor.mode !== 'staff' || !actor.staff?._id || !actor.enterpriseId) fail('construction_forbidden', 403);
    if (token.source === 'password' && actor.staff.mustChangePassword) fail('construction_password_required', 403);
    if (p[0] === 'inspection') {
      const staff = { enterpriseId: actor.enterpriseId, adminId: actor.staff._id,
        miniProgramUserId: actor.user._id, miniProgramContextVersion: token.contextVersion };
      const subpath = p.slice(1).join('/'), query = request.nextUrl.searchParams;
      const list = !subpath && read;
      const routeStops = subpath === 'route-stops' && read;
      const allowed = list ? ['cursor', 'projectId', 'onsite'] : routeStops ? ['projectIds'] : [];
      if ([...query].some(([k]) => !allowed.includes(k) || query.getAll(k).length !== 1)) fail('invalid_construction', 422);
      let data;
      if (list) {
        const onsite = query.get('onsite');
        if (onsite !== null && onsite !== '1') fail('invalid_construction', 422);
        data = await listInspection(staff, query.get('cursor'), query.get('projectId'), onsite === '1');
      } else if (routeStops) data = await inspectionRouteStops(staff, query.has('projectIds') ? query.get('projectIds')!.split(',') : []);
      else if (read && subpath === 'stops') data = await inspectionStops(staff);
      else if (read && p.length === 5 && p[1] === 'projects' && p[3] === 'records') data = await new SiteChatService(staff).reviewRecord(p[2], p[4]);
      else if (request.method === 'POST' && subpath === 'map-entry') data = await createInspectionMapSession(staff, await readBody(request));
      else if (request.method === 'POST' && p.length === 4 && p[1] === 'projects' && p[3] === 'pin') data = await setInspectionPin(staff, p[2], await readBody(request));
      else fail('construction_not_found', 404);
      return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (p[0] === 'staff-video') return await staffMiniCameraHttp(request, {
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
