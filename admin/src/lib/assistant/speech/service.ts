import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { SiteChatService, recordVersion } from '@/lib/construction/site-chat';
import { AssistantMediaService } from '../media/service';
import { cancelRuns, idempotent, newRun } from '../core/conversation';
import { fail, id, key, principalKey, type ActorContext } from '../contracts';
import { speechAudio } from './audio';
import { speechConfigurationHash } from './local';

export type SpeechTarget = { kind: 'consultation'; id: string } | { kind: 'site'; id: string };
export class SpeechService {
  constructor(readonly actor: ActorContext, readonly target: SpeechTarget, private transaction?: PostgresTransaction) { id(target.id); }
  withScope<T>(write: boolean, work: (tx: PostgresTransaction, c: Row) => Promise<T>) {
    if (this.target.kind === 'consultation') return new AssistantMediaService(this.actor, this.transaction).withScope(this.target.id, write, (repo, c) => work(repo.tx, c));
    if (this.actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
    const service = new SiteChatService({ enterpriseId: this.actor.enterpriseId, adminId: this.actor.principal.adminId,
      miniProgramUserId: this.actor.entry?.miniProgramUserId as string | undefined, miniProgramContextVersion: this.actor.entry?.miniProgramContextVersion as number | undefined }, this.transaction);
    return write ? service.withWriteScope(this.target.id, (tx, c) => work(tx, c)) : service.withReadScope(this.target.id, (tx, c) => work(tx, c));
  }
  private async asset(tx: PostgresTransaction, cid: string, assetId: string, owner = false) {
    id(assetId);
    const asset = await one(tx, sql`select a.*,r.status,r.error_code from app.assistant_speech_assets a left join app.assistant_runs r on r.enterprise_id=a.enterprise_id and r.id=a.run_id
      where a.enterprise_id=${this.actor.enterpriseId} and a.conversation_id=${cid} and a.id=${assetId} and a.deleted_at is null for update of a`);
    if (!asset || (asset.principal_key !== principalKey(this.actor) && (owner || !asset.message_id))) fail('assistant_resource_not_found', 404);
    return asset;
  }
  private dto(a: Row) {
    return { id: String(a.id), conversationId: String(a.conversation_id), projectId: a.project_id ? String(a.project_id) : null,
      version: Number(a.version), durationMs: Number(a.duration_ms), sourceHash: a.source_hash,
      status: a.message_id ? 'sent' : a.status, errorCode: a.error_code || null, runId: a.run_id ? String(a.run_id) : null,
      messageId: a.message_id ? String(a.message_id) : null, transcript: a.transcript, correctedText: a.corrected_text,
      own: a.principal_key === principalKey(this.actor) };
  }
  list() {
    return this.withScope(false, async (tx, c) => {
      const items = await rows(tx, sql`select a.*,r.status,r.error_code from app.assistant_speech_assets a left join app.assistant_runs r on r.enterprise_id=a.enterprise_id and r.id=a.run_id
        where a.enterprise_id=${this.actor.enterpriseId} and a.conversation_id=${String(c.id)} and a.deleted_at is null
          and (a.principal_key=${principalKey(this.actor)} or a.message_id is not null) order by a.id desc limit 30`);
      return { available: !!speechConfigurationHash(), items: items.map(a => this.dto(a)) };
    });
  }
  read(assetId: string) { return this.withScope(false, async (tx, c) => { const a = await this.asset(tx, String(c.id), assetId); return { data: a.data as Buffer, mime: 'audio/wav' }; }); }
  upload(requestKey: string, bytes: Buffer) {
    key(requestKey);
    return this.withScope(true, async (tx, c) => {
      const configuration = speechConfigurationHash(); if (!configuration) fail('speech_unavailable', 503);
      const audio = speechAudio(bytes), cid = String(c.id), eid = this.actor.enterpriseId;
      const prior = await one(tx, sql`select id,source_hash,deleted_at from app.assistant_speech_assets where enterprise_id=${eid} and conversation_id=${cid}
        and principal_key=${principalKey(this.actor)} and request_key=${requestKey}`);
      if (prior) { if (prior.source_hash !== audio.hash) fail('idempotency_conflict'); return this.dto(await this.asset(tx, cid, String(prior.id), true)); }
      const count = await one(tx, sql`select count(*) n from app.assistant_speech_assets where enterprise_id=${eid} and conversation_id=${cid}`);
      if (Number(count!.n) >= 20) fail('speech_limit', 422);
      const a = (await one(tx, sql`insert into app.assistant_speech_assets(enterprise_id,conversation_id,project_id,principal_key,request_key,source_hash,duration_ms,byte_size,data,configuration_hash)
        values(${eid},${cid},${this.target.kind === 'site' ? this.target.id : null},${principalKey(this.actor)},${requestKey},${audio.hash},${audio.durationMs},${bytes.length},${bytes},${configuration}) returning *`))!;
      return this.schedule(tx, c, a, requestKey);
    });
  }
  private async schedule(tx: PostgresTransaction, c: Row, a: Row, requestKey: string) {
    const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
      values(${this.actor.enterpriseId},'assistant.speech.uploaded.v1','assistant_speech',${String(a.id)},${Number(a.version)},${JSON.stringify(this.actor.principal)}::jsonb,${requestKey},
      ${JSON.stringify({ speechId: String(a.id), sourceHash: a.source_hash, configurationHash: a.configuration_hash })}::jsonb) returning id`))!;
    const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId}`))!;
    const run = await newRun(tx, this.actor, c, settings, null, a.run_id ? String(a.run_id) : undefined, { kind: 'domain_event', eventId: String(event.id) }, 'speech.transcribe');
    const updated = (await one(tx, sql`update app.assistant_speech_assets set run_id=${run.runId},version=version+1,updated_at=now() where enterprise_id=${this.actor.enterpriseId} and id=${String(a.id)} returning *`))!;
    return this.dto({ ...updated, status: run.status });
  }
  retry(assetId: string, expectedVersion: number, requestKey: string) {
    key(requestKey);
    return this.withScope(true, async (tx, c) => {
      const asset = await this.asset(tx, String(c.id), assetId, true);
      return idempotent(tx, this.actor, 'speech:retry:' + assetId, requestKey, { expectedVersion }, async () => {
        if (asset.message_id || asset.version !== expectedVersion || !['failed', 'cancelled'].includes(String(asset.status))) fail('speech_review_required', 422);
        if (asset.configuration_hash !== speechConfigurationHash()) fail('context_changed');
        return this.schedule(tx, c, asset, requestKey);
      });
    });
  }
  remove(assetId: string, requestKey: string) {
    key(requestKey);
    return this.withScope(false, async (tx, c) => idempotent(tx, this.actor, 'speech:remove:' + assetId, requestKey, {}, async () => {
      const a = await this.asset(tx, String(c.id), assetId, true), eid = this.actor.enterpriseId;
      await cancelRuns(tx, this.actor, String(c.id));
      await tx.execute(sql`update app.assistant_conversations set context_revision=context_revision+1,version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(c.id)}`);
      if (a.message_id) {
        await tx.execute(sql`update app.assistant_messages set content=${JSON.stringify({ version: 1, blocks: [{ type: 'notice', code: 'speech_deleted', fallbackText: '录音及其转写已删除。' }] })}::jsonb,
          version=version+1,updated_at=now() where enterprise_id=${eid} and conversation_id=${String(c.id)} and id=${String(a.message_id)}`);
        const records = await rows(tx, sql`update app.construction_site_records set status='withdrawn',data='{}'::jsonb,withdrawal_reason='原语音来源已撤回',version=version+1,updated_at=now()
          where enterprise_id=${eid} and conversation_id=${String(c.id)} and source_message_id=${String(a.message_id)} returning *`);
        for (const r of records) await recordVersion(tx, eid, r, this.actor.principal.kind === 'admin' ? this.actor.principal.adminId : '', 'withdraw');
      }
      await tx.execute(sql`update app.assistant_speech_assets set data=null,transcript='',corrected_text='',deleted_at=now(),version=version+1,updated_at=now() where enterprise_id=${eid} and id=${assetId}`);
      return { id: assetId, deleted: true };
    }));
  }
}
