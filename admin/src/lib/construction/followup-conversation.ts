import { ConversationService } from '@/lib/assistant/core/conversation';
import { HandoffWorkflow } from '@/lib/assistant/handoff/workflow';
import { fail, key, type ActorContext } from '@/lib/assistant/contracts';
import { FollowupService } from './followup-service';
import { object } from './contracts';
import { mediaHttp } from '@/lib/assistant/media/http';

/** Only the original customer's current private destination. This adapter does
 * not grant ordinary conversation, preview or report access to reception staff. */
export async function followupConversationHttp(request: Request, path: string[], actor: ActorContext) {
  if (actor.principal.kind !== 'user' || path.length < 2 || path.length > 4) fail('assistant_capability_forbidden', 403);
  const query = new URL(request.url).searchParams, resource = path[2];
  if (path[1] !== 'conversation' || resource && !['messages','handoff','media'].includes(resource)
    || path.length > 3 && resource !== 'media') fail('assistant_resource_not_found', 404);
  if ([...query.keys()].some(k => !['beforeSeq','limit'].includes(k) || resource !== 'messages' || query.getAll(k).length !== 1)) fail('invalid_message', 422);
  const context = await new FollowupService(actor).context(path[0]);
  if (context.audience !== 'customer') fail('assistant_capability_forbidden', 403);
  // The repository keeps followup.self as its authoritative purpose/participant
  // branch; chat.self enables reuse of the original user-only services here.
  const customer = { ...actor, capabilities: [...actor.capabilities, 'assistant.chat.self'] };
  const service = new ConversationService(customer), cid = context.conversationId;
  if (resource === 'media') return mediaHttp(request, customer, cid, path.slice(3));
  if (request.method === 'GET') {
    if (!resource) return service.detail(cid);
    if (resource === 'handoff') return new HandoffWorkflow(customer).customerRead(cid);
    const before = query.get('beforeSeq') || '9223372036854775807', limit = Number(query.get('limit') || 30);
    if (!/^[1-9]\d{0,18}$/.test(before) || !Number.isInteger(limit) || limit < 1 || limit > 50) fail('invalid_message', 422);
    return service.messages(cid, before, limit);
  }
  if (request.method !== 'POST' || !resource || query.size) fail('assistant_resource_not_found', 404);
  const requestKey = key(request.headers.get('Idempotency-Key')), raw = await request.text();
  if (raw.length > 20000) fail('invalid_message', 413);
  let body; try { body = JSON.parse(raw); } catch { return fail('invalid_message', 422); }
  if (resource === 'handoff') return new HandoffWorkflow(customer).customerWrite(cid, requestKey, object(body,
    ['action','consent','contactConsent','phone','recipientId','leadId','archiveConsent','mediaConsent','expectedVersion']));
  const b = object(body, ['clientMessageId','content']);
  if (b.clientMessageId !== requestKey) fail('invalid_message', 422);
  return service.send(cid, requestKey, b.content);
}
