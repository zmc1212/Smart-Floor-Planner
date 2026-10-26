import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, requireCapability, type ActorContext } from '../contracts';
import { idempotent, cancelRuns } from '../core/conversation';
import { confirmedRequirements, evidencedRequirements, excerptRequirements } from './contract';
import { conversationGuidance, guidanceProgress } from './guidance';
import { requirementCheckpoint } from './checkpoint';
import { applyRequirementChanges, type RequirementProposal } from './items';
import { requirementReview } from './review';
import { selectedRequirementFields, selectedRequirementReview } from './selection';
import { requirementProposalIsCurrent } from './current';

function dto(row: Row) {
  return { id: String(row.id), conversationId: String(row.conversation_id), version: Number(row.version),
    status: row.status, sourceSeq: String(row.source_seq), draftFields: row.draft_fields,
    confirmedFields: row.confirmed_fields, leadId: row.lead_id ? String(row.lead_id) : null,
    confirmedAt: row.confirmed_at, createdAt: row.created_at, extraction: 'customer-excerpts-v1', requiresCustomerReview: row.status === 'draft' };
}
export async function customerSources(repo: AssistantRepository, enterpriseId: string, conversationId: string) {
  const messages = await rows(repo.tx, sql`select id,seq,content from app.assistant_messages
    where enterprise_id=${enterpriseId} and conversation_id=${conversationId} and author_kind='user' order by seq limit 201`);
  if (messages.length > 200) fail('requirements_history_too_long', 422);
  return { messages, hash: fingerprint(messages), inputs: messages.map(m => ({ id: String(m.id),
    text: ((m.content as { blocks?: { text?: string }[] }).blocks || []).map(b => b.text || '').join('\n') })) };
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
  workflowEnabled(conversationId: string) {
    return this.scoped(conversationId, false, async (repo, c) => {
      const settings = await repo.settings();
      const entry = c.entry_snapshot as Row;
      return entry.requirementReviewMode === true && entry.requirementWorkflow === 'langgraph'
        && settings?.enabled === true && !entry.retentionRedacted && c.mode === 'ai' && c.status === 'open';
    });
  }
  read(conversationId: string) {
    return this.scoped(conversationId, false, async (repo, c) => {
      const latest = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
      const confirmed = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status='confirmed' order by id desc limit 1`);
      const pending = (c.entry_snapshot as Row)?.requirementProposal as Row | undefined;
      const source = await one(repo.tx, sql`select coalesce(max(seq),0)::text seq from app.assistant_messages
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user'`);
      const settings = await repo.settings();
      const sources = pending?.status === 'pending' ? await customerSources(repo, this.actor.enterpriseId, conversationId) : null;
      const current = requirementProposalIsCurrent(pending, {
        sourceHash: sources?.hash || null, sourceSeq: String(source!.seq), epoch: Number(settings!.knowledge_epoch),
        latestId: latest ? String(latest.id) : null, latestVersion: latest ? Number(latest.version) : null,
        mode: String(c.mode), status: String(c.status),
      });
      return { latest: latest ? dto(latest) : null, confirmed: confirmed ? dto(confirmed) : null,
        sourceSeq: String(source!.seq),
        reviewMode: (c.entry_snapshot as Row)?.requirementReviewMode === true,
        proposal: current && pending ? { id: pending.id, digest: pending.digest, status: 'pending', sourceSeq: pending.sourceSeq,
          diff: pending.diff, requiresRestoreConsent: pending.requiresRestoreConsent,
          summary: { status: 'proposal', draftFields: pending.fields, confirmedFields: null } } : null };
    });
  }
  /** Internal proposal-only capability. No model-facing tool can accept it. */
  propose(conversationId: string, requestKey: string, proposal: Extract<RequirementProposal, { changes: unknown }>,
    guard?: (repo: AssistantRepository, conversation: Row) => Promise<void>) {
    return this.scoped(conversationId, true, async (repo, c) => {
      // Replays still cross the current integration and conversation boundary.
      if (guard) await guard(repo, c);
      const entry = c.entry_snapshot as Row;
      if (entry.requirementReviewMode !== true || entry.retentionRedacted || c.mode !== 'ai' || c.status !== 'open') fail('context_changed');
      const result = await idempotent(repo.tx, this.actor, 'requirement-proposal:' + conversationId, requestKey, proposal, async () => {
      const { messages, inputs, hash: sourceHash } = await customerSources(repo, this.actor.enterpriseId, conversationId);
      if (String(messages.at(-1)?.seq || '0') !== proposal.sourceSeq) fail('requirements_stale');
      const latest = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
      if (latest?.status === 'redacted') fail('context_changed');
      // Customer-edited formal values cannot be silently replaced by their older
      // extraction. Until this adapter supports that provenance, require review.
      if (latest?.status === 'confirmed' && Array.isArray(proposal.changes) && proposal.changes.length > 0
        && Object.entries((latest.confirmed_fields || {}) as Record<string, string>)
        .some(([field, text]) => text !== ((latest.draft_fields as Record<string, { text?: string }>)[field]?.text || ''))) {
        fail('requirements_customer_edit_conflict', 409);
      }
      if ((latest ? String(latest.id) : null) !== proposal.baseSummaryId) fail('requirement_target_changed');
      const review = requirementReview(inputs, latest?.draft_fields, proposal.changes);
      if (review.unchanged) {
        if (!latest) fail('requirements_empty', 422);
        // An acknowledgement of the saved values replaces an earlier unaccepted diff.
        if ((entry.requirementProposal as Row)?.status === 'pending') await repo.tx.execute(sql`update app.assistant_conversations
          set entry_snapshot=entry_snapshot-'requirementProposal',version=version+1,updated_at=now()
          where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
        return { kind: 'existing', summaryId: String(latest.id) };
      }
      const settings = await repo.settings(true);
      const binding = { ...review, changes: proposal.changes, sourceSeq: proposal.sourceSeq, sourceHash,
        baseSummaryId: proposal.baseSummaryId, baseVersion: latest ? Number(latest.version) : null,
        epoch: Number(settings!.knowledge_epoch) };
      const digest = fingerprint(binding), old = entry.requirementProposal as Row | undefined;
      const pending = old?.status === 'pending' && old.digest === digest ? old : { ...binding, id: randomUUID(), digest, status: 'pending' };
      if (pending !== old) await repo.tx.execute(sql`update app.assistant_conversations
        set entry_snapshot=jsonb_set(entry_snapshot,'{requirementProposal}',${JSON.stringify(pending)}::jsonb),version=version+1,updated_at=now()
        where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
      return { kind: 'proposal', proposalId: pending.id, digest };
      });
      if (result.kind === 'existing') {
        const saved = await one(repo.tx, sql`select * from app.assistant_requirement_summaries where enterprise_id=${this.actor.enterpriseId}
          and conversation_id=${conversationId} and id=${String(result.summaryId)}`);
        if (!saved) fail('assistant_resource_not_found', 404);
        return { kind: 'existing' as const, summary: dto(saved) };
      }
      // Replay identifiers against current authorized content; never resurrect an old diff.
      const fresh = await repo.conversation(conversationId), pending = (fresh.entry_snapshot as Row)?.requirementProposal as Row | undefined;
      const sources = await customerSources(repo, this.actor.enterpriseId, conversationId);
      const latest = await one(repo.tx, sql`select id,version from app.assistant_requirement_summaries
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
      const settings = await repo.settings(true);
      if (!pending || pending.id !== result.proposalId || pending.digest !== result.digest || pending.status !== 'pending'
        || pending.sourceHash !== sources.hash || pending.sourceSeq !== String(sources.messages.at(-1)?.seq || '0')
        || pending.epoch !== Number(settings!.knowledge_epoch) || pending.baseSummaryId !== (latest ? String(latest.id) : null)
        || pending.baseVersion !== (latest ? Number(latest.version) : null))
        return { kind: 'superseded' as const, proposalId: result.proposalId };
      return { kind: 'proposal' as const, proposal: { id: pending.id, digest: pending.digest, status: 'pending', diff: pending.diff as Row[],
        requiresRestoreConsent: pending.requiresRestoreConsent, summary: { status: 'proposal', draftFields: pending.fields, confirmedFields: null } } };
    });
  }
  /** Internal Agent seam; public REST payloads cannot supply a proposal. */
  customerEvidence(conversationId: string) {
    return this.scoped(conversationId, false, async repo => {
      const messages = await rows(repo.tx, sql`select id,seq,content from app.assistant_messages
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user' order by seq limit 201`);
      if (messages.length > 200) fail('requirements_history_too_long', 422);
      return { sourceSeq: String(messages.at(-1)?.seq || '0'), messages: messages.map(m => ({ id: String(m.id),
        text: ((m.content as { blocks?: { text?: string }[] }).blocks || []).map(b => b.text || '').join('\n') })) };
    });
  }
  write(conversationId: string, requestKey: string, input: Record<string, unknown>, proposal?: RequirementProposal,
    guard?: (repo: AssistantRepository, conversation: Row) => Promise<void>) {
    const confirm = input.action === 'confirm', apply = input.action === 'apply_proposal';
    if (proposal && (confirm || typeof proposal.sourceSeq !== 'string')) fail('invalid_requirement_evidence', 422);
    if (input.action !== 'draft' && !confirm && !apply) fail('invalid_message', 422);
    const allowed = apply ? ['action','proposalId','digest','consent','restoreConsent','selectedFields']
      : confirm ? ['action','draftId','expectedVersion','fields','consent','leadId','reviewedSourceSeq'] : ['action'];
    if (Object.keys(input).some(k => !allowed.includes(k))) fail('invalid_message', 422);
    const fields = confirm ? confirmedRequirements(input.fields) : null;
    const draftId = confirm ? id(input.draftId) : null;
    const leadId = input.leadId === undefined ? null : id(input.leadId);
    if (confirm && (input.consent !== true || !Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) < 1)) fail('invalid_message', 422);
    if (apply && (proposal || input.consent !== true || typeof input.proposalId !== 'string' || typeof input.digest !== 'string'
      || (input.restoreConsent !== undefined && typeof input.restoreConsent !== 'boolean'))) fail('invalid_message', 422);
    if (apply) {
      const selectedFields = selectedRequirementFields(input.selectedFields);
      // Legacy direct-service keys were hashed with restoreConsent omitted.
      // Workflow requests already normalize it; preserve old bodies here.
      input = { ...input, ...(selectedFields ? { selectedFields } : {}) };
    }
    return this.scoped(conversationId, true, async (repo, c) => {
      // Internal integrations can fence an authorized snapshot within the same
      // settings/participant transaction, including before idempotent replay.
      if (guard) await guard(repo, c);
      // Store identifiers only in idempotency records; replay always projects current,
      // possibly redacted content instead of caching private requirement text.
      const result = await idempotent(repo.tx, this.actor, 'requirements:' + conversationId, requestKey, proposal ? { ...input, proposal } : input, async () => {
        if (c.status !== 'open' || c.mode !== 'ai' || (c.entry_snapshot as Row)?.retentionRedacted) fail('context_changed');
        const source = await one(repo.tx, sql`select coalesce(max(seq),0)::text as seq from app.assistant_messages
          where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user'`);
        if (proposal && proposal.sourceSeq !== String(source!.seq)) fail('requirements_stale');
        let summary: Row;
        if (apply) {
          const pending = (c.entry_snapshot as Row)?.requirementProposal as Row | undefined;
          if ((c.entry_snapshot as Row)?.requirementReviewMode !== true) fail('requirements_proposal_required', 409);
          if (pending?.status === 'applied' && pending.id === input.proposalId && pending.digest === input.digest) {
            if (pending.inputHash ? pending.inputHash !== fingerprint(input) : input.selectedFields !== undefined) fail('idempotency_conflict');
            return { conversationId, summaryId: String(pending.summaryId) };
          }
          const latest = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1`);
          const settings = await repo.settings(true);
          if (!pending || pending.status !== 'pending' || pending.id !== input.proposalId || pending.digest !== input.digest) fail('requirement_target_changed');
          if (pending.sourceSeq !== String(source!.seq) || pending.epoch !== Number(settings!.knowledge_epoch)
            || pending.baseSummaryId !== (latest ? String(latest.id) : null) || pending.baseVersion !== (latest ? Number(latest.version) : null)) fail('requirements_stale');
          const sources = await customerSources(repo, this.actor.enterpriseId, conversationId);
          if (pending.sourceHash !== sources.hash) fail('requirements_stale');
          const checked = requirementReview(sources.inputs, latest?.draft_fields, pending.changes);
          if (fingerprint(checked.fields) !== fingerprint(pending.fields)) fail('requirements_stale');
          const selected = selectedRequirementReview(sources.inputs, latest?.draft_fields, pending.changes, input.selectedFields);
          if (selected.requiresRestoreConsent && input.restoreConsent !== true) fail('requirements_restore_confirmation_required', 409);
          summary = (await one(repo.tx, sql`insert into app.assistant_requirement_summaries(enterprise_id,conversation_id,customer_user_id,source_seq,draft_fields,confirmed_fields)
            values(${this.actor.enterpriseId},${conversationId},${this.actor.principal.kind === 'user' ? this.actor.principal.userId : null},${String(source!.seq)},${JSON.stringify(selected.fields)}::jsonb,null) returning *`))!;
          // Keep identifiers only after acceptance. Retention clears entry_snapshot.
          await repo.tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{requirementProposal}',
            ${JSON.stringify({ id: pending.id, digest: pending.digest, status: 'applied', summaryId: String(summary.id), inputHash: fingerprint(input) })}::jsonb)
            where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
        } else if (!confirm) {
          if ((c.entry_snapshot as Row)?.requirementReviewMode === true) fail('requirements_proposal_required', 409);
          const messages = await rows(repo.tx, sql`select id,content from app.assistant_messages
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and author_kind='user' order by seq limit 201`);
          if (!messages.length) fail('requirements_empty', 422);
          if (messages.length > 200) fail('requirements_history_too_long', 422);
          const inputs = messages.map(m => ({ id: String(m.id), text:
            ((m.content as { blocks?: { text?: string }[] }).blocks || []).map(b => b.text || '').join('\n') }));
          const guidance = conversationGuidance(c.entry_snapshot);
          let proposed;
          if (proposal && 'changes' in proposal) {
            const previous = await one(repo.tx, sql`select id,draft_fields from app.assistant_requirement_summaries
              where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status!='redacted' order by id desc limit 1`);
            if ((previous ? String(previous.id) : null) !== proposal.baseSummaryId) fail('requirement_target_changed', 409);
            proposed = applyRequirementChanges(inputs, previous?.draft_fields, proposal.changes);
          } else if (proposal) {
            // Sparse edits preserve every untouched customer fact. All retained
            // excerpts are revalidated against this authorized message set too.
            evidencedRequirements(inputs, proposal.fields);
            const edits = proposal.fields as Array<{field:string;text:string;sourceMessageId:string}>;
            const previous = await one(repo.tx, sql`select draft_fields from app.assistant_requirement_summaries
              where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and status!='redacted' order by id desc limit 1`);
            const retained = Object.entries((previous?.draft_fields || {}) as Record<string,{text?:string;sourceMessageId?:string}>)
              .filter(([field, value]) => value?.text && !edits.some(edit => edit.field === field))
              .map(([field, value]) => ({field,text:value.text,sourceMessageId:value.sourceMessageId}));
            proposed = evidencedRequirements(inputs, [...retained, ...edits]);
          }
          const drafts = proposed || (guidance ? guidanceProgress(guidance, inputs).fields : excerptRequirements(inputs));
          const checkpoint = await requirementCheckpoint(repo.tx, this.actor.enterpriseId, conversationId);
          const effective = !proposal && guidance ? guidanceProgress(guidance, inputs, checkpoint).fields : drafts;
          const editable = Object.fromEntries(Object.entries(effective).map(([k, v]) => [k, v.text]));
          summary = (await one(repo.tx, sql`insert into app.assistant_requirement_summaries(enterprise_id,conversation_id,customer_user_id,source_seq,draft_fields,confirmed_fields)
            values(${this.actor.enterpriseId},${conversationId},${this.actor.principal.kind === 'user' ? this.actor.principal.userId : null},${String(source!.seq)},${JSON.stringify(drafts)}::jsonb,${JSON.stringify(editable)}::jsonb) returning *`))!;
        } else {
          const latest = await one(repo.tx, sql`select * from app.assistant_requirement_summaries
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} order by id desc limit 1 for update`);
          if (!latest || String(latest.id) !== draftId || latest.status !== 'draft' || Number(latest.version) !== input.expectedVersion) fail('version_conflict');
          if ((c.entry_snapshot as Row)?.requirementReviewMode === true
            ? input.reviewedSourceSeq !== String(source!.seq)
            : String(latest.source_seq) !== String(source!.seq)) fail('requirements_stale');
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
