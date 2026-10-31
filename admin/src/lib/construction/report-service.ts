import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { constructionAccess } from './service';
import { object, type ConstructionActor } from './contracts';
import { readStageSettings } from './stages-store';
import { nextReportAt, reportTime } from './report-calendar';
import { enqueueReport } from './report-store';

const asDate = (v: unknown) => new Date(String(v));
/** Domain operations only. No new settings UI, customer message or model path
 * is enabled by this foundation. Existing construction management gates apply. */
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
  configure(input: Row, requestKey: string, now = new Date()) {
    object(input, ['expectedVersion','enabled','dailyTime','weeklyTime','projectIds','stageKeys']); key(requestKey);
    if (!Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0 || typeof input.enabled !== 'boolean'
      || !Array.isArray(input.projectIds) || input.projectIds.length > 20 || !Array.isArray(input.stageKeys) || input.stageKeys.length > 30) fail('invalid_construction', 422);
    const daily = reportTime(input.dailyTime), weekly = reportTime(input.weeklyTime), projects = input.projectIds.map(id), stages = input.stageKeys;
    if (new Set(projects).size !== projects.length || new Set(stages).size !== stages.length) fail('invalid_construction', 422);
    return this.manager(async tx => {
      const eid = this.actor.enterpriseId, actor: ActorContext = { enterpriseId: eid, principal: { kind: 'admin', adminId: this.actor.adminId }, contextVersion: 0, capabilities: [] };
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`report-config:${eid}:${requestKey}`},0))`);
      return idempotent(tx, actor, 'construction:report-settings', requestKey, input, async () => {
        const old = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} for update`);
        if (Number(old?.version || 0) !== input.expectedVersion) fail('version_conflict');
        const validStages = (await readStageSettings(tx, eid)).stages.map(s => s.key);
        if (stages.some(s => typeof s !== 'string' || !validStages.includes(s))) fail('invalid_construction', 422);
        for (const pid of projects) if (!await one(tx, sql`select id from app.construction_projects where enterprise_id=${eid} and id=${pid} for share`)) fail('construction_not_found', 404);
        const cursor = old?.enabled ? String(old.stage_cursor) : String((await one(tx, sql`select coalesce(max(id),0) id from app.domain_event_outbox
          where enterprise_id=${eid} and type='construction.stage.updated.v1'`))!.id);
        const nextDaily = old?.enabled && old.daily_time === daily ? asDate(old.next_daily_at) : nextReportAt('daily', now, daily);
        const nextWeekly = old?.enabled && old.weekly_time === weekly ? asDate(old.next_weekly_at) : nextReportAt('weekly', now, weekly);
        return (await one(tx, sql`insert into app.construction_report_settings(enterprise_id,enabled,daily_time,weekly_time,project_ids,stage_keys,next_daily_at,next_weekly_at,stage_cursor)
          values(${eid},${input.enabled},${daily},${weekly},${JSON.stringify(projects)}::jsonb,${JSON.stringify(stages)}::jsonb,${nextDaily},${nextWeekly},${cursor})
          on conflict(enterprise_id) do update set enabled=excluded.enabled,daily_time=excluded.daily_time,weekly_time=excluded.weekly_time,
            project_ids=excluded.project_ids,stage_keys=excluded.stage_keys,next_daily_at=excluded.next_daily_at,next_weekly_at=excluded.next_weekly_at,
            stage_cursor=excluded.stage_cursor,version=construction_report_settings.version+1,updated_at=now() returning *`))!;
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
      return idempotent(tx, actor, 'construction:report-correct:' + reportId, requestKey, { expectedRevision }, async () => {
        const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for share`);
        const report = await one(tx, sql`select * from app.construction_reports where enterprise_id=${eid} and id=${reportId} for update`);
        if (!settings || !report) fail('construction_not_found', 404);
        if (Number(report.latest_revision) !== expectedRevision) fail('version_conflict');
        const old = await one(tx, sql`select v.status,r.status as run_status,r.policy_snapshot from app.construction_report_versions v
          join app.assistant_runs r on r.enterprise_id=v.enterprise_id and r.id=v.run_id
          where v.enterprise_id=${eid} and v.report_id=${reportId} and v.revision=${expectedRevision}`);
        if (!old || old.run_status !== 'succeeded') fail('context_changed');
        const b = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(report.binding_id)} for update`))!;
        const start = asDate(report.period_start), originalEnd = asDate(report.period_end);
        const end = report.kind === 'daily' ? new Date(Math.max(originalEnd.getTime(), Math.min(now.getTime(), start.getTime() + 86400000))) : originalEnd;
        const updated = { ...report, latest_revision: expectedRevision + 1 };
        const result = await enqueueReport(tx, eid, b, { ...settings, ...((old.policy_snapshot as Row).scope as Row) }, {
          kind: report.kind as 'daily' | 'weekly' | 'stage', start, end, cutoff: new Date(Math.max(end.getTime(), now.getTime())),
          scheduledAt: asDate(report.scheduled_at), ...(report.stage_event_id ? { stageEventId: String(report.stage_event_id) } : {}),
        }, updated);
        if (!result) fail('context_changed');
        await tx.execute(sql`update app.construction_reports set latest_revision=${expectedRevision + 1} where enterprise_id=${eid} and id=${reportId}`);
        return result;
      });
    });
  }
}
