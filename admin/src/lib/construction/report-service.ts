import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { assistantWritesEnabled, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { constructionAccess } from './service';
import { object, type ConstructionActor } from './contracts';
import { readStageSettings } from './stages-store';
import { correctedReportEnd, nextReportAt, reportTime } from './report-calendar';
import { discoverFollowups, enqueueReportCorrection } from './report-store';

const asDate = (v: unknown) => new Date(String(v));
export const reportAudiences = ['customer', 'worker', 'designer', 'boss'] as const;
export function reportPlanDto(row: Row | undefined, enterpriseId: string) {
  return { enterpriseId, version: Number(row?.version || 0), enabled: !!row?.enabled, timezone: 'Asia/Shanghai',
    stageEnabled: row?.stage_enabled !== false, dailyTime: String(row?.daily_time || '20:00'), weeklyTime: String(row?.weekly_time || '08:00'),
    weeklyDay: Number(row?.weekly_day || 1), projectIds: (row?.project_ids || []) as string[], stageKeys: (row?.stage_keys || []) as string[],
    audiences: (row?.audiences || [...reportAudiences]) as string[], inactivePolicy: 'pause_inactive' };
}
/** The shared management gate also rechecks the signed Mini selected identity. */
export class ConstructionReportService {
  constructor(readonly actor: ConstructionActor) {}
  private manager<T>(work: Parameters<typeof withTenantTransaction<T>>[1]) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      if (!await constructionAccess(tx, this.actor)) fail('construction_forbidden', 403);
      await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId} for update`);
      return work(tx);
    });
  }
  settings() {
    return this.manager(async tx => await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${this.actor.enterpriseId}`)
      || { enabled: false, version: 0, timezone: 'Asia/Shanghai', daily_time: '20:00', weekly_time: '08:00', project_ids: [], stage_keys: [] });
  }
  plan(beforeId?: string) {
    if (beforeId) id(beforeId);
    return this.manager(async tx => {
      const eid = this.actor.enterpriseId, row = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid}`);
      const settings = reportPlanDto(row, eid);
      const projects = await rows(tx, sql`select p.id,p.name,p.status,p.current_stage_key from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id where p.enterprise_id=${eid} and l.archived_at is null
        ${beforeId ? sql`and p.id<${beforeId}` : sql``} order by p.id desc limit 31 for share of p,l`);
      const selected = await rows(tx, sql`select p.id,p.name,p.status,p.current_stage_key from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id where p.enterprise_id=${eid} and l.archived_at is null
        and ${JSON.stringify(settings.projectIds)}::jsonb ? p.id::text for share of p,l`);
      const projectDto = (p: Row) => ({ id: String(p.id), name: String(p.name), status: String(p.status), stageKey: p.current_stage_key });
      const enterprise = (await one(tx, sql`select name from app.enterprises where id=${eid}`))!;
      return { settings, enterprise: { id: eid, name: String(enterprise.name) }, projects: projects.slice(0,30).map(projectDto),
        selectedProjects: selected.map(projectDto), nextCursor: projects.length > 30 ? String(projects[29].id) : null };
    });
  }
  configure(input: Row, requestKey: string, now = new Date()) {
    object(input, ['expectedVersion','enabled','dailyTime','weeklyTime','projectIds','stageKeys','stageEnabled','weeklyDay','audiences','inactivePolicy']); key(requestKey);
    if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0 || typeof input.enabled !== 'boolean'
      || !Array.isArray(input.projectIds) || input.projectIds.length > 20 || !Array.isArray(input.stageKeys) || input.stageKeys.length > 30) fail('invalid_construction', 422);
    const daily = reportTime(input.dailyTime), weekly = reportTime(input.weeklyTime), projects = input.projectIds.map(id), stages = input.stageKeys;
    if (new Set(projects).size !== projects.length || new Set(stages).size !== stages.length) fail('invalid_construction', 422);
    if ((input.stageEnabled !== undefined && typeof input.stageEnabled !== 'boolean')
      || (input.weeklyDay !== undefined && (!Number.isInteger(input.weeklyDay) || Number(input.weeklyDay) < 1 || Number(input.weeklyDay) > 7))
      || (input.audiences !== undefined && (!Array.isArray(input.audiences) || !input.audiences.length || input.audiences.length > 4
        || new Set(input.audiences).size !== input.audiences.length || input.audiences.some(a => !reportAudiences.includes(a as typeof reportAudiences[number]))))
      || (input.inactivePolicy !== undefined && input.inactivePolicy !== 'pause_inactive')) fail('invalid_construction', 422);
    return this.manager(async tx => {
      const eid = this.actor.enterpriseId, actor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: this.actor.adminId }, contextVersion: 0, capabilities: [] };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`report-config:${eid}:${requestKey}`},0))`);
      return idempotent(tx, actor, 'construction:report-settings', requestKey, input, async () => {
        const old = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`);
        if (Number(old?.version || 0) !== input.expectedVersion) fail('version_conflict');
        const stageEnabled = input.stageEnabled ?? old?.stage_enabled ?? true, weeklyDay = Number(input.weeklyDay ?? old?.weekly_day ?? 1);
        const audiences = input.audiences ?? old?.audiences ?? [...reportAudiences];
        const dispatchEpoch = Number(old?.dispatch_epoch || 1) + (old?.enabled && !input.enabled ? 1 : 0);
        const validStages = (await readStageSettings(tx, eid)).stages.map(s => s.key);
        if (stages.some(s => typeof s !== 'string' || !validStages.includes(s))) fail('invalid_construction', 422);
        for (const pid of projects) if (!await one(tx, sql`select p.id from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
          where p.enterprise_id=${eid} and p.id=${pid} and l.archived_at is null for share of p,l`)) fail('construction_not_found', 404);
        const cursor = old?.enabled && old.stage_enabled && stageEnabled ? String(old.stage_cursor) : String((await one(tx, sql`select coalesce(max(id),0) id from app.domain_event_outbox
          where enterprise_id=${eid} and type='construction.stage.updated.v1'`))!.id);
        const nextDaily = old?.enabled && old.daily_time === daily ? asDate(old.next_daily_at) : nextReportAt('daily', now, daily);
        const nextWeekly = old?.enabled && old.weekly_time === weekly && Number(old.weekly_day || 1) === weeklyDay ? asDate(old.next_weekly_at) : nextReportAt('weekly', now, weekly, weeklyDay);
        const saved = (await one(tx, sql`insert into app.construction_report_settings(enterprise_id,enabled,daily_time,weekly_time,project_ids,stage_keys,next_daily_at,next_weekly_at,stage_cursor,stage_enabled,weekly_day,audiences,inactive_policy,dispatch_epoch)
          values(${eid},${input.enabled},${daily},${weekly},${JSON.stringify(projects)}::jsonb,${JSON.stringify(stages)}::jsonb,${nextDaily},${nextWeekly},${cursor},${stageEnabled},${weeklyDay},${JSON.stringify(audiences)}::jsonb,'pause_inactive',${dispatchEpoch})
          on conflict(enterprise_id) do update set enabled=excluded.enabled,daily_time=excluded.daily_time,weekly_time=excluded.weekly_time,
            project_ids=excluded.project_ids,stage_keys=excluded.stage_keys,next_daily_at=excluded.next_daily_at,next_weekly_at=excluded.next_weekly_at,
            stage_cursor=excluded.stage_cursor,stage_enabled=excluded.stage_enabled,weekly_day=excluded.weekly_day,audiences=excluded.audiences,
            inactive_policy=excluded.inactive_policy,dispatch_epoch=excluded.dispatch_epoch,version=construction_report_settings.version+1,updated_at=now() returning *`))!;
        // First valid enablement establishes destinations before any due report
        // or client visit. Reuse discovery's exact scope and lifecycle guards;
        // its failure rolls back policy and bindings together, never half-enables.
        const assistant = await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`);
        if (saved.enabled && assistantWritesEnabled(assistant)) await discoverFollowups(tx, eid, saved);
        return saved;
      });
    });
  }
  /** A correction has its own immutable version, not a replay of the old job.
   * Daily supplements can extend the cutoff to that day's midnight. */
  correct(reportId: string, expectedRevision: number, requestKey: string, now = new Date()) {
    id(reportId); key(requestKey);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('invalid_construction', 422);
    return this.manager(async tx => {
      const eid = this.actor.enterpriseId, actor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: this.actor.adminId }, contextVersion: 0, capabilities: [] };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`report-correct:${eid}:${requestKey}`},0))`);
      const result = await idempotent(tx, actor, 'construction:report-correct:' + reportId, requestKey, { expectedRevision }, async () => {
        const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for share`);
        const report = await one(tx, sql`select * from app.construction_reports where enterprise_id=${eid} and id=${reportId} for update`);
        if (!settings || !report) fail('construction_not_found', 404);
        if (Number(report.latest_revision) !== expectedRevision) fail('version_conflict');
        const old = await one(tx, sql`select v.period_end from app.construction_report_versions v
          where v.enterprise_id=${eid} and v.report_id=${reportId} and v.revision=${expectedRevision}`);
        if (!old) fail('context_changed');
        const end = correctedReportEnd(String(report.kind), asDate(report.period_start), asDate(old.period_end), now);
        const result = await enqueueReportCorrection(tx, eid, report, settings, end);
        if (!result) fail('context_changed');
        return result;
      });
      const destination = await one(tx, sql`select b.conversation_id from app.construction_reports r
        join app.construction_followup_bindings b on b.enterprise_id=r.enterprise_id and b.id=r.binding_id
        where r.enterprise_id=${eid} and r.id=${reportId}`);
      if (!destination || String(destination.conversation_id) !== result.conversationId) fail('context_changed');
      return result;
    });
  }
}
