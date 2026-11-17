import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';

type OwnerIdentity = { userId: string; contextVersion: number };
type ReminderTarget = { projectId: string; reminderId: string };

const projectJoin = sql`app.construction_projects p
  join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
  join app.enterprises e on e.id=p.enterprise_id`;
const ownerProgress = (userId: string) => sql`l.customer_user_id=${userId} and l.archived_at is null
  and p.customer_access and p.status='active' and e.status='active'`;
const deliveredToOwner = (userId: string) => sql`r.target_principal_id=${userId}
  and r.target_principal_kind='user' and r.target_role='owner' and r.status='delivered'`;

async function requireCurrentIdentity(tx: PostgresTransaction, identity: OwnerIdentity) {
  const current = await one(tx, sql`select app.assistant_identity_is_current(
    ${identity.userId}::bigint,${identity.contextVersion}::integer) as valid`);
  if (!current?.valid) fail('identity_context_invalid', 401);
}

async function withOwnerProject<T>(identity: OwnerIdentity, projectId: string,
  work: (tx: PostgresTransaction, enterpriseId: string, project: Row) => Promise<T>) {
  const access = ownerProgress(identity.userId);
  const located = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id::text
    from ${projectJoin} where p.id=${projectId} and ${access}`));
  if (!located) fail('construction_not_found', 404);
  const enterpriseId = String(located.enterprise_id);
  return withTenantTransaction(enterpriseId, async tx => {
    await requireCurrentIdentity(tx, identity);
    const project = await one(tx, sql`select p.name from ${projectJoin}
      where p.enterprise_id=${enterpriseId} and p.id=${projectId} and ${access} for share of p,l,e`);
    if (!project) fail('construction_not_found', 404);
    return work(tx, enterpriseId, project);
  });
}

function target(row: Row): ReminderTarget {
  return { projectId: String(row.project_id), reminderId: String(row.reminder_id) };
}

function reminderSummary(row: Row) {
  return { ...target(row), title: String(row.title), deliveredAt: row.delivered_at || null, readAt: row.read_at || null };
}

export async function ownerReminderSummary(identity: OwnerIdentity) {
  return withPlatformTransaction(async tx => {
    await requireCurrentIdentity(tx, identity);
    const latest = await one(tx, sql`select r.project_id,r.reminder_id,r.chat_prompted_at,r.read_at,
      count(*) filter (where r.read_at is null) over () as unread_count,
      first_value(r.project_id) over (order by (r.read_at is not null), r.delivered_at desc nulls last, r.reminder_id desc) as unread_project_id
      from ${projectJoin} join app.construction_stage_reminders r on r.enterprise_id=p.enterprise_id and r.project_id=p.id
      where ${ownerProgress(identity.userId)} and ${deliveredToOwner(identity.userId)}
      order by r.delivered_at desc nulls last,r.reminder_id desc limit 1`);
    const unreadCount = Number(latest?.unread_count || 0);
    // Only the latest delivery can prompt. Other unread deliveries remain in
    // the project inbox when several arrive before the chat checks for updates.
    return { unreadCount, unreadProjectId: unreadCount ? String(latest?.unread_project_id) : null,
      next: latest && !latest.chat_prompted_at && !latest.read_at ? target(latest) : null };
  });
}

export async function listOwnerReminders(identity: OwnerIdentity, projectId: string) {
  return withOwnerProject(identity, projectId, async (tx, enterpriseId) => {
    const items = await rows(tx, sql`select r.project_id,r.reminder_id,r.title,r.delivered_at,r.read_at
      from app.construction_stage_reminders r where r.enterprise_id=${enterpriseId} and r.project_id=${projectId}
      and ${deliveredToOwner(identity.userId)} order by r.delivered_at desc nulls last,r.reminder_id desc limit 50`);
    return { items: items.map(reminderSummary) };
  });
}

export async function updateOwnerReminder(identity: OwnerIdentity, item: ReminderTarget, action: 'prompt' | 'read') {
  return withOwnerProject(identity, item.projectId, async (tx, enterpriseId, project) => {
    const write = action === 'prompt' ? sql`chat_prompted_at=now()` : sql`read_at=coalesce(r.read_at,now())`;
    const unprompted = action === 'prompt' ? sql`and r.chat_prompted_at is null and r.read_at is null` : sql``;
    const row = await one(tx, sql`update app.construction_stage_reminders r set ${write}
      where r.enterprise_id=${enterpriseId} and r.project_id=${item.projectId} and r.reminder_id=${item.reminderId}
      and ${deliveredToOwner(identity.userId)} ${unprompted}
      returning r.project_id,r.reminder_id,r.title,r.body,r.delivered_at,r.read_at`);
    if (action === 'prompt') return { prompt: row ? { ...target(row), title: String(row.title) } : null };
    if (!row) fail('construction_not_found', 404);
    return { item: { ...reminderSummary(row), projectName: String(project.name), body: String(row.body) } };
  });
}
