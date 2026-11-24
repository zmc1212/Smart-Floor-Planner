import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { constructionAccess } from './service';
import { object, text, version, type ConstructionActor } from './contracts';
import { inspectionEvidenceAvailable, inspectionModeSql, inspectionPoint, inspectionProjection, type InspectionPin } from './inspection-policy';
import { reportStatus, reportTitle, shanghaiToday } from './workbench-reports';

const pending = sql`r.status in ('organizing','draft')`;
const needsVisit = sql`(${inspectionModeSql}) in ('required','onsite')`;
const urgent = sql`r.inspection_suggestion->>'priority'='true' and (${inspectionEvidenceAvailable})`;
const scope = (actor: ConstructionActor) => sql`
  from app.construction_projects p
  join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.archived_at is null
  left join app.construction_members m on m.enterprise_id=p.enterprise_id and m.project_id=p.id
    and m.admin_id=${actor.adminId} and m.active and m.role in ('manager','designer')`;
const projectFilter = (actor: ConstructionActor, owner: boolean) => sql`p.enterprise_id=${actor.enterpriseId}
  and p.status<>'archived' and (${owner} or m.admin_id is not null)`;
const recordMessageJoin = sql`join app.assistant_messages s on s.enterprise_id=r.enterprise_id
  and s.conversation_id=r.conversation_id and s.id=r.source_message_id`;
const recordJoin = sql`join app.construction_site_records r on r.enterprise_id=p.enterprise_id and r.project_id=p.id ${recordMessageJoin}`;
const recordOrder = sql`(${urgent}) desc nulls last,s.created_at desc,r.id desc`;
const recordTitle = sql`coalesce(nullif(r.data->>'title',''),'现场上报')`;

async function requireInspectionScope(tx: PostgresTransaction, actor: ConstructionActor, owner: boolean) {
  if (!owner && !await one(tx, sql`select p.id ${scope(actor)} where ${projectFilter(actor, owner)} limit 1`)) {
    fail('construction_forbidden', 403);
  }
}

export async function inspectionSummary(tx: PostgresTransaction, actor: ConstructionActor, owner: boolean) {
  const result = await one(tx, sql`select count(*)::int as count, count(distinct p.id)::int as projects,
    (array_agg(${recordTitle} order by ${recordOrder}))[1] as next
    ${scope(actor)} ${recordJoin}
    where ${projectFilter(actor, owner)} and p.status='active' and ${pending} and ${needsVisit}`);
  return { count: Number(result?.count || 0), projects: Number(result?.projects || 0), next: String(result?.next || '') };
}

export async function listInspection(actor: ConstructionActor, cursor: string | null, projectId: string | null = null, onsiteOnly = false) {
  if (projectId !== null) id(projectId);
  if (onsiteOnly && !projectId) fail('invalid_construction', 422);
  let after: { rank: number; id: string } | null = null;
  if (cursor !== null) {
    const match = /^([012]):([1-9]\d*)$/.exec(cursor);
    if (!match) fail('invalid_construction', 422);
    after = { rank: Number(match[1]), id: id(match[2]) };
  }
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const owner = await constructionAccess(tx, actor);
    await requireInspectionScope(tx, actor, owner);
    if (projectId && !await one(tx, sql`select p.id ${scope(actor)} where ${projectFilter(actor, owner)} and p.id=${projectId}`)) {
      fail('construction_not_found', 404);
    }
    const today = shanghaiToday();
    const page = await rows(tx, sql`with ordered as (
      select r.id,r.version,r.status,r.inspection_checkpoint,r.inspection_suggestion,r.inspection_decision,
        (${inspectionEvidenceAvailable}) as inspection_evidence_available,
        p.id::text as "projectId",p.name as "projectName",p.status as "projectStatus",s.created_at as "submittedAt",
        (s.created_at at time zone 'Asia/Shanghai')::date=${today}::date as today,
        r.data->>'title' as title,r.stage_snapshot as stages,a.display_name as author,
        case when (${pending}) and (${urgent}) then 2 when (${pending}) then 1 else 0 end as rank,
        (select count(*)::int from app.construction_site_attachments x join app.construction_site_media ph
          on ph.enterprise_id=x.enterprise_id and ph.project_id=x.project_id and ph.id=x.media_id
          where x.enterprise_id=r.enterprise_id and x.project_id=r.project_id and x.record_id=r.id and ph.deleted_at is null) as photos,
        exists (select 1 from app.assistant_speech_assets v where v.enterprise_id=r.enterprise_id
          and v.conversation_id=r.conversation_id and v.message_id=r.source_message_id and v.deleted_at is null) as voice
      ${scope(actor)} ${recordJoin}
      join app.admin_users a on a.enterprise_id=r.enterprise_id and a.id=r.author_id
      where ${projectFilter(actor, owner)} and ((s.created_at at time zone 'Asia/Shanghai')::date=${today}::date or (${pending}))
        ${projectId ? sql`and p.id=${projectId}` : sql``}
        ${onsiteOnly ? sql`and p.status='active' and ${pending} and ${needsVisit}` : sql``}
    ) select * from ordered ${after ? sql`where (rank,id)<(${after.rank},${after.id}::bigint)` : sql``}
      order by rank desc,id desc limit 51`);
    const items = page.slice(0, 50).map(record => ({
      recordId: String(record.id), projectId: String(record.projectId), projectName: String(record.projectName),
      projectStatus: String(record.projectStatus), version: Number(record.version), today: Boolean(record.today),
      title: reportTitle(record.title, Number(record.photos), Boolean(record.voice)),
      status: reportStatus(String(record.status)), author: String(record.author || ''),
      submittedAt: new Date(record.submittedAt as Date).toISOString(), stages: record.stages,
      photoCount: Number(record.photos), hasVoice: Boolean(record.voice), inspection: inspectionProjection(record),
    }));
    const last = page[49];
    return { today, summary: await inspectionSummary(tx, actor, owner), items,
      nextCursor: page.length > 50 ? String(last.rank) + ':' + String(last.id) : null };
  });
}

export type InspectionStop = { projectId: string; name: string; projectVersion: number; pin: InspectionPin | null; recordIds: string[]; canSetPin: boolean };
const stopFields = (owner: boolean) => sql`p.id::text as "projectId",p.name,p.version as "projectVersion",p.inspection_pin as pin,
  (${owner} or m.role='manager') as "canSetPin"`;

export function inspectionStops(actor: ConstructionActor, projectIds?: string[]): Promise<InspectionStop[]> {
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const owner = await constructionAccess(tx, actor);
    const items = await rows(tx, sql`select ${stopFields(owner)},
      array_agg(r.id::text order by ${recordOrder}) as "recordIds"
      ${scope(actor)} ${recordJoin}
      where ${projectFilter(actor, owner)} and p.status='active' and ${pending} and ${needsVisit}
      ${projectIds ? sql`and p.id::text = any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(projectIds)}::jsonb)))` : sql``}
      group by p.id,m.role order by bool_or(${urgent}) desc nulls last,p.id desc`) as InspectionStop[];
    if (projectIds && projectIds.length !== items.length) fail('inspection_route_changed', 409);
    if (!items.length) await requireInspectionScope(tx, actor, owner);
    return items;
  });
}

type RouteStop = InspectionStop & { requiredCount: number; nextTitle: string };

/** Saved route IDs can include eight stops and a separate starting site. */
export function inspectionRouteStops(actor: ConstructionActor, savedIds: string[]) {
  if (savedIds.length > 9 || new Set(savedIds).size !== savedIds.length) fail('invalid_construction', 422);
  savedIds.forEach(value => id(value));
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const owner = await constructionAccess(tx, actor);
    const stops = await rows(tx, sql`select ${stopFields(owner)},
      coalesce(q.ids,'{}'::text[]) as "recordIds",q.required as "requiredCount",coalesce(q.title,'') as "nextTitle"
      ${scope(actor)} cross join lateral (
        select array_agg(r.id::text order by ${recordOrder}) as ids,
          (array_agg(${recordTitle} order by ${recordOrder}))[1] as title,
          (count(*) filter (where r.inspection_checkpoint is not null))::int as required,
          bool_or(${urgent}) as priority
        from app.construction_site_records r ${recordMessageJoin}
        where r.enterprise_id=p.enterprise_id and r.project_id=p.id and ${pending} and ${needsVisit}
      ) q
      where ${projectFilter(actor, owner)} and p.status='active'
        and (q.ids is not null or p.id::text=any(ARRAY(select jsonb_array_elements_text(${JSON.stringify(savedIds)}::jsonb))))
      order by q.priority desc nulls last,p.id desc`) as RouteStop[];
    if (!stops.length) await requireInspectionScope(tx, actor, owner);
    return { today: shanghaiToday(), stops };
  });
}

export function setInspectionPin(actor: ConstructionActor, projectId: string, input: unknown) {
  id(projectId);
  const value = object(input, ['expectedVersion', 'point', 'name', 'accuracy']);
  const point = inspectionPoint(value.point), name = text(value.name, 80);
  const expectedVersion = version(value.expectedVersion);
  if (typeof value.accuracy !== 'number' || !Number.isFinite(value.accuracy) || value.accuracy <= 0 || value.accuracy > 50) {
    fail('inspection_location_accuracy', 422);
  }
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const eid = actor.enterpriseId, owner = await constructionAccess(tx, actor);
    const project = await one(tx, sql`select p.id,p.version from app.construction_projects p
      join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.archived_at is null
      where p.enterprise_id=${eid} and p.id=${projectId} and p.status='active' for update of p for share of l`);
    if (!project || (!owner && !await one(tx, sql`select admin_id from app.construction_members where enterprise_id=${eid}
      and project_id=${projectId} and admin_id=${actor.adminId} and role='manager' and active for share`))) fail('construction_not_found', 404);
    if (Number(project.version) !== expectedVersion) fail('version_conflict', 409);
    const pin: InspectionPin = { ...point, name, coordinateSystem: 'wgs84', revision: expectedVersion + 1 };
    await tx.execute(sql`update app.construction_projects set inspection_pin=${JSON.stringify(pin)}::jsonb,
      version=version+1,updated_at=now() where enterprise_id=${eid} and id=${projectId}`);
    await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
      values(${eid},${projectId},${JSON.stringify({ kind: 'admin', adminId: actor.adminId })}::jsonb,
        'inspection_pin',${JSON.stringify({ name, revision: pin.revision })}::jsonb)`);
    return { projectId, pin, projectVersion: pin.revision };
  });
}
