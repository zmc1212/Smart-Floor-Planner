import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { fingerprint, safeText, type ActorContext, type MessageContent } from '@/lib/assistant/contracts';
import { publishedSiteRecord } from '@/lib/construction/site-publications';
import { readSiteResolution } from '@/lib/construction/site-resolution';
import { sharedMaterials } from '@/lib/construction/site-materials';
import { readPlan } from '@/lib/construction/site-plans';
import { delegationScheduleVersion } from './delegation-inputs';
import { delegationActionText, delegationIsTerminal, delegationLifetimeMs, delegationNotice, delegationRefresh,
  type Delegation, type DelegationState, type DelegationTask } from './delegation-state';
import { appendDelegationEvent, delegationFromRow, delegationOrigin, delegationOwner, delegationsEnabled, linkDelegationEvent, saveDelegation } from './delegation-store';

export const delegationOwnerPurpose = 'construction.delegation';
export const delegationStaffPurpose = 'construction.delegation.staff';

type ChatAction = { action: 'start'; progressRoom: string; outletRoom: string; remind: boolean }
  | { action: 'status' | 'pause' | 'resume' | 'cancel' };

/** A bounded opt-in and control command. Ordinary questions, owner replies,
 * quotes and approvals retain their original consultation routes. */
export function delegationCommand(raw: string): ChatAction | null {
  const input = raw.trim();
  const start = /^(?:小[kK][，,]\s*)?(?:请(?:你|帮我)?|帮我|麻烦(?:你)?)?\s*持续跟进[「“]?([^「」“”，、。！？\n]{1,50}?)[」”]?的?水电(?:施工|进展)?(?:和|、|以及)[「“]?([^「」“”，、。！？\n]{1,50}?)[」”]?的?插座(?:点位|位置)?(?:[，,]等我回复超时(?:可以|就)在小K里提醒我)?[。！!]?$/.exec(input);
  if (start) return { action: 'start', progressRoom: start[1].trim(), outletRoom: start[2].trim(), remind: /在小K里提醒我/.test(input) };
  const control = /^(?:请)?(查看|暂停|继续|取消)(?:这次)?水电跟进[。！!]?$/.exec(input);
  if (!control) return null;
  const actions = { 查看: 'status', 暂停: 'pause', 继续: 'resume', 取消: 'cancel' } as const;
  return { action: actions[control[1] as keyof typeof actions] };
}

export async function delegationOwnerReceipt(tx: PostgresTransaction, d: Delegation, key: string, text: string, question?: { waitKey: string }) {
  const eventId = await appendDelegationEvent(tx, d.enterpriseId, delegationNotice, key, 1,
    { delegationId: d.id, projectId: d.projectId, audience: 'owner', ...question });
  if (!eventId) return null;
  return appendMessage(tx, delegationOwner(d), d.conversationId, { author: 'system', eventId, purpose: delegationOwnerPurpose,
    replyToMessageId: d.originMessageId, content: { version: 1, blocks: [{ type: 'text', text }] } });
}

async function electricalProgressText(tx: PostgresTransaction, d: Delegation, task: DelegationTask) {
  if (task.evidence?.customerVisible && await publishedSiteRecord(tx, d.enterpriseId, d.requesterId,
    task.evidence.recordId, task.evidence.version)) {
    return task.next === 'done' ? '本次进展已核对发布' : '已发布本次进展，仍有待处理内容';
  }
  return '等待项目团队发布可查看的水电进展';
}

export async function electricalDelegationSummary(tx: PostgresTransaction, d: Delegation) {
  const label: Record<DelegationState, string> = {
    active: '执行中', processing: '处理中', waiting: '等待补充或核对', blocked: '等项目团队处理阻碍',
    awaiting_authorization: '等待授权', paused: '已暂停', completed: '本次跟进已完成',
    failed: '本次跟进未能完成', cancelled: '已取消', expired: '跟进期限已到',
  };
  if (['paused', 'cancelled', 'expired', 'failed'].includes(d.state)) return `水电跟进：${label[d.state]}。`;
  const lines = [];
  let resultAvailable = true;
  for (const task of d.tasks) {
    let text = delegationActionText[task.next];
    if (task.kind === 'progress') text = await electricalProgressText(tx, d, task);
    else if (task.next === 'done') {
      const resolution = task.issueId && await readSiteResolution(tx, d.enterpriseId, d.projectId, task.issueId);
      const result = resolution && resolution.available && await one(tx, sql`select m.id from app.domain_event_outbox e
        left join app.assistant_messages m on m.enterprise_id=e.enterprise_id and m.source_event_id=e.id and m.purpose='construction.result'
          and m.conversation_id=${d.conversationId}
        where e.enterprise_id=${d.enterpriseId} and e.aggregate_id=${task.issueId!} and e.type='construction.site.issue.result.v1'
          and e.payload->>'lifecycleId'=${resolution.id} and e.payload->>'conversationId'=${d.conversationId}
          and e.payload->>'customerId'=${d.requesterId}`);
      resultAvailable = Boolean(result);
      text = result ? (result.id ? '项目团队已复核，结论已回传到这次咨询' : '项目团队已复核，结论待回传到这次咨询')
        : '原复核结果的依据已变化，请向项目团队核对';
    } else if (task.plan && !await planBasisAvailable(tx, d, task)) {
      text = delegationActionText.recheck_source;
    } else if (['organize_report', 'review_work', 'retry_report'].includes(task.next)) {
      text = '等项目团队核对插座进展';
    }
    lines.push(`${task.roomName}：${text}。`);
  }
  const heading = d.state === 'completed' && !resultAvailable ? '原复核结果待重新核对' : label[d.state];
  return [`水电跟进：${heading}。`, ...lines].join('\n');
}

async function planBasisAvailable(tx: PostgresTransaction, d: Delegation, task: DelegationTask, stage?: unknown) {
  if (!task.plan) return true;
  const plan = await readPlan(tx, d.enterpriseId, task.plan.id);
  if (!plan || plan.status !== task.plan.status || plan.conversationId !== d.conversationId || plan.customerId !== d.requesterId) return false;
  const currentStage = stage ?? (await one(tx, sql`select current_stage_key from app.construction_projects
    where enterprise_id=${d.enterpriseId} and id=${d.projectId}`))?.current_stage_key;
  return await delegationScheduleVersion(tx, d, task.roomId, currentStage) === task.plan.scheduleVersion;
}

export async function applyDelegationCommand(tx: PostgresTransaction, actor: ActorContext, c: Row, message: Row) {
  if (actor.principal.kind !== 'user' || c.purpose !== 'customer_consultation' || !delegationsEnabled(actor.enterpriseId)) return false;
  const cmd = delegationCommand(safeText(message.content as MessageContent));
  if (!cmd) return false;
  const eid = actor.enterpriseId, uid = actor.principal.userId, cid = String(c.id), mid = String(message.id);
  const now = new Date();
  const say = async (text: string) => {
    const eventId = await appendDelegationEvent(tx, eid, delegationNotice, 'command:' + mid, 1, { audience: 'owner' });
    if (eventId) await appendMessage(tx, actor, cid, { author: 'system', eventId, content: { version: 1, blocks: [{ type: 'text', text }] } });
    return true;
  };
  if (cmd.action === 'start') {
    if (c.mode !== 'ai') return say('请先恢复小K接待，再开启水电跟进。');
    if (cmd.progressRoom === cmd.outletRoom) return say('请分别说明要跟进水电进展和插座点位的两个施工部位。');
    const options = await rows(tx, sql`select p.id::text as project_id,p.name,r.id::text as progress_room,s.id::text as outlet_room
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.construction_rooms r on r.enterprise_id=p.enterprise_id and r.project_id=p.id and r.name=${cmd.progressRoom}
      join app.construction_rooms s on s.enterprise_id=p.enterprise_id and s.project_id=p.id and s.name=${cmd.outletRoom}
      where p.enterprise_id=${eid} and p.status='active' and p.customer_access and l.customer_user_id=${uid} and l.archived_at is null
      and (coalesce(${JSON.stringify(c.entry_snapshot)}::jsonb->>'kind','')<>'lead' or l.id::text=${JSON.stringify(c.entry_snapshot)}::jsonb->>'id')
      and exists(select 1 from app.assistant_participants ap where ap.enterprise_id=${eid} and ap.conversation_id=${cid}
        and ap.user_id=${uid} and ap.status='active' and ap.participant_role='owner')
      limit 2 for share of p,l,r,s`);
    if (options.length !== 1 || (c.entry_snapshot as Row).retentionRedacted) return say('这次未开启水电跟进。请从对应工地的咨询入口进入，并核对两个已登记部位的名称。');
    const project = options[0];
    const existing = await one(tx, sql`select * from app.native_workflow_delegations
      where enterprise_id=${eid} and project_id=${String(project.project_id)} and conversation_id=${cid} and requester_id=${uid}
      and state not in ('completed','failed','cancelled','expired') order by created_at desc limit 1 for update`);
    if (existing) {
      const d = delegationFromRow(existing);
      if (!await delegationOrigin(tx, d)) return say('原委托的项目权限或来源已变化，请联系项目团队。');
      await delegationOwnerReceipt(tx, d, 'command:' + mid, '这次咨询已有水电跟进。\n' + await electricalDelegationSummary(tx, d));
      return true;
    }
    const tasks: DelegationTask[] = [
      { key: 'progress', roomId: String(project.progress_room), roomName: cmd.progressRoom, kind: 'progress', completion: 'published_progress', next: 'collect_report' },
      { key: 'outlet', roomId: String(project.outlet_room), roomName: cmd.outletRoom, kind: 'outlet', completion: 'manager_resolution', next: 'review_design' },
    ];
    const expiresAt = new Date(now.getTime() + delegationLifetimeMs);
    const goal = `跟进${cmd.progressRoom}水电进展和${cmd.outletRoom}插座点位`;
    const row = (await one(tx, sql`insert into app.native_workflow_delegations
      (enterprise_id,project_id,requester_id,conversation_id,origin_message_id,origin_hash,goal,authorization_scope,state,tasks,next_wake_at,expires_at)
      values(${eid},${String(project.project_id)},${uid},${cid},${mid},${fingerprint(message.content)},${goal},
        ${JSON.stringify({ trackElectrical: true, remindOwner: cmd.remind })}::jsonb,'active',${JSON.stringify(tasks)}::jsonb,${expiresAt},${expiresAt})
      returning *`))!;
    const d = delegationFromRow(row);
    const eventId = (await appendDelegationEvent(tx, eid, delegationRefresh, mid, 1, { projectId: d.projectId, delegationId: d.id, action: 'start' }, actor.principal))!;
    await saveDelegation(tx, d, tasks, 'active', eventId, now, 'collect_report', true);
    await delegationOwnerReceipt(tx, d, 'command:' + mid, `已开始持续${goal}，后续在这次咨询查看。正式方案和施工安排仍由项目团队按原流程确认。`
      + (cmd.remind ? '等你补充超过48小时，小K会在这里提醒一次。' : ''));
    return true;
  }
  const found = await one(tx, sql`select * from app.native_workflow_delegations
    where enterprise_id=${eid} and conversation_id=${cid} and requester_id=${uid}
    order by (state not in ('completed','failed','cancelled','expired')) desc,created_at desc,id desc limit 1 for update`);
  if (!found) return say('这次咨询没有已登记的水电跟进。');
  const d = delegationFromRow(found), origin = await delegationOrigin(tx, d);
  if (!origin && !['pause', 'cancel'].includes(cmd.action)) return say('原项目或委托依据已不可用。');
  const next = !delegationIsTerminal(d.state) && d.expiresAt <= now ? 'expired'
    : cmd.action === 'cancel' && !delegationIsTerminal(d.state) ? 'cancelled'
    : cmd.action === 'pause' && !delegationIsTerminal(d.state) ? 'paused'
    : cmd.action === 'resume' && ['paused', 'blocked'].includes(d.state) && origin?.mode === 'ai' && origin.project_status === 'active' ? 'active' : d.state;
  if (next !== d.state) {
    const refresh = next === 'active';
    // Refresh and the new activation boundary commit with the owner's control.
    const eventId = (await appendDelegationEvent(tx, eid, refresh ? delegationRefresh : 'native.delegation.control.v1',
      mid, 1, { projectId: d.projectId, delegationId: d.id, action: cmd.action }, actor.principal))!;
    const tasks = refresh ? d.tasks.map(task => ({ ...task, wait: undefined, staffNoticeId: undefined })) : d.tasks;
    await saveDelegation(tx, d, tasks, next, eventId, now, null, refresh);
    if (!refresh) await linkDelegationEvent(tx, d, eventId, 'control', { from: d.state, to: next });
  }
  if (!origin) return say(next === 'cancelled' ? '已取消本次水电跟进。' : '本次水电跟进已暂停。');
  const feedback = next === 'active' && d.state !== next ? '已恢复水电跟进，小K会按当前资料重新核对。'
    : await electricalDelegationSummary(tx, { ...d, state: next });
  await delegationOwnerReceipt(tx, d, 'command:' + mid, feedback);
  return true;
}

export async function delegationOwnerNoticeAvailable(tx: PostgresTransaction, eid: string, cid: string, mid: string, requesterId?: string) {
  const row = await one(tx, sql`select d.* from app.assistant_messages m
    join app.domain_event_outbox e on e.enterprise_id=m.enterprise_id and e.id=m.source_event_id
    join app.native_workflow_delegations d on d.enterprise_id=e.enterprise_id and d.id::text=e.payload->>'delegationId'
    where m.enterprise_id=${eid} and m.conversation_id=${cid} and m.id=${mid}
      and d.conversation_id=m.conversation_id ${requesterId ? sql`and d.requester_id=${requesterId}` : sql``}
      and e.type=${delegationNotice} and e.payload->>'audience'='owner'`);
  const origin = row && await delegationOrigin(tx, delegationFromRow(row));
  return !!origin && origin.project_status === 'active';
}

/** One shared project conversation. Existing members see the current request
 * using the standard project reply card; there is no private material in it. */
export async function syncDelegationStaffNotices(tx: PostgresTransaction, actor: ActorContext, c: Row, projectId: string) {
  const eid = actor.enterpriseId;
  if (!delegationsEnabled(eid) || c.status !== 'open') return [];
  const notices = new Map<string, Row>();
  const matches = await rows(tx, sql`select d.* from app.native_workflow_delegations d
    where d.enterprise_id=${eid} and d.project_id=${projectId} and d.state not in ('paused','cancelled','expired','completed','failed')
    order by d.created_at limit 30`);
  for (const row of matches) {
    const d = delegationFromRow(row), origin = await delegationOrigin(tx, d);
    if (!origin || origin.project_status !== 'active' || origin.assistant_enabled !== true) continue;
    for (const task of d.tasks) {
      if (!task.staffNoticeId || notices.has(task.staffNoticeId)) continue;
      if (task.basis && (await sharedMaterials(tx, eid, projectId, task.roomId)).version !== task.basis.materialVersion) continue;
      if (task.next === 'review_work' && !await planBasisAvailable(tx, d, task, origin.current_stage_key)) continue;
      const notice = await one(tx, sql`select payload from app.domain_event_outbox where enterprise_id=${eid}
        and id=${task.staffNoticeId} and type=${delegationNotice} and payload->>'audience'='staff'`);
      if (!notice) continue;
      const message = await appendMessage(tx, actor, String(c.id), { author: 'system', eventId: task.staffNoticeId, purpose: delegationStaffPurpose,
        content: { version: 1, blocks: [{ type: 'text', text: String((notice.payload as Row).text) }] } });
      notices.set(task.staffNoticeId, message);
    }
  }
  return [...notices.values()];
}
