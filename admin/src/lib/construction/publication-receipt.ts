import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { accessibleRecord, followupAvailable, projectReportFacts, reportAudienceEnabled, type ReportFacts } from './report-scope';
import { reportPlanProjects } from './report-store';
import { publishedSiteNote } from './site-contract';

export async function latestPublishedProgress(tx: PostgresTransaction, eid: string, pid: string, uid: string) {
  const candidates = await rows(tx, sql`select id::text from app.construction_site_records
    where enterprise_id=${eid} and project_id=${pid} and status='published' and audience='customer' and published_customer_id=${uid}
    order by published_at desc,id desc limit 10`);
  for (const { id } of candidates) {
    const source = await accessibleRecord(tx, eid, { audience: 'customer', user_id: uid }, pid, String(id));
    if (!source) continue;
    const data = source.row.data as Row;
    const note = typeof data.note === 'string' ? publishedSiteNote(data.note) : '';
    const text = [data.completed, note, data.pending, data.coordination]
      .find(value => typeof value === 'string' && value.trim()) as string | undefined;
    if (text) return { recordId: String(id), version: Number(source.row.published_version), text: text.trim(),
      mediaId: source.media[0] ? String(source.media[0].id) : null,
      publishedAt: new Date(String(source.row.published_at)).toISOString() };
  }
  return null;
}

export async function sitePublicationReceipt(tx: PostgresTransaction, eid: string, project: Row, record: Row) {
  if (record.status !== 'published' || record.audience !== 'customer') return null;
  const pid = String(project.id), rid = String(record.id), uid = String(record.published_customer_id);
  const version = Number(record.published_version);
  if (!await accessibleRecord(tx, eid, { audience: 'customer', user_id: uid }, pid, rid)) {
    return { ownerReadable: false, daily: 'not_enabled', weekly: 'not_enabled' };
  }
  const latest = await latestPublishedProgress(tx, eid, pid, uid);
  const settings = await one(tx, sql`select s.* from app.construction_report_settings s
    join app.assistant_enterprise_settings a on a.enterprise_id=s.enterprise_id and a.enabled
    where s.enterprise_id=${eid} and s.enabled`);
  const planned = settings && reportAudienceEnabled(settings, { audience: 'customer' })
    ? await reportPlanProjects(tx, eid, settings) : [];
  const binding = await one(tx, sql`select * from app.construction_followup_bindings
    where enterprise_id=${eid} and project_id=${pid} and audience='customer' and user_id=${uid} order by id desc limit 1`);
  const bindingReadable = binding && binding.status !== 'deleted' && !binding.list_hidden && await followupAvailable(tx, eid, binding);
  const enabled = planned.length <= 20 && planned.some(item => String(item.id) === pid)
    && (!binding || (bindingReadable && binding.status === 'enabled'));
  const reports = binding && bindingReadable ? await rows(tx, sql`
    select distinct on (r.kind) r.kind,v.facts,v.generated_at from app.construction_reports r
    join app.construction_report_deliveries d on d.enterprise_id=r.enterprise_id and d.report_id=r.id and d.binding_id=r.binding_id
    join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
    join app.assistant_runs a on a.enterprise_id=v.enterprise_id and a.id=v.run_id and a.conversation_id=${String(binding.conversation_id)}
    where r.enterprise_id=${eid} and r.binding_id=${String(binding.id)} and r.kind in ('daily','weekly')
      and d.revision=r.latest_revision and d.state in ('delivered','muted') and v.status='facts_ready'
      and (
        v.facts @> ${JSON.stringify({ projects: [{ id: pid, records: [{ id: rid, version }] }] })}::jsonb
        or v.facts @> ${JSON.stringify({ projects: [{ id: pid, publishedRecordItems: [{ recordId: rid, recordVersion: version }] }] })}::jsonb
      ) order by r.kind,r.period_start desc,r.id desc`) : [];
  const generated = new Set<string>();
  if (binding) for (const report of reports) {
    const projected = await projectReportFacts(tx, eid, binding, report.facts as ReportFacts, new Date(String(report.generated_at)));
    if (projected.projects.some(item => item.id === pid)) generated.add(String(report.kind));
  }
  const ownerReadable = (latest?.recordId === rid && latest.version === version) || generated.size > 0;
  const status = (kind: 'daily' | 'weekly') => generated.has(kind) ? 'generated' : enabled ? 'pending' : 'not_enabled';
  return { ownerReadable, daily: status('daily'), weekly: status('weekly') };
}
