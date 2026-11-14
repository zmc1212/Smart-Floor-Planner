import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { readSchedule } from '@/lib/construction/site-schedule';
import { readStageSettings } from '@/lib/construction/stages-store';
import { projectSiteIssues } from '@/lib/construction/site-issues';
import { stageForConstructionKey, type StageId } from './stages';
import { reminderPolicyForStage } from './stage-reminder-policies';
import { buildReminderDrafts, reconcileReminders, reminderTriggerTypes, type ReminderDraft,
  type ReminderProjectFacts, type ReminderRole, type ReminderStatus, type ReminderTriggerType } from './reminder-engine';

export const reminderTriggerLabels: Record<ReminderTriggerType, string> = {
  stage_entered: '阶段更新', plan_node_due_soon: '节点临近', plan_node_overdue: '节点过期',
  assignee_todo: '待处理事项', owner_confirmation: '待确认事项', designer_review: '待核对事项',
  worker_missing_material: '待补资料', data_stale: '记录待更新', issue_overdue: '问题超期', stage_ending: '阶段将结束',
};

const principalKind = (role: ReminderRole) => role === 'owner' ? 'user' as const : 'admin' as const;
const audienceForRole: Partial<Record<ReminderRole, string>> = { owner: 'customer', designer: 'designer', worker: 'worker', boss: 'boss' };

async function projectForReminder(tx: PostgresTransaction, eid: string, pid: string) {
  const project = await one(tx, sql`select p.*,l.customer_user_id from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.id=${pid} and l.archived_at is null for share of p,l`);
  if (!project) fail('construction_not_found', 404);
  return project;
}

async function recipientsFor(tx: PostgresTransaction, eid: string, project: Row) {
  const members = await rows(tx, sql`select m.admin_id,m.role,a.role as staff_role from app.construction_members m
    join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id
    where m.enterprise_id=${eid} and m.project_id=${String(project.id)} and m.active and a.status='active' order by m.admin_id`);
  const ids = (role: string) => members.filter(member => member.role === role).map(member => String(member.admin_id));
  // A boss is only reached through the same cross-project construction access
  // that governs the boss workbench. Being a company administrator does not
  // grant design approval, project membership or acceptance authority.
  const bosses = await rows(tx, sql`select a.id from app.admin_users a
    where a.enterprise_id=${eid} and a.status='active'
    and app.construction_actor_access(a.id,${eid}::bigint)='owner' order by a.id`);
  return {
    owner: project.customer_access && project.customer_user_id ? [String(project.customer_user_id)] : [],
    designer: ids('designer'), worker: ids('worker'), manager: ids('manager'),
    boss: bosses.map(row => String(row.id)),
  };
}

async function reminderFacts(tx: PostgresTransaction, eid: string, project: Row, now: Date): Promise<ReminderProjectFacts> {
  const pid = String(project.id), settings = await readStageSettings(tx, eid);
  const stage = settings.stages.find(item => item.key === project.current_stage_key);
  const event = await one(tx, sql`select id,payload,created_at from app.domain_event_outbox
    where enterprise_id=${eid} and type='construction.stage.updated.v1' and aggregate_id=${pid}
    order by aggregate_version desc limit 1 for share`);
  const schedule = await readSchedule(tx, eid, project, settings.stages, { now });
  const latest = await one(tx, sql`select max(published_at) as last_at from app.construction_site_records
    where enterprise_id=${eid} and project_id=${pid} and status='published'`);
  const issues = await projectSiteIssues(tx, eid, pid, 50);
  const recipients = await recipientsFor(tx, eid, project);
  const issueItems = issues.map(issue => ({ id: issue.issueId, title: issue.text, status: issue.classification,
    updatedAt: now.toISOString(), dueAt: null as string | null }));
  const pendingFor = (role: ReminderRole) => {
    const assigned = issues.filter(issue => issue.ownerId && recipients[role]?.includes(String(issue.ownerId)));
    if (role === 'owner') return [];
    if (role === 'designer') return assigned.filter(issue => ['awaiting_verification', 'awaiting_rectification'].includes(issue.classification))
      .map(issue => ({ id: issue.issueId, title: issue.text, createdAt: now.toISOString(), dedupeSubject: issue.issueId + ':' + issue.revision }));
    if (role === 'worker') return assigned.filter(issue => !['closed', 'dismissed', 'cancelled', 'invalidated'].includes(issue.classification))
      .map(issue => ({ id: issue.issueId, title: issue.text, createdAt: now.toISOString(), dedupeSubject: issue.issueId + ':' + issue.revision }));
    return assigned.filter(issue => ['awaiting_rectification', 'rectifying', 'awaiting_review'].includes(issue.classification))
      .map(issue => ({ id: issue.issueId, title: issue.text, createdAt: now.toISOString(), dedupeSubject: issue.issueId + ':' + issue.revision }));
  };
  // An invalidated source must be re-verified by the team before asking the
  // owner to confirm or the worker to supplement anything.
  const ownerConfirmations = issues.filter(issue => issue.classification !== 'invalidated'
    && (issue.state === 'awaiting_owner' || issue.sourceKind === 'need' && issue.classification === 'awaiting_verification'))
    .map(issue => ({ id: issue.issueId, title: issue.text, createdAt: now.toISOString(), dedupeSubject: issue.issueId + ':' + issue.revision }));
  const workerMissing = issues.filter(issue => issue.ownerId && recipients.worker.includes(String(issue.ownerId))
    && !['closed', 'dismissed', 'cancelled', 'invalidated'].includes(issue.classification) && /资料|照片|补|材料|上传/u.test(issue.text))
    .map(issue => ({ id: issue.issueId, title: issue.text, createdAt: now.toISOString(), dedupeSubject: issue.issueId + ':' + issue.revision }));
  return {
    enterpriseId: eid, projectId: pid, projectName: String(project.name),
    projectStatus: String(project.status) as ReminderProjectFacts['projectStatus'],
    constructionStageKey: project.current_stage_key as string | null, stageName: stage?.name ?? null,
    stageEventId: event ? String((event.payload as Row)?.sourceEventKey || event.id) : null,
    stageEnteredAt: event ? new Date(String(event.created_at)).toISOString() : null,
    schedule: {
      available: schedule.available, version: schedule.version || null,
      nodes: schedule.nodes.map(node => ({
        key: node.key, stageId: stageForConstructionKey(node.stageKey)?.stageId ?? null,
        roomId: node.roomId, roomName: node.roomName, plannedStart: node.plannedStart, plannedEnd: node.plannedEnd,
        color: node.color, completion: node.constructionStatus,
      })),
    },
    pending: {
      ownerConfirmations, designerReviews: pendingFor('designer'),
      workerMissingMaterials: workerMissing, managerTodos: pendingFor('manager'),
    },
    issues: issueItems, lastRecordAt: latest?.last_at ? new Date(String(latest.last_at)).toISOString() : null,
    recipients,
  };
}

type PauseRow = { principal_kind: string; principal_id: string; trigger_type: string };
async function projectPauses(tx: PostgresTransaction, eid: string, pid: string): Promise<PauseRow[]> {
  return (await rows(tx, sql`select principal_kind,principal_id,trigger_type from app.construction_stage_reminder_pauses
    where enterprise_id=${eid} and project_id=${pid}`)).map(row => ({
    principal_kind: String(row.principal_kind), principal_id: String(row.principal_id), trigger_type: String(row.trigger_type),
  }));
}
function pausedBy(draft: ReminderDraft, pauses: PauseRow[]) {
  const kind = principalKind(draft.targetRole);
  return pauses.some(pause => pause.principal_kind === kind && pause.principal_id === draft.targetUserId
    && (pause.trigger_type === 'all' || pause.trigger_type === draft.triggerType));
}

export async function syncProjectReminders(tx: PostgresTransaction, eid: string, projectId: string, now = new Date()) {
  const project = await projectForReminder(tx, eid, projectId);
  const stage = stageForConstructionKey(project.current_stage_key as string | null);
  if (!stage) {
    await tx.execute(sql`update app.construction_stage_reminders set status='expired',last_error='construction_stage_unavailable',updated_at=now()
      where enterprise_id=${eid} and project_id=${projectId} and status in ('pending','paused','failed')`);
    return { created: 0, cancelled: 0, expired: 0, skipped: true };
  }
  const policy = reminderPolicyForStage(stage.stageId as StageId);
  if (!policy) return { created: 0, cancelled: 0, expired: 0, skipped: true };
  const facts = await reminderFacts(tx, eid, project, now);
  const pauses = await projectPauses(tx, eid, projectId);
  let drafts = buildReminderDrafts(facts, policy, now).filter(draft => !pausedBy(draft, pauses));
  // One company exception is not repeated for every project that reports the
  // same subject. The first project keeps the pending/delivered record; the
  // next tick recreates it if that exception is still the only one.
  if (drafts.some(draft => draft.targetRole === 'boss')) {
    const recent = await rows(tx, sql`select trigger_type,trigger_evidence->>'subject' as subject
      from app.construction_stage_reminders where enterprise_id=${eid} and project_id<>${projectId}
      and target_role='boss' and status in ('pending','delivered','paused','failed')
      and scheduled_at>${new Date(now.getTime() - 86_400_000)}`);
    const seen = new Set(recent.map(row => String(row.trigger_type) + ':' + String(row.subject || '')));
    drafts = drafts.filter(draft => draft.targetRole !== 'boss'
      || !seen.has(draft.triggerType + ':' + String(draft.triggerEvidence.subject || '')));
  }
  const existing = (await rows(tx, sql`select reminder_id,dedupe_key,stage_id,target_role,target_principal_kind,target_principal_id,status
    from app.construction_stage_reminders where enterprise_id=${eid} and project_id=${projectId} order by reminder_id`)).map(row => ({
      reminderId: String(row.reminder_id), dedupeKey: String(row.dedupe_key), stageId: row.stage_id as string | null,
      targetRole: String(row.target_role) as ReminderRole, targetUserId: row.target_principal_id as string | null, status: String(row.status) as ReminderStatus,
    }));
  const pausedPrefixes = existing.filter(item => item.targetUserId && pauses.some(pause =>
    pause.principal_kind === principalKind(item.targetRole) && pause.principal_id === item.targetUserId
    && (pause.trigger_type === 'all' || item.dedupeKey.includes(':' + pause.trigger_type + ':'))))
    .map(item => item.dedupeKey.split(':').slice(0, 6).join(':'));
  const changes = reconcileReminders({ facts, current: drafts, existing, pausedPrefixes });
  for (const change of changes) {
    await tx.execute(sql`update app.construction_stage_reminders set status=${change.status},last_error=${change.reason},updated_at=now()
      where enterprise_id=${eid} and reminder_id=${change.reminderId} and status in ('pending','paused','failed')`);
  }
  for (const draft of drafts) {
    await tx.execute(sql`insert into app.construction_stage_reminders
      (reminder_id,enterprise_id,project_id,stage_id,construction_stage_key,target_role,target_principal_kind,target_principal_id,
       related_task_id,related_issue_id,trigger_type,trigger_evidence,scheduled_at,status,dedupe_key,action_url,title,body)
      values(${draft.reminderId},${eid},${projectId},${draft.stageId},${draft.constructionStageKey},${draft.targetRole},
       ${principalKind(draft.targetRole)},${draft.targetUserId},${draft.relatedTaskId},${draft.relatedIssueId},
       ${draft.triggerType},${JSON.stringify(draft.triggerEvidence)}::jsonb,${draft.scheduledAt},'pending',${draft.dedupeKey},
       ${draft.actionUrl},${draft.title},${draft.body})
      on conflict (enterprise_id,dedupe_key) do nothing`);
  }
  return { created: drafts.length, cancelled: changes.filter(item => item.status === 'cancelled').length,
    expired: changes.filter(item => item.status === 'expired').length, skipped: false };
}

export async function advanceStageReminders(now = new Date(), onlyEnterprise?: string) {
  const projects = await withPlatformTransaction(tx => rows(tx, sql`select p.enterprise_id,p.id from app.construction_projects p
    join app.enterprises e on e.id=p.enterprise_id and e.status='active'
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.status='active' and l.archived_at is null ${onlyEnterprise ? sql`and p.enterprise_id=${onlyEnterprise}` : sql``}
    order by p.id limit 100`));
  let created = 0; const errors: Array<{ enterpriseId: string; projectId: string; code: string }> = [];
  for (const project of projects) {
    const eid = String(project.enterprise_id), pid = String(project.id);
    try {
      created += (await withTenantTransaction(eid, tx => syncProjectReminders(tx, eid, pid, now))).created;
    } catch (error) {
      errors.push({ enterpriseId: eid, projectId: pid, code: error instanceof Error && 'code' in error ? String((error as { code: string }).code) : 'stage_reminder_unavailable' });
    }
  }
  return { created, errors };
}

async function principalAccess(tx: PostgresTransaction, actor: ActorContext, eid: string, project: Row, role: ReminderRole) {
  if (actor.principal.kind === 'user') {
    if (role !== 'owner' || !project.customer_access || String(project.customer_user_id) !== actor.principal.userId) return false;
    return true;
  }
  const admin = await one(tx, sql`select role from app.admin_users where enterprise_id=${eid} and id=${actor.principal.adminId} and status='active' for share`);
  if (!admin) return false;
  // A company owner is reached through the same cross-project construction
  // access that produced boss recipients; this does not grant approval or
  // acceptance rights and does not require project membership.
  if (role === 'boss') return ['enterprise_admin', 'admin', 'super_admin'].includes(String(admin.role))
    && String((await one(tx, sql`select app.construction_actor_access(${actor.principal.adminId}::bigint,${eid}::bigint) as role`))?.role || '') === 'owner';
  const member = await one(tx, sql`select role from app.construction_members where enterprise_id=${eid}
    and project_id=${String(project.id)} and admin_id=${actor.principal.adminId} and active for share`);
  if (!member) return false;
  if (role === 'manager') return member.role === 'manager';
  if (role === 'designer') return member.role === 'designer';
  if (role === 'worker') return member.role === 'worker' || admin.role === 'construction_staff';
  return false;
}

async function pausedForPrincipal(tx: PostgresTransaction, eid: string, pid: string, reminder: Row) {
  const pause = await one(tx, sql`select 1 from app.construction_stage_reminder_pauses where enterprise_id=${eid} and project_id=${pid}
    and principal_kind=${String(reminder.target_principal_kind)} and principal_id=${String(reminder.target_principal_id)}
    and trigger_type in ('all',${String(reminder.trigger_type)}) limit 1`);
  if (pause) return true;
  const audience = audienceForRole[String(reminder.target_role) as ReminderRole];
  if (!audience) return false;
  const binding = await one(tx, sql`select status,remind_stage from app.construction_followup_bindings
    where enterprise_id=${eid} and principal_key=${String(reminder.target_principal_kind) + ':' + String(reminder.target_principal_id)}
    and audience=${audience} ${audience === 'customer' ? sql`and project_id=${pid}` : sql``}
    order by id desc limit 1`);
  return !!binding && (binding.status !== 'enabled' || binding.remind_stage === false);
}

/** Resolve the recipient's existing private conversation. A reminder never
 * invents an inbox: staff without a followup binding stay failed/no_inbox until
 * the enterprise creates one. */
async function inboxFor(tx: PostgresTransaction, eid: string, pid: string, reminder: Row) {
  const kind = String(reminder.target_principal_kind), principalId = String(reminder.target_principal_id);
  const role = String(reminder.target_role) as ReminderRole;
  const audience = audienceForRole[role];
  if (audience) {
    const binding = await one(tx, sql`select conversation_id from app.construction_followup_bindings
      where enterprise_id=${eid} and principal_key=${kind + ':' + principalId} and audience=${audience}
      and status='enabled' and remind_stage is not false
      ${audience === 'customer' ? sql`and project_id=${pid}` : sql``} order by id desc limit 1`);
    if (binding?.conversation_id) return String(binding.conversation_id);
  }
  if (kind === 'user') {
    const conversation = await one(tx, sql`select c.id from app.assistant_conversations c
      join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id
      where c.enterprise_id=${eid} and c.purpose='customer_consultation' and c.status='open'
      and ap.user_id=${principalId} and ap.status='active' order by c.id desc limit 1`);
    if (conversation?.id) return String(conversation.id);
  }
  return null;
}

async function deliverOne(tx: PostgresTransaction, eid: string, pid: string, reminder: Row, now: Date) {
  const reminderId = String(reminder.reminder_id);
  const conversationId = await inboxFor(tx, eid, pid, reminder);
  if (!conversationId) {
    await tx.execute(sql`update app.construction_stage_reminders set status='failed',last_error='no_inbox',
      delivery_attempts=delivery_attempts+1,updated_at=now()
      where enterprise_id=${eid} and reminder_id=${reminderId} and status in ('pending','failed')`);
    return 'failed' as const;
  }
  const event = await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.stage_reminder.delivered.v1','construction_stage_reminder',${reminderId},1,'{"kind":"system"}',${reminderId},
    ${JSON.stringify({ reminderId, projectId: pid, targetRole: String(reminder.target_role) })}::jsonb)
    on conflict (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version) do update set updated_at=now() returning id`);
  const actor: ActorContext = { enterpriseId: eid, contextVersion: 0, capabilities: [],
    principal: String(reminder.target_principal_kind) === 'user'
      ? { kind: 'user', userId: String(reminder.target_principal_id) }
      : { kind: 'admin', adminId: String(reminder.target_principal_id) } };
  const message = await appendMessage(tx, actor, conversationId, {
    author: 'system', eventId: String(event!.id), purpose: 'construction.stage_reminder',
    content: { version: 1, blocks: [{ type: 'text', text: String(reminder.title) + '\n' + String(reminder.body) }] },
  });
  await tx.execute(sql`update app.construction_stage_reminders set status='delivered',delivered_at=${now},
    conversation_id=${conversationId},message_id=${String(message.id)},delivery_attempts=delivery_attempts+1,last_error=null,updated_at=now()
    where enterprise_id=${eid} and reminder_id=${reminderId} and status in ('pending','failed')`);
  return 'delivered' as const;
}

export async function deliverStageReminders(now = new Date(), onlyEnterprise?: string) {
  const projects = await withPlatformTransaction(tx => rows(tx, sql`select distinct r.enterprise_id,r.project_id from app.construction_stage_reminders r
    join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.enterprises e on e.id=r.enterprise_id and e.status='active'
    where r.status in ('pending','failed') and r.delivery_attempts<10 and r.scheduled_at<=${now}
    ${onlyEnterprise ? sql`and r.enterprise_id=${onlyEnterprise}` : sql``}
    order by r.enterprise_id,r.project_id limit 50`));
  let delivered = 0, paused = 0, cancelled = 0, failed = 0;
  for (const target of projects) {
    const eid = String(target.enterprise_id), pid = String(target.project_id);
    await withTenantTransaction(eid, async tx => {
      const project = await one(tx, sql`select p.*,l.customer_user_id from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${eid} and p.id=${pid} and l.archived_at is null for share of p,l`);
      if (!project || project.status !== 'active') {
        cancelled += Number((await tx.execute(sql`update app.construction_stage_reminders set status='cancelled',last_error='project_inactive',updated_at=now()
          where enterprise_id=${eid} and project_id=${pid} and status in ('pending','failed') returning reminder_id`)).rowCount || 0);
        return;
      }
      const currentStage = stageForConstructionKey(project.current_stage_key as string | null)?.stageId ?? null;
      const pending = await rows(tx, sql`select * from app.construction_stage_reminders where enterprise_id=${eid} and project_id=${pid}
        and status in ('pending','failed') and delivery_attempts<10 and scheduled_at<=${now}
        order by scheduled_at limit 100 for update skip locked`);
      for (const reminder of pending) {
        const role = String(reminder.target_role) as ReminderRole;
        if (reminder.stage_id && currentStage && String(reminder.stage_id) !== currentStage) {
          await tx.execute(sql`update app.construction_stage_reminders set status='expired',last_error='stage_changed',updated_at=now()
            where enterprise_id=${eid} and reminder_id=${String(reminder.reminder_id)}`);
          cancelled++;
          continue;
        }
        if (!await principalAccess(tx, { enterpriseId: eid, principal: reminder.target_principal_kind === 'user'
          ? { kind: 'user', userId: String(reminder.target_principal_id) } : { kind: 'admin', adminId: String(reminder.target_principal_id) },
          contextVersion: 0, capabilities: [] }, eid, project, role)) {
          await tx.execute(sql`update app.construction_stage_reminders set status='cancelled',last_error='permission_revoked',updated_at=now()
            where enterprise_id=${eid} and reminder_id=${String(reminder.reminder_id)}`);
          cancelled++;
          continue;
        }
        if (await pausedForPrincipal(tx, eid, pid, reminder)) {
          await tx.execute(sql`update app.construction_stage_reminders set status='paused',last_error='user_paused',updated_at=now()
            where enterprise_id=${eid} and reminder_id=${String(reminder.reminder_id)}`);
          paused++;
          continue;
        }
        await tx.execute(sql`savepoint stage_reminder_delivery`);
        try {
          if (await deliverOne(tx, eid, pid, reminder, now) === 'delivered') delivered++; else failed++;
          await tx.execute(sql`release savepoint stage_reminder_delivery`);
        } catch {
          await tx.execute(sql`rollback to savepoint stage_reminder_delivery`);
          await tx.execute(sql`update app.construction_stage_reminders set status='failed',last_error='delivery_failed',
            delivery_attempts=delivery_attempts+1,updated_at=now()
            where enterprise_id=${eid} and reminder_id=${String(reminder.reminder_id)} and status in ('pending','failed')`);
          failed++;
        }
      }
    });
  }
  return { delivered, paused, cancelled, failed };
}

/** Read the recipient's current reminder inbox. Project access is rechecked
 * against today's membership/ownership so a revoked user cannot keep reading
 * content from a project they no longer belong to. Closed items stay available
 * as explicit history instead of being mixed into the current todo list. */
export async function listStageReminders(actor: ActorContext, projectId?: string) {
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const eid = actor.enterpriseId, kind = actor.principal.kind;
    const principalId = kind === 'user' ? actor.principal.userId : actor.principal.adminId;
    if (projectId) {
      const project = await projectForReminder(tx, eid, id(projectId));
      if (kind === 'user') {
        if (!project.customer_access || String(project.customer_user_id) !== principalId) fail('construction_not_found', 404);
      } else if (!await one(tx, sql`select 1 from app.construction_members where enterprise_id=${eid} and project_id=${String(project.id)}
        and admin_id=${principalId} and active`)
        && String((await one(tx, sql`select app.construction_actor_access(${principalId}::bigint,${eid}::bigint) as role`))?.role || '') !== 'owner')
        fail('construction_not_found', 404);
    }
    const pauses = await rows(tx, sql`select trigger_type from app.construction_stage_reminder_pauses
      where enterprise_id=${eid} and principal_kind=${kind} and principal_id=${principalId}
      ${projectId ? sql`and project_id=${projectId}` : sql``} order by trigger_type`);
    const found = await rows(tx, sql`select r.*,p.name as project_name,
        case when ${kind}='user' then (p.customer_access and l.customer_user_id=${principalId})
          else (exists (select 1 from app.construction_members m where m.enterprise_id=r.enterprise_id
                 and m.project_id=r.project_id and m.admin_id=${principalId} and m.active)
               or app.construction_actor_access(${principalId}::bigint,r.enterprise_id)='owner')
        end as accessible
      from app.construction_stage_reminders r
      join app.construction_projects p on p.enterprise_id=r.enterprise_id and p.id=r.project_id
      join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      where r.enterprise_id=${eid} and r.target_principal_kind=${kind} and r.target_principal_id=${principalId}
      and r.status in ('pending','delivered','failed','paused','cancelled','expired') and l.archived_at is null
      ${projectId ? sql`and r.project_id=${projectId}` : sql``}
      order by r.scheduled_at desc limit 100`);
    const visible = found.filter(row => row.accessible === true).map(row => {
      let roomId: string | null = null;
      try { roomId = new URL(String(row.action_url), 'https://xiaok.local').searchParams.get('roomId'); } catch { /* Stored URL is server-built. */ }
      const status = String(row.status), lastError = row.last_error ? String(row.last_error) : null;
      // A manager has no private assistant conversation; the existing project
      // workbench is their in-app inbox. Pending and failed manager reminders
      // are both workbench todos, never a failed send. No conversation or
      // message id is invented.
      const channel = status === 'delivered' && row.message_id ? 'conversation'
        : String(row.target_role) === 'manager' && (['pending', 'paused'].includes(status)
          || status === 'failed' && (lastError === 'no_inbox' || lastError === null)) ? 'workbench'
        : status === 'failed' ? 'failed' : null;
      return {
        reminderId: String(row.reminder_id), projectId: String(row.project_id), projectName: String(row.project_name),
        stageId: row.stage_id, stageKey: row.construction_stage_key, triggerType: String(row.trigger_type),
        triggerLabel: reminderTriggerLabels[String(row.trigger_type) as ReminderTriggerType] || '提醒',
        role: String(row.target_role), status, channel, title: String(row.title), body: String(row.body),
        actionUrl: String(row.action_url), relatedTaskId: row.related_task_id ? String(row.related_task_id) : null,
        relatedIssueId: row.related_issue_id ? String(row.related_issue_id) : null, roomId,
        scheduledAt: new Date(String(row.scheduled_at)).toISOString(),
        deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)).toISOString() : null,
        lastError,
      };
    });
    const current = visible.filter(row => ['pending', 'delivered', 'failed', 'paused'].includes(row.status)).slice(0, 50);
    const history = visible.filter(row => ['cancelled', 'expired'].includes(row.status)).slice(0, 20);
    return { paused: pauses.length > 0, pauses: pauses.map(row => String(row.trigger_type)), items: current, history };
  });
}

export async function pauseStageReminders(actor: ActorContext, input: { projectId?: unknown; triggerType?: unknown }) {
  const trigger = input.triggerType === undefined ? 'all' : String(input.triggerType);
  if (trigger !== 'all' && !reminderTriggerTypes.includes(trigger as ReminderTriggerType)) fail('invalid_construction', 422);
  const pid = id(input.projectId);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const project = await projectForReminder(tx, actor.enterpriseId, pid);
    if (!await principalAccess(tx, actor, actor.enterpriseId, project, actor.principal.kind === 'user' ? 'owner' : 'manager')
      && !await one(tx, sql`select 1 from app.construction_members where enterprise_id=${actor.enterpriseId} and project_id=${pid}
        and admin_id=${actor.principal.kind === 'admin' ? actor.principal.adminId : null} and active`)) fail('construction_forbidden', 403);
    const kind = actor.principal.kind, principalId = kind === 'user' ? actor.principal.userId : actor.principal.adminId;
    await tx.execute(sql`insert into app.construction_stage_reminder_pauses(enterprise_id,project_id,principal_kind,principal_id,trigger_type)
      values(${actor.enterpriseId},${pid},${kind},${principalId},${trigger})
      on conflict(enterprise_id,project_id,principal_kind,principal_id,trigger_type) do update set updated_at=now()`);
    await tx.execute(sql`update app.construction_stage_reminders set status='paused',last_error='user_paused',updated_at=now()
      where enterprise_id=${actor.enterpriseId} and project_id=${pid} and target_principal_kind=${kind} and target_principal_id=${principalId}
      and status in ('pending','failed') ${trigger === 'all' ? sql`` : sql`and trigger_type=${trigger}`}`);
    return { projectId: pid, triggerType: trigger, paused: true };
  });
}

export async function cancelStageReminder(actor: ActorContext, input: { reminderId?: unknown }) {
  const reminderId = typeof input.reminderId === 'string' && /^rem_[a-f0-9]{24}$/u.test(input.reminderId) ? input.reminderId : null;
  if (!reminderId) fail('invalid_construction', 422);
  const kind = actor.principal.kind, principalId = kind === 'user' ? actor.principal.userId : actor.principal.adminId;
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const reminder = await one(tx, sql`select reminder_id,project_id,status from app.construction_stage_reminders
      where enterprise_id=${actor.enterpriseId} and reminder_id=${reminderId}
      and target_principal_kind=${kind} and target_principal_id=${principalId} for update`);
    if (!reminder) fail('construction_not_found', 404);
    if (!['pending', 'paused', 'failed'].includes(String(reminder.status))) fail('context_changed', 409);
    await tx.execute(sql`update app.construction_stage_reminders set status='cancelled',last_error='user_cancelled',updated_at=now()
      where enterprise_id=${actor.enterpriseId} and reminder_id=${reminderId}`);
    return { reminderId, projectId: String(reminder.project_id), cancelled: true };
  });
}

export async function resumeStageReminders(actor: ActorContext, input: { projectId?: unknown; triggerType?: unknown }) {
  const trigger = input.triggerType === undefined ? 'all' : String(input.triggerType);
  if (trigger !== 'all' && !reminderTriggerTypes.includes(trigger as ReminderTriggerType)) fail('invalid_construction', 422);
  const pid = id(input.projectId);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const project = await projectForReminder(tx, actor.enterpriseId, pid);
    if (!await principalAccess(tx, actor, actor.enterpriseId, project, actor.principal.kind === 'user' ? 'owner' : 'manager')
      && !await one(tx, sql`select 1 from app.construction_members where enterprise_id=${actor.enterpriseId} and project_id=${pid}
        and admin_id=${actor.principal.kind === 'admin' ? actor.principal.adminId : null} and active`)) fail('construction_forbidden', 403);
    const kind = actor.principal.kind, principalId = kind === 'user' ? actor.principal.userId : actor.principal.adminId;
    await tx.execute(sql`delete from app.construction_stage_reminder_pauses where enterprise_id=${actor.enterpriseId} and project_id=${pid}
      and principal_kind=${kind} and principal_id=${principalId} ${trigger === 'all' ? sql`` : sql`and trigger_type=${trigger}`}`);
    await tx.execute(sql`update app.construction_stage_reminders set status='pending',last_error=null,updated_at=now()
      where enterprise_id=${actor.enterpriseId} and project_id=${pid} and target_principal_kind=${kind} and target_principal_id=${principalId}
      and status='paused' ${trigger === 'all' ? sql`` : sql`and trigger_type=${trigger}`}`);
    await syncProjectReminders(tx, actor.enterpriseId, pid);
    return { projectId: pid, triggerType: trigger, paused: false };
  });
}
