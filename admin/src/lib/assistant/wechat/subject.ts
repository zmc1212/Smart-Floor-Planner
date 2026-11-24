import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import type { StageId } from '@/lib/xiaok-v1/stages';
import { fail, type ActorContext } from '../contracts';

export function isWechatConsultation(actor: ActorContext) { return actor.entry?.kind === 'wechat_personal'; }

export function wechatSubject(c: { enterprise_id: string; user_id: string; id: string }): ActorContext {
  return { enterpriseId: c.enterprise_id, principal: { kind: 'user', userId: c.user_id }, contextVersion: 1,
    capabilities: ['assistant.chat.self'], entry: { kind: 'wechat_personal', channelId: c.id } };
}

export async function authorizedWechatStage(tx: PostgresTransaction, actor: ActorContext) {
  if (actor.principal.kind !== 'user' || !isWechatConsultation(actor)) fail('assistant_capability_forbidden', 403);
  const channel = await one<{ stage_id: StageId }>(tx, sql`select c.stage_id from app.assistant_wechat_channels c
    where c.enterprise_id=${actor.enterpriseId} and c.id=${String(actor.entry!.channelId)} and c.user_id=${actor.principal.userId}
    and c.status='connected' and not exists (select 1 from app.assistant_stage_agents s where
    s.enterprise_id=c.enterprise_id and s.stage_id=c.stage_id and not s.enabled) for share of c`);
  if (!channel) fail('assistant_resource_not_found', 404);
  return channel.stage_id;
}
