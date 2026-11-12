import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { object, text } from './contracts';
import { stageKey, type ConstructionStage } from './stages';

const publishedType = 'construction.schedule.published.v1';
export type ProgressColor = 'green' | 'yellow' | 'red' | 'gray';
export type ScheduleNodeInput = { key: string; stageKey: string; roomId: string | null; plannedStart: string; plannedEnd: string };
export type ScheduleNode = ScheduleNodeInput & {
  stageName: string; roomName: string; color: ProgressColor; label: string; reason: string;
  plannedStartAt: string; plannedEndAt: string;
  actual: { completedAt: string; recordId: string; recordVersion: number; mediaCount: number; basis: 'record' | 'stage' } | null;
};
export type ScheduleGap = { kind: string; label: string; nodeKey?: string; roomName?: string; stageName?: string };
export type ScheduleRead = {
  available: boolean; version: number; title: string; note: string; publisherId: string; publishedAt: string;
  nodes: ScheduleNode[]; counts: Record<ProgressColor, number>;
  overall: { color: ProgressColor; label: string }; gaps: ScheduleGap[]; valid: boolean; text: string;
};
type PlanPayload = { projectId: string; version: number; title: string; note: string; publisherId: string; nodes: ScheduleNodeInput[] };

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
/** Drivers may hand back timestamptz as Date or as an ISO string; normalise before comparing. */
const time = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const dayStart = (value: string) => new Date(value + 'T00:00:00+08:00');
const dayEnd = (value: string) => new Date(dayStart(value).getTime() + 86400000 - 1);
function dateValue(value: unknown) {
  if (typeof value !== 'string' || !dateOnly.test(value)) fail('invalid_construction', 422);
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) fail('invalid_construction', 422);
  return value;
}
/** Explicit plan nodes only; no inferred rooms, dates or completion from text. */
export function scheduleNodesInput(raw: unknown): ScheduleNodeInput[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) fail('invalid_construction', 422);
  const nodes = raw.map((item, index) => {
    const v = object(item, ['key', 'stageKey', 'roomId', 'plannedStart', 'plannedEnd']);
    const key = v.key === undefined ? `node_${index + 1}` : text(v.key, 64);
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(key)) fail('invalid_construction', 422);
    return { key, stageKey: stageKey(v.stageKey), roomId: v.roomId === null || v.roomId === '' ? null : id(v.roomId),
      plannedStart: dateValue(v.plannedStart), plannedEnd: dateValue(v.plannedEnd) };
  });
  if (new Set(nodes.map(n => n.key)).size !== nodes.length) fail('invalid_construction', 422);
  if (nodes.some(n => dayStart(n.plannedStart).getTime() > dayEnd(n.plannedEnd).getTime())) fail('invalid_construction', 422);
  return nodes;
}
export async function latestScheduleEvent(tx: PostgresTransaction, eid: string, pid: string, asOf?: Date) {
  return one(tx, sql`select id,aggregate_version,payload,created_at,actor_ref from app.domain_event_outbox
    where enterprise_id=${eid} and type=${publishedType} and aggregate_type='construction_project' and aggregate_id=${pid}
    ${asOf ? sql`and created_at<${asOf}` : sql``} order by aggregate_version desc limit 1`);
}
function completionRecord(record: Row | undefined) {
  if (!record) return null;
  const data = record.data as Row;
  if (!String(data?.completed || '').trim() || String(data?.pending || '').trim() || String(data?.coordination || '').trim()) return null;
  return record;
}
/**
 * A deterministic projection over the latest published plan and the actual
 * stage/record evidence. It never treats inactivity as normal, a single room
 * as whole-project completion, or an unconfirmed record as quality acceptance.
 */
export async function readSchedule(tx: PostgresTransaction, eid: string, pid: string, project?: Row, stagesArg?: ConstructionStage[], asOf?: Date): Promise<ScheduleRead> {
  const p = project || await one(tx, sql`select * from app.construction_projects where enterprise_id=${eid} and id=${pid} for share`);
  const settings = stagesArg ? { stages: stagesArg } : await one(tx, sql`select stages from app.construction_stage_settings where enterprise_id=${eid}`);
  const stages = ((settings?.stages || []) as ConstructionStage[]);
  const event = await latestScheduleEvent(tx, eid, pid, asOf);
  const now = asOf || new Date();
  const empty = (gaps: ScheduleGap[]): ScheduleRead => ({ available: false, version: 0, title: '', note: '', publisherId: '', publishedAt: '',
    nodes: [], counts: { green: 0, yellow: 0, red: 0, gray: 0 }, overall: { color: 'gray', label: '尚未排期' }, gaps, valid: false,
    text: '本项目还没有有效的施工进度计划版本；未排期不能视为正常，也不能据此推断完成。' + (gaps.length ? '\n资料缺口：' + gaps.map(g => g.label).join('；') : '') });
  if (!event) return empty([{ kind: 'no_schedule', label: '尚未发布施工进度计划' }]);
  const plan = event.payload as PlanPayload;
  const rooms = await rows(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} order by id`);
  const audits = await rows(tx, sql`select snapshot,created_at from app.construction_audits where enterprise_id=${eid} and project_id=${pid}
    and action='progress' order by created_at,id`);
  const publishedAt = time(event.created_at);
  const records = await rows(tx, sql`select room_id,id::text,version,data,published_at,
    (select count(*)::int from app.construction_site_attachments a where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id) as media_count
    from app.construction_site_records r where enterprise_id=${eid} and project_id=${pid} and status='published' and room_id is not null
    and published_at is not null and published_at>=${publishedAt} order by published_at desc,id desc limit 600`);
  const stageIndex = (key: string | null) => key ? stages.findIndex(s => s.key === key) : -1;
  const currentIndex = stageIndex(p?.current_stage_key ? String(p.current_stage_key) : null);
  // A room record only evidences the stage that was actually current when it was
  // published; otherwise one room update would silently close every stage of it.
  const stageAt = (at: Date) => {
    let index = -1;
    for (const audit of audits) {
      if (time(audit.created_at).getTime() > at.getTime()) break;
      const moved = stageIndex(String((audit.snapshot as Row)?.stageKey || ''));
      if (moved >= 0) index = moved;
    }
    return index;
  };
  const gaps: ScheduleGap[] = [];
  const nodes = plan.nodes.map(node => {
    const index = stageIndex(node.stageKey), stage = stages[index], room = node.roomId ? rooms.find(r => r.id === node.roomId) : null;
    const plannedStartAt = dayStart(node.plannedStart), plannedEndAt = dayEnd(node.plannedEnd);
    let color: ProgressColor = 'gray', label = '待核实', reason = '', actual: ScheduleNode['actual'] = null;
    if (!stage) {
      reason = '计划引用的施工节点已调整，需重新核对计划。';
      gaps.push({ kind: 'stage_unavailable', label: `${node.stageKey} 节点已调整，计划项待重新核对`, nodeKey: node.key });
    } else if (node.roomId && !room) {
      reason = '计划引用的房间已不存在，需重新核对计划。';
      gaps.push({ kind: 'room_unavailable', label: `${node.roomId} 房间已调整，计划项待重新核对`, nodeKey: node.key });
    } else {
      let completedAt: Date | null = null;
      let hasEvidence = false;
      if (node.roomId) {
        // Only a record for this room published while this stage was current
        // counts as evidence; another room's completion never closes this node.
        const stageRecords = records.filter(r => String(r.room_id) === node.roomId && stageAt(time(r.published_at)) === index);
        hasEvidence = stageRecords.length > 0;
        const record = completionRecord(stageRecords[0]);
        if (record) {
          completedAt = time(record.published_at);
          actual = { completedAt: completedAt.toISOString(), recordId: String(record.id), recordVersion: Number(record.version), mediaCount: Number(record.media_count || 0), basis: 'record' };
        }
      } else if (currentIndex >= index) {
        hasEvidence = true;
        if (currentIndex > index) {
          const moved = audits.find(a => stageIndex(String((a.snapshot as Row)?.stageKey || '')) > index);
          if (moved) {
            completedAt = time(moved.created_at);
            actual = { completedAt: completedAt.toISOString(), recordId: '', recordVersion: 0, mediaCount: 0, basis: 'stage' };
          } else {
            reason = '实际节点已推进，但缺少可核对的推进时间记录，需要核实。';
            gaps.push({ kind: 'stage_time_missing', label: `${stage.name}已推进但缺时间证据`, nodeKey: node.key });
          }
        }
      }
      if (completedAt) {
        if (completedAt.getTime() < dayStart(node.plannedEnd).getTime()) { color = 'green'; label = '提前完成'; reason = `已按现场证据完成，早于计划结束（${node.plannedEnd}）。`; }
        else if (completedAt.getTime() <= plannedEndAt.getTime()) { color = 'yellow'; label = '按期完成'; reason = `已按现场证据在计划结束日（${node.plannedEnd}）完成。`; }
        else { color = 'red'; label = '超期完成'; reason = `现场证据晚于计划结束（${node.plannedEnd}），需核对原因。`; }
      } else if (now.getTime() > plannedEndAt.getTime()) {
        color = 'red'; label = '已落后'; reason = `计划 ${node.plannedEnd} 完成，当前仍无有效完成证据。`;
      } else if (now.getTime() < plannedStartAt.getTime()) {
        color = 'yellow'; label = '待开始'; reason = `计划 ${node.plannedStart} 开始，当前未到开始日期。`;
      } else if (hasEvidence) {
        color = 'yellow'; label = '进行中'; reason = `处于计划工期内（${node.plannedStart} 至 ${node.plannedEnd}），已有现场进展但尚未完成。`;
      } else {
        // Absence of a record is not evidence of normal progress.
        color = 'gray'; label = '待核实'; reason = `处于计划工期内（${node.plannedStart} 至 ${node.plannedEnd}），但没有可核对的实际记录，不能判定为正常。`;
        gaps.push({ kind: 'node_no_evidence', label: `${node.roomId ? String(room?.name || '') + ' · ' : ''}${stage.name}计划期内尚无现场记录，不能判定正常`, nodeKey: node.key });
      }
    }
    return { ...node, stageName: String(stage?.name || node.stageKey), roomName: String(room?.name || ''), color, label, reason,
      plannedStartAt: plannedStartAt.toISOString(), plannedEndAt: plannedEndAt.toISOString(), actual };
  });
  if (!plan.nodes.some(n => n.stageKey === p?.current_stage_key)) gaps.push({ kind: 'current_stage_unscheduled', label: `当前阶段${stages[currentIndex]?.name || '未设置'}尚未排期` });
  const lastMove = audits.length ? time(audits[audits.length - 1].created_at) : null;
  const hasCurrentRecord = lastMove ? await one(tx, sql`select id from app.construction_site_records where enterprise_id=${eid} and project_id=${pid}
    and status='published' and published_at>=${lastMove} limit 1`) : await one(tx, sql`select id from app.construction_site_records
    where enterprise_id=${eid} and project_id=${pid} and status='published' limit 1`);
  if (!hasCurrentRecord) gaps.push({ kind: 'current_stage_no_record', label: `当前阶段${stages[currentIndex]?.name || ''}还没有已发布的现场记录` });
  const counts: Record<ProgressColor, number> = { green: 0, yellow: 0, red: 0, gray: 0 };
  for (const node of nodes) counts[node.color]++;
  const overall = counts.red ? { color: 'red' as const, label: '存在落后项' }
    : counts.gray ? { color: 'gray' as const, label: '存在待核实项' }
    : counts.yellow ? { color: 'yellow' as const, label: '按计划进行' }
    : nodes.length ? { color: 'green' as const, label: '全部提前完成' } : { color: 'gray' as const, label: '尚未排期' };
  const lines = [`施工计划V${plan.version}：${overall.label}（提前${counts.green} / 正常${counts.yellow} / 落后${counts.red} / 待核实${counts.gray}）。`];
  for (const node of nodes) lines.push(`${node.roomName ? node.roomName + ' · ' : ''}${node.stageName}：${node.label}。${node.reason}`);
  if (gaps.length) lines.push('资料缺口（不计为施工质量问题，也不代表验收合格）：' + gaps.map(g => g.label).join('；'));
  lines.push('计划颜色来自最近有效计划版本和实际现场证据；单个房间完成不等于整个项目完成，计划、施工和问题状态分别核对。');
  return { available: true, version: Number(event.aggregate_version), title: plan.title, note: plan.note,
    publisherId: plan.publisherId, publishedAt: time(event.created_at).toISOString(), nodes, counts, overall, gaps,
    valid: !gaps.some(g => ['stage_unavailable', 'room_unavailable'].includes(g.kind)), text: lines.join('\n') };
}
export async function publishSchedule(tx: PostgresTransaction, actor: ActorContext, pid: string, input: Row) {
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, title = text(input.title ?? '施工进度计划', 80);
  const note = text(input.note ?? '', 500, false), nodes = scheduleNodesInput(input.nodes);
  const settings = await one(tx, sql`select stages from app.construction_stage_settings where enterprise_id=${eid}`);
  const stages = (settings?.stages || []) as ConstructionStage[], keys = new Set(stages.map(s => s.key));
  if (nodes.some(n => !keys.has(n.stageKey))) fail('construction_stage_unavailable', 422);
  const rooms = await rows(tx, sql`select id::text from app.construction_rooms where enterprise_id=${eid} and project_id=${pid}`);
  if (nodes.some(n => n.roomId && !rooms.some(r => r.id === n.roomId))) fail('construction_not_found', 404);
  const previous = await latestScheduleEvent(tx, eid, pid), expected = Number(input.expectedVersion ?? 0);
  if (!Number.isSafeInteger(expected) || expected < 0 || expected !== Number(previous?.aggregate_version || 0)) fail('version_conflict');
  const version = Number(previous?.aggregate_version || 0) + 1;
  const payload: PlanPayload = { projectId: pid, version, title, note, publisherId: actor.principal.adminId, nodes };
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${publishedType},'construction_project',${pid},${version},${JSON.stringify(actor.principal)}::jsonb,${pid},${JSON.stringify(payload)}::jsonb) returning id`))!;
  return { id: pid, version, scheduleId: String(event.id), scope: 'schedule' };
}
