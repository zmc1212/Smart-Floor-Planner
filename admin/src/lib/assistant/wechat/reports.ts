import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { FollowupService } from '@/lib/construction/followup-service';
import type { FollowupAudience } from '@/lib/construction/report-scope';
import { mainRelease } from '@/lib/xiaok-v1/main-publication';
import { AssistantError, fail, principalKey } from '../contracts';
import { checkRecipient, checkReportBinding, savedRecipient, type Recipient } from './recipient';
import type { ChannelRow } from './channels';
import { bossWeeklyNotebookText, buildBossWeeklyNotebook, type BossWeeklyNotebook } from './weekly-notebook';

export type Period = 'daily' | 'weekly';
export type ReportEvent = { report_kind: Period | null; report_id: string | null; report_revision: number | null;
  recipient_version: number | null; proactive: boolean; role_delivery_key?: string | null };
type WechatReportMessage = { text: string; notebook?: BossWeeklyNotebook };

type RoleRecipient = Extract<Recipient, { audience: FollowupAudience }>;
type ReportProjectView = {
  id: string; name: string; stageName?: string | null; records?: Array<{ room?: string; data?: unknown }>;
};
type ReportView = {
  reportId?: string; revision?: number; kind?: Period; periodStart?: unknown; periodEnd?: unknown; available?: boolean;
  facts?: { projects?: ReportProjectView[] } | null;
  body?: Array<{ projectId?: string; [key: string]: unknown }> | null;
  weeklyReport?: { summary?: string; sections?: Array<{ label?: string; lines?: Array<{ text?: string }> }>; exceptions?: string[] } | null;
};

const reportName = (kind: Period) => kind === 'daily' ? '日报' : '周报';
const reportFooter = '完整报告可在小程序「工地日报与周报」查看。';
const isRoleRecipient = (recipient: Recipient): recipient is RoleRecipient => 'audience' in recipient;
const roleName: Record<FollowupAudience, string> = { customer: '本人工地', worker: '本人施工跟进', designer: '本人项目跟进', boss: '企业工地' };

function clean(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '';
}

function dateText(value: unknown) {
  if (value === undefined || value === null) return '';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

function periodText(report: ReportView) {
  const start = dateText(report.periodStart), end = dateText(report.periodEnd);
  if (!start) return '';
  return start === end || !end ? start : `${start} 至 ${end}`;
}

function sectionTexts(section: unknown) {
  if (!Array.isArray(section)) return [];
  return section.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const value = item as { text?: unknown; citationStatus?: unknown };
    if (value.citationStatus === 'rejected') return [];
    const text = clean(value.text);
    return text ? [text] : [];
  });
}

function recordTexts(project: ReportProjectView) {
  if (!Array.isArray(project.records)) return [];
  return project.records.flatMap(record => {
    const room = clean(record.room);
    const data = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
    const completed = clean(data.completed), pending = clean(data.pending), coordination = clean(data.coordination);
    return [completed && `${room ? room + '：' : ''}${completed}`, pending && `${room ? room + ' · ' : ''}待处理：${pending}`,
      coordination && `${room ? room + ' · ' : ''}需配合：${coordination}`].filter(Boolean);
  });
}

function bounded(lines: string[], max = 1600) {
  const unique = [...new Set(lines.map(clean).filter(Boolean))];
  const selected: string[] = [];
  let size = reportFooter.length;
  for (const line of unique) {
    const extra = line.length + (selected.length ? 1 : 0);
    if (size + extra > max) continue;
    selected.push(line);
    size += extra;
  }
  return [...selected, reportFooter].join('\n');
}

/** Build the short WeChat projection from the already-authorized facts/body view.
 * No model output or newly retrieved knowledge is used here. Lines are omitted
 * only at the message-size boundary; a complete-report link is always retained. */
export function buildWechatReportSummary(input: unknown, kind: Period, audience?: FollowupAudience) {
  if (!input || typeof input !== 'object') return null;
  const report = input as ReportView;
  const projects = Array.isArray(report.facts?.projects) ? report.facts.projects.filter(project => project && project.id && project.name) : [];
  if (!projects.length) return null;
  const range = periodText(report);
  const heading = `${reportName(kind)}${range ? `（${range}）` : ''}`;
  const records = projects.reduce((sum, project) => sum + (Array.isArray(project.records) ? project.records.length : 0), 0);
  const lines = [heading, audience === 'boss' ? `授权范围内共${projects.length}个工地；现场记录${records}条。`
    : audience && audience !== 'customer' ? `${roleName[audience]}共${projects.length}个工地；现场记录${records}条。`
      : `本人订阅工地共${projects.length}个；现场记录${records}条。`];

  if (kind === 'weekly' && report.weeklyReport) {
    const weekly = report.weeklyReport;
    if (clean(weekly.summary)) lines.push(clean(weekly.summary));
    if (audience && audience !== 'boss' && audience !== 'customer') {
      for (const project of projects) lines.push(`${project.name} · ${clean(project.stageName) || '阶段未识别'} · 现场记录${project.records?.length ?? 0}条`);
    }
    for (const section of weekly.sections ?? []) {
      for (const text of (section.lines ?? []).map(line => clean(line.text)).filter(Boolean)) {
        lines.push(section.label ? `${section.label}：${text}` : text);
      }
    }
    for (const exception of weekly.exceptions ?? []) if (clean(exception)) lines.push(`需要关注：${clean(exception)}`);
  } else {
    for (const project of projects) {
      const stage = clean(project.stageName) || '阶段未识别';
      lines.push(`${project.name} · ${stage}`);
      const body = report.body?.find(item => item.projectId === project.id);
      const highlights = [
        ...sectionTexts(body?.progress), ...sectionTexts(body?.pending), ...sectionTexts(body?.arrangements),
      ];
      lines.push(...(highlights.length ? highlights : recordTexts(project)));
    }
  }
  return bounded(lines);
}

type LatestRoleReport = { id: string; revision: number; binding_id: string; project_id: string | null };

async function latestRoleReport(tx: PostgresTransaction, channel: ChannelRow, recipient: RoleRecipient, kind: Period) {
  if (recipient.bindingId) {
    return one<LatestRoleReport>(tx, sql`select r.id::text as id,r.latest_revision as revision,r.binding_id::text as binding_id,null::text as project_id
      from app.construction_reports r
      join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.binding_id=r.binding_id
        and d.report_id=r.id and d.revision=r.latest_revision and d.state='delivered'
      join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=d.revision
      where r.enterprise_id=${channel.enterprise_id} and r.binding_id=${recipient.bindingId} and r.kind=${kind}
      order by r.period_start desc,r.id desc limit 1`);
  }
  return one<LatestRoleReport>(tx, sql`select r.id::text as id,r.latest_revision as revision,r.binding_id::text as binding_id,b.project_id::text as project_id
    from app.construction_followup_bindings b
    join app.construction_reports r on r.enterprise_id=b.enterprise_id and r.binding_id=b.id and r.kind=${kind}
    join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.binding_id=r.binding_id
      and d.report_id=r.id and d.revision=r.latest_revision and d.state='delivered'
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=d.revision
    where b.enterprise_id=${channel.enterprise_id} and b.principal_key=${principalKey(recipient.actor)} and b.audience='customer'
      and b.project_id is not null and b.status='enabled'
      and v.facts->'projects' @> jsonb_build_array(jsonb_build_object('id',b.project_id::text))
    order by r.period_start desc,r.id desc limit 1`);
}

async function selectRoleReport(tx: PostgresTransaction, channel: ChannelRow, recipient: RoleRecipient, kind: Period, runId: string) {
  await checkRecipient(tx, recipient);
  const latest = await latestRoleReport(tx, channel, recipient, kind);
  const noReport = kind === 'daily' ? '当前授权范围暂无可查看的本人日报。' : '当前授权范围暂无可查看的本人周报。';
  if (!latest) return noReport;
  const binding = await checkReportBinding(tx, recipient, latest.binding_id);
  const report = await new FollowupService(recipient.actor, tx).detail(String(binding.id), latest.id, latest.revision) as ReportView;
  const projects = report?.available && report.facts?.projects ? report.facts.projects : [];
  if (!projects?.length || recipient.audience === 'customer' && latest.project_id && !projects.some(project => project.id === latest.project_id)) return noReport;
  const selected = recipient.audience === 'customer' && latest.project_id ? projects.find(project => project.id === latest.project_id) : null;
  const scope = selected ? `工地「${selected.name}」` : roleName[recipient.audience];
  const event = await one(tx, sql`update app.assistant_wechat_events set report_kind=${kind},report_id=${report.reportId},
    report_revision=${report.revision},recipient_version=${channel.recipient_version} where enterprise_id=${channel.enterprise_id}
    and channel_id=${channel.id} and run_id=${runId} and status='running' returning id`);
  if (!event) fail('context_changed');
  return `已选中${scope}的${reportName(kind)}，微信将在发送时核验权限并展示已保存的摘要。`;
}

export async function selectReport(tx: PostgresTransaction, channel: ChannelRow, kind: Period, runId: string) {
  const recipient = savedRecipient(channel);
  if (!recipient) return '请先在小程序的工地日报与周报页关联本人微信。';
  if (isRoleRecipient(recipient)) return selectRoleReport(tx, channel, recipient, kind, runId);
  await checkRecipient(tx, recipient);
  const latest = await one<{id:string; revision:number}>(tx,sql`select r.id,d.revision from app.construction_reports r
    join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.binding_id=r.binding_id
      and d.report_id=r.id and d.revision=r.latest_revision and d.state='delivered'
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=d.revision
    where r.enterprise_id=${channel.enterprise_id} and r.binding_id=${recipient.bindingId} and r.kind=${kind}
      and v.facts->'projects' @> ${JSON.stringify([{id:recipient.projectId}])}::jsonb
    order by r.period_start desc,r.id desc limit 1`);
  const report = latest && await new FollowupService(recipient.actor,tx).detail(recipient.bindingId,latest.id,latest.revision);
  if (!report?.available || !report.facts?.projects.some(p=>p.id===recipient.projectId))
    return kind === 'daily' ? '当前工地暂无可查看的本人日报。' : '当前工地暂无可查看的本人周报。';
  const event = await one(tx, sql`update app.assistant_wechat_events set report_kind=${kind},report_id=${report.reportId},
    report_revision=${report.revision},recipient_version=${channel.recipient_version} where enterprise_id=${channel.enterprise_id}
    and channel_id=${channel.id} and run_id=${runId} and status='running' returning id`);
  if (!event) fail('context_changed');
  // The channel projects private text at delivery. The general consultation keeps no copy of it.
  return '已选中本人当前工地的报告，微信将在发送时核验权限并展示已保存的摘要。';
}

async function roleReportMessage(tx: PostgresTransaction, c: ChannelRow, recipient: RoleRecipient, event: ReportEvent, since: string | null): Promise<WechatReportMessage | null> {
  if (event.proactive && !since) return null;
  await checkRecipient(tx, recipient);
  const current = await one<{binding_id:string; revision:number; kind:Period}>(tx,sql`select r.binding_id::text as binding_id,r.latest_revision as revision,r.kind
    from app.construction_reports r
    join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id
      and d.revision=r.latest_revision and d.binding_id=r.binding_id and d.state='delivered'
    join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=d.revision
    where r.enterprise_id=${c.enterprise_id} and r.id=${event.report_id} and r.kind=${event.report_kind}
      and (${!event.proactive} or (r.scheduled_at>=${since}::timestamptz and d.delivered_at>=${since}::timestamptz))
    for share of r,d`);
  if (!current) return null;
  const binding = await checkReportBinding(tx, recipient, current.binding_id);
  if (event.proactive && binding[event.report_kind === 'daily' ? 'remind_daily' : 'remind_weekly'] === false) return null;
  const report = await new FollowupService(recipient.actor, tx).detail(String(binding.id), event.report_id!, current.revision);
  if (!report.available || !report.facts?.projects.length || !('kind' in report) || report.kind !== event.report_kind) return null;
  if (event.proactive && recipient.audience === 'boss' && event.report_kind === 'weekly') {
    const notebook = buildBossWeeklyNotebook({ reportId: report.reportId, revision: report.revision,
      periodStart: report.periodStart as Date | string, periodEnd: report.periodEnd as Date | string, projects: report.facts.projects });
    return { notebook, text: bossWeeklyNotebookText(notebook) };
  }
  const text = buildWechatReportSummary(report, event.report_kind, recipient.audience);
  return text ? { text } : null;
}

export async function reportMessage(tx: PostgresTransaction, c: ChannelRow, event: ReportEvent): Promise<WechatReportMessage | null> {
  const recipient = savedRecipient(c);
  if (!recipient || !event.report_id || !event.report_revision || !event.report_kind) return null;
  if (event.proactive && Boolean(event.role_delivery_key) !== isRoleRecipient(recipient)) return null;
  const since = event.report_kind === 'daily' ? c.daily_since : c.weekly_since;
  if (event.proactive ? !since : c.recipient_version !== event.recipient_version) return null;
  const app = await mainRelease(tx, c.enterprise_id);
  if (!app?.enabled || !app.reports) return null;
  try {
    if (isRoleRecipient(recipient)) return await roleReportMessage(tx, c, recipient, event, since);
    const binding = await checkRecipient(tx, recipient);
    if (!binding) return null;
    if (event.proactive && binding[event.report_kind === 'daily' ? 'remind_daily' : 'remind_weekly'] === false) return null;
    const current = await one(tx,sql`select 1 from app.construction_reports r join app.construction_report_deliveries d
      on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.revision=r.latest_revision and d.binding_id=r.binding_id
      where r.enterprise_id=${c.enterprise_id} and r.id=${event.report_id} and r.binding_id=${recipient.bindingId}
      and r.latest_revision=${event.report_revision} and d.state='delivered'
      and (${!event.proactive} or d.delivered_at>=${since}::timestamptz) for share of r,d`);
    if (!current) return null;
    const service = new FollowupService(recipient.actor, tx);
    const report = await service.detail(recipient.bindingId, event.report_id, event.report_revision);
    if (!report.available || !report.facts || !('kind' in report) || report.kind !== event.report_kind || report.deliveryState !== 'delivered') return null;
    const project = report.facts.projects.find(p => p.id === recipient.projectId);
    if (!project) return null;
    const saved = report.body?.find(p => p.projectId === project.id);
    const sections = saved && 'progress' in saved ? saved.progress : null;
    const progress: string[] = Array.isArray(sections) ? sections.filter(s => typeof s?.text === 'string' && s.citationStatus !== 'rejected').map(s => s.text) : [];
    const records = project.records.map(r => r.data.completed).filter((t): t is string => typeof t === 'string' && !!t.trim());
    const name = event.report_kind === 'daily' ? '日报' : '周报';
    const date = (value:unknown) => new Date(String(value)).toLocaleDateString('zh-CN', {timeZone:'Asia/Shanghai'});
    const start = date(report.periodStart), end = date(report.periodEnd);
    const period = start === end ? start : start+' 至 '+end;
    const text = [project.name+' · '+name+'（'+period+'）', project.stageName ? '本期阶段：' + project.stageName : '',
      ...(progress.length ? progress : records.length ? records : ['本期暂无可展示的已发布进展记录。']).slice(0,3),
      reportFooter].filter(Boolean).join('\n').slice(0,1600);
    return { text };
  } catch (error) {
    if (error instanceof AssistantError && [401,403,404,409].includes(error.status)) return null;
    throw error;
  }
}

export async function queueWechatReports(tx: PostgresTransaction, enterprise: string) {
  await tx.execute(sql`insert into app.assistant_wechat_events
    (enterprise_id,channel_id,event_key,role_delivery_key,report_kind,report_id,report_revision,recipient_version,proactive)
    select candidate.enterprise_id,candidate.channel_id,candidate.event_key,candidate.role_delivery_key,candidate.report_kind,
      candidate.report_id,candidate.report_revision,candidate.recipient_version,candidate.proactive
    from (
      select c.enterprise_id,c.id as channel_id,
        'report:'||d.report_id||':'||d.revision||':'||c.project_id as event_key,
        null::text as role_delivery_key,r.kind as report_kind,d.report_id as report_id,d.revision as report_revision,c.recipient_version,true as proactive,d.delivered_at as queued_at
      from app.assistant_wechat_channels c join app.assistant_main_publications a on a.enterprise_id=c.enterprise_id and a.enabled and a.reports
      join app.construction_report_deliveries d on d.enterprise_id=c.enterprise_id and d.binding_id=c.recipient_binding_id and d.state='delivered'
      join app.construction_reports r on r.enterprise_id=d.enterprise_id and r.id=d.report_id and r.latest_revision=d.revision
      join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=r.id and v.revision=d.revision
      where c.enterprise_id=${enterprise} and c.stage_id='main' and c.status='connected' and c.verified_at is not null and c.latest_context is not null
        and c.recipient_audience is null
        and (r.kind='daily' and d.delivered_at>=c.daily_since or r.kind='weekly' and d.delivered_at>=c.weekly_since)
        and v.facts->'projects' @> jsonb_build_array(jsonb_build_object('id',c.project_id::text))
        and not exists (select 1 from app.assistant_wechat_events e where e.channel_id=c.id and e.event_key='report:'||d.report_id||':'||d.revision||':'||c.project_id)
      union all
      select c.enterprise_id,c.id as channel_id,
        'report-role:'||role_key.role_delivery_key as event_key,
        role_key.role_delivery_key,
        r.kind as report_kind,d.report_id as report_id,d.revision as report_revision,c.recipient_version,true as proactive,d.delivered_at as queued_at
      from app.assistant_wechat_channels c
      join app.assistant_main_publications a on a.enterprise_id=c.enterprise_id and a.enabled and a.reports
      join app.construction_followup_bindings b on b.enterprise_id=c.enterprise_id and b.principal_key=c.recipient_key
        and b.audience=c.recipient_audience and b.status='enabled'
        and ((c.recipient_audience='customer' and c.recipient_binding_id is null and b.project_id is not null)
          or (c.recipient_audience in ('worker','designer','boss') and b.id=c.recipient_binding_id and b.project_id is null))
      join app.construction_report_deliveries d on d.enterprise_id=b.enterprise_id and d.binding_id=b.id and d.state='delivered'
      join app.construction_reports r on r.enterprise_id=d.enterprise_id and r.id=d.report_id and r.binding_id=b.id and r.latest_revision=d.revision
      join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=r.id and v.revision=d.revision
      cross join lateral (select concat(c.recipient_key,':',c.recipient_audience,':',case when c.recipient_audience='customer' then b.project_id::text else 'all' end,
        ':',r.kind,':',to_char(r.period_start at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),':',to_char(r.period_end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) as role_delivery_key) role_key
      where c.enterprise_id=${enterprise} and c.stage_id='main' and c.status='connected' and c.verified_at is not null and c.latest_context is not null
        and c.recipient_audience is not null
        and ((r.kind='daily' and c.daily_since is not null and r.scheduled_at>=c.daily_since and d.delivered_at>=c.daily_since)
          or (r.kind='weekly' and c.weekly_since is not null and r.scheduled_at>=c.weekly_since and d.delivered_at>=c.weekly_since))
        and (c.recipient_audience<>'customer' or v.facts->'projects' @> jsonb_build_array(jsonb_build_object('id',b.project_id::text)))
        and not exists (select 1 from app.assistant_wechat_events e
          where e.enterprise_id=c.enterprise_id and e.role_delivery_key=role_key.role_delivery_key)
    ) candidate
    order by candidate.queued_at,candidate.report_id,candidate.channel_id limit 16
    on conflict do nothing`);
}
