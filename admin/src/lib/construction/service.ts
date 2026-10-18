import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { choice, memberRoles, object, projectStatuses, text, version, type ConstructionActor } from './contracts';
import { assignmentInput, defaultConstructionStages, stageKey, stageReminder, stagesInput, type ConstructionStage } from './stages';
import { currentStage } from './stages-store';
import { recordStageReminder, syncConstructionReminders } from './reminders';

export async function constructionAccess(tx: PostgresTransaction, actor: ConstructionActor) {
  id(actor.enterpriseId); id(actor.adminId);
  if (!await one(tx, sql`select id from app.enterprises where id=${actor.enterpriseId} and status='active' for share`)) fail('construction_forbidden', 403);
  const access = await one(tx, actor.miniProgramUserId
    ? sql`select app.construction_miniprogram_access(${actor.adminId}::bigint,${actor.enterpriseId}::bigint,${id(actor.miniProgramUserId)}::bigint,${actor.miniProgramContextVersion ?? -1}::integer) as role`
    : sql`select app.construction_actor_access(${actor.adminId}::bigint,${actor.enterpriseId}::bigint) as role`);
  if (!access?.role) fail('construction_forbidden', 403);
  return access.role === 'owner';
}
const fields: Record<string, string[]> = {
  list: [], options: [], lead: ['leadId'], stages: [], saveStages: ['expectedVersion', 'stages'], detail: ['projectId'],
  create: ['leadId', 'name', 'managerId', 'rooms'], update: ['projectId', 'expectedVersion', 'name', 'status', 'customerAccess'],
  member: ['projectId', 'expectedVersion', 'adminId', 'role', 'active', 'workLabel'], room: ['projectId', 'expectedVersion', 'roomId', 'name'],
  contact: ['projectId', 'expectedVersion', 'stageKey', 'staffIds', 'primaryStaffId'],
  progress: ['projectId', 'expectedVersion', 'stageKey', 'note', 'sendReminder'],
};
const actorContext = (a: ConstructionActor): ActorContext => ({ enterpriseId: a.enterpriseId, principal: { kind: 'admin', adminId: a.adminId }, contextVersion: 1, capabilities: [] });
const dto = (value: unknown): unknown => typeof value === 'bigint' ? String(value) : value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(dto) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, dto(v)])) : value;
async function staff(tx: PostgresTransaction, eid: string, aid: unknown, activeRequired = true) {
  const row = await one(tx, sql`select id from app.admin_users where enterprise_id=${eid} and id=${id(aid)} ${activeRequired ? sql`and status='active'` : sql``} for share`);
  if (!row) fail('construction_staff_unavailable', 422);
  return String(row.id);
}
async function projectLead(tx: PostgresTransaction, eid: string, leadId: unknown) {
  const lead = await one(tx, sql`select id,name,community_name,status,archived_at,customer_user_id from app.leads where enterprise_id=${eid} and id=${id(leadId)} for share`);
  if (!lead) fail('construction_lead_unavailable', 422);
  if (lead.archived_at || lead.status === 'closed') fail('construction_lead_inactive', 409);
  if (!lead.customer_user_id) fail('construction_customer_required', 422);
  return { id: lead.id, name: lead.name, community_name: lead.community_name };
}
async function audit(tx: PostgresTransaction, actor: ConstructionActor, pid: string, action: string, snapshot: Row) {
  await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
    values(${actor.enterpriseId},${pid},${JSON.stringify({ kind: 'admin', id: actor.adminId })}::jsonb,${action},${JSON.stringify(snapshot)}::jsonb)`);
}
export class ConstructionService {
  constructor(readonly actor: ConstructionActor) {}
  async execute(action: string, input: Row = {}, requestKey?: string): Promise<Row> {
    if (!fields[action]) fail('construction_not_found', 404);
    object(input, fields[action]);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const a = this.actor, eid = a.enterpriseId, owner = await constructionAccess(tx, a);
      const read = ['list', 'options', 'lead', 'detail', 'stages'].includes(action);
      if (!read) { key(requestKey); await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`construction:${eid}:${a.adminId}:${requestKey}`},0))`); }
      await tx.execute(sql`insert into app.construction_stage_settings(enterprise_id,stages) values(${eid},${JSON.stringify(defaultConstructionStages)}::jsonb) on conflict do nothing`);
      const settings = (await one(tx, sql`select * from app.construction_stage_settings where enterprise_id=${eid} ${action === 'saveStages' ? sql`for update` : sql`for share`}`))!;
      const stages = settings.stages as ConstructionStage[];
      if (action === 'lead') {
        if (!owner) fail('construction_forbidden', 403);
        return dto(await projectLead(tx, eid, input.leadId)) as Row;
      }
      if (action === 'stages') return dto({ stages, version: settings.version, owner }) as Row;
      if (action === 'saveStages') {
        if (!owner) fail('construction_forbidden', 403);
        return idempotent(tx, actorContext(a), 'construction:stages', requestKey!, input, async () => {
          if (version(input.expectedVersion) !== Number(settings.version)) fail('version_conflict');
          const next = stagesInput(input.stages), keys = next.map(s => s.key);
          if (await one(tx, sql`select id from app.construction_projects where enterprise_id=${eid} and current_stage_key is not null
            and not(current_stage_key=any(ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)))) limit 1`)) fail('construction_stage_in_use', 422);
          await tx.execute(sql`update app.construction_stage_settings set stages=${JSON.stringify(next)}::jsonb,version=version+1,updated_at=now() where enterprise_id=${eid}`);
          await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
            values(${eid},'construction.stages.configured.v1','construction_stage_settings',${eid},${Number(settings.version)+1},
            ${JSON.stringify(a)}::jsonb,${eid},${JSON.stringify({ previousVersion: Number(settings.version), stages: next })}::jsonb)`);
          return { id: eid, version: Number(settings.version) + 1, scope: 'stages' };
        });
      }
      if (action === 'options') return dto({ owner,
        staff: owner ? await rows(tx, sql`select id,display_name,role,construction_trades from app.admin_users where enterprise_id=${eid} and status='active' order by id limit 300`) : [],
        leads: owner ? await rows(tx, sql`select id,name,community_name from app.leads where enterprise_id=${eid} and customer_user_id is not null and archived_at is null and status<>'closed' order by id desc limit 200`) : [],
      }) as Row;
      if (action === 'list') return dto({ owner, stages, items: await rows(tx, sql`select p.id,${owner ? sql`p.lead_id` : sql`null`} as lead_id,p.name,p.status,p.customer_access,p.version,p.current_stage_key,p.progress_note,p.updated_at,
        (select m.role from app.construction_members m where m.enterprise_id=p.enterprise_id and m.project_id=p.id and m.admin_id=${a.adminId} and m.active) as my_role,
        (select m.work_label from app.construction_members m where m.enterprise_id=p.enterprise_id and m.project_id=p.id and m.admin_id=${a.adminId} and m.active) as my_work_label,
        coalesce((select jsonb_agg(s.stage_key order by s.stage_key) from app.construction_stage_assignments s where s.enterprise_id=p.enterprise_id and s.project_id=p.id and s.admin_id=${a.adminId}),'[]'::jsonb) as my_stages
        from app.construction_projects p where p.enterprise_id=${eid} ${owner ? sql`` : sql`and exists(select 1 from app.construction_members m where m.enterprise_id=p.enterprise_id and m.project_id=p.id and m.admin_id=${a.adminId} and m.active)`}
        order by p.id desc limit 200`) }) as Row;
      if (action === 'create') {
        if (!owner) fail('construction_forbidden', 403);
        return idempotent(tx, actorContext(a), 'construction:create', requestKey!, input, async () => {
          const leadId = id(input.leadId), name = text(input.name, 80), managerId = await staff(tx, eid, input.managerId);
          await projectLead(tx, eid, leadId);
          if (!Array.isArray(input.rooms) || input.rooms.length > 30) fail('invalid_construction', 422);
          const names = input.rooms.map(v => text(v, 50)); if (new Set(names).size !== names.length) fail('invalid_construction', 422);
          const p = (await one(tx, sql`insert into app.construction_projects(enterprise_id,lead_id,name) values(${eid},${leadId},${name}) returning *`))!, pid = String(p.id);
          await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role) values(${eid},${pid},${managerId},'manager')`);
          for (const name of names) await tx.execute(sql`insert into app.construction_rooms(enterprise_id,project_id,name) values(${eid},${pid},${name})`);
          await audit(tx, a, pid, 'create', { name, leadId, managerId, rooms: names });
          return { id: pid, version: 1 };
        });
      }
      const pid = id(input.projectId);
      let member = await one(tx, sql`select role from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=${a.adminId} and active`);
      if (!owner && !member) fail('construction_not_found', 404);
      // Lock the destination before the project, matching customer chat reads/tools.
      const conversations = read ? [] : await rows(tx, sql`select c.* from app.assistant_conversations c
        join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.status='active'
        join app.leads l on l.enterprise_id=c.enterprise_id and l.customer_user_id=ap.user_id and l.archived_at is null
        join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
        where c.enterprise_id=${eid} and p.id=${pid} and c.purpose='customer_consultation' and c.status='open' and c.mode='ai'
        and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=l.id::text)
        order by c.id desc limit 1 for update of c`);
      const p = await one(tx, sql`select * from app.construction_projects where enterprise_id=${eid} and id=${pid} for update`);
      if (!p) fail('construction_not_found', 404);
      if (!owner) {
        member = await one(tx, sql`select role from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=${a.adminId} and active for share`);
        if (!member) fail('construction_not_found', 404);
      }
      const manage = owner || member?.role === 'manager';
      if (action === 'detail') return dto({ project: { id: p.id, name: p.name, lead_id: owner ? p.lead_id : undefined, status: p.status,
        customer_access: p.customer_access, version: p.version, current_stage_key: p.current_stage_key, progress_note: p.progress_note }, manage, owner, stages, settingsVersion: settings.version,
        myRole: member?.role || (owner ? 'owner' : null),
        assignments: await rows(tx, sql`select s.stage_key,s.admin_id,s.is_primary,a.display_name,a.status as staff_status from app.construction_stage_assignments s join app.construction_members m on m.enterprise_id=s.enterprise_id and m.project_id=s.project_id and m.admin_id=s.admin_id and m.active join app.admin_users a on a.enterprise_id=s.enterprise_id and a.id=s.admin_id where s.enterprise_id=${eid} and s.project_id=${pid} order by s.stage_key,s.admin_id`),
        members: await rows(tx, sql`select m.admin_id,m.role,m.active,m.work_label,a.display_name,a.role as staff_role,a.status as staff_status,a.construction_trades from app.construction_members m join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id where m.enterprise_id=${eid} and m.project_id=${pid} order by m.admin_id`),
        staff: manage ? await rows(tx, sql`select id,display_name,role,construction_trades from app.admin_users where enterprise_id=${eid} and status='active' order by id limit 300`) : [],
        rooms: await rows(tx, sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} order by id`),
        audits: await rows(tx, sql`select action,created_at from app.construction_audits where enterprise_id=${eid} and project_id=${pid} order by id desc limit 30`),
      }) as Row;
      if (!manage) fail('construction_forbidden', 403);
      return idempotent(tx, actorContext(a), 'construction:' + action + ':' + pid, requestKey!, input, async () => {
        if (version(input.expectedVersion) !== Number(p.version)) fail('version_conflict');
        let remind = false, followUp = false;
        if (action === 'update') {
          if (!owner && input.customerAccess !== p.customer_access) fail('construction_forbidden', 403);
          const name = text(input.name, 80), status = choice(input.status, projectStatuses);
          if (typeof input.customerAccess !== 'boolean') fail('invalid_construction', 422);
          await tx.execute(sql`update app.construction_projects set name=${name},status=${status},customer_access=${input.customerAccess},
            progress_revision=progress_revision+${status !== p.status || input.customerAccess !== p.customer_access ? 1 : 0} where enterprise_id=${eid} and id=${pid}`);
        } else if (action === 'member') {
          if (typeof input.active !== 'boolean') fail('invalid_construction', 422);
          const aid = await staff(tx, eid, input.adminId, input.active), role = choice(input.role, memberRoles);
          const previous = await one(tx, sql`select role from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=${aid}`);
          if (!owner && (role === 'manager' || previous?.role === 'manager')) fail('construction_forbidden', 403);
          const workLabel = text(input.workLabel ?? '', 50, false);
          await tx.execute(sql`insert into app.construction_members(enterprise_id,project_id,admin_id,role,active,work_label) values(${eid},${pid},${aid},${role},${input.active},${workLabel})
            on conflict(enterprise_id,project_id,admin_id) do update set role=excluded.role,active=excluded.active,work_label=excluded.work_label`);
          if (!input.active) await tx.execute(sql`delete from app.construction_stage_assignments where enterprise_id=${eid} and project_id=${pid} and admin_id=${aid}`);
          if (!await one(tx, sql`select m.admin_id from app.construction_members m join app.admin_users a on a.enterprise_id=m.enterprise_id and a.id=m.admin_id and a.status='active' where m.enterprise_id=${eid} and m.project_id=${pid} and m.role='manager' and m.active limit 1`)) fail('construction_manager_required', 422);
        } else if (action === 'room') {
          const name = text(input.name, 50);
          if (input.roomId) {
            if (!await one(tx, sql`update app.construction_rooms set name=${name} where enterprise_id=${eid} and project_id=${pid} and id=${id(input.roomId)} returning id`)) fail('construction_not_found', 404);
          } else {
            if (Number((await one(tx, sql`select count(*) n from app.construction_rooms where enterprise_id=${eid} and project_id=${pid}`))!.n) >= 30) fail('invalid_construction', 422);
            await tx.execute(sql`insert into app.construction_rooms(enterprise_id,project_id,name) values(${eid},${pid},${name})`);
          }
        } else if (action === 'contact') {
          const key = stageKey(input.stageKey), assignment = assignmentInput(input.staffIds, input.primaryStaffId);
          if (!stages.some(s => s.key === key)) fail('construction_stage_unavailable', 422);
          for (const aid of assignment.ids) {
            await staff(tx, eid, aid);
            if (!await one(tx, sql`select admin_id from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=${aid} and active for share`)) fail('construction_member_required', 422);
          }
          await tx.execute(sql`delete from app.construction_stage_assignments where enterprise_id=${eid} and project_id=${pid} and stage_key=${key}`);
          for (const aid of assignment.ids) await tx.execute(sql`insert into app.construction_stage_assignments(enterprise_id,project_id,stage_key,admin_id,is_primary) values(${eid},${pid},${key},${aid},${aid === assignment.primary})`);
        } else if (action === 'progress') {
          if (p.status !== 'active') fail('construction_project_inactive');
          const key = stageKey(input.stageKey), note = text(input.note ?? '', 1000, false), stage = stages.find(s => s.key === key);
          if (!stage || typeof input.sendReminder !== 'boolean') fail('construction_stage_unavailable', 422);
          if (input.sendReminder && !stage.visitReminder) fail('construction_reminder_disabled', 422);
          const changed = key !== p.current_stage_key;
          remind = stage.visitReminder && (changed || input.sendReminder);
          followUp = changed && !!stage.followUps?.length;
          await tx.execute(sql`update app.construction_projects set current_stage_key=${key},progress_note=${note},progress_revision=progress_revision+${changed || remind || note !== p.progress_note ? 1 : 0} where enterprise_id=${eid} and id=${pid}`);
        }
        const updated = (await one(tx, sql`update app.construction_projects set version=version+1,updated_at=now() where enterprise_id=${eid} and id=${pid} returning *`))!;
        await audit(tx, a, pid, action, input);
        if ((remind || followUp) && updated.customer_access) {
          await recordStageReminder(tx, actorContext(a), updated, Number(settings.version), stageReminder(String(updated.name), currentStage(updated, stages)!, String(updated.progress_note)));
          for (const c of conversations) {
            const customer = await one(tx, sql`select customer_user_id from app.leads where enterprise_id=${eid} and id=${String(updated.lead_id)} and archived_at is null`);
            if (customer?.customer_user_id) await syncConstructionReminders(tx, { ...actorContext(a), principal: { kind: 'user', userId: String(customer.customer_user_id) } }, c);
          }
        }
        return { id: pid, version: Number(updated.version), reminderRecorded: remind && !!updated.customer_access };
      });
    });
  }
}
