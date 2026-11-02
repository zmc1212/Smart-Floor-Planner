import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, requireCapability, type ActorContext } from '@/lib/assistant/contracts';
import { ConversationService, idempotent } from '@/lib/assistant/core/conversation';
import { runUsageReconciled } from '@/lib/assistant/core/usage-review';
import { reportChoice, reportContext, reportContextProtocol, reportContextView, resolveReportReference, selectedReport, type ReportReference } from './report-reference';

export function parseReportSelection(value: unknown) {
  const b = value as Row;
  if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).some(k => !['expectedVersion','selection'].includes(k))
    || !Number.isSafeInteger(b.expectedVersion) || Number(b.expectedVersion) < 0 || !Object.hasOwn(b, 'selection')) fail('invalid_message', 422);
  return { expectedVersion: Number(b.expectedVersion), selection: b.selection === null ? null : reportChoice(b.selection) };
}
export class ReportContextService {
  constructor(readonly actor: ActorContext, readonly conversationId: string) {
    id(conversationId); requireCapability(actor, actor.capabilities.includes('assistant.followup.self') ? 'assistant.followup.self' : 'assistant.chat.self');
    if (actor.principal.kind !== 'user' && !actor.capabilities.includes('assistant.followup.self')) fail('assistant_capability_forbidden', 403);
  }
  private scope<T>(fn: (repo: AssistantRepository, c: Row) => Promise<T>, write = false) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor); await repo.settings(write);
      const c = await repo.conversation(this.conversationId);
      if ((c.entry_snapshot as Row)?.retentionRedacted) fail('assistant_resource_not_found', 404);
      return fn(repo, c);
    });
  }
  read() { return this.scope((repo, c) => reportContextView(repo.tx, this.actor, c)); }
  select(requestKey: string, input: unknown) {
    const body = parseReportSelection(input);
    return this.scope(async (repo, c) => {
      const result = await idempotent(repo.tx, this.actor, 'report-context:' + this.conversationId, requestKey, body, async () => {
        if (c.status !== 'open' || c.mode !== 'ai') fail('conversation_read_only');
        if (reportContext(c.entry_snapshot).revision !== body.expectedVersion) fail('version_conflict');
        if (await one(repo.tx, sql`select r.id from app.assistant_runs r where r.enterprise_id=${this.actor.enterpriseId}
          and r.conversation_id=${this.conversationId} and r.purpose not in ('construction.report.facts','construction.report.compose')
          and (r.status in ('queued','running') or r.status='indeterminate' and not ${runUsageReconciled()}) limit 1`)) fail('conversation_busy');
        let selection: ReportReference | null = null;
        if (body.selection) {
          const resolved = await resolveReportReference(repo.tx, this.actor, body.selection);
          if (!resolved || c.purpose === 'construction_followup' && resolved.selection.conversationId !== this.conversationId
            || (c.entry_snapshot as Row)?.kind === 'lead' && String((c.entry_snapshot as Row).id) !== resolved.leadId) fail('assistant_resource_not_found', 404);
          selection = resolved.selection;
        }
        const value = { protocol: reportContextProtocol, revision: body.expectedVersion + 1, selection };
        await repo.tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{reportContext}',${JSON.stringify(value)}::jsonb),
          context_revision=context_revision+${c.purpose === 'construction_followup' ? 0 : 1},version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
        return value;
      });
      const current = await repo.conversation(this.conversationId);
      if (fingerprint(reportContext(current.entry_snapshot)) !== fingerprint(result)) fail('context_changed');
      const projection = await reportContextView(repo.tx, this.actor, current);
      if (result.selection && !projection.selected) fail('context_changed');
      return projection;
    }, true);
  }
  /** Explicit action only. Original create/participant/idempotency services own
   * the new ordinary topic; the automatic destination is never rebound. */
  topic(requestKey: string) {
    if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
    return this.scope(async (repo, c) => {
      if (c.status !== 'open' || c.mode !== 'ai') fail('conversation_read_only');
      const selected = await selectedReport(repo.tx, this.actor, c);
      if (!selected) fail('assistant_resource_not_found', 404);
      const actor: ActorContext = { ...this.actor, capabilities: ['assistant.chat.self'], entry: { kind: 'lead', id: selected.leadId,
        reportContext: { protocol: reportContextProtocol, revision: 1, selection: selected.selection } } };
      const result = await idempotent(repo.tx, this.actor, 'report-topic:' + this.conversationId, requestKey, selected.selection,
        () => new ConversationService(actor, repo.tx).create(requestKey));
      await new AssistantRepository(repo.tx, actor).conversation(String(result.id));
      return result;
    }, true);
  }
}
