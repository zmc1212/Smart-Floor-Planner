import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key, principalKey, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { constructionAccess } from './service';
import { bindingForActor, ensureFollowupBinding } from './report-store';
import { followupBindingAvailable, followupProjects, projectReportFacts, type FollowupAudience, type ReportFacts } from './report-scope';
import { readStageSettings } from './stages-store';
import { currentRecord } from './site-issues';
import { reportHistoryFilters, type ReportHistoryFilters } from './report-history';
import { reportBodyView, reportKnowledgeSource } from './report-body-view';
import type { ReportBody } from './report-composition';
import { enqueueReportBody } from './report-body-store';

type ReminderPreferences = { stage: boolean; daily: boolean; weekly: boolean };
const preferences = (b: Row): ReminderPreferences => ({ stage: b.remind_stage !== false, daily: b.remind_daily !== false, weekly: b.remind_weekly !== false });

export class FollowupService {
  constructor(readonly actor: ActorContext) { requireCapability(actor, 'assistant.followup.self'); }
  private scoped<T>(work: (repo: AssistantRepository) => Promise<T>, write = false) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      return work(repo);
    });
  }
  private async destination(repo: AssistantRepository, b: Row, afterProjectId?: string, projectId?: string) {
    const c = await repo.conversation(String(b.conversation_id)), eid = this.actor.enterpriseId;
    const projects = await followupProjects(repo.tx, eid, b, false, [], [], false, afterProjectId), settings = await readStageSettings(repo.tx, eid);
    const selected = projectId ? (await followupProjects(repo.tx, eid, b, false, [projectId]))[0] : undefined;
    if (projectId && !selected) fail('construction_not_found', 404);
    const projectDto = (p: Row) => ({ id: String(p.id), name: String(p.name), stageKey: p.current_stage_key || null,
      stageName: settings.stages.find(s => s.key === p.current_stage_key)?.name || '' });
    const enterprise = (await one(repo.tx, sql`select id::text,name from app.enterprises where id=${eid}`))!;
    return { enterprise, title: b.audience === 'customer' ? String(projects[0]?.name || '我家装修') : b.audience === 'boss' ? '企业工地简报'
      : b.audience === 'designer' ? '我的项目跟进' : '我的施工跟进',
      conversation: { id: String(c.id), mode: String(c.mode), status: String(c.status), version: Number(c.version) },
      stages: settings.stages.map(s => ({ key: s.key, name: s.name })),
      projects: projects.slice(0, 20).map(projectDto), projectsNextCursor: projects.length > 20 ? String(projects[19].id) : null,
      ...(selected ? { selectedProject: projectDto(selected) } : {}),
      projectsTruncated: projects.length > 20 };
  }
  context(bindingId: string, options: { afterProjectId?: string; projectId?: string } = {}) {
    id(bindingId);
    if (options.afterProjectId !== undefined) id(options.afterProjectId);
    if (options.projectId !== undefined) id(options.projectId);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId);
      return { bindingId, conversationId: String(b.conversation_id), audience: String(b.audience), status: String(b.status), version: Number(b.version),
        ...await this.destination(repo, b, options.afterProjectId, options.projectId) };
    });
  }
  private async managementBinding(repo: AssistantRepository, bindingId: string) {
    const b = await bindingForActor(repo.tx, this.actor, bindingId, true);
    if (!await followupBindingAvailable(repo.tx, this.actor.enterpriseId, b)) fail('assistant_resource_not_found', 404);
    return b;
  }
  /** A separate minimal projection; never hydrate a deleted/redacted destination. */
  management(beforeId = '9223372036854775807') {
    id(beforeId);
    return this.scoped(async repo => {
      const a = this.actor, subject = a.principal.kind === 'user' ? a.principal.userId : a.principal.adminId;
      const found = await rows(repo.tx, sql`select b.*,c.entry_snapshot from app.construction_followup_bindings b
        join app.assistant_conversations c on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id and c.purpose='construction_followup'
        where b.enterprise_id=${a.enterpriseId} and b.principal_key=${principalKey(a)} and b.id<${beforeId}
        and app.assistant_followup_binding_access(${a.principal.kind},${subject}::bigint,b.enterprise_id,b.id)
        order by b.id desc limit 31`);
      const items = [];
      for (const b of found.slice(0, 30)) {
        const p = b.audience === 'customer' ? await followupProjects(repo.tx, a.enterpriseId, b, false, [], [], true) : [];
        items.push({ bindingId: String(b.id), title: b.audience === 'customer' ? String(p[0]?.name || '我家装修')
          : b.audience === 'boss' ? '企业工地简报' : b.audience === 'designer' ? '我的项目跟进' : '我的施工跟进',
        status: String(b.status), version: Number(b.version), hidden: Boolean(b.list_hidden),
        retentionRedacted: (b.entry_snapshot as Row)?.retentionRedacted === true, preferences: preferences(b) });
      }
      return { items, nextCursor: found.length > 30 ? String(found[29].id) : null };
    });
  }
  savePreferences(bindingId: string, value: ReminderPreferences, expectedVersion: number, requestKey: string) {
    id(bindingId); key(requestKey);
    if (!value || Object.keys(value).length !== 3 || !['stage','daily','weekly'].every(k => typeof value[k as keyof ReminderPreferences] === 'boolean')
      || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await this.managementBinding(repo, bindingId);
      const result = await idempotent(repo.tx, this.actor, 'followup:preferences:' + bindingId, requestKey, { expectedVersion, preferences: value }, async () => {
        if (Number(b.version) !== expectedVersion) fail('version_conflict');
        await repo.tx.execute(sql`update app.construction_followup_bindings set remind_stage=${value.stage},remind_daily=${value.daily},remind_weekly=${value.weekly},
          version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${bindingId}`);
        return { bindingId, conversationId: String(b.conversation_id), version: expectedVersion + 1, preferences: value };
      });
      const current = await this.managementBinding(repo, bindingId);
      if (String(current.conversation_id) !== result.conversationId || fingerprint(preferences(current)) !== fingerprint(result.preferences)) fail('context_changed');
      return result;
    }, true);
  }
  /** Explicit self opt-in also supports selected-enterprise admin/super_admin.
   * Automatic discovery never opts platform accounts into every tenant. */
  open(requestKey: string, projectId?: string) {
    key(requestKey); if (projectId) id(projectId);
    return this.scoped(async repo => {
      const a = this.actor, eid = a.enterpriseId;
      await repo.tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`followup-open:${eid}:${principalKey(a)}:${requestKey}`},0))`);
      const result = await idempotent(repo.tx, a, 'followup:open', requestKey, { projectId: projectId || null }, async () => {
        let audience: FollowupAudience = 'customer';
        if (a.principal.kind === 'user') {
          if (!projectId) fail('invalid_construction', 422);
        } else {
          if (projectId) fail('invalid_construction', 422);
          const owner = await constructionAccess(repo.tx, { enterpriseId: eid, adminId: a.principal.adminId,
            miniProgramUserId: a.entry?.miniProgramUserId as string | undefined, miniProgramContextVersion: a.entry?.miniProgramContextVersion as number | undefined });
          const role = owner ? 'enterprise_admin' : (await one(repo.tx, sql`select role from app.admin_users where enterprise_id=${eid} and id=${a.principal.adminId}`))?.role;
          audience = owner ? 'boss' : role === 'designer' ? 'designer' : 'worker';
        }
        const b = await ensureFollowupBinding(repo.tx, eid, { kind: a.principal.kind, id: a.principal.kind === 'user' ? a.principal.userId : a.principal.adminId, audience, projectId });
        return { bindingId: String(b.id), conversationId: String(b.conversation_id), status: b.status, version: Number(b.version) };
      });
      // Reentry with an old idempotency key still revalidates today's authority.
      await repo.conversation(String(result.conversationId));
      return result;
    }, true);
  }
  private async version(repo: AssistantRepository, b: Row, reportId: string, revision?: number) {
    const eid = this.actor.enterpriseId;
    const r = await one(repo.tx, sql`select r.*,v.revision,v.status as fact_status,v.facts,v.facts_hash,v.generated_at,
      v.body,v.body_generated_at,v.knowledge_status,v.body_error_code,v.body_attempts,body_job.provider_started_at as body_dispatched,
      exists(select 1 from app.assistant_usage_records body_usage where body_usage.enterprise_id=v.enterprise_id and body_usage.run_id=v.body_run_id
        and body_usage.category='query_embedding' and body_usage.quantity is null) as body_unknown_io,
      body_run.status as body_run_status,body_run.error_code as body_run_error,
      v.period_end as fact_period_end,v.cutoff_at as fact_cutoff_at,run.status as run_status,run.error_code,d.state as delivery_state,d.read_at,d.message_id,m.seq
      from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
      join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
      left join app.assistant_runs body_run on body_run.enterprise_id=v.enterprise_id and body_run.id=v.body_run_id
      left join app.assistant_jobs body_job on body_job.enterprise_id=body_run.enterprise_id and body_job.run_id=body_run.id
      left join app.construction_report_deliveries d on d.enterprise_id=v.enterprise_id and d.report_id=v.report_id and d.revision=v.revision and d.binding_id=r.binding_id
      left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
      where r.enterprise_id=${eid} and r.binding_id=${String(b.id)} and r.id=${reportId} and v.revision=${revision || sql`r.latest_revision`}
      and run.conversation_id=${String(b.conversation_id)}`);
    if (!r) fail('assistant_resource_not_found', 404);
    const metadata = { reportId: String(r.id), revision: Number(r.revision), kind: String(r.kind), timezone: 'Asia/Shanghai',
      periodStart: r.period_start, periodEnd: r.fact_period_end, cutoffAt: r.fact_cutoff_at, scheduledAt: r.scheduled_at,
      generatedAt: r.generated_at, readAt: r.read_at, deliveryState: r.delivery_state || null, sequence: r.seq ? String(r.seq) : null };
    if (r.fact_status !== 'facts_ready') return { ...metadata, available: true, state: r.run_status, errorCode: r.error_code,
      contentStatus: 'not_generated' as const, facts: null, readToken: null };
    const facts = await projectReportFacts(repo.tx, eid, b, r.facts as ReportFacts, new Date(String(r.generated_at)));
    if (!facts.projects.length) return { reportId, revision: Number(r.revision), available: false, state: 'source_unavailable',
      contentStatus: 'not_generated' as const, facts: null, readToken: null, readAt: null, sequence: null };
    const body = await reportBodyView(repo.tx, this.actor, await repo.conversation(String(b.conversation_id)), facts, r.body as ReportBody | null);
    return { ...metadata, available: true, state: 'facts_ready', contentStatus: body.length ? 'composed' as const : 'facts_only' as const, facts, body,
      bodyGeneratedAt: body.length ? r.body_generated_at : null,
      generationState: r.body ? body.length ? 'ready' : 'source_unavailable' : r.body_run_status || r.knowledge_status,
      generationError: r.body_run_error || r.body_error_code || null,
      generationRetryable: b.status === 'enabled' && !r.body && !r.body_dispatched && !r.body_unknown_io && Number(r.body_attempts) < 3
        && (r.body_run_status === 'failed' || !r.body_run_status && r.knowledge_status === 'failed'),
      generationLabel: r.body ? body.length ? '' : '工艺来源或权限已变化，可先查看有效记录。'
        : ['queued','running'].includes(String(r.body_run_status)) ? '正文生成中，可先查看原记录。'
        : r.body_run_status === 'indeterminate' ? '正文结果正在核对，可先查看原记录。'
        : r.knowledge_status === 'failed' || r.body_run_status === 'failed' ? '正文暂未生成，可先查看原记录。' : '',
      readToken: fingerprint({ subject: principalKey(this.actor), bindingId: String(b.id), reportId, revision: Number(r.revision), factsHash: fingerprint(facts), bodyHash: fingerprint(body) }) };
  }
  list() {
    return this.scoped(async repo => {
      const bindings = await rows(repo.tx, sql`select b.*,c.status as conversation_status from app.construction_followup_bindings b
        join app.assistant_conversations c on c.enterprise_id=b.enterprise_id and c.id=b.conversation_id
        where b.enterprise_id=${this.actor.enterpriseId} and b.principal_key=${principalKey(this.actor)} and b.status<>'deleted'
        and coalesce(c.entry_snapshot->>'retentionRedacted','false')<>'true'
        and app.assistant_followup_conversation_access(${this.actor.principal.kind},
          ${this.actor.principal.kind === 'user' ? this.actor.principal.userId : this.actor.principal.adminId}::bigint,b.enterprise_id,b.conversation_id)
        order by b.id desc limit 30`);
      const items = [];
      for (const b of bindings) {
        const versions = await rows(repo.tx, sql`select d.report_id,d.revision from app.construction_report_deliveries d
          join app.construction_report_versions v on v.enterprise_id=d.enterprise_id and v.report_id=d.report_id and v.revision=d.revision
          join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
          where d.enterprise_id=${this.actor.enterpriseId} and d.binding_id=${String(b.id)} and d.state='delivered'
          and run.conversation_id=${String(b.conversation_id)} order by d.event_id desc limit 51`);
        let unreadReports = 0, unreadMessages = 0, latestReport = null;
        for (const v of versions.slice(0, 50)) {
          const projected = await this.version(repo, b, String(v.report_id), Number(v.revision));
          if (!projected.available) continue;
          if (!latestReport && 'kind' in projected) latestReport = { reportId: projected.reportId, revision: projected.revision,
            kind: projected.kind, generatedAt: projected.generatedAt, contentStatus: projected.contentStatus };
          if (!projected.readAt) unreadReports++;
          if (projected.sequence && BigInt(projected.sequence) > BigInt(String(b.last_read_seq))) unreadMessages++;
        }
        items.push({ ...await this.destination(repo, b), bindingId: String(b.id), conversationId: String(b.conversation_id), audience: b.audience, status: b.status,
          conversationStatus: b.conversation_status, hidden: Boolean(b.list_hidden), version: Number(b.version), unreadReports, unreadMessages, unreadTruncated: versions.length > 50, latestReport });
      }
      return { items, truncated: bindings.length === 30 };
    });
  }
  reports(bindingId: string, beforeId = '9223372036854775807', filters: ReportHistoryFilters = {}) {
    id(bindingId); id(beforeId);
    const filter = reportHistoryFilters(filters);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
      if (filter.projectId && !(await followupProjects(repo.tx, this.actor.enterpriseId, b, false, [filter.projectId])).length)
        fail('construction_not_found', 404);
      const found = await rows(repo.tx, sql`select r.id from app.construction_reports r
        join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
        join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
        where r.enterprise_id=${this.actor.enterpriseId} and r.binding_id=${bindingId} and r.id<${beforeId}
         and ${filter.kind ? sql`r.kind=${filter.kind}` : sql`true`}
         and ${filter.start ? sql`r.period_start>=${filter.start} and r.period_start<${filter.end!}` : sql`true`}
         and ${filter.projectId ? sql`v.facts->'projects' @> ${JSON.stringify([{ id: filter.projectId }])}::jsonb` : sql`true`}
        and run.conversation_id=${String(b.conversation_id)} order by r.id desc limit 20`);
      const items = [];
      for (const r of found) {
        const view = await this.version(repo, b, String(r.id));
        if (filter.projectId && view.available && view.facts) {
          const projects = view.facts.projects.filter(p => p.id === filter.projectId);
          // The index is a filtered view, never a new report or an acknowledgement grant.
          items.push(projects.length ? { ...view, facts: { ...view.facts, projects, projectsTruncated: false },
            ...('body' in view ? { body: view.body.filter(p => p.projectId === filter.projectId) } : {}), readToken: null }
            : { reportId: String(r.id), revision: view.revision, available: false, state: 'source_unavailable', facts: null, readToken: null });
        } else items.push(view);
      }
      return { items, nextCursor: found.length === 20 ? String(found.at(-1)!.id) : null };
    });
  }
  detail(bindingId: string, reportId: string, revision?: number) {
    id(bindingId); id(reportId); if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
      return this.version(repo, b, reportId, revision);
    });
  }
  knowledgeSource(bindingId: string, reportId: string, revision: number, projectId: string, sourceId: string, original = false) {
    [bindingId, reportId, projectId].forEach(id);
    if (!Number.isSafeInteger(revision) || revision < 1 || !/^K[1-9]\d{0,18}$/.test(sourceId)) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId), c = await repo.conversation(String(b.conversation_id));
      const view = await this.version(repo, b, reportId, revision);
      if (!view.available || !('body' in view) || !view.body.some(p => p.projectId === projectId && p.knowledgeSources.some(s => s.sourceId === sourceId)))
        fail('assistant_resource_not_found', 404);
      const v = (await one(repo.tx, sql`select body from app.construction_report_versions
        where enterprise_id=${this.actor.enterpriseId} and report_id=${reportId} and revision=${revision}`))!;
      return reportKnowledgeSource(repo.tx, this.actor, c, v.body as ReportBody, projectId, sourceId, original);
    });
  }
  /** The saved report is a locator, never a new publication or consultation grant. */
  private async original(repo: AssistantRepository, bindingId: string, reportId: string, revision: number, projectId: string, recordId: string) {
    const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
    const view = await this.version(repo, b, reportId, revision);
    if (!view.available || !view.facts) fail('construction_not_found', 404);
    const project = view.facts.projects.find(p => p.id === projectId);
    if (!project || !(project.records.some(r => r.id === recordId) || project.publishedRecordItems?.some(r => r.recordId === recordId))) fail('construction_not_found', 404);
    const original = await currentRecord(repo.tx, this.actor.enterpriseId, projectId, recordId, true);
    if (!original) fail('construction_not_found', 404);
    return original;
  }
  record(bindingId: string, reportId: string, revision: number, projectId: string, recordId: string) {
    [bindingId, reportId, projectId, recordId].forEach(id);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const original = await this.original(repo, bindingId, reportId, revision, projectId, recordId), r = original.row;
      return { id: recordId, projectId, version: Number(r.published_version), room: String(r.room_name_snapshot), data: r.data,
        media: original.media.map(m => ({ id: String(m.id), hash: String(m.source_hash) })) };
    });
  }
  recordMedia(bindingId: string, reportId: string, revision: number, projectId: string, recordId: string, mediaId: string) {
    [bindingId, reportId, projectId, recordId, mediaId].forEach(id);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const original = await this.original(repo, bindingId, reportId, revision, projectId, recordId);
      if (!original.media.some(m => String(m.id) === mediaId)) fail('construction_not_found', 404);
      const m = await one(repo.tx, sql`select data,mime_type from app.construction_site_media where enterprise_id=${this.actor.enterpriseId}
        and project_id=${projectId} and id=${mediaId} and deleted_at is null for share`);
      if (!m) fail('construction_not_found', 404);
      return { data: m.data as Buffer, mime: String(m.mime_type) };
    });
  }
  acknowledge(bindingId: string, reportId: string, revision: number, readToken: string, requestKey: string) {
    id(bindingId); id(reportId); key(requestKey);
    if (!Number.isSafeInteger(revision) || revision < 1 || typeof readToken !== 'string') fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
      const view = await this.version(repo, b, reportId, revision);
      if (!view.available || view.readToken !== readToken || !['delivered','muted'].includes(String(view.deliveryState))) fail('context_changed');
      return idempotent(repo.tx, this.actor, 'followup:read:' + reportId, requestKey, { revision, readToken }, async () => {
        await repo.tx.execute(sql`update app.construction_report_deliveries set read_at=coalesce(read_at,now())
          where enterprise_id=${this.actor.enterpriseId} and report_id=${reportId} and revision=${revision} and binding_id=${bindingId} and state in ('delivered','muted')`);
        return { reportId, revision, read: true };
      });
    });
  }
  seen(bindingId: string, throughSequence: string, requestKey: string, conversationId?: string) {
    id(bindingId); id(throughSequence); key(requestKey); if (conversationId) id(conversationId);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId), c = await repo.conversation(String(b.conversation_id));
      const renewed = Boolean((c.entry_snapshot as Row).followupGeneration);
      // Sequence numbers restart in a fresh conversation. A stale visibility
      // request must not acknowledge a new message with the same sequence.
      if ((renewed && !conversationId) || (conversationId && conversationId !== String(c.id))) fail('context_changed');
      const target = await one(repo.tx, sql`select d.report_id,d.revision from app.construction_report_deliveries d
        join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
        where d.enterprise_id=${this.actor.enterpriseId} and d.binding_id=${bindingId} and d.state='delivered'
        and m.conversation_id=${String(b.conversation_id)} and m.seq=${throughSequence}`);
      if (!target || !(await this.version(repo, b, String(target.report_id), Number(target.revision))).available) fail('context_changed');
      return idempotent(repo.tx, this.actor, 'followup:seen:' + bindingId, requestKey,
        { throughSequence, ...(renewed ? { conversationId: String(c.id) } : {}) }, async () => {
        await repo.tx.execute(sql`update app.construction_followup_bindings set last_read_seq=greatest(last_read_seq,${throughSequence}::bigint),updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${bindingId}`);
        return { bindingId, throughSequence };
      });
    });
  }
  change(bindingId: string, action: 'archive' | 'stop' | 'delete' | 'resume', expectedVersion: number, requestKey: string) {
    id(bindingId); key(requestKey);
    if (!['archive','stop','delete','resume'].includes(action) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await this.managementBinding(repo, bindingId);
      if (action !== 'resume' && action !== 'delete') await repo.conversation(String(b.conversation_id));
      const result = await idempotent(repo.tx, this.actor, 'followup:' + action + ':' + bindingId, requestKey, { expectedVersion }, async () => {
        if (Number(b.version) !== expectedVersion) fail('version_conflict');
        const status = action === 'stop' ? 'stopped' : action === 'delete' ? 'deleted' : action === 'resume' ? 'enabled' : b.status;
        const old = await one(repo.tx, sql`select * from app.assistant_conversations
          where enterprise_id=${this.actor.enterpriseId} and id=${String(b.conversation_id)} and purpose='construction_followup' for update`);
        if (!old) fail('assistant_resource_not_found', 404);
        if (action === 'resume' && (b.status === 'deleted' || (old.entry_snapshot as Row)?.retentionRedacted === true)) {
          // Only explicit self-resume rotates a deleted/retained destination. Keep the
          // old tombstone, content and runs untouched; never copy its context.
          await repo.tx.execute(sql`update app.assistant_participants set status='revoked',revoked_at=coalesce(revoked_at,now()),version=version+1,updated_at=now()
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${String(old.id)} and status='active'`);
          const next = (await one(repo.tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,mode,entry_snapshot,context_revision,policy_version)
            select ${this.actor.enterpriseId},'construction_followup',${String(old.mode)},
              ${JSON.stringify({ kind: 'construction_followup', audience: b.audience, scope: b.scope_key,
                followupGeneration: Number(old.context_revision) + 1 })}::jsonb,${Number(old.context_revision) + 1},policy_version
            from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId} returning id`))!;
          await repo.tx.execute(sql`update app.construction_followup_bindings set conversation_id=${String(next.id)},status='enabled',last_read_seq=0,list_hidden=false,
            version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${bindingId}`);
          await repo.tx.execute(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,admin_id,grant_basis)
            values(${this.actor.enterpriseId},${String(next.id)},${this.actor.principal.kind},${b.user_id},${b.admin_id},
              ${JSON.stringify({ kind: 'construction_followup', bindingId })}::jsonb)`);
          return { bindingId, conversationId: String(next.id), status, version: expectedVersion + 1 };
        }
        await repo.tx.execute(sql`update app.construction_followup_bindings set status=${status},
          list_hidden=${action === 'archive' || action === 'delete' ? true : action === 'resume' ? false : b.list_hidden},
          version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${bindingId}`);
        if (action !== 'archive') await repo.tx.execute(sql`update app.assistant_conversations set status=${action === 'delete' ? 'closed' : 'open'},
          context_revision=context_revision+${action === 'stop' || action === 'delete' ? 1 : 0},version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${String(b.conversation_id)}`);
        if (action === 'delete' || action === 'resume') await repo.tx.execute(sql`update app.assistant_participants set status=${action === 'delete' ? 'revoked' : 'active'},
          revoked_at=${action === 'delete' ? sql`now()` : sql`null`},version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and conversation_id=${String(b.conversation_id)} and principal_kind=${this.actor.principal.kind}`);
        return { bindingId, conversationId: String(b.conversation_id), status, version: expectedVersion + 1 };
      });
      const current = await bindingForActor(repo.tx, this.actor, bindingId, true);
      if (String(current.conversation_id) !== result.conversationId || (action === 'resume' && current.status !== 'enabled')) fail('context_changed');
      if (action !== 'delete') await repo.conversation(String(result.conversationId));
      return result;
    }, action === 'resume');
  }
  retry(bindingId: string, reportId: string, revision: number, requestKey: string) {
    id(bindingId); id(reportId); key(requestKey);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId), c = await repo.conversation(String(b.conversation_id));
      if (b.status !== 'enabled') fail('context_changed');
      // Revalidate before idempotency lookup as well: an old retry receipt must
      // not claim an earlier generation's run is queued in the new destination.
      if (!await one(repo.tx, sql`select v.run_id from app.construction_reports r
        join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
        join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
        where r.enterprise_id=${this.actor.enterpriseId} and r.id=${reportId} and r.binding_id=${bindingId}
        and v.revision=${revision} and run.conversation_id=${String(c.id)}`)) fail('context_changed');
      return idempotent(repo.tx, this.actor, 'followup:retry:' + reportId + ':' + revision, requestKey, {}, async () => {
        if (await one(repo.tx, sql`select report_id from app.construction_report_versions where enterprise_id=${this.actor.enterpriseId}
          and report_id=${reportId} and revision=${revision} and status='facts_ready'`))
          return { reportId, revision, ...await enqueueReportBody(repo.tx, this.actor.enterpriseId, reportId, revision) };
        const job = await one(repo.tx, sql`select j.* from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
          join app.assistant_jobs j on j.enterprise_id=v.enterprise_id and j.run_id=v.run_id
          join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
          where r.enterprise_id=${this.actor.enterpriseId} and r.id=${reportId} and r.binding_id=${bindingId} and v.revision=${revision} and v.status='queued'
          and run.conversation_id=${String(c.id)} for update of j`);
        if (!job || job.status !== 'failed' || job.provider_started_at || Number(job.attempts) >= 3) fail('context_changed');
        await repo.tx.execute(sql`update app.assistant_runs set status='queued',context_revision=${Number(c.context_revision)},error_code=null,completed_at=null,version=version+1
          where enterprise_id=${this.actor.enterpriseId} and id=${String(job.run_id)} and purpose='construction.report.facts'`);
        await repo.tx.execute(sql`update app.assistant_jobs set status='queued',last_error=null,available_at=now(),version=version+1
          where enterprise_id=${this.actor.enterpriseId} and id=${String(job.id)}`);
        return { reportId, revision, runId: String(job.run_id), status: 'queued' };
      });
    }, true);
  }
}
