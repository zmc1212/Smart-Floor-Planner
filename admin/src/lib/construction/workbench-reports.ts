import { sql } from 'drizzle-orm';
import { one, rows } from '@/db/repositories/assistant-repository';
import type { PostgresTransaction } from '@/db/transaction';
import { fail } from '@/lib/assistant/contracts';
import type { ConstructionActor } from './contracts';
import { inspectionModeSql } from './inspection-policy';

export type ReportRange = { from: string; to: string };

export type WorkerReportItem = {
  recordId: string;
  clientMessageId: string;
  title: string;
  at: string;
  status: string;
  statusLabel: string;
  stages: { key: string; name: string }[];
  photoCount: number;
  photoId: string | null;
  hasVoice: boolean;
  approvedByName: string;
  approvedAt: string | null;
  returnedByName: string;
  returnedAt: string | null;
  returnReason: string;
  resubmittedRecordId: string | null;
};

const day = 86400000;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export function parseReportRange(from?: string | null, to?: string | null, now = new Date()): ReportRange {
  const today = shanghaiToday(now);
  const value = from || to ? { from, to } : { from: today, to: today };
  if (!value.from || !value.to || !isoDay.test(value.from) || !isoDay.test(value.to)) fail('invalid_construction', 422);
  const start = Date.parse(value.from + 'T00:00:00Z'), end = Date.parse(value.to + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || end - start > 92 * day) fail('invalid_construction', 422);
  return { from: value.from, to: value.to };
}

export function reportStatus(status: string) {
  if (status === 'published') return { code: 'approved', label: '审核通过' };
  if (status === 'changes_requested') return { code: 'returned', label: '需补充' };
  if (status === 'withdrawn') return { code: 'withdrawn', label: '已撤回' };
  return { code: 'pending', label: '待审核' };
}

export function reportTitle(title: unknown, photoCount: number, hasVoice: boolean) {
  const value = String(title || '').trim();
  if (value) return value;
  if (photoCount > 0) return `现场照片 · ${photoCount}张`;
  return hasVoice ? '语音上报' : '现场上报';
}

function stages(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === 'object' && typeof (item as { key?: unknown }).key === 'string'
    && typeof (item as { name?: unknown }).name === 'string')
    .map(item => ({ key: String((item as { key: string }).key), name: String((item as { name: string }).name) }));
}

async function workerReports(tx: PostgresTransaction, actor: ConstructionActor, projectId: string, range?: ReportRange) {
  const data = await rows<{
    recordId: string; clientMessageId: string; status: string; title: string | null; sourceAt: Date;
    stages: unknown; photoCount: string | number; photoId: string | null; hasVoice: boolean;
    approvedByName: string | null; publishedAt: Date | null; returnedByName: string | null; returnedAt: Date | null;
    returnReason: string | null; resubmittedRecordId: string | null;
  }>(tx, sql`select r.id::text as "recordId",m.client_message_id as "clientMessageId",r.status,r.data->>'title' as title,
    m.created_at as "sourceAt",r.stage_snapshot as stages,
    (select count(*) from app.construction_site_attachments x join app.construction_site_media mm
      on mm.enterprise_id=x.enterprise_id and mm.project_id=x.project_id and mm.id=x.media_id
      where x.enterprise_id=r.enterprise_id and x.project_id=r.project_id and x.record_id=r.id and mm.deleted_at is null) as "photoCount",
    (select x.media_id::text from app.construction_site_attachments x join app.construction_site_media mm
      on mm.enterprise_id=x.enterprise_id and mm.project_id=x.project_id and mm.id=x.media_id
      where x.enterprise_id=r.enterprise_id and x.project_id=r.project_id and x.record_id=r.id and mm.deleted_at is null
      order by x.position limit 1) as "photoId",
    exists(select 1 from app.assistant_speech_assets s where s.enterprise_id=r.enterprise_id and s.conversation_id=r.conversation_id
      and s.message_id=r.source_message_id and s.deleted_at is null) as "hasVoice",
    ap.display_name as "approvedByName",r.published_at as "publishedAt",
    rb.display_name as "returnedByName",r.returned_at as "returnedAt",r.review_requirements as "returnReason",
    (select child.id::text from app.construction_site_records child where child.enterprise_id=r.enterprise_id
      and child.project_id=r.project_id and child.author_id=r.author_id and child.resubmission_of_id=r.id limit 1) as "resubmittedRecordId"
    from app.construction_site_records r join app.assistant_messages m
      on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.source_message_id
    left join app.admin_users ap on ap.enterprise_id=r.enterprise_id and ap.id=r.approved_by
    left join app.admin_users rb on rb.enterprise_id=r.enterprise_id and rb.id=r.returned_by
    where r.enterprise_id=${actor.enterpriseId} and r.project_id=${projectId} and r.author_id=${actor.adminId}
      ${range ? sql`and (m.created_at at time zone 'Asia/Shanghai')::date between ${range.from}::date and ${range.to}::date`
        : sql`and r.status='changes_requested' and not exists(select 1 from app.construction_site_records child
          where child.enterprise_id=r.enterprise_id and child.project_id=r.project_id
            and child.author_id=r.author_id and child.resubmission_of_id=r.id)`}
    order by ${range ? sql`m.created_at` : sql`coalesce(r.returned_at,m.created_at)`} desc,r.id desc limit ${range ? 100 : 1}`);
  return data.map(row => {
    const photoCount = Number(row.photoCount || 0);
    const status = reportStatus(String(row.status));
    return {
      recordId: String(row.recordId),
      clientMessageId: String(row.clientMessageId || ''),
      title: reportTitle(row.title, photoCount, Boolean(row.hasVoice)),
      at: new Date(row.sourceAt).toISOString(),
      status: status.code,
      statusLabel: status.label,
      stages: stages(row.stages),
      photoCount,
      photoId: row.photoId ? String(row.photoId) : null,
      hasVoice: Boolean(row.hasVoice),
      approvedByName: String(row.approvedByName || ''),
      approvedAt: row.publishedAt ? new Date(row.publishedAt).toISOString() : null,
      returnedByName: String(row.returnedByName || ''),
      returnedAt: row.returnedAt ? new Date(row.returnedAt).toISOString() : null,
      returnReason: String(row.returnReason || ''),
      resubmittedRecordId: row.resubmittedRecordId,
    };
  });
}

export function workerReportHistory(tx: PostgresTransaction, actor: ConstructionActor, projectId: string, range: ReportRange) {
  return workerReports(tx, actor, projectId, range);
}

export async function latestWorkerReturn(tx: PostgresTransaction, actor: ConstructionActor, projectId: string) {
  return (await workerReports(tx, actor, projectId))[0] || null;
}

export async function workerTodaySummary(tx: PostgresTransaction, actor: ConstructionActor, projectId: string) {
  const summary = await one<{ total: string; pending: string; approved: string; returned: string }>(tx, sql`
    select count(*) as total,
      count(*) filter (where r.status in ('organizing','draft')) as pending,
      count(*) filter (where r.status='published') as approved,
      count(*) filter (where r.status='changes_requested') as returned
    from app.construction_site_records r join app.assistant_messages m
      on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.source_message_id
    where r.enterprise_id=${actor.enterpriseId} and r.project_id=${projectId} and r.author_id=${actor.adminId}
      and (m.created_at at time zone 'Asia/Shanghai')::date=(now() at time zone 'Asia/Shanghai')::date`);
  return {
    total: Number(summary?.total || 0),
    pending: Number(summary?.pending || 0),
    approved: Number(summary?.approved || 0),
    returned: Number(summary?.returned || 0),
  };
}

export async function latestPendingReport(tx: PostgresTransaction, enterpriseId: string, projectId?: string,
  { routineOnly = false }: { routineOnly?: boolean } = {}) {
  const report = await one<{
    recordId: string; projectId: string; projectName: string; title: string | null; authorName: string;
    sourceAt: Date; photoCount: string | number; hasVoice: boolean; stageSnapshot: unknown;
  }>(tx, sql`select r.id::text as "recordId",p.id::text as "projectId",p.name as "projectName",r.data->>'title' as title,
    a.display_name as "authorName",m.created_at as "sourceAt",r.stage_snapshot as "stageSnapshot",
    (select count(*) from app.construction_site_attachments x join app.construction_site_media mm
      on mm.enterprise_id=x.enterprise_id and mm.project_id=x.project_id and mm.id=x.media_id
      where x.enterprise_id=r.enterprise_id and x.project_id=r.project_id and x.record_id=r.id and mm.deleted_at is null) as "photoCount",
    exists(select 1 from app.assistant_speech_assets s where s.enterprise_id=r.enterprise_id and s.conversation_id=r.conversation_id
      and s.message_id=r.source_message_id and s.deleted_at is null) as "hasVoice"
    from app.construction_site_records r join app.construction_projects p
      on p.enterprise_id=r.enterprise_id and p.id=r.project_id
    join app.assistant_messages m on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.source_message_id
    join app.admin_users a on a.enterprise_id=r.enterprise_id and a.id=r.author_id
    where r.enterprise_id=${enterpriseId} and r.status='draft' and p.status<>'archived'
      ${projectId ? sql`and r.project_id=${projectId}` : sql``}
      ${routineOnly ? sql`and r.resubmission_of_id is null and (${inspectionModeSql}) not in ('required','onsite')` : sql``}
    order by m.created_at desc,r.id desc limit 1`);
  if (!report) return null;
  const photoCount = Number(report.photoCount || 0);
  return {
    recordId: String(report.recordId),
    projectId: String(report.projectId),
    projectName: String(report.projectName),
    title: reportTitle(report.title, photoCount, Boolean(report.hasVoice)),
    authorName: String(report.authorName || ''),
    at: new Date(report.sourceAt).toISOString(),
    photoCount,
    hasVoice: Boolean(report.hasVoice),
    stageNames: stages(report.stageSnapshot).map(stage => stage.name),
  };
}
