import { sql } from 'drizzle-orm';
import { MAX_NATIVE_WORKFLOW_SCHEDULE_ENTERPRISES, nativeWorkflowEnterpriseIds } from '@/lib/native-workflow/live/tenant-allowlist';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { completeLocalReport, failRun, type Lease } from '@/lib/assistant/infrastructure/job-queue';
import { resolvePilotScope, tenantPilotScopeRead, type PilotScopeResolution,
  type PilotScopeResolutionStatus } from '@/lib/xiaok-v1/pilot-scope-resolver';
import { readWeeklyReportConfig, type WeeklyReportMode } from '@/lib/xiaok-v1/weekly-report-config';
import { validatePilotReportDelivery } from '@/lib/xiaok-v1/pilot-report-scope';
import { latestReportPeriod, nextReportAt } from './report-calendar';
import { discoverFollowups, enqueueReport, pilotScopedReportSettings } from './report-store';
import { dailySupplementCandidates, supplementClosedDailyReports } from './report-supplements';
import { collectReportFacts, deliveryActor, followupAvailable, followupProjects, projectReportFacts, reportFactsHash, type ReportFacts } from './report-scope';
import { enqueueReportBody } from './report-body-store';
import { currentReportStageEvent } from './stage-events';

export type ReportQueuePeriod = {
  kind: 'daily' | 'weekly' | 'stage';
  start: Date; end: Date; cutoff: Date; scheduledAt: Date; stageEventId?: string;
};

/** The existing report reads and writes bound to the tenant transaction. Tests
 * replace them with in-memory fakes; production keeps RLS and tenant scope. */
export type ReportQueueRuntime = {
  discoverBindings: (settings: Row) => Promise<Row[]>;
  enqueue: (binding: Row, settings: Row, period: ReportQueuePeriod) => Promise<unknown>;
  supplementDaily: (settings: Row, now: Date) => Promise<number>;
  stageEvents: (cursor: string, now: Date) => Promise<Row[]>;
  currentStageEvent: (eventId: unknown) => Promise<Row | undefined>;
  advanceNext: (kind: 'daily' | 'weekly', next: Date) => Promise<void>;
  advanceStageCursor: (cursor: string) => Promise<void>;
};

export type ReportQueueResult = { queued: number; scopedProjects: number | null };

/** Queue one enterprise's due reports.
 *
 * Without `pilotProjectIds` the original enterprise report behavior is
 * unchanged. With `pilotProjectIds` a shallow settings copy replaces
 * `project_ids` with the pilot/enterprise intersection; discovery, daily,
 * weekly and stage reports all use that effective scope, while the saved
 * enterprise settings row is never mutated. An empty intersection queues
 * nothing. */
export async function queueDueReports(input: {
  enterpriseId: string;
  now: Date;
  settings: Row;
  nativeWeekly: ReadonlySet<string>;
  pilotProjectIds?: readonly string[];
  runtime: ReportQueueRuntime;
}): Promise<ReportQueueResult> {
  const pilot = input.pilotProjectIds !== undefined;
  const settings = pilot ? pilotScopedReportSettings(input.settings, input.pilotProjectIds!) : input.settings;
  if (!settings) return { queued: 0, scopedProjects: 0 };
  const allowed = pilot ? new Set(settings.project_ids as string[]) : null;
  const bindings = await input.runtime.discoverBindings(settings);
  let n = 0;
  for (const kind of ['daily', 'weekly'] as const) {
    if (kind === 'weekly' && settings.stage_enabled === false && input.nativeWeekly.has(input.enterpriseId)) continue;
    const due = settings[kind === 'daily' ? 'next_daily_at' : 'next_weekly_at'];
    if (new Date(String(due)) > input.now) continue;
    const time = String(settings[kind === 'daily' ? 'daily_time' : 'weekly_time']);
    const period = latestReportPeriod(kind, input.now, time, Number(settings.weekly_day || 1));
    for (const binding of bindings) if (await input.runtime.enqueue(binding, settings, period)) n++;
    await input.runtime.advanceNext(kind, nextReportAt(kind, input.now, time, Number(settings.weekly_day || 1)));
  }
  // A pilot run only controls new reports; it never creates corrections from
  // historical daily reports that may contain out-of-scope projects.
  if (!pilot) n += await input.runtime.supplementDaily(settings, input.now);
  const events = await input.runtime.stageEvents(String(settings.stage_cursor), input.now);
  for (const event of events) {
    if (settings.stage_enabled === false) continue;
    // An out-of-scope stage event may advance the cursor but never creates a report.
    if (allowed && !allowed.has(String(event.aggregate_id))) continue;
    if (!await input.runtime.currentStageEvent(event.id)) continue;
    const at = new Date(String(event.created_at));
    // PostgreSQL preserves microseconds; JSON/Date retains milliseconds.
    // Include the source event's whole millisecond instead of excluding it.
    const cutoff = new Date(at.getTime() + 1);
    for (const binding of bindings) if (await input.runtime.enqueue(binding, settings, {
      kind: 'stage', start: at, end: at, cutoff, scheduledAt: at, stageEventId: String(event.id),
    })) n++;
  }
  await input.runtime.advanceStageCursor(String(events.at(-1)?.id || settings.stage_cursor));
  return { queued: n, scopedProjects: allowed ? allowed.size : null };
}

function reportQueueRuntime(tx: PostgresTransaction, eid: string): ReportQueueRuntime {
  return {
    discoverBindings: settings => discoverFollowups(tx, eid, settings),
    enqueue: (binding, settings, period) => enqueueReport(tx, eid, binding, settings, period),
    supplementDaily: (settings, now) => supplementClosedDailyReports(tx, eid, settings, now),
    stageEvents: (cursor, now) => rows(tx, sql`select e.* from app.domain_event_outbox e
      where e.enterprise_id=${eid} and e.type='construction.stage.updated.v1' and e.id>${cursor}
      and e.created_at<=${now} order by e.id limit 50`),
    currentStageEvent: eventId => currentReportStageEvent(tx, eid, eventId),
    advanceNext: async (kind, next) => {
      const field = kind === 'daily' ? sql`next_daily_at` : sql`next_weekly_at`;
      await tx.execute(sql`update app.construction_report_settings set ${field}=${next} where enterprise_id=${eid}`);
    },
    advanceStageCursor: async cursor => {
      await tx.execute(sql`update app.construction_report_settings set stage_cursor=${cursor} where enterprise_id=${eid}`);
    },
  };
}

export type ConstructionReportAdvance = { queued: number; errors: Array<{ enterpriseId: string; code: string }>;
  scopedProjects?: number };

/** One latest due daily and weekly period per tick, not an unbounded outage replay.
 * Time changes affect future ticks; each queued run retains its original scope.
 * With `pilotProjectIds` only the supported enterprise and the intersection of
 * that pilot scope with the enterprise report filter may queue reports. */
export async function advanceConstructionReports(now = new Date(), onlyEnterprise?: string,
  pilotProjectIds?: readonly string[]): Promise<ConstructionReportAdvance> {
  // A pilot run cannot invent its enterprise or apply one scope to another tenant.
  if (pilotProjectIds !== undefined && !onlyEnterprise) throw new Error('pilot_scope_enterprise_required');
  // An explicit native assignment reserves the weekly slot even while the
  // native scheduler is stopped. Daily and stage processing remain independent.
  const nativeWeekly = new Set(nativeWorkflowEnterpriseIds(process.env.NATIVE_WORKFLOW_SCHEDULE_ENTERPRISE_IDS)
    .slice(0, MAX_NATIVE_WORKFLOW_SCHEDULE_ENTERPRISES));
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`select s.enterprise_id from app.construction_report_settings s
    join app.enterprises e on e.id=s.enterprise_id and e.status='active'
    join app.assistant_enterprise_settings a on a.enterprise_id=s.enterprise_id and a.enabled
    where s.enabled ${onlyEnterprise ? sql`and s.enterprise_id=${onlyEnterprise}` : sql``}
    and (s.next_daily_at<=${now} or (s.next_weekly_at<=${now} and
      (s.stage_enabled or not (${JSON.stringify([...nativeWeekly])}::jsonb ? s.enterprise_id::text))) or exists(select 1 from app.domain_event_outbox ev
      where ev.enterprise_id=s.enterprise_id and ev.type='construction.stage.updated.v1' and ev.id>s.stage_cursor and ev.created_at<=${now})
      or exists(select 1 ${dailySupplementCandidates(sql`s.enterprise_id`, now)}))
    order by s.enterprise_id limit 20`));
  let queued = 0; let scopedProjects: number | undefined;
  const errors: Array<{ enterpriseId: string; code: string }> = [];
  for (const candidate of candidates) {
    const eid = String(candidate.enterprise_id);
    try {
      const result = await withTenantTransaction(eid, async tx => {
        if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for update skip locked`)) return null;
        const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for update skip locked`);
        if (!settings) return null;
        const queuedHere = await queueDueReports({
          enterpriseId: eid, now, settings, nativeWeekly,
          ...(pilotProjectIds === undefined ? {} : { pilotProjectIds }),
          runtime: reportQueueRuntime(tx, eid),
        });
        await tx.execute(sql`update app.construction_report_settings set last_error=null,last_tick_at=now() where enterprise_id=${eid}`);
        return queuedHere;
      });
      if (result) {
        queued += result.queued;
        if (result.scopedProjects !== null) scopedProjects = result.scopedProjects;
      }
    } catch (error) {
      const code = error instanceof AssistantError ? error.code : 'construction_report_unavailable';
      errors.push({ enterpriseId: eid, code });
      await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_report_settings set last_error=${code},last_tick_at=now() where enterprise_id=${eid}`));
    }
  }
  return { queued, errors, ...(scopedProjects === undefined ? {} : { scopedProjects }) };
}

export type ReportAdvanceFn = (now: Date, enterpriseId?: string,
  pilotProjectIds?: readonly string[]) => Promise<ConstructionReportAdvance>;
export type ReportPilotScopeResolver = (enterpriseId: string, pilotId: string,
  now: Date) => Promise<PilotScopeResolution>;

const resolveReportPilotScope: ReportPilotScopeResolver = (enterpriseId, pilotId, now) =>
  withTenantTransaction(enterpriseId, tx => resolvePilotScope({
    enterpriseId, pilotId, context: { read: tenantPilotScopeRead(tx), now },
  }));

export type ConstructionReportChecks = {
  mode: WeeklyReportMode | null;
  pilotId: string | null;
  scopeVersion: number | null;
  scopeStatus: PilotScopeResolutionStatus | 'unavailable' | null;
  scopedProjects: number | null;
  queued: number;
  errors: Array<{ enterpriseId: string; code: string }>;
};

/** Resolve the independent weekly report mode and run exactly that mode.
 *
 * An unset or explicit enterprise mode keeps the existing enterprise reports.
 * A pilot run requires both ids, resolves the latest saved scope, and queues
 * only the pilot/enterprise report intersection. A config error, missing,
 * inactive or unreadable scope queues nothing and never falls back to the
 * enterprise-wide report. */
export async function advanceConfiguredConstructionReports(input: {
  now: Date;
  env?: Record<string, string | undefined>;
  advance?: ReportAdvanceFn;
  resolveScope?: ReportPilotScopeResolver;
}): Promise<ConstructionReportChecks> {
  const config = readWeeklyReportConfig(input.env);
  if (!config.ok) {
    return { mode: config.mode, pilotId: null, scopeVersion: null, scopeStatus: null,
      scopedProjects: 0, queued: 0, errors: [{ enterpriseId: '', code: config.code }] };
  }
  const advance = input.advance ?? advanceConstructionReports;
  if (config.mode === 'enterprise') {
    const result = await advance(input.now, config.enterpriseId ?? undefined);
    return { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
      scopedProjects: null, queued: result.queued, errors: result.errors };
  }
  const enterpriseId = config.enterpriseId;
  let scope: PilotScopeResolution;
  try {
    scope = await (input.resolveScope ?? resolveReportPilotScope)(enterpriseId, config.pilotId, input.now);
  } catch {
    return { mode: 'pilot', pilotId: config.pilotId, scopeVersion: null, scopeStatus: 'unavailable',
      scopedProjects: 0, queued: 0, errors: [{ enterpriseId, code: 'pilot_scope_unavailable' }] };
  }
  if (scope.status !== 'active') {
    return { mode: 'pilot', pilotId: config.pilotId, scopeVersion: scope.scopeVersion, scopeStatus: scope.status,
      scopedProjects: 0, queued: 0, errors: [] };
  }
  const result = await advance(input.now, enterpriseId, scope.projectIds);
  return { mode: 'pilot', pilotId: config.pilotId, scopeVersion: scope.scopeVersion, scopeStatus: 'active',
    scopedProjects: result.scopedProjects ?? 0, queued: result.queued, errors: result.errors };
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
      if (report.kind === 'stage') {
        stageEvent = await currentReportStageEvent(tx, eid, report.stage_event_id, b);
        if (!stageEvent || settings.stage_enabled === false) fail('context_changed');
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
      await enqueueReportBody(tx, eid, String(report.id), Number(policy.revision));
    });
  } catch (error) {
    // Completion may already have committed after a lost receipt. The lease
    // check prevents changing its successful result or redispatching a provider.
    await failRun(lease, error instanceof AssistantError ? error.code : 'construction_report_unavailable').catch(() => undefined);
  }
}

/** The existing delivery reads and writes bound to the tenant transaction. Tests
 * replace them with in-memory fakes; production keeps RLS and tenant scope. */
export type ReportDeliveryRuntime = {
  binding: (delivery: Row) => Promise<Row | undefined>;
  stageEventValid: (delivery: Row, binding: Row) => Promise<boolean>;
  revalidatedFacts: (delivery: Row, binding: Row) => Promise<ReportFacts | null>;
  activeProjects: (binding: Row, projectIds: string[]) => Promise<Set<string>>;
  identity: (binding: Row) => Promise<void>;
  conversation: (binding: Row) => Promise<Row>;
  reportCreatedBefore: (reportId: string, endedAt: string) => Promise<boolean>;
  newerDelivery: (delivery: Row, binding: Row) => Promise<Row | undefined>;
  reopenConversation: (conversationId: string) => Promise<void>;
  unhideBinding: (binding: Row) => Promise<void>;
  append: (binding: Row, delivery: Row, conversationId: string) => Promise<Row>;
  markDelivered: (delivery: Row, binding: Row, messageId: string) => Promise<void>;
  setState: (delivery: Row, state: 'revoked' | 'muted' | 'held') => Promise<void>;
};

function reportProjectIdsFromFacts(facts: unknown): string[] | null {
  if (!facts || typeof facts !== 'object') return null;
  const projects = (facts as { projects?: unknown }).projects;
  if (!Array.isArray(projects) || !projects.length) return null;
  const projectIds: string[] = [];
  for (const project of projects) {
    if (!project || typeof project !== 'object') return null;
    const projectId = (project as { id?: unknown }).id;
    if (typeof projectId !== 'string') return null;
    projectIds.push(projectId);
  }
  return projectIds;
}

/** Deliver one enterprise's pending/held receipts.
 *
 * Without `pilotProjectIds` the original recipient, conversation, stage and
 * idempotency rules are unchanged. With a pilot scope every immutable facts
 * snapshot is checked as a whole before any recipient check: one out-of-scope
 * or unconfirmable project revokes that pending/held delivery. The snapshot,
 * facts hash, report version and history messages are never modified. */
export async function deliverReportBatch(input: {
  enterpriseId: string;
  settings: Row;
  pending: Row[];
  pilotProjectIds?: readonly string[];
  pilotScopeVersion?: number | null;
  runtime: ReportDeliveryRuntime;
}): Promise<number> {
  const pilotProjectIds = input.pilotProjectIds;
  let delivered = 0;
  for (const delivery of input.pending) {
    if (pilotProjectIds !== undefined) {
      const reportProjectIds = reportProjectIdsFromFacts(delivery.facts);
      if (!reportProjectIds) {
        await input.runtime.setState(delivery, 'revoked');
        continue;
      }
      let deliverable = false;
      try {
        deliverable = validatePilotReportDelivery({ pilotProjectIds, reportProjectIds,
          scopeVersion: input.pilotScopeVersion }).deliverable;
      } catch {
        deliverable = false;
      }
      if (!deliverable) {
        await input.runtime.setState(delivery, 'revoked');
        continue;
      }
    }
    const binding = await input.runtime.binding(delivery);
    if (!binding) {
      await input.runtime.setState(delivery, 'revoked');
      continue;
    }
    if (binding.conversation_id !== delivery.generation_conversation_id
      || Number(input.settings.dispatch_epoch || 1) !== Number((delivery.policy_snapshot as Row).reportDispatchEpoch || 1)
      || delivery.kind === 'stage' && (input.settings.stage_enabled === false
        || !await input.runtime.stageEventValid(delivery, binding))) {
      await input.runtime.setState(delivery, 'revoked');
      continue;
    }
    const facts = await input.runtime.revalidatedFacts(delivery, binding);
    if (facts) {
      const active = await input.runtime.activeProjects(binding, facts.projects.map(project => project.id));
      facts.projects = facts.projects.filter(project => active.has(String(project.id)));
    }
    if (binding.status !== 'enabled' || !facts?.projects.length) {
      await input.runtime.setState(delivery, 'revoked');
      continue;
    }
    await input.runtime.identity(binding);
    const conversation = await input.runtime.conversation(binding);
    if (Number(conversation.context_revision) !== Number(delivery.generation_context_revision)) {
      await input.runtime.setState(delivery, 'revoked');
      continue;
    }
    // Reception changes keep report tasks independent of chat cancellation.
    // A report already created when reception explicitly ended stays in
    // history, including work completed later; it is never a catch-up message.
    const endedAt = ((conversation.entry_snapshot as Row).handoff as Row | undefined)?.endedAt;
    if (endedAt && await input.runtime.reportCreatedBefore(String(delivery.report_id), String(endedAt))) {
      await input.runtime.setState(delivery, 'muted');
      continue;
    }
    // Keep the immutable report and receipt. Re-enabling affects future
    // reception; muted historical results never become an unread backlog.
    if (binding['remind_' + String(delivery.kind)] === false) {
      await input.runtime.setState(delivery, 'muted');
      continue;
    }
    if (conversation.mode !== 'ai') {
      await input.runtime.setState(delivery, 'held');
      continue;
    }
    // Collapse period backlogs by kind, but never let a different project's
    // valid stage event supersede this one in a multi-project destination.
    const newer = await input.runtime.newerDelivery(delivery, binding);
    if (delivery.state === 'held' && newer) {
      await input.runtime.setState(delivery, 'revoked');
      continue;
    }
    if (conversation.status === 'archived') {
      await input.runtime.reopenConversation(String(conversation.id));
    }
    if (binding.list_hidden) await input.runtime.unhideBinding(binding);
    // Store only an opaque report reference, never a cached private title or
    // summary. The read projection resolves current permissions and originals.
    const message = await input.runtime.append(binding, delivery, String(conversation.id));
    await input.runtime.markDelivered(delivery, binding, String(message.id));
    delivered++;
  }
  return delivered;
}

function reportDeliveryRuntime(tx: PostgresTransaction, eid: string): ReportDeliveryRuntime {
  return {
    binding: delivery => one(tx, sql`select * from app.construction_followup_bindings
      where enterprise_id=${eid} and id=${String(delivery.binding_id)} for update`),
    stageEventValid: async (delivery, binding) =>
      !!await currentReportStageEvent(tx, eid, delivery.stage_event_id, binding),
    revalidatedFacts: async (delivery, binding) => await followupAvailable(tx, eid, binding)
      ? projectReportFacts(tx, eid, binding, delivery.facts as ReportFacts, new Date(String(delivery.generated_at)))
      : null,
    activeProjects: async (binding, projectIds) => new Set((await followupProjects(tx, eid, binding, true, projectIds))
      .map(project => String(project.id))),
    identity: async binding => { await new AssistantRepository(tx, deliveryActor(eid, binding)).identity(); },
    conversation: binding => new AssistantRepository(tx, deliveryActor(eid, binding))
      .conversation(String(binding.conversation_id)),
    reportCreatedBefore: async (reportId, endedAt) => !!await one(tx, sql`select id from app.construction_reports
      where enterprise_id=${eid} and id=${reportId} and created_at<=${endedAt}::timestamptz`),
    newerDelivery: (delivery, binding) => one(tx, sql`select newer.event_id from app.construction_report_deliveries newer
      join app.construction_reports nr on nr.enterprise_id=newer.enterprise_id and nr.id=newer.report_id
      join app.construction_reports old on old.enterprise_id=${eid} and old.id=${String(delivery.report_id)}
      where newer.enterprise_id=${eid} and newer.binding_id=${String(binding.id)} and newer.state in ('pending','held','delivered')
      and nr.kind=old.kind and (old.kind<>'stage' or nr.stage_event_id=old.stage_event_id)
      and newer.event_id>${String(delivery.event_id)} limit 1`),
    reopenConversation: async conversationId => {
      await tx.execute(sql`update app.assistant_conversations set status='open',version=version+1,updated_at=now()
        where enterprise_id=${eid} and id=${conversationId}`);
    },
    unhideBinding: async binding => {
      await tx.execute(sql`update app.construction_followup_bindings set list_hidden=false,version=version+1,updated_at=now()
        where enterprise_id=${eid} and id=${String(binding.id)}`);
    },
    append: (binding, delivery, conversationId) => appendMessage(tx, deliveryActor(eid, binding), conversationId, {
      author: 'system', eventId: String(delivery.event_id), purpose: 'construction.report.facts',
      content: { version: 1, blocks: [{ type: 'text', text: `report:${String(delivery.report_id)}:${Number(delivery.revision)}` }] },
    }),
    markDelivered: async (delivery, binding, messageId) => {
      await tx.execute(sql`update app.construction_report_deliveries set state='delivered',message_id=${messageId},delivered_at=now()
        where enterprise_id=${eid} and report_id=${String(delivery.report_id)} and revision=${Number(delivery.revision)}
        and binding_id=${String(binding.id)}`);
    },
    setState: async (delivery, state) => {
      await tx.execute(sql`update app.construction_report_deliveries set state=${state}
        where enterprise_id=${eid} and event_id=${String(delivery.event_id)}`);
    },
  };
}

export async function deliverConstructionReports(onlyEnterprise?: string, pilotProjectIds?: readonly string[],
  pilotScopeVersion?: number | null) {
  // A pilot run cannot invent its enterprise or apply one scope to another tenant.
  if (pilotProjectIds !== undefined && !onlyEnterprise) throw new Error('pilot_scope_enterprise_required');
  if (pilotProjectIds !== undefined && !pilotProjectIds.length) return 0;
  const targets = await withPlatformTransaction(tx => rows(tx, sql`select distinct enterprise_id from app.construction_report_deliveries
    where state in ('pending','held') ${onlyEnterprise ? sql`and enterprise_id=${onlyEnterprise}` : sql``} order by enterprise_id limit 20`));
  let delivered = 0;
  for (const target of targets) delivered += await withTenantTransaction(String(target.enterprise_id), async tx => {
    const eid = String(target.enterprise_id);
    if (!await one(tx, sql`select id from app.assistant_enterprise_settings where enterprise_id=${eid} and enabled for update skip locked`)) return 0;
    const settings = await one(tx, sql`select * from app.construction_report_settings where enterprise_id=${eid} and enabled for share`);
    if (!settings) return 0;
    const pending = await rows(tx, sql`select d.*,r.kind,r.stage_event_id,v.facts,v.generated_at,run.context_revision as generation_context_revision,
      run.conversation_id as generation_conversation_id,run.policy_snapshot from app.construction_report_deliveries d
      join app.construction_reports r on r.enterprise_id=d.enterprise_id and r.id=d.report_id
      join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
      join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
      where d.enterprise_id=${eid} and d.state in ('pending','held') order by d.event_id limit 20 for update of d`);
    return deliverReportBatch({
      enterpriseId: eid, settings, pending,
      ...(pilotProjectIds === undefined ? {} : { pilotProjectIds, pilotScopeVersion }),
      runtime: reportDeliveryRuntime(tx, eid),
    });
  });
  return delivered;
}

export type ReportDeliverFn = (enterpriseId?: string, pilotProjectIds?: readonly string[],
  pilotScopeVersion?: number | null) => Promise<number>;

export type ConstructionReportDeliveryChecks = {
  mode: WeeklyReportMode | null;
  pilotId: string | null;
  scopeVersion: number | null;
  scopeStatus: PilotScopeResolutionStatus | 'unavailable' | null;
  scopedProjects: number | null;
  delivered: number;
  errors: Array<{ enterpriseId: string; code: string }>;
};

/** Resolve the independent weekly report mode and deliver exactly that mode.
 *
 * An unset or explicit enterprise mode keeps the existing delivery behavior.
 * A pilot run resolves the latest saved scope before touching pending/held
 * receipts and then revalidates every immutable facts snapshot against it.
 * Missing, inactive, empty or unreadable scope delivers nothing and never falls
 * back to the enterprise-wide delivery. */
export async function deliverConfiguredConstructionReports(input: {
  now: Date;
  env?: Record<string, string | undefined>;
  deliver?: ReportDeliverFn;
  resolveScope?: ReportPilotScopeResolver;
}): Promise<ConstructionReportDeliveryChecks> {
  const config = readWeeklyReportConfig(input.env);
  if (!config.ok) {
    return { mode: config.mode, pilotId: null, scopeVersion: null, scopeStatus: null,
      scopedProjects: 0, delivered: 0, errors: [{ enterpriseId: '', code: config.code }] };
  }
  const deliver = input.deliver ?? deliverConstructionReports;
  if (config.mode === 'enterprise') {
    const delivered = await deliver(config.enterpriseId ?? undefined);
    return { mode: 'enterprise', pilotId: null, scopeVersion: null, scopeStatus: null,
      scopedProjects: null, delivered, errors: [] };
  }
  const enterpriseId = config.enterpriseId;
  let scope: PilotScopeResolution;
  try {
    scope = await (input.resolveScope ?? resolveReportPilotScope)(enterpriseId, config.pilotId, input.now);
  } catch {
    return { mode: 'pilot', pilotId: config.pilotId, scopeVersion: null, scopeStatus: 'unavailable',
      scopedProjects: 0, delivered: 0, errors: [{ enterpriseId, code: 'pilot_scope_unavailable' }] };
  }
  if (scope.status !== 'active') {
    return { mode: 'pilot', pilotId: config.pilotId, scopeVersion: scope.scopeVersion, scopeStatus: scope.status,
      scopedProjects: 0, delivered: 0, errors: [] };
  }
  const delivered = await deliver(enterpriseId, scope.projectIds, scope.scopeVersion);
  return { mode: 'pilot', pilotId: config.pilotId, scopeVersion: scope.scopeVersion, scopeStatus: 'active',
    scopedProjects: scope.projectIds.length, delivered, errors: [] };
}
