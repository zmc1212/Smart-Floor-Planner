import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { assistantWritesEnabled, one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { constructionAccess } from './service';
import { constructionBrief } from './brief';
import { readStageSettings } from './stages-store';
import { currentRecord, projectSiteIssues, siteIssueTitle, type IssueView } from './site-issues';
import type { ConstructionActor } from './contracts';

type Project = { id: string; name: string; role: 'worker' | 'manager' | 'observer' | 'designer';
  status: string; stageKey: string | null; assigned: boolean };
type RecordKind = 'capture' | 'draft' | 'rework';

const awaitingOwner = new Set(['awaiting_owner', 'rectifying', 'reopened']);
const awaitingReview = new Set(['awaiting_review', 'implemented']);
const clock = (value: Date | string) => new Date(value).toISOString();

function issueCard(issue: IssueView) {
  return { issueId: issue.issueId, title: siteIssueTitle(issue), roomName: issue.roomName,
    label: issue.classificationLabel, waitingFor: issue.ownerName };
}

async function recordCard(tx: PostgresTransaction, actor: ConstructionActor, projectId: string, kind: RecordKind) {
  const { enterpriseId: eid, adminId } = actor;
  const filter = kind === 'capture' ? sql`r.author_id=${adminId} and exists(select 1 from app.construction_site_record_versions v
    where v.enterprise_id=r.enterprise_id and v.project_id=r.project_id and v.record_id=r.id and v.snapshot ? 'capture')`
    : sql`r.status='draft' and r.resubmission_of_id is ${kind === 'rework' ? sql`not null` : sql`null`}`;
  const record = await one<{
    id: string; status: string; title: string | null; sourceAt: Date; authorName: string; hasVoice: boolean;
  }>(tx, sql`select r.id::text,r.status,r.data->>'title' as title,m.created_at as "sourceAt",a.display_name as "authorName",
    exists(select 1 from app.assistant_speech_assets s where s.enterprise_id=r.enterprise_id and s.conversation_id=r.conversation_id
      and s.message_id=r.source_message_id and s.deleted_at is null) as "hasVoice"
    from app.construction_site_records r join app.assistant_messages m
      on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.source_message_id
    join app.admin_users a on a.enterprise_id=r.enterprise_id and a.id=r.author_id
    where r.enterprise_id=${eid} and r.project_id=${projectId} and ${filter}
    order by ${kind === 'capture' ? sql`m.created_at` : sql`r.updated_at`} desc,r.id desc limit 1`);
  if (!record) return null;
  const source = await currentRecord(tx, eid, projectId, record.id, true);
  return { recordId: record.id, title: record.title || '现场上报', at: clock(record.sourceAt), authorName: record.authorName,
    status: record.status, photoId: source?.media[0]?.id || null, photoCount: source?.media.length || 0, hasVoice: record.hasVoice };
}

export function constructionWorkbench(actor: ConstructionActor, staffRole: string, selection?: string) {
  if (!['construction_staff', 'designer', 'enterprise_admin'].includes(staffRole)) fail('construction_forbidden', 403);
  const requested = selection === undefined ? null : id(selection);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const eid = actor.enterpriseId, owner = await constructionAccess(tx, actor);
    const { stages } = await readStageSettings(tx, eid);
    if (staffRole === 'enterprise_admin') {
      if (!owner) fail('construction_forbidden', 403);
      if (requested) fail('invalid_construction', 422);
      const projects = await rows(tx, sql`select p.id,p.name,p.status,p.current_stage_key,p.progress_note,p.progress_revision
        from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${eid} and p.status<>'archived' and l.archived_at is null order by p.id desc limit 21 for share of p,l`);
      const enterprise = await one(tx, sql`select name from app.enterprises where id=${eid}`);
      return { view: 'boss', enterpriseName: String(enterprise?.name || ''), ...(await constructionBrief(tx, eid, projects, stages, true)) };
    }

    // The role shown to a construction employee is the live membership of
    // the selected project. A design account only lists its design assignments.
    const allowed = staffRole === 'designer' ? sql`m.role='designer'` : sql`m.role in ('worker','manager','observer')`;
    const projects = await rows<Project>(tx, sql`select p.id::text,p.name,p.status,p.current_stage_key as "stageKey",m.role,
      exists(select 1 from app.construction_stage_assignments s where s.enterprise_id=p.enterprise_id and s.project_id=p.id
        and s.stage_key=p.current_stage_key and s.admin_id=m.admin_id) as assigned
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.construction_members m on m.enterprise_id=p.enterprise_id and m.project_id=p.id and m.admin_id=${actor.adminId} and m.active
      where p.enterprise_id=${eid} and p.status<>'archived' and l.archived_at is null and ${allowed}
      order by (p.status='active') desc,p.id desc limit 200 for share of p,l,m`);
    const project = requested ? projects.find(p => p.id === requested) : projects[0];
    if (requested && !project) fail('construction_not_found', 404);
    const defaultView = staffRole === 'designer' ? 'designer' : 'worker';
    const choices = projects.map(({ id, name }) => ({ id, name }));
    if (!project) return { view: defaultView, choices, project: null };
    const stageName = stages.find(stage => stage.key === project.stageKey)?.name || '阶段待标记';
    const scope = { choices, project: { id: project.id, name: project.name, status: project.status, stageName } };
    if (project.role === 'observer') return { view: 'worker', ...scope, canCapture: false };

    const issues = await projectSiteIssues(tx, eid, project.id, null);
    const active = issues.filter(issue => issue.sourceAvailable && (awaitingOwner.has(issue.status) || awaitingReview.has(issue.status)));
    const mine = active.filter(issue => issue.ownerId === actor.adminId);
    if (project.role === 'designer') return { view: 'designer', ...scope,
      reply: mine.filter(issue => awaitingOwner.has(issue.status)).slice(0, 3).map(issueCard),
      changes: mine.filter(issue => issue.designRelated && awaitingReview.has(issue.status)).slice(0, 3).map(issueCard) };
    if (project.role === 'manager') {
      const issue = active.find(issue => issue.classification === 'awaiting_review');
      return { view: 'manager', ...scope, draft: await recordCard(tx, actor, project.id, 'draft'),
        review: issue ? issueCard(issue) : await recordCard(tx, actor, project.id, 'rework') };
    }
    const task = mine.find(issue => issue.sourceKind !== 'need' && awaitingOwner.has(issue.status));
    const settings = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`);
    return { view: 'worker', ...scope, canCapture: project.status === 'active' && assistantWritesEnabled(settings),
      task: task ? issueCard(task) : project.assigned && project.stageKey && project.status === 'active'
        ? { title: stageName, label: '进行中' } : null,
      receipt: await recordCard(tx, actor, project.id, 'capture') };
  });
}
