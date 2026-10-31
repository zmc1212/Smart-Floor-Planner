import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key, principalKey, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { constructionAccess } from './service';
import { bindingForActor, ensureFollowupBinding } from './report-store';
import { projectReportFacts, type FollowupAudience, type ReportFacts } from './report-scope';

export class FollowupService {
  constructor(readonly actor: ActorContext) { requireCapability(actor, 'assistant.followup.self'); }
  private scoped<T>(work: (repo: AssistantRepository) => Promise<T>, write = false) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      return work(repo);
    });
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
      v.period_end as fact_period_end,v.cutoff_at as fact_cutoff_at,run.status as run_status,run.error_code,d.state as delivery_state,d.read_at,d.message_id,m.seq
      from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
      join app.assistant_runs run on run.enterprise_id=v.enterprise_id and run.id=v.run_id
      left join app.construction_report_deliveries d on d.enterprise_id=v.enterprise_id and d.report_id=v.report_id and d.revision=v.revision and d.binding_id=r.binding_id
      left join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
      where r.enterprise_id=${eid} and r.binding_id=${String(b.id)} and r.id=${reportId} and v.revision=${revision || sql`r.latest_revision`}`);
    if (!r) fail('assistant_resource_not_found', 404);
    const metadata = { reportId: String(r.id), revision: Number(r.revision), kind: String(r.kind), timezone: 'Asia/Shanghai',
      periodStart: r.period_start, periodEnd: r.fact_period_end, cutoffAt: r.fact_cutoff_at, scheduledAt: r.scheduled_at,
      generatedAt: r.generated_at, readAt: r.read_at, deliveryState: r.delivery_state || null, sequence: r.seq ? String(r.seq) : null };
    if (r.fact_status !== 'facts_ready') return { ...metadata, available: true, state: r.run_status, errorCode: r.error_code,
      contentStatus: 'not_generated' as const, facts: null, readToken: null };
    const facts = await projectReportFacts(repo.tx, eid, b, r.facts as ReportFacts, new Date(String(r.generated_at)));
    if (!facts.projects.length) return { reportId, revision: Number(r.revision), available: false, state: 'source_unavailable',
      contentStatus: 'not_generated' as const, facts: null, readToken: null, readAt: null, sequence: null };
    return { ...metadata, available: true, state: 'facts_ready', contentStatus: 'facts_only' as const, facts,
      readToken: fingerprint({ subject: principalKey(this.actor), bindingId: String(b.id), reportId, revision: Number(r.revision), factsHash: fingerprint(facts) }) };
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
          where d.enterprise_id=${this.actor.enterpriseId} and d.binding_id=${String(b.id)} and d.state='delivered' order by d.event_id desc limit 51`);
        let unreadReports = 0, unreadMessages = 0;
        for (const v of versions.slice(0, 50)) {
          const projected = await this.version(repo, b, String(v.report_id), Number(v.revision));
          if (!projected.available) continue;
          if (!projected.readAt) unreadReports++;
          if (projected.sequence && BigInt(projected.sequence) > BigInt(String(b.last_read_seq))) unreadMessages++;
        }
        items.push({ bindingId: String(b.id), conversationId: String(b.conversation_id), audience: b.audience, status: b.status,
          conversationStatus: b.conversation_status, version: Number(b.version), unreadReports, unreadMessages, unreadTruncated: versions.length > 50 });
      }
      return { items, truncated: bindings.length === 30 };
    });
  }
  reports(bindingId: string, beforeId = '9223372036854775807') {
    id(bindingId); id(beforeId);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
      const found = await rows(repo.tx, sql`select id from app.construction_reports where enterprise_id=${this.actor.enterpriseId}
        and binding_id=${bindingId} and id<${beforeId} order by id desc limit 20`);
      const items = [];
      for (const r of found) items.push(await this.version(repo, b, String(r.id)));
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
  acknowledge(bindingId: string, reportId: string, revision: number, readToken: string, requestKey: string) {
    id(bindingId); id(reportId); key(requestKey);
    if (!Number.isSafeInteger(revision) || revision < 1 || typeof readToken !== 'string') fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
      const view = await this.version(repo, b, reportId, revision);
      if (!view.available || view.readToken !== readToken || !view.sequence) fail('context_changed');
      return idempotent(repo.tx, this.actor, 'followup:read:' + reportId, requestKey, { revision, readToken }, async () => {
        await repo.tx.execute(sql`update app.construction_report_deliveries set read_at=coalesce(read_at,now())
          where enterprise_id=${this.actor.enterpriseId} and report_id=${reportId} and revision=${revision} and binding_id=${bindingId} and state='delivered'`);
        return { reportId, revision, read: true };
      });
    });
  }
  seen(bindingId: string, throughSequence: string, requestKey: string) {
    id(bindingId); id(throughSequence); key(requestKey);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId); await repo.conversation(String(b.conversation_id));
      const target = await one(repo.tx, sql`select d.report_id,d.revision from app.construction_report_deliveries d
        join app.assistant_messages m on m.enterprise_id=d.enterprise_id and m.id=d.message_id
        where d.enterprise_id=${this.actor.enterpriseId} and d.binding_id=${bindingId} and d.state='delivered' and m.seq=${throughSequence}`);
      if (!target || !(await this.version(repo, b, String(target.report_id), Number(target.revision))).available) fail('context_changed');
      return idempotent(repo.tx, this.actor, 'followup:seen:' + bindingId, requestKey, { throughSequence }, async () => {
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
      const b = await bindingForActor(repo.tx, this.actor, bindingId, action === 'resume' || action === 'delete');
      if (action !== 'resume' && !(action === 'delete' && b.status === 'deleted')) await repo.conversation(String(b.conversation_id));
      const result = await idempotent(repo.tx, this.actor, 'followup:' + action + ':' + bindingId, requestKey, { expectedVersion }, async () => {
        if (Number(b.version) !== expectedVersion) fail('version_conflict');
        const status = action === 'stop' ? 'stopped' : action === 'delete' ? 'deleted' : action === 'resume' ? 'enabled' : b.status;
        await repo.tx.execute(sql`update app.construction_followup_bindings set status=${status},version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${bindingId}`);
        await repo.tx.execute(sql`update app.assistant_conversations set status=${action === 'archive' ? 'archived' : action === 'delete' ? 'closed' : 'open'},
          context_revision=context_revision+${action === 'stop' || action === 'delete' ? 1 : 0},version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${String(b.conversation_id)}`);
        if (action === 'delete' || action === 'resume') await repo.tx.execute(sql`update app.assistant_participants set status=${action === 'delete' ? 'revoked' : 'active'},
          revoked_at=${action === 'delete' ? sql`now()` : sql`null`},version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and conversation_id=${String(b.conversation_id)} and principal_kind=${this.actor.principal.kind}`);
        return { bindingId, conversationId: String(b.conversation_id), status, version: expectedVersion + 1 };
      });
      if (action !== 'delete') await repo.conversation(String(b.conversation_id));
      return result;
    });
  }
  retry(bindingId: string, reportId: string, revision: number, requestKey: string) {
    id(bindingId); id(reportId); key(requestKey);
    if (!Number.isSafeInteger(revision) || revision < 1) fail('invalid_construction', 422);
    return this.scoped(async repo => {
      const b = await bindingForActor(repo.tx, this.actor, bindingId), c = await repo.conversation(String(b.conversation_id));
      if (b.status !== 'enabled') fail('context_changed');
      return idempotent(repo.tx, this.actor, 'followup:retry:' + reportId + ':' + revision, requestKey, {}, async () => {
        const job = await one(repo.tx, sql`select j.* from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
          join app.assistant_jobs j on j.enterprise_id=v.enterprise_id and j.run_id=v.run_id
          where r.enterprise_id=${this.actor.enterpriseId} and r.id=${reportId} and r.binding_id=${bindingId} and v.revision=${revision} and v.status='queued' for update of j`);
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
