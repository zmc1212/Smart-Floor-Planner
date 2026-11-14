import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { delegationConsumer } from '@/lib/native-workflow/live/delegation-state';
import { object, text } from './contracts';
import { defaultConstructionStages, stageKey, type ConstructionStage } from './stages';
import { collaborationMember } from './collaboration-scope';
import { siteAccessRevoked } from './site-access';
import { aggregatePlanStatus, classifyPlanTiming } from '@/lib/xiaok-v1/progress-status';

const publishedType = 'construction.schedule.published.v1';
type Color = 'green' | 'yellow' | 'red' | 'gray';
type WorkStatus = 'unknown' | 'in_progress' | 'completed';
type Node = { key: string; stageKey: string; roomId: string | null; plannedStart: string; plannedEnd: string };
type Completion = { nodeKey: string; scheduleId: string; scheduleVersion: number; stageKey: string; roomId: string };
type Schedule = { title: string; note: string; publisherId?: string; completionPolicy?: 'explicit'; nodes: Node[] };
type ScheduleGap = { kind: string; label: string; nodeKey?: string };
type Evidence = { kind: 'record' | 'stage'; eventId: string; version: number; at: string;
  recordId?: string; scheduleId?: string; scheduleVersion?: number };
type ScheduleNode = Node & { roomName: string; stageName: string; constructionStatus: WorkStatus;
  color: Color; label: string; reason: string; evidence: Evidence | null;
  actual: { completedAt: string; recordId: string; recordVersion: number; mediaCount: number; basis: 'record' | 'stage' } | null };

const time = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const dayStart = (day: string) => Date.parse(day + 'T00:00:00+08:00');
function dateInput(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('invalid_construction', 422);
  const parsed = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 10) !== value) fail('invalid_construction', 422);
  return value;
}

export function scheduleNodesInput(raw: unknown): Node[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > 50) fail('invalid_construction', 422);
  const nodes = raw.map((item, index) => {
    const node = object(item, ['key', 'stageKey', 'roomId', 'plannedStart', 'plannedEnd']);
    const plannedStart = dateInput(node.plannedStart), plannedEnd = dateInput(node.plannedEnd);
    if (plannedStart > plannedEnd) fail('invalid_construction', 422);
    return { key: node.key === undefined ? `node_${index + 1}` : stageKey(node.key), stageKey: stageKey(node.stageKey), roomId: node.roomId === null || node.roomId === '' ? null : id(node.roomId), plannedStart, plannedEnd };
  });
  if (new Set(nodes.map(node => node.key)).size !== nodes.length) fail('invalid_construction', 422);
  return nodes;
}

export function latestScheduleEvent(tx: PostgresTransaction, eid: string, pid: string) {
  return one(tx, sql`select id::text,aggregate_version,payload,created_at from app.domain_event_outbox
    where enterprise_id=${eid} and type=${publishedType} and aggregate_type='construction_project' and aggregate_id=${pid}
    order by aggregate_version desc limit 1`);
}

/** Kept as the construction-facing adapter. The single I7.1 rule lives in
 * `classifyPlanTiming` so project, boss and weekly views cannot diverge. */
export function scheduleColor(node: Pick<Node, 'plannedStart' | 'plannedEnd'>, now: Date, observed: boolean, completedAt?: string) {
  return classifyPlanTiming({ ...node, now, observed, completedAt });
}

const stageOf = (audit: Row) => String((audit.snapshot as Row)?.stageKey || '');
function stageAt(audits: Row[], date: unknown) {
  return audits.findLast(audit => +time(audit.created_at) <= +time(date));
}
function completionFor(record: Row, node: Node) {
  const source = record.completion as Completion | null;
  return source?.nodeKey === node.key && source.stageKey === node.stageKey && source.roomId === node.roomId ? source : null;
}

/** Same calculation for all readers. The audience only controls provenance and internal notes. */
export async function readSchedule(tx: PostgresTransaction, eid: string, project: Row, stages: ConstructionStage[],
  options: { now?: Date; customerId?: string; family?: boolean } = {}) {
  const pid = String(project.id), now = options.now || new Date(), event = await latestScheduleEvent(tx, eid, pid);
  const currentStage = String(project.current_stage_key || ''), counts: Record<Color, number> = { green: 0, yellow: 0, red: 0, gray: 0 };
  const plan = event?.payload as Schedule | undefined, nodes: ScheduleNode[] = [], gaps: ScheduleGap[] = [];
  const explicit = !!plan && (plan.completionPolicy === 'explicit' || !plan.publisherId);
  const stageName = stages.find(stage => stage.key === currentStage)?.name || '';
  const construction = { stageKey: currentStage || null, stageName, revision: Number(project.progress_revision || 0) };
  if (plan && event) {
    const rooms = await rows(tx, sql`select id::text,name from app.construction_rooms where enterprise_id=${eid} and project_id=${pid}`);
    const audits = await rows(tx, sql`select id::text,snapshot,created_at from app.construction_audits where enterprise_id=${eid}
      and project_id=${pid} and action='progress' order by created_at,id`);
    const records = await rows(tx, sql`select r.id::text,r.version,r.room_id::text,r.created_at,r.published_at,r.published_customer_id,
        r.approved_by::text, r.data, e.id::text as event_id,e.payload->'scheduleCompletion' as completion,
        (select count(*) from app.construction_site_attachments a where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id and a.record_id=r.id) as media_count
      from app.construction_site_records r
      join app.construction_rooms room on room.enterprise_id=r.enterprise_id and room.project_id=r.project_id and room.id=r.room_id
        and room.name=r.room_name_snapshot
      join app.domain_event_outbox e on e.enterprise_id=r.enterprise_id and e.type='construction.record.publish.v1'
        and e.aggregate_type='construction_site_record' and e.aggregate_id=r.id::text and e.aggregate_version=r.version
      where r.enterprise_id=${eid} and r.project_id=${pid} and r.status='published' and r.published_at<=${now}
        and not exists(select 1 from app.construction_site_attachments a join app.construction_site_media m on m.enterprise_id=a.enterprise_id
          and m.project_id=a.project_id and m.id=a.media_id where a.enterprise_id=r.enterprise_id and a.project_id=r.project_id
          and a.record_id=r.id and m.deleted_at is not null)
      order by r.published_at desc,r.id desc`);
    for (const node of plan.nodes) {
      const stage = stages.find(candidate => candidate.key === node.stageKey);
      const room = node.roomId && rooms.find(candidate => candidate.id === node.roomId);
      const valid = !!stage && (!node.roomId || !!room);
      let evidence: Evidence | null = null, observed = false, completed = false;
      if (!stage) gaps.push({ kind: 'stage_unavailable', label: '计划阶段已不可用：' + node.stageKey, nodeKey: node.key });
      if (node.roomId && !room) gaps.push({ kind: 'room_unavailable', label: '计划引用的房间已不可用。', nodeKey: node.key });
      if (valid && node.roomId) {
        const matches = records.filter(record => record.room_id === node.roomId
          && stageOf(stageAt(audits, explicit ? record.created_at : record.published_at) || {}) === node.stageKey
          && (explicit || +time(record.published_at) >= +time(event.created_at)));
        const latest = matches[0];
        let completedRecord: Row | undefined;
        for (const match of matches) {
          if (completionFor(match, node) && await collaborationMember(tx, eid, pid, String(match.approved_by)) === 'manager'
            && !await siteAccessRevoked(tx, eid, pid, [String(match.approved_by)], match.published_at as Date, { managers: [String(match.approved_by)] })) {
            completedRecord = match;
            break;
          }
        }
        if (!explicit && !completedRecord && latest) {
          const data = latest.data as Row;
          if (String(data?.completed || '').trim() && !String(data?.pending || '').trim() && !String(data?.coordination || '').trim()
            && !await siteAccessRevoked(tx, eid, pid, [String(latest.approved_by)], latest.published_at as Date)) completedRecord = latest;
        }
        const source = completedRecord || latest;
        completed = !!completedRecord;
        observed = !!source;
        if (source && !options.family && (!options.customerId || String(source.published_customer_id) === options.customerId)) {
          const anchor = completionFor(source, node);
          evidence = { kind: 'record', eventId: String(source.event_id), recordId: String(source.id), version: Number(source.version),
            at: time(source.created_at).toISOString(), ...(completed && anchor ? { scheduleId: anchor.scheduleId, scheduleVersion: anchor.scheduleVersion } : {}) };
        }
        const completedAt = completedRecord && time(explicit ? completedRecord.created_at : completedRecord.published_at).toISOString();
        const timing = scheduleColor(node, now, observed, completedAt);
        if (timing.color === 'gray' && +now >= dayStart(node.plannedStart))
          gaps.push({ kind: 'node_no_evidence', label: String(room && room.name) + ' · ' + stage!.name + '尚无可核对的实际记录。', nodeKey: node.key });
        const actual = completedAt && completedRecord && (!options.customerId && !options.family || !!evidence)
          ? { completedAt, recordId: String(completedRecord.id), recordVersion: Number(completedRecord.version),
            mediaCount: Number(completedRecord.media_count), basis: 'record' as const } : null;
        nodes.push({ ...node, stageName: stage!.name, roomName: room ? String(room.name) : '', constructionStatus: completed ? 'completed' : observed ? 'in_progress' : 'unknown', ...timing, evidence, actual });
        continue;
      }
      let end: Row | undefined;
      if (valid) {
        const visible = audits.filter(audit => +time(audit.created_at) <= +now);
        const last = visible.findLastIndex(audit => stageOf(audit) === node.stageKey);
        const following = visible[last + 1];
        observed = currentStage === node.stageKey || last >= 0;
        // A skipped stage and a rollback do not prove completion.
        if (last >= 0 && following && stages.findIndex(s => s.key === stageOf(following)) > stages.indexOf(stage!) &&
          stages.findIndex(s => s.key === currentStage) > stages.indexOf(stage!)) {
          end = following; completed = true;
          if (!options.family && !options.customerId) evidence = { kind: 'stage', eventId: String(end.id),
            version: Number((end.snapshot as Row)?.progressRevision || 0), at: time(end.created_at).toISOString() };
        }
      }
      const timing = valid ? !explicit && !end && +now < dayStart(node.plannedStart)
        ? { color: 'yellow' as const, label: '待开始', reason: '尚未到计划开始日。' }
        : scheduleColor(node, now, observed, end && time(end.created_at).toISOString())
        : { color: 'gray' as const, label: '待核实', reason: '计划引用的房间或施工节点已变化。' };
      if (valid && timing.color === 'gray' && +now >= dayStart(node.plannedStart))
        gaps.push({ kind: 'node_no_evidence', label: stage!.name + '尚无可核对的实际记录。', nodeKey: node.key });
      const actual = end && !options.family && !options.customerId
        ? { completedAt: time(end.created_at).toISOString(), recordId: '', recordVersion: 0, mediaCount: 0, basis: 'stage' as const } : null;
      nodes.push({ ...node, stageName: stage?.name || node.stageKey, roomName: room ? String(room.name) : '',
        constructionStatus: completed ? 'completed' : observed ? 'in_progress' : 'unknown', ...timing, evidence, actual });
    }
  }
  for (const node of nodes) counts[node.color]++;
  const currentStageScheduled = nodes.some(node => node.stageKey === currentStage);
  const aggregate = aggregatePlanStatus(nodes);
  const overall = !currentStageScheduled && nodes.length
    ? { color: 'gray' as const, label: '待核实' } : aggregate;
  const version = Number(event?.aggregate_version || 0);
  if (!event) gaps.push({ kind: 'schedule_missing', label: '尚未发布施工进度计划。' });
  else if (!currentStageScheduled) gaps.push({ kind: 'current_stage_unscheduled', label: '当前施工节点未排期。' });
  const summary = version ? `施工计划V${version} · ${overall.label}（提前${counts.green}、正常${counts.yellow}、落后${counts.red}、待核实${counts.gray}）` : '本项目尚未发布施工进度计划，未排期不能视为正常。';
  const display = [summary, ...nodes.map(node => `${node.roomName ? node.roomName + ' · ' : ''}${node.stageName}：${node.label}。${node.reason}`)];
  if (gaps.length) display.push('资料缺口：' + gaps.map(gap => gap.label).join('；'));
  display.push('单个房间完成不等于整个项目完成。');
  return { available: !!event, scheduleId: event?.id ? String(event.id) : null, version, ...(!options.family ? { title: plan?.title || '' } : {}),
    ...(!options.customerId && !options.family ? { note: plan?.note || '' } : {}), construction,
    nodes, counts, overall, gaps, valid: !!event && !gaps.some(g => g.kind === 'stage_unavailable' || g.kind === 'room_unavailable'), summary, text: display.join('\n') };
}

export async function publishSchedule(tx: PostgresTransaction, actor: ActorContext, project: Row, stages: ConstructionStage[], input: Row, explicit = true) {
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, pid = String(project.id), aid = actor.principal.adminId;
  if (explicit && await collaborationMember(tx, eid, pid, aid) !== 'manager') fail('construction_forbidden', 403);
  if (project.status !== 'active') fail('construction_project_inactive');
  const nodes = scheduleNodesInput(input.nodes), title = text(input.title ?? '施工进度计划', 80), note = text(input.note ?? '', 500, false);
  const roomIds = new Set((await rows(tx, sql`select id::text from app.construction_rooms where enterprise_id=${eid} and project_id=${pid}`)).map(room => room.id));
  if (nodes.some(node => !stages.some(stage => stage.key === node.stageKey) || node.roomId && !roomIds.has(node.roomId))) fail('invalid_construction', 422);
  const previous = await latestScheduleEvent(tx, eid, pid), expectedVersion = input.expectedVersion ?? 0;
  if (!Number.isSafeInteger(expectedVersion) || Number(expectedVersion) < 0) fail('invalid_construction', 422);
  if (expectedVersion !== Number(previous?.aggregate_version || 0)) fail('version_conflict');
  const version = Number(expectedVersion) + 1;
  const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},${publishedType},'construction_project',${pid},${version},${JSON.stringify(actor.principal)}::jsonb,${pid},
      ${JSON.stringify({ projectId: pid, version, title, note, publisherId: aid, ...(explicit ? { completionPolicy: 'explicit' } : {}), nodes })}::jsonb) returning id::text`))!;
  await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key)
    select ${eid},${String(event.id)},${delegationConsumer} where exists(select 1 from app.native_workflow_delegations
      where enterprise_id=${eid} and project_id=${pid} and state not in ('completed','failed','cancelled','expired'))
    on conflict do nothing`);
  return { id: pid, scheduleId: String(event.id), version, scope: 'schedule' };
}

/** The record publisher may explicitly verify completion of a dated room node. */
export async function confirmScheduleCompletion(tx: PostgresTransaction, eid: string, project: Row, record: Row, raw: unknown): Promise<Completion> {
  const input = object(raw, ['nodeKey', 'expectedVersion']);
  const nodeKey = stageKey(input.nodeKey), pid = String(project.id), event = await latestScheduleEvent(tx, eid, pid);
  if (!event || Number(event.aggregate_version) !== input.expectedVersion) fail('version_conflict');
  const node = (event.payload as Schedule).nodes.find(candidate => candidate.key === nodeKey);
  const data = record.data as Row;
  if (!node?.roomId || node.roomId !== String(record.room_id) || node.stageKey !== project.current_stage_key
    || !data.completed || data.pending || data.coordination) fail('site_review_required', 422);
  const captureStage = await one(tx, sql`select snapshot from app.construction_audits where enterprise_id=${eid} and project_id=${pid}
    and action='progress' and created_at<=${record.created_at as Date} order by created_at desc,id desc limit 1`);
  if (!captureStage || stageOf(captureStage) !== node.stageKey) fail('site_review_required', 422);
  return { nodeKey, scheduleId: String(event.id), scheduleVersion: Number(event.aggregate_version), stageKey: node.stageKey, roomId: node.roomId };
}

export async function projectSchedule(tx: PostgresTransaction, eid: string, project: Row, options?: Parameters<typeof readSchedule>[4]) {
  const settings = await one(tx, sql`select stages from app.construction_stage_settings where enterprise_id=${eid}`);
  return readSchedule(tx, eid, project, (settings?.stages || defaultConstructionStages) as ConstructionStage[], options);
}
