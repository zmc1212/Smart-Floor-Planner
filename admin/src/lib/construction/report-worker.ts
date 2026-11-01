import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { completeLocalReport, failRun, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { latestReportPeriod, nextReportAt } from './report-calendar';
import { discoverFollowups, enqueueReport } from './report-store';
import { dailySupplementCandidates, supplementClosedDailyReports } from './report-supplements';
import { collectReportFacts, deliveryActor, followupAvailable, followupProjects, projectReportFacts, reportFactsHash, type ReportFacts } from './report-scope';

/** One latest due daily and weekly period per tick, not an unbounded outage replay.
 * Time changes affect future ticks; each queued run retains its original scope. */
export async function advanceConstructionReports(now = new Date(), onlyEnterprise?: string) {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select s.enterprise_id from app.construction_report_settings s
    join app.enterprises e on e.id=s.enterprise_id and e.status='active'
    join app.assistant_enterprise_settings a on a.enterprise_id=s.enterprise_id and a.enabled
    where s.enabled ${onlyEnterprise ? sql`and s.enterprise_id=${onlyEnterprise}` : sql``}
    and (s.next_daily_at<=${now} or s.next_weekly_at<=${now} or exists(select 1 from app.domain_event_outbox ev
      where ev.enterprise_id=s.enterprise_id and ev.type='construction.stage.updated.v1' and ev.id>s.stage_cursor and ev.created_at<=${now})
      or exists(select 1 ${dailySupplementCandidates(sql`s.enterprise_id`, now)}))
    order by s.enterprise_id limit 20`));
  let queued = 0;
  const errors: Array<{ enterpriseId: string; code: string }> = [];
  for (const candidate of candidates) {
    const eid = String(candidate.enterprise_id);
    try {
      queued += await withTenantTransaction(eid, async tx => {
        if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for update skip locked`)) return 0;
        const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for update skip locked`);
        if (!settings) return 0;
        const bindings = await discoverFollowups(tx, eid, settings);
        let n = 0;
        for (const kind of ['daily','weekly'] as const) {
          const due = settings[kind === 'daily' ? 'next_daily_at' : 'next_weekly_at'];
          if (new Date(String(due)) > now) continue;
          const time = String(settings[kind === 'daily' ? 'daily_time' : 'weekly_time']);
          const period = latestReportPeriod(kind, now, time, Number(settings.weekly_day || 1));
          for (const b of bindings) if (await enqueueReport(tx, eid, b, settings, period)) n++;
          const field = kind === 'daily' ? sql`next_daily_at` : sql`next_weekly_at`;
          await tx.execute(sql`update app.construction_report_settings set ${field}=${nextReportAt(kind, now, time, Number(settings.weekly_day || 1))} where enterprise_id=${eid}`);
        }
        n += await supplementClosedDailyReports(tx, eid, settings, now);
        const events = await rows(tx, sql`select e.* from app.domain_event_outbox e
          where e.enterprise_id=${eid} and e.type='construction.stage.updated.v1' and e.id>${String(settings.stage_cursor)}
          and e.created_at<=${now} order by e.id limit 50`);
        for (const event of events) {
          if (settings.stage_enabled === false) continue;
          const project = await one(tx, sql`select id from app.construction_projects where enterprise_id=${eid} and id=${String(event.aggregate_id)}
            and status='active' and progress_revision=${Number(event.aggregate_version)} for share`);
          if (!project) continue;
          const at = new Date(String(event.created_at));
          // PostgreSQL preserves microseconds; JSON/Date retains milliseconds.
          // Include the source event's whole millisecond instead of excluding it.
          const cutoff = new Date(at.getTime() + 1);
          for (const b of bindings) if (await enqueueReport(tx, eid, b, settings, { kind: 'stage', start: at, end: at, cutoff, scheduledAt: at, stageEventId: String(event.id) })) n++;
        }
        await tx.execute(sql`update app.construction_report_settings set stage_cursor=${String(events.at(-1)?.id || settings.stage_cursor)},
          last_error=null,last_tick_at=now() where enterprise_id=${eid}`);
        return n;
      });
    } catch (error) {
      const code = error instanceof AssistantError ? error.code : 'construction_report_unavailable';
      errors.push({ enterpriseId: eid, code });
      await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_report_settings set last_error=${code},last_tick_at=now() where enterprise_id=${eid}`));
    }
  }
  return { queued, errors };
}

export async function processConstructionReport(lease: Lease) {
  try {
    await completeLocalReport(lease, async (tx, run) => {
      const eid = lease.enterpriseId, policy = run.policy_snapshot as Row;
      const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for share`);
      const report = await one(tx, sql`select r.*,v.period_end as fact_period_end,v.cutoff_at as fact_cutoff_at,v.status as version_status
        from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
        where r.enterprise_id=${eid} and r.id=${String(policy.reportId)} and v.revision=${Number(policy.revision)} and v.run_id=${lease.runId} for update of v`);
      if (!settings || !report || report.version_status !== 'queued') fail('context_changed');
      if (Number(settings.dispatch_epoch || 1) !== Number(policy.reportDispatchEpoch || 1)) fail('context_changed');
      const b = await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(report.binding_id)} and status='enabled' for update`);
      if (!b || b.conversation_id !== run.conversation_id) fail('context_changed');
      let stageEvent: Row | undefined;
      if (report.stage_event_id) {
        stageEvent = await one(tx, sql`select e.* from app.domain_event_outbox e join app.construction_projects p
          on p.enterprise_id=e.enterprise_id and p.id::text=e.aggregate_id and p.progress_revision=e.aggregate_version
          where e.enterprise_id=${eid} and e.id=${String(report.stage_event_id)} and e.type='construction.stage.updated.v1' for share of p`);
        if (!stageEvent) fail('context_changed');
      }
      const facts = await collectReportFacts(tx, eid, b, { ...report, stage_event: stageEvent, period_end: report.fact_period_end, cutoff_at: report.fact_cutoff_at }, policy.scope as Row);
      if (!facts.projects.length) fail('context_changed');
      await tx.execute(sql`update app.construction_report_versions set status='facts_ready',facts=${JSON.stringify(facts)}::jsonb,
        facts_hash=${reportFactsHash(facts)},generated_at=now() where enterprise_id=${eid} and report_id=${String(report.id)} and revision=${Number(policy.revision)}`);
      const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${eid},'construction.report.facts_ready.v1','construction_report',${String(report.id)},${Number(policy.revision)},'{"kind":"system"}',${lease.runId},
        ${JSON.stringify({ reportId: String(report.id), revision: Number(policy.revision) })}::jsonb) returning id`))!;
      await tx.execute(sql`insert into app.construction_report_deliveries(enterprise_id,report_id,revision,binding_id,event_id)
        values(${eid},${String(report.id)},${Number(policy.revision)},${String(b.id)},${String(event.id)}) on conflict do nothing`);
    });
  } catch (error) {
    // Completion may already have committed after a lost receipt. The lease
    // check prevents changing its successful result or redispatching a provider.
    await failRun(lease, error instanceof AssistantError ? error.code : 'construction_report_unavailable').catch(() => undefined);
  }
}

export async function deliverConstructionReports(onlyEnterprise?: string) {
  const targets = await withPlatformTransaction(tx => rows(tx, sql`select distinct enterprise_id from app.construction_report_deliveries
    where state in ('pending','held') ${onlyEnterprise ? sql`and enterprise_id=${onlyEnterprise}` : sql``} order by enterprise_id limit 20`));
  let delivered = 0;
  for (const target of targets) delivered += await withTenantTransaction(String(target.enterprise_id), async tx => {
    const eid = String(target.enterprise_id);
    if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for update skip locked`)) return 0;
    const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for share`);
    if (!settings) return 0;
    const pending = await rows(tx, sql`select d.*,r.kind,v.facts,v.generated_at,run.context_revision as generation_context_revision,
      run.conversation_id as generation_conversation_id,run.policy_snapshot from app.construction_report_deliveries d
      join app.construction_reports r on r.enterprise_id=d.enterprise_id and r.id=d.report_id
      join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
      join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
      where d.enterprise_id=${eid} and d.state in ('pending','held') order by d.event_id limit 20 for update of d`);
    let count = 0;
    for (const d of pending) {
      const b = (await one(tx, sql`select * from app.construction_followup_bindings where enterprise_id=${eid} and id=${String(d.binding_id)} for update`))!;
      if (b.conversation_id !== d.generation_conversation_id || Number(settings.dispatch_epoch || 1) !== Number((d.policy_snapshot as Row).reportDispatchEpoch || 1)) {
        await tx.execute(sql`update app.construction_report_deliveries set state='revoked' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      const actor = deliveryActor(eid, b);
      const facts = await followupAvailable(tx, eid, b) ? await projectReportFacts(tx, eid, b, d.facts as ReportFacts, new Date(String(d.generated_at))) : null;
      if (facts) {
        const active = new Set((await followupProjects(tx, eid, b, true, facts.projects.map(p => p.id))).map(p => String(p.id)));
        facts.projects = facts.projects.filter(p => active.has(p.id));
      }
      if (b.status !== 'enabled' || !facts?.projects.length) {
        await tx.execute(sql`update app.construction_report_deliveries set state='revoked' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      await new AssistantRepository(tx, actor).identity();
      const c = await new AssistantRepository(tx, actor).conversation(String(b.conversation_id));
      if (Number(c.context_revision) !== Number(d.generation_context_revision)) {
        await tx.execute(sql`update app.construction_report_deliveries set state='revoked' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      // Reception changes keep report tasks independent of chat cancellation.
      // A report already created when reception explicitly ended stays in
      // history, including work completed later; it is never a catch-up message.
      const endedAt = ((c.entry_snapshot as Row).handoff as Row | undefined)?.endedAt;
      if (endedAt && await one(tx, sql`select id from app.construction_reports where enterprise_id=${eid}
        and id=${String(d.report_id)} and created_at<=${String(endedAt)}::timestamptz`)) {
        await tx.execute(sql`update app.construction_report_deliveries set state='muted' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      // Keep the immutable report and receipt. Re-enabling affects future
      // reception; muted historical results never become an unread backlog.
      if (b['remind_' + String(d.kind)] === false) {
        await tx.execute(sql`update app.construction_report_deliveries set state='muted' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      if (c.mode !== 'ai') {
        await tx.execute(sql`update app.construction_report_deliveries set state='held' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      // Collapse held backlogs to the latest revision/period of each kind.
      const newer = await one(tx, sql`select newer.event_id from app.construction_report_deliveries newer
        join app.construction_reports nr on nr.enterprise_id=newer.enterprise_id and nr.id=newer.report_id
        join app.construction_reports old on old.enterprise_id=${eid} and old.id=${String(d.report_id)}
        where newer.enterprise_id=${eid} and newer.binding_id=${String(b.id)} and newer.state in ('pending','held','delivered')
        and nr.kind=old.kind and newer.event_id>${String(d.event_id)} limit 1`);
      if (d.state === 'held' && newer) {
        await tx.execute(sql`update app.construction_report_deliveries set state='revoked' where enterprise_id=${eid} and event_id=${String(d.event_id)}`);
        continue;
      }
      if (c.status === 'archived') await tx.execute(sql`update app.assistant_conversations set status='open',version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(c.id)}`);
      if (b.list_hidden) await tx.execute(sql`update app.construction_followup_bindings set list_hidden=false,version=version+1,updated_at=now()
        where enterprise_id=${eid} and id=${String(b.id)}`);
      // Store only an opaque report reference, never a cached private title or
      // summary. The read projection resolves current permissions and originals.
      const message = await appendMessage(tx, actor, String(c.id), { author: 'system', eventId: String(d.event_id), purpose: 'construction.report.facts',
        content: { version: 1, blocks: [{ type: 'text', text: `report:${String(d.report_id)}:${Number(d.revision)}` }] } });
      await tx.execute(sql`update app.construction_report_deliveries set state='delivered',message_id=${String(message.id)},delivered_at=now()
        where enterprise_id=${eid} and report_id=${String(d.report_id)} and revision=${Number(d.revision)} and binding_id=${String(b.id)}`);
      count++;
    }
    return count;
  });
  return delivered;
}
