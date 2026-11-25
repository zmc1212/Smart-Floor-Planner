import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { AssistantError, fail, id, isPublicAssistantScope, key } from '../contracts';
import { ConversationService } from '../core/conversation';
import { replyStreamResponse } from '../core/answer-stream';
import { RequirementWorkflow } from '../requirements/workflow';
import { customerIdentity, entryContext, fromEntry, locate } from './auth';
import { assertPrivateScope } from './public-scope';
import { HandoffWorkflow } from '../handoff/workflow';
import { staffHandoffHttp } from '../handoff/http';
import { mediaHttp } from '../media/http';
import { speechHttp } from '../speech/http';
import { portfolioCatalogHttp, portfolioPreviewHttp } from '@/lib/portfolio/catalog';
import { siteWatchInterceptor } from '@/lib/construction/site-watches';
import { customerSiteMedia } from '@/lib/construction/site-publications';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository } from '@/db/repositories/assistant-repository';
import { customerPublicHttp } from '@/lib/construction/public-http';
import { customerPlanHttp } from '@/lib/construction/plan-http';
import { parseWebCitationId } from '../agent/web-evidence';
import { LocationService } from '../location/service';
import { FloorplanContextService } from '../media/floorplan-context';
import { AssistantMeasureBookingService } from '../booking/appointment';
import { ReportContextService } from '@/lib/construction/report-context';
import { followupHttp } from '@/lib/construction/followup-http';
import { longTermHttp } from '../memory/http';

function only(body: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(body).some(k => !allowed.includes(k))) fail('invalid_message', 422);
}
export async function assistantHttp(request: Request, path: string[]) {
  if(path[0]==='followups')return followupHttp(request,path.slice(1));
  if(path[0]==='handoffs')return staffHandoffHttp(request,path.slice(1));
  const requestId = randomUUID();
  try {
    const identity = await customerIdentity(request);
    const privateConversation = async (target: string) => {
      const actor = await locate(identity, 'conversation', target);
      assertPrivateScope(actor);
      return actor;
    };
    if (path[0] === 'portfolio-preview') return await portfolioPreviewHttp(request, path.slice(1));
    if (path[0] === 'conversations' && ['report-context','report-topic'].includes(path[2]) && path.length === 3) {
      const cid = id(path[1]), params = new URL(request.url).searchParams;
      if (params.size) fail('invalid_message', 422);
      const service = new ReportContextService(await privateConversation(cid), cid);
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
    if (path[0] === 'conversations' && path[2] === 'measure-booking') {
      const cid = id(path[1]), params = new URL(request.url).searchParams;
      const service = new AssistantMeasureBookingService(await privateConversation(cid), cid, {
        phone: identity.phone,
        name: identity.nickname,
      });
      let data: unknown;
      if (request.method === 'GET' && path.length === 3 && !params.size) data = await service.read();
      else if (request.method === 'GET' && path.length === 4 && path[3] === 'availability') {
        if ([...params.keys()].some(key => !['date', 'leadId'].includes(key)) || params.size < 1 || params.size > 2) fail('invalid_message', 422);
        data = await service.availability({ date: params.get('date'), leadId: params.get('leadId') || undefined });
      } else if (request.method === 'POST' && path.length === 3 && !params.size) {
        const raw = await request.text(); if (raw.length > 2048) fail('invalid_message', 413);
        let body: unknown; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
        data = await service.book(key(request.headers.get('Idempotency-Key')), body);
      } else fail('assistant_resource_not_found', 404);
      return NextResponse.json({ success: true, data, requestId }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (path[0] === 'conversations' && path[2] === 'floorplan-context' && path.length === 3) {
      const cid = id(path[1]), params = new URL(request.url).searchParams;
      const service = new FloorplanContextService(await privateConversation(cid), cid);
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
      return await speechHttp(request, await privateConversation(cid), { kind: 'consultation', id: cid }, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'location' && path.length === 3) {
      if (new URL(request.url).searchParams.size) fail('invalid_location', 422);
      const cid = id(path[1]), service = new LocationService(await privateConversation(cid), cid);
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
      return await customerPlanHttp(request, await privateConversation(cid), cid, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'public-sites') {
      const cid = id(path[1]);
      return await customerPublicHttp(request, await privateConversation(cid), cid, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'construction-records' && path[4] === 'media' && path.length === 6 && request.method === 'GET') {
      const cid = id(path[1]), actor = await privateConversation(cid), params = new URL(request.url).searchParams;
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
      return await portfolioCatalogHttp(request, await privateConversation(target), target, path.slice(3));
    }
    if (path[0] === 'conversations' && path[2] === 'media' && [3,4].includes(path.length)) {
      const target = id(path[1]);
      return await mediaHttp(request, await privateConversation(target), target, path.slice(3));
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
      only(body, ['entryToken', 'staffProfileNotice']);
      if (body.staffProfileNotice !== undefined && body.staffProfileNotice !== true) fail('invalid_message', 422);
      const actor = await fromEntry(identity, method === 'GET' ? request.headers.get('X-Assistant-Entry') : body.entryToken,
        method === 'POST' && body.staffProfileNotice === true);
      const service = new ConversationService(actor);
      if (method === 'POST') {
        if (body.staffProfileNotice) assertPrivateScope(actor);
        data = await service.create(requestKey());
      }
      else if (params.has('search')) data = await service.search(params.get('search')!, cursor('cursor'), limit);
      else data = await service.list(cursor('cursor'), limit);
    } else if (path[0] === 'conversations' && path[2] === 'messages' && path.length === 4 && method === 'DELETE') {
      const target = id(path[1]);
      const service = new ConversationService(await locate(identity, 'conversation', target));
      data = await service.deleteQuestion(target, id(path[3]), requestKey());
    } else if (path[0] === 'conversations' && path[2] === 'messages' && path.length === 5) {
      const target = id(path[1]);
      const actor = await locate(identity, 'conversation', target);
      const service = new ConversationService(actor);
      const message = id(path[3]);
      if (path[4] === 'feedback' && method === 'PATCH') {
        only(body, ['rating', 'reason', 'note']);
        data = await service.feedback(target, message, requestKey(), body);
      } else if (path[4] === 'regenerate' && method === 'POST') {
        only(body, []);
        data = await service.regenerate(target, message, requestKey());
        status = 202;
      } else if (path[4] === 'audio' && method === 'GET') {
        assertPrivateScope(actor);
        const audio = await service.readAloud(target, message);
        return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
      } else fail('assistant_resource_not_found', 404);
    } else if (path[0] === 'conversations' && path.length <= 3) {
      const target = id(path[1]); const actor = await locate(identity, 'conversation', target); const service = new ConversationService(actor);
      if (path.length === 3 && path[2] !== 'messages') assertPrivateScope(actor);
      if (path.length === 2 && method === 'GET') data = await service.detail(target);
      else if (path.length === 2 && method === 'PATCH') {
        only(body, ['action', 'expectedVersion']);
        if (body.action !== 'archive' || !Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 1) fail('invalid_message', 422);
        data = await service.archive(target, Number(body.expectedVersion), requestKey());
      } else if (path[2] === 'long-term' && ['GET','POST','PATCH'].includes(method))
        data = await longTermHttp(actor, target, method, params, body, method === 'GET' ? undefined : requestKey());
      else if (path[2] === 'requirements' && method === 'GET') data = await new RequirementWorkflow(actor).read(target, params.get('profile') === '1');
      else if (path[2] === 'renovation-profile' && method === 'POST')
        data = await new RequirementWorkflow(actor).requirements.withdrawProfile(target, requestKey(), body);
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
        only(body, ['clientMessageId', 'content', 'speech', 'quoteMessageId']);
        if (requestKey() !== key(body.clientMessageId)) fail('invalid_message', 422);
        const publicScope = isPublicAssistantScope(actor);
        if (publicScope && body.speech !== undefined) fail('assistant_capability_forbidden', 403);
        data = await service.send(target, String(body.clientMessageId), body.content, publicScope ? undefined : siteWatchInterceptor, body.speech,
          body.quoteMessageId === undefined ? undefined : id(body.quoteMessageId));
        status = 202;
      } else fail('assistant_resource_not_found', 404);
    } else if (path[0]==='citations' && path.length===2 && method==='GET') {
      const web = parseWebCitationId(path[1]);
      const target = web ? key(path[1]) : id(path[1]);
      data=await new ConversationService(await locate(identity,web ? 'run' : 'citation',web ? id(web.runId) : target)).citation(target);
    } else if (path[0] === 'runs' && path.length <= 3) {
      const target = id(path[1]); const service = new ConversationService(await locate(identity, 'run', target)); only(body, []);
      if (path.length === 2 && method === 'GET') data = await service.run(target);
      else if (path[2] === 'answer-stream' && path.length === 3 && method === 'GET' && !params.size) {
        const read = () => service.run(target);
        return replyStreamResponse(read, await read(), request.signal);
      }
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
