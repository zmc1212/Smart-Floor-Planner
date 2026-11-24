import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository } from '@/db/repositories/assistant-repository';
import { bindingForActor } from '@/lib/construction/report-store';
import { followupAvailable, followupProjects } from '@/lib/construction/report-scope';
import { fail, principalKey, requireCapability, type ActorContext } from '../contracts';
import type { ChannelRow } from './channels';

export type Recipient = { actor: ActorContext; bindingId: string; projectId: string };
export function miniUser(actor: ActorContext) {
  const user = actor.principal.kind === 'user' ? actor.principal.userId : actor.entry?.miniProgramUserId;
  if (typeof user !== 'string' || !/^[1-9]\d*$/.test(user)) fail('identity_context_invalid',403);
  return user;
}
export async function checkRecipient(tx: PostgresTransaction, recipient: Recipient) {
  const { actor, bindingId, projectId } = recipient;
  requireCapability(actor, 'assistant.followup.self');
  await new AssistantRepository(tx, actor).identity();
  const binding = await bindingForActor(tx, actor, bindingId);
  if (binding.status !== 'enabled' || !await followupAvailable(tx, actor.enterpriseId, binding)
    || !(await followupProjects(tx, actor.enterpriseId, binding, false, [projectId])).length)
    fail('construction_not_found',404);
  return binding;
}
export function savedRecipient(row: ChannelRow): Recipient | null {
  if (!row.verified_at || !row.recipient_key || !row.recipient_binding_id || !row.project_id || !row.mini_user_id) return null;
  const [kind, id] = row.recipient_key.split(':');
  const actor: ActorContext = { enterpriseId: row.enterprise_id, contextVersion: row.identity_version!,
    principal: kind === 'admin' ? { kind, adminId:id } : { kind:'user', userId:id },
    ...(row.recipient_requires_service ? { customerServiceRequired:true } : {}),
    capabilities:['assistant.followup.self'], entry:{ miniProgramUserId:row.mini_user_id, miniProgramContextVersion:row.identity_version } };
  if (principalKey(actor) !== row.recipient_key) return null;
  return { actor, bindingId:row.recipient_binding_id, projectId:row.project_id };
}
