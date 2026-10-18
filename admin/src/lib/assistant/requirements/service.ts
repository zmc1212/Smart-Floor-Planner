import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, requireCapability, type ActorContext } from '../contracts';
import { idempotent, cancelRuns } from '../core/conversation';
import { confirmedRequirements, excerptRequirements } from './contract';
import { conversationGuidance, guidanceProgress } from './guidance';
import { requirementCheckpoint } from './checkpoint';

function dto(row: Row) {
  return { id: String(row.id), conversationId: String(row.conversation_id), version: Number(row.version),
    status: row.status, sourceSeq: String(row.source_seq), draftFields: row.draft_fields,
    confirmedFields: row.confirmed_fields, leadId: row.lead_id ? String(row.lead_id) : null,
    confirmedAt: row.confirmed_at, createdAt: row.created_at, extraction: 'customer-excerpts-v1', requiresCustomerReview: row.status === 'draft' };
}

export class RequirementService {
  constructor(readonly actor: ActorContext) {
    requireCapability(actor, 'assistant.chat.self');
    if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  }
  private scoped<T>(conversationId: string, write: boolean, work: (repo: AssistantRepository, c: Row) => Promise<T>) {
    id(conversationId);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      const c = await repo.conversation(conversationId);
      if (c.purpose !== 'customer_consultation') fail('assistant_capability_forbidden', 403);
      return work(repo, c);
    });
  }
  read(conversationId: string) {
    return this.scoped(conversationId, false, async repo => {
      const latest = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
      const confirmed = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status='confirmed' order by id desc limit 1`);
      return { latest: latest ? dto(latest) : null, confirmed: confirmed ? dto(confirmed) : null };
    });
  }
  write(conversationId: string, requestKey: string, input: Record<string, unknown>) {
    const confirm = input.action === 'confirm';
    if (input.action !== 'draft' && !confirm) fail('invalid_message', 422);
    const allowed = confirm ? ['action','draftId','expectedVersion','fields','consent','leadId'] : ['action'];
    if (Object.keys(input).some(k => !allowed.includes(k))) fail('invalid_message', 422);
    const fields = confirm ? confirmedRequirements(input.fields) : null;
    const draftId = confirm ? id(input.draftId) : null;
    const leadId = input.leadId === undefined ? null : id(input.leadId);
    if (confirm && (input.consent !== true || !Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)) fail('invalid_message', 422);
    return this.scoped(conversationId, true, async (repo, c) => {
      // Store identifiers only in idempotency records; replay always projects current,
      // possibly redacted content instead of caching private requirement text.
      const result = await idempotent(repo.tx, this.actor, 'requirements:' + conversationId, requestKey, input, async () => {
        if (c.status !== 'open' || c.mode !== 'ai' || (c.entry_snapshot as Row)?.retentionRedacted) fail('context_changed');
        const source = await one(repo.tx, sql`select coalesce(max(seq),0)::text as seq from app.assistant_messages
          where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user'`);
        let summary: Row;
        if (!confirm) {
          const messages = await rows(repo.tx, sql`select id,content from app.assistant_messages
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user' order by seq limit 201`);
          if (!messages.length) fail('requirements_empty', 422);
          if (messages.length > 200) fail('requirements_history_too_long', 422);
          const inputs = messages.map(m => ({ id: String(m.id), text: String((m.content as { blocks?: { text?: string }[] }).blocks?.[0]?.text || '') }));
          const guidance = conversationGuidance(c.entry_snapshot);
          const drafts = guidance ? guidanceProgress(guidance, inputs).fields : excerptRequirements(inputs);
          const checkpoint = await requirementCheckpoint(repo.tx, this.actor.enterpriseId, conversationId);
          const effective = guidance ? guidanceProgress(guidance, inputs, checkpoint).fields : drafts;
          const editable = Object.fromEntries(Object.entries(effective).map(([k, v]) => [k, v.text]));
          summary = (await one(repo.tx, sql`insert into app.assistant_requirement_summaries(enterprise_id,conversation_id,customer_user_id,source_seq,draft_fields,confirmed_fields)
            values(${this.actor.enterpriseId},${conversationId},${this.actor.principal.kind === 'user' ? this.actor.principal.userId : null},${String(source!.seq)},${JSON.stringify(drafts)}::jsonb,${JSON.stringify(editable)}::jsonb) returning *`))!;
        } else {
          const latest = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1 for update`);
          if (!latest || String(latest.id) !== draftId || latest.status !== 'draft' || Number(latest.version) !== input.expectedVersion) fail('version_conflict');
          if (String(latest.source_seq) !== String(source!.seq)) fail('requirements_stale');
          if (leadId && !await one(repo.tx, sql`select id from app.leads where enterprise_id=${this.actor.enterpriseId} and id=${leadId}
            and customer_user_id=${this.actor.principal.kind === 'user' ? this.actor.principal.userId : null}
            and archived_at is null and status not in ('closed','converted') for share`)) fail('assistant_resource_not_found', 404);
          summary = (await one(repo.tx, sql`update app.assistant_requirement_summaries set status='confirmed',confirmed_fields=${JSON.stringify(fields)}::jsonb,
            lead_id=${leadId},confirmed_at=now(),updated_at=now(),version=version+1
            where enterprise_id=${this.actor.enterpriseId} and id=${draftId} returning *`))!;
          // Fence a reply computed from the previous requirement version.
          await cancelRuns(repo.tx, this.actor, conversationId);
          await repo.tx.execute(sql`update app.assistant_conversations set context_revision=context_revision+1
            where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
          await repo.tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
            values(${this.actor.enterpriseId},'assistant.requirements.confirmed.v1','assistant_conversation',${conversationId},${Number(c.version) + 1},
              ${JSON.stringify(this.actor.principal)}::jsonb,${String(summary.id)},${JSON.stringify({ conversationId, summaryId: String(summary.id), leadId })}::jsonb)`);
        }
        await repo.tx.execute(sql`update app.assistant_conversations set updated_at=now(),version=version+1 where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
        return { conversationId, summaryId: String(summary.id) };
      });
      const saved = await one(repo.tx, sql`select * from app.assistant_requirement_summaries where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and id=${String(result.summaryId)}`);
      if (!saved) fail('assistant_resource_not_found', 404);
      return dto(saved);
    });
  }
}
