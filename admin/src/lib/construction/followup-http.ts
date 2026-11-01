import { NextResponse } from 'next/server';
import { resolveMiniProgramContext } from '@/lib/miniprogram-auth';
import { verifyMiniProgramToken } from '@/lib/miniprogram-jwt';
import { customerIdentity, fromEntry } from '@/lib/assistant/application/auth';
import { AssistantError, fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { FollowupService } from './followup-service';
import { object } from './contracts';
import { ConstructionReportService, reportPlanDto } from './report-service';

/** Reuses the selected Mini identity and original repository authority. Neither
 * principal, tenant, audience nor a delivery capability comes from the body. */
export async function followupMiniActor(request: Request): Promise<ActorContext> {
  const context = await resolveMiniProgramContext(request), token = await verifyMiniProgramToken(request.headers.get('authorization')?.slice(7) || '');
  if (!context || !token) fail('identity_context_invalid', 401);
  if (context.mode === 'customer') {
    const identity = await customerIdentity(request), entry = request.headers.get('X-Assistant-Entry');
    const actor = entry ? await fromEntry(identity, entry) : context.enterpriseId
      ? { enterpriseId: context.enterpriseId, principal: { kind: 'user' as const, userId: context.user._id }, contextVersion: token.contextVersion }
      : fail('entry_context_invalid', 422);
    return { ...actor, capabilities: ['assistant.followup.self'] };
  }
  if (context.mode !== 'staff' || !context.staff || !context.enterpriseId) fail('assistant_capability_forbidden', 403);
  if (token.source === 'password' && context.staff.mustChangePassword) fail('construction_password_required', 403);
  return { enterpriseId: context.enterpriseId, principal: { kind: 'admin', adminId: context.staff._id }, contextVersion: token.contextVersion,
    capabilities: ['assistant.followup.self'], entry: { miniProgramUserId: context.user._id, miniProgramContextVersion: token.contextVersion } };
}
export async function followupHttp(request: Request, path: string[]) {
  try {
    const data = await handleFollowup(request, path, await followupMiniActor(request));
    if (data instanceof Response) return data;
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const e = error instanceof AssistantError ? error : new AssistantError('construction_report_unavailable', 503);
    return NextResponse.json({ success: false, error: e.code, code: e.code }, { status: e.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
export async function handleFollowup(request: Request, path: string[], actor: ActorContext) {
  if (path[0] === 'plan') {
    if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
    const params = new URL(request.url).searchParams;
    if (path.length !== 1 || [...params.keys()].some(k => k !== 'beforeId') || (request.method !== 'GET' && params.size)) fail('invalid_construction', 422);
    const service = new ConstructionReportService({ enterpriseId: actor.enterpriseId, adminId: actor.principal.adminId,
      miniProgramUserId: actor.entry?.miniProgramUserId as string | undefined, miniProgramContextVersion: actor.contextVersion });
    if (request.method === 'GET') return service.plan(params.has('beforeId') ? id(params.get('beforeId')) : undefined);
    if (request.method !== 'POST') fail('assistant_resource_not_found', 404);
    const raw = await request.text(); if (raw.length > 4096) fail('invalid_construction', 413);
    let body; try { body = JSON.parse(raw); } catch { return fail('invalid_construction', 422); }
    return reportPlanDto(await service.configure(body, key(request.headers.get('Idempotency-Key'))), actor.enterpriseId);
  }
  const service = new FollowupService(actor), method = request.method, params = new URL(request.url).searchParams;
  const allowed = path.length === 1 && path[0] === 'manage' ? ['beforeId'] : path[1] === 'reports' ? path.length === 2 ? ['beforeId'] : ['revision'] : [];
  if ([...params.keys()].some(k => !allowed.includes(k))) fail('invalid_construction', 422);
  if (method === 'GET') {
    if (!path.length) return service.list();
    if (path.length === 1 && path[0] === 'manage') return service.management(params.has('beforeId') ? id(params.get('beforeId')) : undefined);
    const bid = id(path[0]);
    if (path.length === 1) return service.context(bid);
    if (path[1] === 'reports') {
      if (path.length === 2) return service.reports(bid, params.has('beforeId') ? id(params.get('beforeId')) : undefined);
      const rid = id(path[2]), revision = params.has('revision') ? Number(params.get('revision')) : undefined;
      if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) fail('invalid_construction', 422);
      if (path.length === 3) return service.detail(bid, rid, revision);
      if (path[3] === 'projects' && path[5] === 'records' && [7,9].includes(path.length) && revision) {
        const pid = id(path[4]), recordId = id(path[6]);
        if (path.length === 7) return service.record(bid, rid, revision, pid, recordId);
        if (path[7] === 'media') {
          const media = await service.recordMedia(bid, rid, revision, pid, recordId, id(path[8]));
          return new Response(new Uint8Array(media.data), { headers: { 'Content-Type': media.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
        }
      }
    }
    fail('assistant_resource_not_found', 404);
  }
  if (method !== 'POST' || params.size) fail('assistant_resource_not_found', 404);
  const requestKey = key(request.headers.get('Idempotency-Key')), raw = await request.text();
  if (raw.length > 2048) fail('invalid_construction', 413);
  let body; try { body = JSON.parse(raw); } catch { return fail('invalid_construction', 422); }
  if (path.length === 1 && path[0] === 'open') { const b = object(body, ['projectId']); return service.open(requestKey, b.projectId === undefined ? undefined : id(b.projectId)); }
  const bid = id(path[0]);
  if (path.length === 2 && path[1] === 'preferences') {
    const b = object(body, ['expectedVersion','preferences']), p = object(b.preferences, ['stage','daily','weekly']);
    return service.savePreferences(bid, p as { stage: boolean; daily: boolean; weekly: boolean }, b.expectedVersion as number, requestKey);
  }
  if (path.length === 2 && ['archive','stop','delete','resume'].includes(path[1])) {
    const b = object(body, ['expectedVersion']); return service.change(bid, path[1] as 'archive' | 'stop' | 'delete' | 'resume', b.expectedVersion as number, requestKey);
  }
  if (path.length === 2 && path[1] === 'seen') {
    const b = object(body, ['throughSequence','conversationId']); return service.seen(bid, id(b.throughSequence), requestKey, id(b.conversationId));
  }
  if (path[1] === 'reports' && path.length === 4) {
    const rid = id(path[2]);
    if (path[3] === 'acknowledge') { const b = object(body, ['revision','readToken']); return service.acknowledge(bid, rid, b.revision as number, b.readToken as string, requestKey); }
    if (path[3] === 'retry') { const b = object(body, ['revision']); return service.retry(bid, rid, b.revision as number, requestKey); }
  }
  fail('assistant_resource_not_found', 404);
}
