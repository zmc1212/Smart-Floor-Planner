import { setTimeout as delay } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, type ActorContext } from '../contracts';
import { historyRefsAvailable, type HistoryRef } from '../agent/history';
import { synthesisContextAvailable } from '../agent/synthesis-sources';
import type { SynthesisContext } from '../agent/synthesis';
import { runContext, type Lease } from '../infrastructure/job-queue';

export const replyStreamProtocol = 'customer-reply-stream-v1';
const previewStep = 1028;
const previewKind = 'customer_reply_preview';
const emptyPreview = { text: '', revision: 0 };
type PreviewProof = { context: SynthesisContext; history: HistoryRef[] };
type PreviewFrame = typeof emptyPreview;

export function replyStreamAvailable(actor: ActorContext, conversation: Row, run: Row) {
  return actor.principal.kind === 'user' && conversation.purpose === 'customer_consultation'
    && run.purpose === 'reply' && (run.policy_snapshot as Row)?.replyStream === replyStreamProtocol;
}

async function previewAllowed(tx: PostgresTransaction, actor: ActorContext, conversation: Row, proof: PreviewProof) {
  return !(conversation.entry_snapshot as Row)?.retentionRedacted
    && await historyRefsAvailable(tx, actor.enterpriseId, String(conversation.id), proof.history)
    && await synthesisContextAvailable(tx, actor, conversation, proof.context);
}

/** Save only completed, independently checked paragraphs under the current
 * lease. The temporary prefix never enters assistant_messages. */
export async function saveReplyPreview(lease: Lease, text: string, proof?: PreviewProof) {
  await withTenantTransaction(lease.enterpriseId, async tx => {
    const { conversation, run } = await runContext(tx, lease);
    if (!replyStreamAvailable(lease.actor, conversation, run)) fail('context_changed');
    if (text && (!proof || text.length > 16000 || !await previewAllowed(tx, lease.actor, conversation, proof))) fail('context_changed');
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,private_checkpoint,source_refs)
      values(${lease.enterpriseId},${lease.runId},${previewStep},${previewKind},'succeeded',
        ${JSON.stringify({ leaseToken: lease.token, text })}::jsonb,${JSON.stringify(proof ?? {})}::jsonb)
      on conflict(enterprise_id,run_id,step_seq) do update set private_checkpoint=excluded.private_checkpoint,
        source_refs=excluded.source_refs,version=app.assistant_run_steps.version+1,updated_at=now()
      where app.assistant_run_steps.kind=${previewKind}`);
  });
}

export async function readReplyPreview(tx: PostgresTransaction, actor: ActorContext, run: Row): Promise<PreviewFrame> {
  if (run.status !== 'running') return emptyPreview;
  const step = await one(tx, sql`select s.version,s.private_checkpoint,s.source_refs,j.id::text as job_id,j.lease_token
    from app.assistant_run_steps s join app.assistant_jobs j on j.enterprise_id=s.enterprise_id and j.run_id=s.run_id
    where s.enterprise_id=${actor.enterpriseId} and s.run_id=${String(run.id)} and s.step_seq=${previewStep} and s.kind=${previewKind}
      and j.status='running' and j.lease_expires_at>now()`);
  const saved = step?.private_checkpoint as { leaseToken?: string; text?: string } | undefined;
  if (!step || !saved?.text || saved.leaseToken !== step.lease_token) return emptyPreview;
  try {
    const { conversation } = await runContext(tx, { actor, enterpriseId: actor.enterpriseId, runId: String(run.id),
      jobId: String(step.job_id), token: String(step.lease_token) });
    const proof = step.source_refs as PreviewProof;
    if (!proof?.context || !await previewAllowed(tx, actor, conversation, proof)) return emptyPreview;
    return { text: saved.text, revision: Number(step.version) };
  } catch (error) {
    if (error instanceof AssistantError && [403, 404, 409].includes(error.status)) return emptyPreview;
    throw error;
  }
}

const streamActive = (status: unknown) => status === 'queued' || status === 'running';

/** One bounded connection per active UI. Reopening starts from the current
 * authorized prefix, so dropped chunks never require reissuing a turn. */
export function replyStreamResponse(read: () => Promise<Row>, initial: Row, signal: AbortSignal) {
  if (!initial.answerStreaming) fail('assistant_resource_not_found', 404);
  const encode = new TextEncoder(), expiresAt = Date.now() + 24_000;
  let first: Row | null = initial, last = '', stopped = false;
  const send = (controller: ReadableStreamDefaultController<Uint8Array>, value: unknown) => {
    // ASCII JSON lines avoid splitting a multibyte character in old Mini Program hosts.
    controller.enqueue(encode.encode(JSON.stringify(value).replace(/[^\x00-\x7f]/gu,
      char => char.split('').map(part => '\\u' + part.charCodeAt(0).toString(16).padStart(4, '0')).join('')) + '\n'));
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (!stopped && !signal.aborted && Date.now() < expiresAt) {
          const run = first ?? await read();
          first = null;
          if (stopped || signal.aborted) break;
          if (!run.answerStreaming || !streamActive(run.status)) {
            send(controller, { type: 'settled' });
            controller.close();
            return;
          }
          const frame = (run.answerPreview as PreviewFrame | undefined) ?? emptyPreview;
          const key = `${frame.revision}:${frame.text}`;
          if (key !== last) { last = key; send(controller, { type: 'preview', ...frame }); return; }
          await delay(600, undefined, { signal });
        }
      } catch {
        if (!stopped && !signal.aborted) send(controller, { type: 'refresh' });
      }
      if (!stopped) controller.close();
    },
    cancel() { stopped = true; },
  });
  return new Response(body, { headers: {
    'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no',
  } });
}
