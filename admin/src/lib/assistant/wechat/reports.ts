import { sql } from 'drizzle-orm';
import { one } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { FollowupService } from '@/lib/construction/followup-service';
import { mainRelease } from '@/lib/xiaok-v1/main-publication';
import { AssistantError, fail } from '../contracts';
import { checkRecipient, savedRecipient } from './recipient';
import type { ChannelRow } from './channels';

export type Period = 'daily' | 'weekly';
export type ReportEvent = { report_kind: Period | null; report_id: string | null; report_revision: number | null;
  recipient_version: number | null; proactive: boolean };

export async function selectReport(tx: PostgresTransaction, channel: ChannelRow, kind: Period, runId: string) {
  const recipient = savedRecipient(channel);
  if (!recipient) return '请先在小程序的工地日报与周报页关联本人微信。';
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

export async function reportText(tx: PostgresTransaction, c: ChannelRow, event: ReportEvent) {
  const recipient = savedRecipient(c);
  if (!recipient || !event.report_id || !event.report_revision || !event.report_kind) return null;
  const since = event.report_kind === 'daily' ? c.daily_since : c.weekly_since;
  if (event.proactive ? !since : c.recipient_version !== event.recipient_version) return null;
  const app = await mainRelease(tx, c.enterprise_id);
  if (!app?.enabled || !app.reports) return null;
  try {
    const binding = await checkRecipient(tx, recipient);
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
    return [project.name+' · '+name+'（'+period+'）', project.stageName ? '本期阶段：' + project.stageName : '',
      ...(progress.length ? progress : records.length ? records : ['本期暂无可展示的已发布进展记录。']).slice(0,3),
      '完整报告可在小程序「工地日报与周报」查看。'].filter(Boolean).join('\n').slice(0,1600);
  } catch (error) {
    if (error instanceof AssistantError && [401,403,404,409].includes(error.status)) return null;
    throw error;
  }
}

export async function queueWechatReports(tx: PostgresTransaction, enterprise: string) {
  await tx.execute(sql`insert into app.assistant_wechat_events
    (enterprise_id,channel_id,event_key,report_kind,report_id,report_revision,recipient_version,proactive)
    select c.enterprise_id,c.id,'report:'||d.report_id||':'||d.revision||':'||c.project_id,r.kind,d.report_id,d.revision,c.recipient_version,true
    from app.assistant_wechat_channels c join app.assistant_main_publications a on a.enterprise_id=c.enterprise_id and a.enabled and a.reports
    join app.construction_report_deliveries d on d.enterprise_id=c.enterprise_id and d.binding_id=c.recipient_binding_id and d.state='delivered'
    join app.construction_reports r on r.enterprise_id=d.enterprise_id and r.id=d.report_id and r.latest_revision=d.revision
    join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=r.id and v.revision=d.revision
    where c.enterprise_id=${enterprise} and c.stage_id='main' and c.status='connected' and c.verified_at is not null and c.latest_context is not null
      and (r.kind='daily' and d.delivered_at>=c.daily_since or r.kind='weekly' and d.delivered_at>=c.weekly_since)
      and v.facts->'projects' @> jsonb_build_array(jsonb_build_object('id',c.project_id::text))
      and not exists (select 1 from app.assistant_wechat_events e where e.channel_id=c.id and e.event_key='report:'||d.report_id||':'||d.revision||':'||c.project_id)
    order by d.delivered_at,d.report_id,c.id limit 16 on conflict (channel_id,event_key) do nothing`);
}
