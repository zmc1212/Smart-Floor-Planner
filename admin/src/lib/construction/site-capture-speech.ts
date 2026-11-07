import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '@/lib/assistant/contracts';
import { speechAudio } from '@/lib/assistant/speech/audio';
import { speechConfigurationHash, transcribeLocal } from '@/lib/assistant/speech/local';
import { heartbeat, type Lease } from '@/lib/assistant/infrastructure/job-queue';

type Scope = <T>(work: (tx: PostgresTransaction, record: Row) => Promise<T>) => Promise<T>;
/** A local transcription step in the original site.record job, with the same original audio and accounting. */
export async function transcribeCapturedSpeech(lease: Lease, scope: Scope, transcribe = transcribeLocal) {
  const initial = await scope(async (tx, record) => {
    const a = await one(tx, sql`select * from app.assistant_speech_assets where enterprise_id=${lease.enterpriseId}
      and conversation_id=${String(record.conversation_id)} and message_id=${String(record.source_message_id)} and deleted_at is null for update`);
    if (!a || a.transcript) return null;
    const binding = speechConfigurationHash();
    if (!binding) fail('speech_unavailable', 503);
    if (a.configuration_hash && a.configuration_hash !== binding) fail('context_changed');
    if (speechAudio(a.data as Buffer).hash !== a.source_hash) fail('context_changed');
    if (await one(tx, sql`select id from app.assistant_run_steps where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1090`)) fail('speech_result_unknown');
    await tx.execute(sql`update app.assistant_speech_assets set configuration_hash=${binding} where enterprise_id=${lease.enterpriseId} and id=${String(a.id)}`);
    await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
      values(${lease.enterpriseId},${lease.runId},1090,'speech_local','running',${JSON.stringify({ sourceHash: a.source_hash, configurationHash: binding, durationMs: a.duration_ms })}::jsonb)`);
    await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,cost_micros,currency,measurement_kind)
      values(${lease.enterpriseId},${lease.runId},${'speech:' + lease.runId},'audio_input_ms',${Number(a.duration_ms)},0,'CNY','observed') on conflict do nothing`);
    return { id: String(a.id), data: a.data as Buffer, source_hash: String(a.source_hash), duration_ms: Number(a.duration_ms), configuration_hash: binding };
  });
  if (!initial) return;
  const started = Date.now(), timer = setInterval(() => { heartbeat(lease).catch(() => undefined); }, 30000);
  try {
    const result = await transcribe(initial.data as Buffer);
    if (!result.text?.trim() || result.text.length > 4000 || result.configurationHash !== initial.configuration_hash
      || result.durationMs !== Number(initial.duration_ms) || speechConfigurationHash() !== initial.configuration_hash) fail('speech_transcription_invalid', 502);
    await scope(async (tx, record) => {
      const a = await one(tx, sql`select id from app.assistant_speech_assets where enterprise_id=${lease.enterpriseId} and id=${String(initial.id)}
        and message_id=${String(record.source_message_id)} and deleted_at is null and source_hash=${String(initial.source_hash)} for update`);
      if (!a) fail('context_changed');
      await tx.execute(sql`update app.assistant_speech_assets set transcript=${result.text.trim()},version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and id=${String(a.id)}`);
      await tx.execute(sql`update app.assistant_run_steps set status='succeeded',duration_ms=${Date.now() - started},
        private_checkpoint=${JSON.stringify({ modelHash: result.modelHash, transcriptStoredPrivately: true })}::jsonb
        where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1090`);
    });
  } catch (error) {
    // Preserve the local attempt outcome even if project access was revoked in flight.
    await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.assistant_run_steps set status='failed',duration_ms=${Date.now() - started},
      private_checkpoint=${JSON.stringify({ errorCode: error instanceof AssistantError ? error.code : 'speech_local_failed' })}::jsonb
      where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1090 and status='running'`));
    throw error;
  } finally { clearInterval(timer); }
}
