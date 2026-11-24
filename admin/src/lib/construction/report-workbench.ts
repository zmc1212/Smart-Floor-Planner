import { assistantWritesEnabled, type AssistantRepository, type Row } from '@/db/repositories/assistant-repository';
import { constructionBrief } from './brief';
import { collaborationMember } from './collaboration-scope';
import { followupProjects, type ReportFacts, type ReportProject } from './report-scope';
import { currentRecord, readSiteIssue, siteIssueTitle } from './site-issues';
import { reportOwnerDecisions, readPlan } from './site-plans';
import { readStageSettings } from './stages-store';
import { shanghaiToday, workerReportHistory } from './workbench-reports';

type Report = { facts: ReportFacts; kind: string; periodStart: unknown; cutoffAt: unknown };
type ReportPhoto = { recordId: string; projectId: string; mediaId: string; version: number; room: string };

async function sitePhotos(repo: AssistantRepository, project: ReportProject, recordId: string, version: number) {
  const record = await currentRecord(repo.tx, repo.actor.enterpriseId, project.id, recordId, true);
  if (!record || Number(record.row.published_version) !== version) return [];
  return record.media.map(media => ({
    recordId, projectId: project.id, mediaId: String(media.id), version, room: String(record.row.room_name_snapshot || ''),
  }));
}

/** The snapshot and acknowledgement are owned by FollowupService. Live work
 * is projected only within the already revalidated projects of that version. */
export async function reportWorkbench(repo: AssistantRepository, binding: Row, report: Report, projectId?: string) {
  const { tx, actor } = repo, eid = actor.enterpriseId;
  const projects = report.facts.projects.filter(project => !projectId || project.id === projectId);
  if (!projects.length) return null;
  const start = new Date(String(report.periodStart)), cutoff = new Date(String(report.cutoffAt));
  if (actor.principal.kind === 'user') {
    if (binding.audience !== 'customer') return null;
    const project = projects[0], photos: ReportPhoto[] = [];
    for (const record of project.records) {
      photos.push(...(await sitePhotos(repo, project, record.id, record.version)).slice(0, 2 - photos.length));
      if (photos.length >= 2) break;
    }
    return { role: 'customer' as const, decisions: await reportOwnerDecisions(repo, project.id, cutoff), photos };
  }
  const aid = actor.principal.adminId;
  if (binding.audience === 'boss') {
    const current = await followupProjects(tx, eid, binding, false, projects.map(project => project.id));
    const { stages } = await readStageSettings(tx, eid);
    const brief = await constructionBrief(tx, eid, current, stages, true);
    const closed = new Set(projects.flatMap(project => (project.issues || [])
      .filter(issue => issue.status === 'closed' && !issue.carriedOver && new Date(issue.updatedAt) >= start && new Date(issue.updatedAt) < cutoff)
      .map(issue => issue.id)));
    return { role: 'boss' as const, items: brief.items.map(item => ({
      projectId: item.projectId, name: item.name, status: item.status, late: item.late,
      coordination: item.coordination, coordinationCount: item.coordinationCount,
      unverified: !item.progress.available || item.progress.overall.color === 'gray',
    })), closed: closed.size,
    closedComplete: !report.facts.projectsTruncated && projects.every(project => Array.isArray(project.issues) && !project.issuesTruncated) };
  }
  if (binding.audience === 'designer') {
    const review = [];
    for (const project of projects) for (const saved of (project.issues || []).filter(issue => issue.ownerId === aid)) {
      const issue = await readSiteIssue(tx, eid, project.id, saved.id);
      if (!issue?.sourceAvailable || issue.ownerId !== aid || ['invalidated', 'cancelled', 'dismissed'].includes(issue.status)) continue;
      const photos = saved.recordId && issue.recordId === saved.recordId && project.records.some(r => r.id === saved.recordId && r.version === saved.recordVersion)
        ? await sitePhotos(repo, project, saved.recordId, saved.recordVersion) : [];
      const plan = issue.planId ? await readPlan(tx, eid, issue.planId) : null;
      review.push({ projectId: project.id, projectName: project.name, issueId: issue.issueId,
        room: issue.roomName, title: siteIssueTitle(issue), label: issue.classificationLabel,
        replied: !!issue.progressMessageId && ['awaiting_review', 'implemented', 'resolved', 'closed'].includes(issue.status),
        planNumber: plan?.projectId === project.id ? plan.number : null,
        photoCount: photos.length, photo: photos[0] || null });
    }
    return { role: 'designer' as const, review };
  }
  if (binding.audience === 'worker') {
    const records = [], next = [], captureProjects: string[] = [];
    const range = { from: shanghaiToday(start), to: shanghaiToday(new Date(+cutoff - 1)) };
    const current = await followupProjects(tx, eid, binding, false, projects.map(project => project.id));
    const writes = assistantWritesEnabled(await repo.settings(false, 'share'));
    for (const project of projects) {
      const role = await collaborationMember(tx, eid, project.id, aid);
      const writable = writes && ['worker', 'manager'].includes(role || '') && current.some(p => String(p.id) === project.id && p.status === 'active');
      if (writable) captureProjects.push(project.id);
      for (const record of await workerReportHistory(tx, { enterpriseId: eid, adminId: aid }, project.id, range)) {
        if (new Date(record.at) < cutoff) records.push({ projectId: project.id, projectName: project.name,
          recordId: record.recordId, title: record.title, status: record.status, label: record.statusLabel,
          returnReason: record.returnReason, resubmittedRecordId: record.resubmittedRecordId, canResubmit: writable && record.status === 'returned' && !record.resubmittedRecordId });
      }
      for (const saved of (project.issues || []).filter(issue => issue.ownerId === aid)) {
        const issue = await readSiteIssue(tx, eid, project.id, saved.id);
        if (issue?.sourceAvailable && issue.ownerId === aid && ['awaiting_owner', 'rectifying', 'reopened'].includes(issue.status))
          next.push({ projectId: project.id, projectName: project.name, issueId: issue.issueId,
            title: siteIssueTitle(issue), label: issue.classificationLabel });
      }
    }
    return { role: 'worker' as const, records, next, captureProjects };
  }
  return null;
}
