import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { fail, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { privateMemoryScope } from '@/lib/assistant/memory/scope';
import { delegationConsumer, delegationNotice, delegationOwnerInput, delegationPurpose, delegationRefresh, statusText,
  type ReviewDelegation, type DelegationControl } from './delegation-state';
import { appendDelegationEvent } from './delegation-store';
import { controlOutcome, delegationActor, reviewDelegationFromRow, reviewDelegationOrigin,
  DelegationService, linkReviewDelegationEvent, saveReviewDelegation } from './delegation-review-store';

export function reviewDelegationCommand(text: string): { action: DelegationControl; target: string } | null {
  const m = /^(?:请|帮我|麻烦你)?\s*(查看|看看|暂停|先暂停|继续|恢复|取消)(?:一下)?\s*(?:(?:当前|这次|这个|这项|我的)?(?:委托|跟进)(?:[：:]\s*(.{1,90}))?|(.{1,70})的跟进)[。！!\s]*$/u.exec(text.trim());
  if (!m) return null;
  const action = { 查看: 'status', 看看: 'status', 暂停: 'pause', 先暂停: 'pause', 继续: 'resume', 恢复: 'resume', 取消: 'cancel' } as const;
  return { action: action[m[1] as keyof typeof action], target: (m[2] || m[3] || '').trim().replace(/[。！!]$/, '') };
}

export function delegationSummary(d: ReviewDelegation) {
  return [d.title, d.nextAction].join('：');
}

export async function delegationReceipt(tx: PostgresTransaction, d: ReviewDelegation, key: string, text: string, conversationId = d.conversationId) {
  const eventId = await appendDelegationEvent(tx, d.enterpriseId, delegationNotice, key, 1,
    { projectId: d.projectId, delegationId: d.id, conversationId, ownerId: d.ownerId, delivery: 'in_app',
      delegationVersion: d.version, evidence: d.evidence });
  if (!eventId) return null;
  const message = await appendMessage(tx, delegationActor(d), conversationId, { author: 'system', eventId,
    purpose: delegationPurpose, content: { version: 1, blocks: [{ type: 'text', text }] } });
  return { messageId: String(message.id), delivery: 'persisted_in_app' };
}

async function commandReceipt(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row, text: string) {
  const id = await appendDelegationEvent(tx, actor.enterpriseId, delegationNotice, 'command:' + String(message.id), 1,
    { conversationId: String(c.id), ownerId: actor.principal.kind === 'user' ? actor.principal.userId : '', delivery: 'in_app' });
  if (id) await appendMessage(tx, actor, String(c.id), { author: 'system', eventId: id, purpose: delegationPurpose,
    content: { version: 1, blocks: [{ type: 'text', text }] } });
}

export async function applyReviewDelegationCommand(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
  const command = reviewDelegationCommand(safeText(message.content as MessageContent));
  if (!command) return false;
  const scope = await privateMemoryScope(tx, actor, c);
  if (!scope) {
    await commandReceipt(tx, actor, c, message, '当前咨询无法查看或变更项目委托。请从对应项目的原咨询重试。');
    return true;
  }
  const service = new DelegationService(tx, scope);
  const all = await service.list();
  const selected = command.target ? all.filter(item => (item.title + item.scope.roomName + item.scope.subject).includes(command.target))
    : all.filter(item => !['cancelled','completed'].includes(item.status));
  if (command.action === 'status') {
    const matches = command.target ? selected : all;
    const summaries = (await currentDelegationViews(tx, matches)).map(delegationSummary);
    await commandReceipt(tx, actor, c, message, summaries.length ? summaries.join('\n') : '这次项目咨询没有可查看的委托。');
    return true;
  }
  if (selected.length !== 1) {
    await commandReceipt(tx, actor, c, message, selected.length
      ? '请说明要操作哪一项委托。\n' + selected.map(delegationSummary).join('\n') : '当前项目没有匹配的委托。');
    return true;
  }
  const d = await service.find(selected[0].id, true);
  if (!d || !await reviewDelegationOrigin(tx, d)) fail('delegation_origin_unavailable', 409);
  const next = controlOutcome(command.action, d.status);
  if (!next) {
    await delegationReceipt(tx, d, 'command:' + String(message.id), delegationSummary(d), String(c.id));
    return true;
  }
  const now = new Date(), refresh = command.action === 'resume';
  const payload = { projectId: d.projectId, delegationId: d.id, action: command.action, sourceMessageId: String(message.id) };
  const eventId = (await appendDelegationEvent(tx, d.enterpriseId, 'native.delegation.control.v1', d.id, d.version + 1, payload, actor.principal))!;
  const activation = refresh
    ? (await appendDelegationEvent(tx, d.enterpriseId, delegationRefresh, d.id, d.version + 1, payload, actor.principal))! : undefined;
  const updated = await saveReviewDelegation(tx, d, next, now, refresh
    ? { activate: activation, reminderStage: 0, dueAt: d.dueAt > now ? d.dueAt : new Date(now.getTime() + 48 * 3600_000) } : {});
  if (activation) await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
    values(${d.enterpriseId},${activation},${delegationConsumer}) on conflict do nothing`);
  await linkReviewDelegationEvent(tx, d, updated, eventId, 'control', { action: command.action, messageId: String(message.id) });
  await delegationReceipt(tx, updated, 'command:' + String(message.id),
    delegationSummary(updated), String(c.id));
  return true;
}

export async function recordDelegationOwnerInput(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
  const scope = await privateMemoryScope(tx, actor, c);
  if (!scope?.projectId) return;
  const messageId = String(message.id);
  await appendDelegationEvent(tx, scope.enterpriseId, delegationOwnerInput, messageId, 1,
    { projectId: scope.projectId, conversationId: scope.conversationId, ownerId: scope.ownerId, messageId }, actor.principal);
}

export async function reviewDelegationNoticeAvailable(tx: PostgresTransaction, actor: ActorContext, c: Row, messageId: string) {
  const scope = await privateMemoryScope(tx, actor, c);
  if (!scope) return false;
  const row = await one(tx, sql`select e.payload from app.assistant_messages m join app.domain_event_outbox e
    on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    where m.enterprise_id=${scope.enterpriseId} and m.conversation_id=${scope.conversationId} and m.id=${messageId}
      and e.type=${delegationNotice} and e.payload->>'ownerId'=${scope.ownerId}`);
  if (!row) return false;
  const p = row.payload as Row;
  if (!p.delegationId) return true;
  if (!scope.projectId || scope.projectId !== p.projectId) return false;
  const found = await one(tx, sql`select * from app.native_workflow_delegations where enterprise_id=${scope.enterpriseId}
    and owner_id=${scope.ownerId} and project_id=${scope.projectId} and id=${String(p.delegationId)}`);
  if (!found) return false;
  const d = reviewDelegationFromRow(found);
  if (!await reviewDelegationOrigin(tx, d)) return false;
  const evidence = p.evidence as ReviewDelegation['evidence'];
  if (!evidence) return true;
  if (d.evidence?.id !== evidence.id || d.evidence.version !== evidence.version) return false;
  return (await currentDelegationView(tx, d)).evidence?.id === evidence.id;
}

export async function currentDelegationView(tx: PostgresTransaction, d: ReviewDelegation) {
  const evidence = d.evidence;
  if (!evidence || ['owner_reply','external_result'].includes(evidence.type)) return d;
  const { observeDelegation } = await import('./delegation-sources');
  const origin = await reviewDelegationOrigin(tx, d);
  const result = origin ? await observeDelegation(tx, d, origin, {
    id: String(d.activationEventId ?? 0), type: delegationRefresh, aggregateId: d.id, aggregateVersion: d.version,
    projectId: d.projectId, payload: { delegationId: d.id },
  }) : null;
  const current = result?.ok ? (JSON.parse(result.content).result?.next?.evidence as ReviewDelegation['evidence']) : null;
  if (current?.id === evidence.id && current.version === evidence.version) return d;
  return { ...d, status: 'waiting_for_authorization' as const, waitingFor: null, assignedTo: null, completedAt: null,
    nextAction: '原进展或复核依据已变化，等待重新核对', evidence: null };
}

export async function currentDelegationViews(tx: PostgresTransaction, delegations: ReviewDelegation[]) {
  const result: ReviewDelegation[] = [];
  for (const delegation of delegations) result.push(await currentDelegationView(tx, delegation));
  return result;
}

export function delegationModelView(items: ReviewDelegation[]) {
  return items.map(({ id, title, status, nextAction, dueAt, waitingFor, completionCriteria, version, evidence }) =>
    ({ id, title, status, nextAction: nextAction || statusText[status], dueAt, waitingFor, completionCriteria, version, evidence }));
}
