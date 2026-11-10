import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { fail, key, type ActorContext } from '@/lib/assistant/contracts';
import { FollowupService } from './followup-service';
import { object } from './contracts';
import { mediaHttp } from '@/lib/assistant/media/http';
import { ReportContextService } from './report-context';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { sql } from 'drizzle-orm';
import { parseWebCitationId } from '@/lib/assistant/agent/web-evidence';

/** Only the current recipient's private destination. Reception grants never
 * confer the recipient's report, knowledge or private-question authority. */
export async function followupConversationHttp(request: Request, path: string[], actor: ActorContext) {
  if (path.length < 2 || path.length > 5) fail('assistant_capability_forbidden', 403);
  const query = new URL(request.url).searchParams, resource = path[2];
  if (path[1] !== 'conversation' || resource && !['messages','handoff','media','report-context','report-topic','runs','citations'].includes(resource)
    || path.length > 3 && !['media','runs','citations'].includes(resource)
    || path.length > 4 && resource !== 'runs') fail('assistant_resource_not_found', 404);
  if ([...query.keys()].some(k => !['afterSeq','beforeSeq','limit'].includes(k) || resource !== 'messages' || query.getAll(k).length !== 1)) fail('invalid_message', 422);
  const context = await new FollowupService(actor).context(path[0]);
  const customer = actor.principal.kind === 'user';
  if (customer ? context.audience !== 'customer' : !['worker','designer','boss'].includes(context.audience)) fail('assistant_capability_forbidden', 403);
  if (!customer && ['handoff','media','report-topic'].includes(resource)) fail('assistant_capability_forbidden', 403);
  const service = new ConversationService(actor), cid = context.conversationId;
  if (resource === 'citations') {
    if (request.method !== 'GET' || path.length !== 4 || query.size) fail('assistant_resource_not_found', 404);
    const citationId = path[3];
    if (!/^[1-9]\d{0,18}$/.test(citationId) && !parseWebCitationId(citationId)) fail('invalid_message', 422);
    return service.citation(citationId, true, cid);
  }
  if (resource === 'runs') {
    if (![4,5].includes(path.length) || query.size) fail('assistant_resource_not_found', 404);
    const runId = path[3];
    if (!/^[1-9]\d{0,18}$/.test(runId)) fail('invalid_message', 422);
    const owned = await withTenantTransaction(actor.enterpriseId, tx => one(tx, sql`select id from app.assistant_runs
      where enterprise_id=${actor.enterpriseId} and conversation_id=${cid} and id=${runId} and purpose<>'construction.report.facts'`));
    if (!owned) fail('assistant_resource_not_found', 404);
    if (request.method === 'GET' && path.length === 4) return service.run(runId);
    if (request.method !== 'POST') fail('assistant_resource_not_found', 404);
    const raw = await request.text(); if (raw.length > 256) fail('invalid_message', 413);
    if (path.length === 5) {
      if (!['cancel','retry'].includes(path[4])) fail('assistant_resource_not_found', 404);
      let body; try { body = raw ? JSON.parse(raw) : {}; } catch { return fail('invalid_message', 422); }
      object(body, []);
      return service.run(runId, path[4] as 'cancel' | 'retry', key(request.headers.get('Idempotency-Key')));
    }
    let body; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
    const b = object(body, ['action']); if (!['cancel','retry'].includes(String(b.action))) fail('invalid_message', 422);
    return service.run(runId, b.action as 'cancel' | 'retry', key(request.headers.get('Idempotency-Key')));
  }
  if (resource === 'report-context' || resource === 'report-topic') {
    if (query.size) fail('invalid_message', 422);
    const reports = new ReportContextService(actor, cid);
    if (request.method === 'GET' && resource === 'report-context') return reports.read();
    if (request.method !== 'POST') fail('assistant_resource_not_found', 404);
    const requestKey = key(request.headers.get('Idempotency-Key')), raw = await request.text();
    if (raw.length > 2048) fail('invalid_message', 413);
    let body; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
    if (resource === 'report-topic') { object(body, []); return reports.topic(requestKey); }
    return reports.select(requestKey, body);
  }
  const customerActor = { ...actor, capabilities: [...actor.capabilities, 'assistant.chat.self'] };
  if (resource === 'media') return mediaHttp(request, customerActor, cid, path.slice(3));
  if (request.method === 'GET') {
    if (!resource) return service.detail(cid);
    if (resource === 'handoff') return new HandoffWorkflow(customerActor).customerRead(cid);
    const after = query.get('afterSeq'), before = query.get('beforeSeq') || '9223372036854775807', limit = Number(query.get('limit') || 30);
    if (after !== null && query.has('beforeSeq')) fail('invalid_message', 422);
    if (after !== null && (!/^[1-9]\d{0,18}$/.test(after) || BigInt(after) > 9223372036854775807n)) fail('invalid_message', 422);
    if (!/^[1-9]\d{0,18}$/.test(before) || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('invalid_message', 422);
    return after !== null ? service.messageDelta(cid, after, limit) : service.messages(cid, before, limit);
  }
  if (request.method !== 'POST' || !resource || query.size) fail('assistant_resource_not_found', 404);
  const requestKey = key(request.headers.get('Idempotency-Key')), raw = await request.text();
  if (raw.length > 20000) fail('invalid_message', 413);
  let body; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
  if (resource === 'handoff') return new HandoffWorkflow(customerActor).customerWrite(cid, requestKey, object(body,
    ['action','consent','contactConsent','phone','recipientId','leadId','archiveConsent','mediaConsent','expectedVersion']));
  const b = object(body, ['clientMessageId','content']);
  if (b.clientMessageId !== requestKey) fail('invalid_message', 422);
  return service.send(cid, requestKey, b.content);
}
