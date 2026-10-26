import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { RequirementWorkflow } from '@/lib/assistant/requirements/workflow';
import { requirementItems, requirementSources } from '@/lib/assistant/requirements/items';
import type { ActorContext } from '@/lib/assistant/contracts';

// Saved provider requests and evidence contain heterogeneous historical shapes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
export const selectionTrace = 'tmp/agent-contract/trial-requirement-proposal-os08-2026-10-26T09-30-02-332Z.json';
export const selectionOriginal = 'tmp/agent-contract/trial-2026-10-25T06-01-28-936Z.json';

/** Replay actual first-draft operations, rebinding only source/item identifiers. */
export async function replaySelectionCase(root: string, actor: ActorContext, cid: string, trial: 1 | 2, own: (id: string) => void) {
  const trace = JSON.parse(fs.readFileSync(path.join(root, selectionTrace), 'utf8'));
  const original = JSON.parse(fs.readFileSync(path.join(root, selectionOriginal), 'utf8')).cases.find((c: Row) => c.id === 'createAgent.1.reversal');
  const saved = trace.cases.find((c: Row) => c.id === `reversal.${trial}`);
  assert.equal(saved.passed, false);
  const system = trace.calls.find((c: Row) => c.case === saved.id).request.messages[0].content;
  const context = JSON.parse(system.slice(system.indexOf('Context: ') + 9));
  const oldMessages = original.context.customerMessages as { id: string; text: string }[];
  const groups = [...new Set<string>(context.customerClauses.map((c: Row) => c.sourceMessageId))];
  assert.equal(groups.length, oldMessages.length);
  const mapping = new Map<string, string>();
  const append = async (index: number) => {
    const old = oldMessages[index];
    assert.deepEqual(context.customerClauses.filter((c: Row) => c.sourceMessageId === groups[index]).map((c: Row) => c.text),
      requirementSources([old]).map(c => c.text));
    await withTenantTransaction(actor.enterpriseId, async tx => {
      const m = await appendMessage(tx, actor, cid, { author:'user',clientMessageId:randomUUID(),content:{version:1,blocks:[{type:'text',text:old.text}]} });
      mapping.set(groups[index], String(m.id));
    });
  };
  await withTenantTransaction(actor.enterpriseId, tx => tx.execute(sql`update app.assistant_conversations
    set entry_snapshot=entry_snapshot||'{"requirementReviewMode":true,"requirementWorkflow":"langgraph"}'::jsonb
    where enterprise_id=${actor.enterpriseId} and id=${cid}`));
  for (let i=0;i<oldMessages.length-1;i++) await append(i);
  const workflow = new RequirementWorkflow(actor);
  let evidence = await workflow.requirements.customerEvidence(cid);
  const sources = requirementSources(evidence.messages);
  const seed = await workflow.propose(cid,randomUUID(),{sourceSeq:evidence.sourceSeq,baseSummaryId:null,
    changes:context.savedItems.map((item: Row) => {
      const source = sources.find(s => s.sourceMessageId === mapping.get(item.sourceMessageId) && s.text === item.text);
      assert.ok(source); return {operation:'add',field:item.field,sourceId:source.id};
    })});
  assert.equal(seed.kind,'proposal'); if(seed.kind!=='proposal')throw Error('seed_proposal'); own(String(seed.proposal.id));
  const baseline = await workflow.write(cid,randomUUID(),{action:'apply_proposal',proposalId:seed.proposal.id,digest:seed.proposal.digest,consent:true});
  await append(oldMessages.length-1);
  evidence = await workflow.requirements.customerEvidence(cid);
  const items = requirementItems(evidence.messages,baseline.draftFields);
  const rawChanges = saved.firstDraft.toolCalls[0].args.changes;
  const changes = rawChanges.map((raw: Row) => {
    const next = {...raw};
    if (raw.targetId) {
      const old = context.savedItems.find((i: Row) => i.id === raw.targetId); assert.ok(old);
      const target = items.find(i => i.field===old.field && i.text===old.text && i.sourceMessageId===mapping.get(old.sourceMessageId));
      assert.ok(target); next.targetId=target.id;
    }
    if (raw.sourceId) {
      const old = context.customerClauses.find((s: Row) => s.id===raw.sourceId); assert.ok(old);
      const source = requirementSources(evidence.messages).find(s=>s.sourceMessageId===mapping.get(old.sourceMessageId) && s.text===old.text);
      assert.ok(source); next.sourceId=source.id;
    }
    return next;
  });
  const pending = await workflow.propose(cid,randomUUID(),{sourceSeq:evidence.sourceSeq,baseSummaryId:baseline.id,changes});
  assert.equal(pending.kind,'proposal'); if(pending.kind!=='proposal')throw Error('wrong_proposal_missing'); own(String(pending.proposal.id));
  assert.deepEqual(pending.proposal.diff.map((d: Row)=>({field:d.field,before:d.before,after:d.after})),saved.proposal.proposal.diff.map((d: Row)=>({field:d.field,before:d.before,after:d.after})));
  return { baseline, proposal:pending.proposal, evidence, binding:{case:saved.id,source:selectionTrace,originalPassed:false,rawChanges,reboundChanges:changes,messageMapping:Object.fromEntries(mapping)} };
}
