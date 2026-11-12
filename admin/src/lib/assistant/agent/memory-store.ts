import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { recordNeedIssueSupplement } from '@/lib/construction/need-issues';
import { boundDelegationReply, outletFields, recordDelegationRequirements } from '@/lib/native-workflow/live/delegation-inputs';
import { fail, fingerprint, safeText, type ActorContext } from '../contracts';
import { saveAutomaticRequirements } from '../requirements/automatic';
import { applyNeedDelta, compactNeedMemory, needMemoryPolicy, parseNeedDelta, parseNeedWrites, readMemory, uncoveredNeedStatements, NeedWriteIncompleteError, type NeedFact } from './memory';

type NeedReceipt = { status: 'saved'; memoryVersion: number; conversationVersion: number; formalApproval: false;
  savedFacts: Array<Pick<NeedFact, 'id' | 'room' | 'field' | 'value' | 'supersedes'>> };
type NeedCheckpoint = { policy: typeof needMemoryPolicy.version; receipt: NeedReceipt; archivedFacts: NeedFact[] };

/** Called inside the existing authorized run/conversation lock. Reuse its tool
 * step for an immutable receipt and private archive; no second fact store or
 * model-visible archive. The existing retention/tenant cleanup clears both. */
export async function persistNeedWrites(tx: PostgresTransaction, actor: ActorContext, conversation: Row,
  operation: { runId: string; turn: number; index: number; sourceMessageId: string }, input: unknown): Promise<{ content: string }> {
  if (actor.principal.kind !== 'user' || conversation.purpose !== 'customer_consultation'
    || String(conversation.enterprise_id) !== actor.enterpriseId) fail('assistant_capability_forbidden', 403);
  const repository = new AssistantRepository(tx, actor);
  conversation = await repository.conversation(String(conversation.id));
  const writes = parseNeedWrites(input);
  const source = await one(tx, sql`select m.content from app.assistant_messages m join app.assistant_runs r
    on r.enterprise_id=m.enterprise_id and r.conversation_id=m.conversation_id and r.trigger_message_id=m.id
    where m.enterprise_id=${actor.enterpriseId} and m.conversation_id=${String(conversation.id)} and m.id=${operation.sourceMessageId}
      and m.user_id=${actor.principal.userId} and m.author_kind='user' and r.id=${operation.runId} for share of m`);
  if (!source) fail('context_changed');
  const sourceText = safeText(source.content as Parameters<typeof safeText>[0]);
  if (/喜欢|中意|满意|不合适/.test(sourceText) && /第[一二三123](?:个|款|张|套|例)|这(?:款|张|套)参考/.test(sourceText)) fail('need_source_mismatch', 422);
  const sequence = 1200 + operation.turn * 10 + operation.index;
  const inputHash = fingerprint({ input, sourceMessageId: operation.sourceMessageId, content: source.content });
  const cached = await one(tx, sql`select kind,status,input_summary,private_checkpoint from app.assistant_run_steps
    where enterprise_id=${actor.enterpriseId} and run_id=${operation.runId} and step_seq=${sequence}`);
  if (cached) {
    const checkpoint = cached.private_checkpoint as NeedCheckpoint | null;
    if (cached.kind !== 'agent_need_write' || cached.status !== 'succeeded' || (cached.input_summary as Row)?.inputHash !== inputHash
      || checkpoint?.policy !== needMemoryPolicy.version) fail('context_changed');
    return { content: JSON.stringify(checkpoint.receipt) };
  }
  const memory = readMemory(conversation.entry_snapshot), changedFacts: NeedFact[] = [];
  const reply = writes.some(write => outletFields.includes(write.field))
    ? await boundDelegationReply(tx, actor, String(conversation.id), operation.sourceMessageId, sourceText) : null;
  let next = memory;
  for (const [position, write] of writes.entries()) {
    const operationId = `${operation.runId}:${operation.turn}:${operation.index}` + (position ? `:need:${position}` : '');
    const delta = parseNeedDelta({ ...write, sourceMessageId: operation.sourceMessageId, expectedVersion: next.version });
    const replyRoom = outletFields.includes(write.field) ? reply?.roomName : undefined;
    const updated = applyNeedDelta(next, delta, { id: operation.sourceMessageId, text: sourceText, replyRoom }, operationId, new Date().toISOString());
    // Validate every attempt first, then reuse a current receipt for the same
    // run/source/key/value/quote. A later model turn is not a new customer edit.
    if (next.facts.some(f => f.status === 'current' && f.id.startsWith(operation.runId + ':')
      && f.sourceMessageId === operation.sourceMessageId && f.room === write.room && f.field === write.field
      && f.value === write.value && f.quote === write.quote)) continue;
    if (updated !== next) changedFacts.push(updated.facts.find(f => f.id === operationId)!);
    next = updated;
  }
  // Nothing durable has changed yet. Reject the complete proposed batch so a
  // retry cannot leave the first field saved while silently omitting the next.
  const missingStatements = uncoveredNeedStatements(sourceText, writes);
  if (missingStatements.length) throw new NeedWriteIncompleteError(missingStatements);
  const compacted = compactNeedMemory(next);
  const receipt: NeedReceipt = { status: 'saved', memoryVersion: next.version,
    conversationVersion: Number(conversation.version) + (next === memory ? 0 : 1), formalApproval: false,
    savedFacts: writes.flatMap(write => next.facts.filter(f => f.status === 'current' && f.room === write.room && f.field === write.field))
      .map(({ id, room, field, value, supersedes }) => ({ id, room, field, value, supersedes })) };
  if (next !== memory) {
    await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{agentMemory}',${JSON.stringify(compacted.memory)}::jsonb),version=version+1,updated_at=now()
      where enterprise_id=${actor.enterpriseId} and id=${String(conversation.id)}`);
    for (const fact of changedFacts) await recordNeedIssueSupplement(tx, actor, conversation, fact);
    await recordDelegationRequirements(tx, actor, String(conversation.id), operation.sourceMessageId, `${operation.runId}:${sequence}`, changedFacts, reply);
    await saveAutomaticRequirements(repository, String(conversation.id));
  }
  const checkpoint: NeedCheckpoint = { policy: needMemoryPolicy.version, receipt, archivedFacts: compacted.archivedFacts };
  await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,capability_name,capability_version,status,input_summary,private_checkpoint,source_refs)
    values(${actor.enterpriseId},${operation.runId},${sequence},'agent_need_write','record_need',1,'succeeded',
      ${JSON.stringify({ policy: needMemoryPolicy.version, inputHash, archivedCount: compacted.archivedFacts.length, fromVersion: memory.version, toVersion: next.version })}::jsonb,
      ${JSON.stringify(checkpoint)}::jsonb,${JSON.stringify([{ messageId: operation.sourceMessageId, hash: fingerprint(source.content) }])}::jsonb)`);
  return { content: JSON.stringify(receipt) };
}
