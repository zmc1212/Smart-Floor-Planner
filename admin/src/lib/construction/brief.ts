import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint } from '@/lib/assistant/contracts';
import { currentRecord, projectSiteIssues, type IssueView } from './site-issues';
import { projectPlans } from './site-plans';
import { readSchedule } from './site-schedule';

/** A read model of the existing project facts. No generated advice, private consultation, or new fact store. */
export function waitingFact(issue: IssueView, plan?: { status: string; id: string }) {
  if (issue.status === 'cancelled') return { label: '已取消', waitingFor: '', reason: '本事项已明确取消跟进。' };
  if (issue.status === 'dismissed') return { label: '已排除', waitingFor: '', reason: '已由有权人员排除为误报或非施工质量问题；资料缺口不按施工错误处理。' };
  if (issue.status === 'rectifying') return { label: '整改中', waitingFor: issue.ownerName || '有效负责人', reason: '已确认为施工问题并进入整改，等待现场处理与回传。' };
  if (issue.confirmed && issue.status === 'awaiting_owner') return { label: '待整改', waitingFor: issue.ownerName || '有效负责人', reason: '已确认属于施工问题，等待负责人整改；施工回传不等于复核通过。' };
  if (!issue.sourceAvailable || issue.status === 'invalidated') return { label: '待重新核对', waitingFor: '有权核对人员', reason: '原材料或授权已变化，旧处理结果不再沿用。' };
  if (issue.status === 'closed') return { label: '已关闭', waitingFor: '', reason: '管理者已正式关闭本事项；不代表工程验收或付款。' };
  if (issue.status === 'resolved') return { label: '待关闭', waitingFor: '项目管理者', reason: '已正式解决，尚未关闭。' };
  if (issue.status === 'implemented') return { label: '待管理核对', waitingFor: '项目管理者', reason: '已提交现场落实依据，尚未正式解决。' };
  if (plan?.status === 'pending_customer' || plan?.status === 'deferred') return { label: '待客户决定', waitingFor: '客户', reason: `方案${plan.id}${plan.status === 'deferred' ? '已暂缓决定' : '尚未取得客户决定'}；不等于批准或落实。` };
  if (plan?.status === 'approved') return { label: '待现场落实', waitingFor: issue.ownerName || '有效负责人', reason: `方案${plan.id}已获客户同意，尚无有效现场落实结果。` };
  if (plan?.status === 'declined' || plan?.status === 'changes_requested') return { label: '待方案处理', waitingFor: issue.ownerName || '有效负责人', reason: `方案${plan.id}${plan.status === 'declined' ? '被客户拒绝' : '收到客户修改请求'}，需由团队处理。` };
  if (!issue.ownerId) return { label: '待分配', waitingFor: '项目管理者', reason: '尚未分配当前有效负责人。' };
  if (issue.status === 'awaiting_review') return { label: '待核对', waitingFor: '有权核对人员', reason: '已有处理回复，仍待团队核对；回复不等于正式解决。' };
  return { label: '待回复', waitingFor: issue.ownerName, reason: '已分配负责人，尚无当前有效处理回复。' };
}

/** Caller supplies only projects selected by ConstructionService's live management scope, inside its tenant transaction. */
export async function constructionBrief(tx: PostgresTransaction, eid: string, projects: Row[], stages: Row[]) {
  const items = [];
  for (const p of projects.slice(0, 20)) {
    const pid = String(p.id), issues = await projectSiteIssues(tx, eid, pid), plans = await projectPlans(tx, eid, pid);
    const facts = issues.map(issue => {
      const plan = plans.find(p => p.available && 'issueId' in p && p.issueId === issue.issueId);
      return { issueId: issue.issueId, recordId: issue.recordId, revision: issue.revision, status: issue.status,
        ...waitingFact(issue, plan), deadline: null, deadlineLabel: '未记录明确期限，不推断逾期' };
    });
    const candidate = await one(tx, sql`select r.id,a.display_name
      from app.construction_site_records r left join app.admin_users a on a.id=r.author_id
      where r.enterprise_id=${eid} and r.project_id=${pid} and r.status='published'
      order by r.updated_at desc,r.id desc limit 1`);
    const recent = candidate ? (await currentRecord(tx, eid, pid, String(candidate.id), true))?.row : null;
    const pending = facts.filter(f => !['cancelled', 'closed', 'dismissed'].includes(f.status));
    const title = recent ? String((recent.data as Row)?.title || '') : '';
    const schedule = await readSchedule(tx, eid, pid, p);
    items.push({ projectId: pid, name: String(p.name), stageName: stages.find(s => s.key === p.current_stage_key)?.name || '节点未设置',
      progress: { available: schedule.available, version: schedule.version, overall: schedule.overall, counts: schedule.counts,
        gaps: schedule.gaps.map(g => g.label).slice(0, 5), text: schedule.text },
      progressNote: String(p.progress_note || ''), latestRecord: recent ? { id: String(recent.id), version: Number(recent.version),
        updatedAt: recent.updated_at, authorName: candidate?.display_name || '项目管理人员', title } : null,
      issues: facts, focusIssueId: (pending[0] || facts[0])?.issueId || '', summary: pending.length ? pending.map(f => `事项${f.issueId} · ${f.label}${f.waitingFor ? ' · ' + f.waitingFor : ''}`).slice(0, 3).join('；')
        : facts.length ? '本次读取的事项均已关闭或取消。' : recent ? '现场记录：' + title : candidate ? '最新发布记录的来源已失效，等待重新核对。' : '暂无可读取的发布记录或持续事项，进展待补充。',
      hasMoreIssues: !!await one(tx, sql`select id from app.domain_event_outbox where enterprise_id=${eid}
        and type='construction.site.issue.opened.v1' and payload->>'projectId'=${pid} order by id desc offset 50 limit 1`) });
  }
  // The fingerprint excludes the request time; reentry derives fresh facts and never replays an old successful view.
  return { items, version: fingerprint(items), asOf: new Date().toISOString(), hasMoreProjects: projects.length > 20,
    scope: 'management', deadlineSupport: false };
}
