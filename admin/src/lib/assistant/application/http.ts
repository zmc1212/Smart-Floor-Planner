import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AssistantError, fail, id, key } from '../contracts';
import { ConversationService } from '../core/conversation';
import { RequirementWorkflow } from '../requirements/workflow';
import { customerIdentity, entryContext, fromEntry, locate } from './auth';
import { HandoffWorkflow } from '../handoff/workflow';
import { staffHandoffHttp } from '../handoff/http';
import { mediaHttp } from '../media/http';
import { speechHttp } from '../speech/http';
import { portfolioCatalogHttp } from '@/lib/portfolio/catalog';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { customerSiteMedia } from '@/lib/construction/site-publications';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository } from '@/db/repositories/assistant-repository';
import { customerPublicHttp } from '@/lib/construction/public-http';
import { customerPlanHttp } from '@/lib/construction/plan-http';
import { parseWebCitationId } from '../agent/web-evidence';
import { LocationService } from '../location/service';
import { FloorplanContextService } from '../media/floorplan-context';
import { ReportContextService } from '@/lib/construction/report-context';
import { followupHttp } from '@/lib/construction/followup-http';

function only(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(k => !allowed.includes(k))) fail('invalid_message', 422);
}
export async function assistantHttp(request: Request, path: string[]) {
  if(path[0]==='followups')return followupHttp(request,path.slice(1));
  if(path[0]==='handoffs')return staffHandoffHttp(request,path.slice(1));
  const requestId = randomUUID();
  try {
    const identity = await customerIdentity(request);
    if (path[0] === 'conversations' && ['report-context','report-topic'].includes(path[2]) && path.length === 3) {
      const cid = id(path[1]), params = new URL(request.url).searchParams;
      if (params.size) fail('invalid_message', 422);
      const service = new ReportContextService(await locate(identity, 'conversation', cid), cid);
      let data: unknown;
      if (request.method === 'GET' && path[2] === 'report-context') data = await service.read();
      else if (request.method === 'POST') {
        const raw = await request.text(); if (raw.length > 2048) fail('invalid_message', 413);
        let body: unknown; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
        if (path[2] === 'report-topic' && (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length)) fail('invalid_message', 422);
        const requestKey = key(request.headers.get('Idempotency-Key'));
        data = path[2] === 'report-topic' ? await service.topic(requestKey) : await service.select(requestKey, body);
      } else fail('assistant_resource_not_found', 404);
      return NextResponse.json({ success: true, data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path[0] === 'conversations' && path[2] === 'floorplan-context' && path.length === 3) {
      const cid = id(path[1]), params = new URL(request.url).searchParams;
      const service = new FloorplanContextService(await locate(identity, 'conversation', cid), cid);
      let data: unknown;
      if (request.method === 'GET') {
        if (!params.size) data = await service.read();
        else {
          if ([...params.keys()].some(k => !['leadId','floorPlanId','layoutHash'].includes(k)) || params.size !== 3) fail('invalid_message', 422);
          data = await service.detail(id(params.get('leadId')), id(params.get('floorPlanId')), String(params.get('layoutHash')));
        }
      } else if (request.method === 'POST' && !params.size) {
        const raw = await request.text(); if (raw.length > 1024) fail('invalid_message', 422);
        let body: unknown; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
        data = await service.select(key(request.headers.get('Idempotency-Key')), body);
      } else fail('assistant_resource_not_found', 404);
      return NextResponse.json({ success: true, data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path[0] === 'conversations' && path[2] === 'speech') {
      const cid = id(path[1]);
      return await speechHttp(request, await locate(identity, 'conversation', cid), { kind: 'consultation', id: cid }, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'location' && path.length === 3) {
      if (new URL(request.url).searchParams.size) fail('invalid_location', 422);
      const cid = id(path[1]), service = new LocationService(await locate(identity, 'conversation', cid), cid);
      let data: unknown;
      if (request.method === 'GET') data = await service.read();
      else if (request.method === 'DELETE') data = await service.clear();
      else if (request.method === 'POST') {
        const text = await request.text(); if (text.length > 512) fail('invalid_location', 422);
        let input: unknown; try { input = JSON.parse(text); } catch { return fail('invalid_location', 422); }
        data = await service.locate(input);
      } else fail('assistant_resource_not_found', 404);
      return NextResponse.json({ success: true, data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path[0] === 'conversations' && path[2] === 'plans') {
      const cid = id(path[1]);
      return await customerPlanHttp(request, await locate(identity, 'conversation', cid), cid, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'public-sites') {
      const cid = id(path[1]);
      return await customerPublicHttp(request, await locate(identity, 'conversation', cid), cid, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'construction-records' && path[4] === 'media' && path.length === 6 && request.method === 'GET') {
      const cid = id(path[1]), actor = await locate(identity, 'conversation', cid), params = new URL(request.url).searchParams;
      const version = Number(params.get('version'));
      if ([...params.keys()].some(k => k !== 'version') || !Number.isSafeInteger(version) || version < 1) fail('invalid_message', 422);
      const media = await withTenantTransaction(actor.enterpriseId, async tx => {
        const repo = new AssistantRepository(tx, actor); await repo.settings();
        return customerSiteMedia(tx, actor, await repo.conversation(cid), id(path[3]), id(path[5]), version);
      });
      return new Response(new Uint8Array(media.data), { headers: { 'Content-Type': media.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (path[0] === 'conversations' && path[2] === 'portfolio') {
      const target = id(path[1]);
      return await portfolioCatalogHttp(request, await locate(identity, 'conversation', target), target, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'media' && [3,4].includes(path.length)) {
      const target = id(path[1]);
      return await mediaHttp(request, await locate(identity, 'conversation', target), target, path.slice(3));
    }
    const method = request.method;
    let body: Record<string, unknown> = {};
    if (['POST', 'PATCH'].includes(method)) {
      const text = await request.text();
      if (text.length > 20000) fail('invalid_message', 422);
      try { body = text ? JSON.parse(text) : {}; } catch { fail('invalid_message', 422); }
      if (!body || Array.isArray(body) || typeof body !== 'object') fail('invalid_message', 422);
    }
    let data: unknown; let status = 200;
    const requestKey = () => key(request.headers.get('Idempotency-Key'));
    const params = new URL(request.url).searchParams;
    const cursor = (name: string) => params.has(name) ? id(params.get(name)) : undefined;
    const limit = Number(params.get('limit') || 20);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('invalid_message', 422);
    if (path.join('/') === 'entry-context' && method === 'POST') data = await entryContext(identity, body);
    else if (path[0] === 'conversations' && path.length === 1 && ['GET', 'POST'].includes(method)) {
      only(body, ['entryToken']);
      const actor = await fromEntry(identity, method === 'GET' ? request.headers.get('X-Assistant-Entry') : body.entryToken);
      const service = new ConversationService(actor);
      data = method === 'GET' ? await service.list(cursor('cursor'), limit) : await service.create(requestKey());
    } else if (path[0] === 'conversations' && path.length <= 3) {
      const target = id(path[1]); const actor = await locate(identity, 'conversation', target); const service = new ConversationService(actor);
      if (path.length === 2 && method === 'GET') data = await service.detail(target);
      else if (path.length === 2 && method === 'PATCH') {
        only(body, ['action', 'expectedVersion']);
        if (body.action !== 'archive' || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) fail('invalid_message', 422);
        data = await service.archive(target, Number(body.expectedVersion), requestKey());
      } else if (path[2] === 'requirements' && method === 'GET') data = await new RequirementWorkflow(actor).read(target);
      else if (path[2] === 'handoff' && method === 'GET') data = await new HandoffWorkflow(actor).customerRead(target);
      else if (path[2] === 'handoff' && method === 'POST') data = await new HandoffWorkflow(actor).customerWrite(target,requestKey(),body);
      else if (path[2] === 'requirements' && method === 'POST') data = await new RequirementWorkflow(actor).write(target, requestKey(), body);
      else if (path[2] === 'messages' && method === 'GET') {
        const after = cursor('afterSeq');
        if (after !== undefined && params.has('beforeSeq')) fail('invalid_message', 422);
        data = after !== undefined ? await service.messageDelta(target, after, limit) : await service.messages(target, cursor('beforeSeq'), limit);
      }
      else if (path[2] === 'suggestions' && method === 'GET') data = await service.suggestions(target);
      else if (path[2] === 'construction-contact' && method === 'GET') {
        if ([...params.keys()].some(k => !['projectId', 'messageId'].includes(k))) fail('invalid_message', 422);
        data = await service.constructionContact(target, id(params.get('projectId')), id(params.get('messageId')));
      }
      else if (path[2] === 'messages' && method === 'POST') {
        only(body, ['clientMessageId', 'content', 'speech']);
        if (requestKey() !== key(body.clientMessageId)) fail('invalid_message', 422);
        data = await service.send(target, String(body.clientMessageId), body.content, siteWatchInterceptor, body.speech); status = 202;
      } else fail('assistant_resource_not_found', 404);
    } else if (path[0]==='citations' && path.length===2 && method==='GET') {
      const web = parseWebCitationId(path[1]);
      const target = web ? key(path[1]) : id(path[1]);
      data=await new ConversationService(await locate(identity,web ? 'run' : 'citation',web ? id(web.runId) : target)).citation(target);
    } else if (path[0] === 'runs' && path.length <= 3) {
      const target = id(path[1]); const service = new ConversationService(await locate(identity, 'run', target)); only(body, []);
      if (path.length === 2 && method === 'GET') data = await service.run(target);
      else if (path.length === 3 && ['cancel', 'retry'].includes(path[2]) && method === 'POST') {
        data = await service.run(target, path[2] as 'cancel' | 'retry', requestKey()); status = path[2] === 'retry' ? 202 : 200;
      } else fail('assistant_resource_not_found', 404);
    } else fail('assistant_resource_not_found', 404);
    return NextResponse.json({ success: true, data, requestId }, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    // A non-AssistantError here is an unexpected infrastructure failure; the
    // mapped 503 must keep its real cause in the server log for diagnosis.
    if (!(error instanceof AssistantError)) console.error('[assistant] unexpected dispatch failure', requestId, error);
    const safe = error instanceof AssistantError ? error : new AssistantError('assistant_unavailable', 503);
    return NextResponse.json({ success: false, error: safe.code, code: safe.code, requestId }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } });
  }
}
