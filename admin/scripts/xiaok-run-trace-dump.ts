/** Read-only dump of assistant run traces for the 2026-11-12 user-journey round. */
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { rows } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(path.resolve(process.cwd()), true);

const eid = process.env.DUMP_ENTERPRISE || '1454';
const outDir = path.resolve(process.argv[2] || '../tmp/xiaok-user-journey-20261112');
const runIds = (process.argv[3] || '3664,3665,3666,3667,3668,3669,3742,3743').split(',');

function textOf(content: unknown) {
  const c = content as Record<string, unknown>;
  if (Array.isArray(c?.blocks)) {
    return (c.blocks as Array<Record<string, unknown>>).map(b => String(b.text ?? '')).join('\n');
  }
  return JSON.stringify(content);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const report: unknown[] = [];
  for (const runId of runIds) {
    const run = (await withTenantTransaction(eid, tx => rows(tx, sql`
      select r.id, r.conversation_id, r.trigger_kind, r.trigger_message_id, r.purpose, r.status,
             r.answer_kind, r.policy_snapshot, r.error_code, r.started_at, r.completed_at,
             r.created_at, r.updated_at
      from app.assistant_runs r
      where r.enterprise_id=${eid} and r.id=${runId}`)))[0] as Record<string, unknown> | undefined;
    if (!run) {
      report.push({ runId, missing: true });
      console.log(`== run ${runId}: MISSING ==`);
      continue;
    }
    const trigger = (await withTenantTransaction(eid, tx => rows(tx, sql`
      select id, author_kind, content, created_at from app.assistant_messages
      where enterprise_id=${eid} and id=${run.trigger_message_id}`)))[0] as Record<string, unknown> | undefined;
    const steps = await withTenantTransaction(eid, tx => rows(tx, sql`
      select step_seq, kind, capability_name, capability_version, provider_attempt_id, status,
             input_summary, private_checkpoint, source_refs, duration_ms, created_at
      from app.assistant_run_steps
      where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
    const messages = await withTenantTransaction(eid, tx => rows(tx, sql`
      select id, seq, author_kind, user_id, admin_id, run_id, purpose, answer_kind, reply_to_message_id,
             content, created_at
      from app.assistant_messages
      where enterprise_id=${eid} and conversation_id=${run.conversation_id}
      order by seq`));
    const attempts = await withTenantTransaction(eid, tx => rows(tx, sql`
      select id, capability, provider_key, logical_model_key, remote_model, status, accepted,
             error_code, error_message, estimated_cost, actual_cost, metadata, created_at, updated_at
      from app.ai_provider_attempts
      where enterprise_id=${eid} and assistant_run_id=${runId} order by id`));
    const usage = await withTenantTransaction(eid, tx => rows(tx, sql`
      select id, provider_attempt_id, operation_key, category, quantity, cost_micros, currency,
             measurement_kind, input_tokens, output_tokens
      from app.assistant_usage_records
      where enterprise_id=${eid} and run_id=${runId} order by id`));
    const policy = (run.policy_snapshot ?? {}) as Record<string, unknown>;
    const snapshot = {
      runId,
      run: {
        id: run.id, conversationId: run.conversation_id, triggerKind: run.trigger_kind,
        purpose: run.purpose, status: run.status, answerKind: run.answer_kind,
        errorCode: run.error_code, startedAt: run.started_at, completedAt: run.completed_at,
        createdAt: run.created_at,
      },
      policy: {
        protocol: policy.protocol ?? null,
        identity: policy.identity ?? null,
        keys: Object.keys(policy),
        knowledgeEnabled: policy.knowledgeEnabled ?? null,
        reportCoordination: policy.reportCoordination ?? null,
        entrySnapshot: policy.entrySnapshot ?? null,
      },
      trigger: trigger ? { id: trigger.id, at: trigger.created_at, text: textOf(trigger.content) } : null,
      steps: steps.map(s => ({
        seq: s.step_seq, kind: s.kind, capability: s.capability_name, version: s.capability_version,
        attempt: s.provider_attempt_id, status: s.status, input: s.input_summary,
        checkpoint: s.private_checkpoint, sources: s.source_refs, ms: s.duration_ms, at: s.created_at,
      })),
      messages: messages.map(m => ({
        id: m.id, seq: m.seq, author: m.author_kind, userId: m.user_id, runId: m.run_id,
        purpose: m.purpose, answerKind: m.answer_kind, replyTo: m.reply_to_message_id,
        text: textOf(m.content), at: m.created_at,
      })),
      attempts: attempts.map(a => ({
        id: a.id, capability: a.capability, provider: a.provider_key, model: a.logical_model_key,
        remote: a.remote_model, status: a.status, accepted: a.accepted, errorCode: a.error_code,
        errorMessage: a.error_message, estimatedCost: a.estimated_cost, actualCost: a.actual_cost,
        metadata: a.metadata, at: a.created_at,
      })),
      usage: usage.map(u => ({
        id: u.id, attempt: u.provider_attempt_id, key: u.operation_key, category: u.category,
        quantity: u.quantity, costMicros: u.cost_micros, currency: u.currency,
        measurement: u.measurement_kind, inputTokens: u.input_tokens, outputTokens: u.output_tokens,
      })),
    };
    report.push(snapshot);
    fs.writeFileSync(path.join(outDir, `run-${runId}.json`), JSON.stringify(snapshot, null, 2));
    console.log(`== run ${runId}: ${run.status} purpose=${run.purpose} conv=${run.conversation_id} steps=${steps.length} attempts=${attempts.length} usage=${usage.length}`);
    console.log('   trigger:', (trigger ? textOf(trigger.content) : '(none)').slice(0, 160).replace(/\n/g, ' '));
    console.log('   steps:', steps.map(s => `${s.step_seq}:${s.kind}${s.capability_name ? '/' + s.capability_name : ''}:${s.status}`).join(' | '));
    const assistant = messages.filter(m => m.author_kind === 'assistant' && String(m.run_id) === String(runId));
    for (const m of assistant) console.log('   answer:', textOf(m.content).slice(0, 260).replace(/\n/g, ' '));
  }
  fs.writeFileSync(path.join(outDir, 'runs.json'), JSON.stringify(report, null, 2));
}
main().finally(() => closePostgresPool());
