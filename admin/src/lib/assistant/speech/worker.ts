import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail } from '../contracts';
import { runContext, heartbeat, markProviderStarted, completeLocalSpeech, failRun, type Lease } from '../infrastructure/job-queue';
import { SpeechService } from './service';
import { speechConfigurationHash, transcribeLocal } from './local';
import { speechAudio } from './audio';

export async function processSpeech(lease: Lease, transcribe = transcribeLocal) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let started = 0;
  const scoped = async <T>(work: (tx: Parameters<typeof runContext>[0], asset: Row) => Promise<T>) => {
    const a = await withTenantTransaction(lease.enterpriseId, tx => one(tx, sql`select * from app.assistant_speech_assets where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and deleted_at is null`));
    if (!a) fail('context_changed');
    const service = new SpeechService(lease.actor, { kind: a.project_id ? 'site' : 'consultation', id: String(a.project_id || a.conversation_id) });
    return service.withScope(true, async (tx) => {
      const context = await runContext(tx, lease);
      const asset = await one(tx, sql`select * from app.assistant_speech_assets where enterprise_id=${lease.enterpriseId} and id=${String(a.id)} and run_id=${lease.runId} and deleted_at is null for update`);
      if (!asset || asset.message_id || context.run.purpose !== 'speech.transcribe' || asset.configuration_hash !== speechConfigurationHash()) fail('context_changed');
      return work(tx, asset);
    });
  };
  try {
    const initial = await scoped(async (_tx, asset) => asset), bytes = initial.data as Buffer;
    if (speechAudio(bytes).hash !== initial.source_hash) fail('context_changed');
    await markProviderStarted(lease);
    started = Date.now();
    await withTenantTransaction(lease.enterpriseId, async tx => {
      await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
        values(${lease.enterpriseId},${lease.runId},1200,'speech_local','running',${JSON.stringify({ sourceHash: initial.source_hash, configurationHash: initial.configuration_hash, durationMs: initial.duration_ms })}::jsonb)`);
      await tx.execute(sql`insert into app.assistant_usage_records(enterprise_id,run_id,operation_key,category,quantity,cost_micros,currency,measurement_kind)
        values(${lease.enterpriseId},${lease.runId},${'speech:' + lease.runId},'audio_input_ms',${Number(initial.duration_ms)},0,'CNY','observed') on conflict do nothing`);
    });
    timer = setInterval(() => { heartbeat(lease).catch(() => undefined); }, 30000);
    const result = await transcribe(bytes);
    if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 4000 || result.configurationHash !== initial.configuration_hash || result.durationMs !== Number(initial.duration_ms)) fail('speech_transcription_invalid', 502);
    await scoped(async () => undefined);
    await completeLocalSpeech(lease, result.durationMs, async tx => {
      const service = new SpeechService(lease.actor, { kind: initial.project_id ? 'site' : 'consultation', id: String(initial.project_id || initial.conversation_id) }, tx);
      await service.withScope(true, async () => undefined);
      const current = await one(tx, sql`select id from app.assistant_speech_assets where enterprise_id=${lease.enterpriseId} and id=${String(initial.id)} and run_id=${lease.runId}
        and deleted_at is null and configuration_hash=${result.configurationHash} for update`);
      if (!current || speechConfigurationHash() !== result.configurationHash) fail('context_changed');
      await tx.execute(sql`update app.assistant_speech_assets set transcript=${result.text.trim()},version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and id=${String(initial.id)}`);
      await tx.execute(sql`update app.assistant_run_steps set status='succeeded',private_checkpoint=${JSON.stringify({ modelHash: result.modelHash, transcriptStoredPrivately: true })}::jsonb,
        duration_ms=${Date.now() - started},version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1200`);
    });
  } catch (error) {
    const code = error instanceof AssistantError ? error.code : error instanceof Error && error.message === 'speech_timeout' ? 'speech_result_unknown' : 'speech_transcription_failed';
    if (started) await withTenantTransaction(lease.enterpriseId, tx => tx.execute(sql`update app.assistant_run_steps set status='failed',duration_ms=${Date.now() - started},
      private_checkpoint=${JSON.stringify({ code, externalProvider: false })}::jsonb,version=version+1,updated_at=now() where enterprise_id=${lease.enterpriseId} and run_id=${lease.runId} and step_seq=1200`));
    try { await failRun(lease, code, true); }
    catch (e) { if (!(e instanceof AssistantError && e.code === 'context_changed')) throw e; }
  } finally { if (timer) clearInterval(timer); }
}
