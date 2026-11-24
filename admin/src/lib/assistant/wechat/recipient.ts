import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { bindingForActor } from '@/lib/construction/report-store';
import { followupAvailable, followupProjects, reportAudiences, type FollowupAudience } from '@/lib/construction/report-scope';
import { fail, principalKey, requireCapability, type ActorContext } from '../contracts';
import type { ChannelRow } from './channels';

export type RequestedRecipient = { actor: ActorContext; bindingId: string; projectId: string | null };
export type Recipient =
  | { actor: ActorContext; bindingId: string; projectId: string; audience?: never }
  | { actor: ActorContext; bindingId: string | null; projectId: null; audience: FollowupAudience };

export function miniUser(actor: ActorContext) {
  const user = actor.principal.kind === 'user' ? actor.principal.userId : actor.entry?.miniProgramUserId;
  if (typeof user !== 'string' || !/^[1-9]\d*$/.test(user)) fail('identity_context_invalid',403);
  return user;
}

async function checkIdentity(tx: PostgresTransaction, actor: ActorContext) {
  requireCapability(actor, 'assistant.followup.self');
  await new AssistantRepository(tx, actor).identity();
}

export async function checkReportBinding(tx: PostgresTransaction, recipient: Recipient, bindingId: string) {
  if (recipient.bindingId && recipient.bindingId !== bindingId) fail('construction_not_found', 404);
  return validateBinding(tx, recipient, await bindingForActor(tx, recipient.actor, bindingId));
}

async function validateBinding(tx: PostgresTransaction, recipient: Recipient, binding: Row) {
  const { actor, projectId, audience } = recipient;
  if (binding.status !== 'enabled' || (audience && binding.audience !== audience)) fail('construction_not_found', 404);
  if (projectId) {
    if (!(await followupProjects(tx, actor.enterpriseId, binding, false, [projectId])).length) fail('construction_not_found', 404);
  } else {
    if (audience === 'customer' ? !binding.project_id : !!binding.project_id || binding.scope_key !== 'enterprise')
      fail('construction_not_found', 404);
    if (!await followupAvailable(tx, actor.enterpriseId, binding)) fail('construction_not_found', 404);
  }
  return binding;
}

export async function resolveRecipient(tx: PostgresTransaction, requested: RequestedRecipient): Promise<{ recipient: Recipient; binding: Row }> {
  const { actor, bindingId, projectId } = requested;
  await checkIdentity(tx, actor);
  if (projectId) {
    const recipient = { actor, bindingId, projectId };
    return { recipient, binding: await checkReportBinding(tx, recipient, bindingId) };
  }
  const anchor = await bindingForActor(tx, actor, bindingId);
  const audience = reportAudiences.find(role => role === anchor.audience);
  if (!audience) fail('construction_not_found', 404);
  const recipient: Recipient = { actor, bindingId: audience === 'customer' ? null : bindingId, projectId: null, audience };
  return { recipient, binding: await validateBinding(tx, recipient, anchor) };
}

export async function checkRecipient(tx: PostgresTransaction, recipient: Recipient) {
  const { actor, bindingId } = recipient;
  await checkIdentity(tx, actor);
  if (bindingId) return checkReportBinding(tx, recipient, bindingId);
  const owned = await one(tx, sql`select 1 from app.construction_followup_bindings b
    join app.assistant_conversations c on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id
    where b.enterprise_id=${actor.enterpriseId} and b.principal_key=${principalKey(actor)} and b.audience='customer'
      and b.status='enabled' and coalesce(c.entry_snapshot->>'retentionRedacted','false')<>'true'
      and app.assistant_followup_conversation_access('user',b.user_id,b.enterprise_id,b.conversation_id) limit 1`);
  if (!owned) fail('construction_not_found', 404);
  return null;
}

export function savedRecipient(row: ChannelRow): Recipient | null {
  if (!row.verified_at || !row.recipient_key || !row.mini_user_id || row.identity_version === null) return null;
  const [kind, id] = row.recipient_key.split(':');
  const actor: ActorContext = { enterpriseId: row.enterprise_id, contextVersion: row.identity_version,
    principal: kind === 'admin' ? { kind, adminId:id } : { kind:'user', userId:id },
    ...(row.recipient_requires_service ? { customerServiceRequired:true } : {}),
    capabilities:['assistant.followup.self'], entry:{ miniProgramUserId:row.mini_user_id, miniProgramContextVersion:row.identity_version } };
  if (principalKey(actor) !== row.recipient_key || (kind === 'user' && id !== row.mini_user_id)) return null;
  const audience = row.recipient_audience;
  if (audience) return { actor, bindingId: row.recipient_binding_id, projectId: null, audience };
  return row.recipient_binding_id && row.project_id ? { actor, bindingId:row.recipient_binding_id, projectId:row.project_id } : null;
}
