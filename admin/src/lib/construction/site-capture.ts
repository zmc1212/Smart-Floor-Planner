import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { AssistantError, fail, id, principalKey, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, newRun } from '@/lib/assistant/core/conversation';
import { maxSpeechBytes, speechAudio } from '@/lib/assistant/speech/audio';
import { speechConfigurationHash } from '@/lib/assistant/speech/local';
import { object } from './contracts';
import type { SiteDraft } from './site-contract';

// Shortcuts describe an explicit selection; they never advance the project stage.
export const siteQuickWorks = [
  { id: 'wiring', label: '穿线', stage: 'utilities' },
  { id: 'conduit', label: '线管敷设', stage: 'utilities' },
  { id: 'water_test', label: '试水', stage: 'utilities' },
  { id: 'tile_layout', label: '排版', stage: 'masonry_carpentry' },
  { id: 'tiling', label: '铺贴', stage: 'masonry_carpentry' },
  { id: 'ceiling', label: '吊顶', stage: 'masonry_carpentry' },
] as const;
export const siteProgressLabels = { done: '做完了', partial: '做了一部分', not_started: '还没做', unsure: '说不准' } as const;
type Quick = { kind: 'quick'; workId: string; roomId: string | null; location: 'whole' | 'unsure' | null; progress: keyof typeof siteProgressLabels };
export function captureInput(value: unknown): { kind: 'free' } | Quick {
  if ((value as Row)?.kind === 'free') { object(value, ['kind']); return { kind: 'free' }; }
  const v = object(value, ['kind', 'workId', 'roomId', 'location', 'progress']);
  if (v.kind !== 'quick' || !siteQuickWorks.some(w => w.id === v.workId) || !Object.hasOwn(siteProgressLabels, String(v.progress))
    || !(v.roomId === null ? ['whole', 'unsure'].includes(String(v.location)) : typeof v.roomId === 'string' && /^[1-9]\d{0,18}$/.test(v.roomId) && v.location === null)) fail('invalid_construction', 422);
  if (v.roomId) id(v.roomId);
  return v as Quick;
}
export function captureAudio(value: unknown) {
  if (value === undefined) return null;
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maxSpeechBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('speech_audio_invalid', 422);
  const bytes = Buffer.from(value, 'base64');
  return { ...speechAudio(bytes), bytes };
}
export async function capturedRecord(tx: PostgresTransaction, eid: string, projectId: string, recordId: string) {
  return !!await one(tx, sql`select record_id from app.construction_site_record_versions where enterprise_id=${eid}
    and project_id=${projectId} and record_id=${recordId} and snapshot ? 'capture' limit 1`);
}
/** Admission failure cannot roll back already received materials. Unexpected database errors still abort. */
export async function scheduleCapturedRecord(tx: PostgresTransaction, actor: ActorContext, c: Row, record: Row) {
  await tx.execute(sql`savepoint site_capture_schedule`);
  try {
    const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`))!;
    const run = await newRun(tx, actor, c, settings, String(record.source_message_id), record.run_id ? String(record.run_id) : undefined,
      { kind: 'user_message', messageId: String(record.source_message_id) }, 'site.record');
    await tx.execute(sql`update app.construction_site_records set run_id=${run.runId} where enterprise_id=${actor.enterpriseId} and id=${String(record.id)}`);
    await tx.execute(sql`release savepoint site_capture_schedule`);
    return run;
  } catch (error) {
    await tx.execute(sql`rollback to savepoint site_capture_schedule`);
    await tx.execute(sql`release savepoint site_capture_schedule`);
    if (!(error instanceof AssistantError) || !['assistant_quota_exceeded', 'conversation_busy', 'assistant_disabled', 'provider_outcome_unknown'].includes(error.code)) throw error;
    return { runId: null, status: 'not_scheduled', errorCode: error.code };
  }
}
export async function saveSiteCapture(tx: PostgresTransaction, actor: ActorContext, c: Row, projectId: string, body: Row, requestKey: string) {
  if (actor.principal.kind !== 'admin') fail('construction_forbidden', 403);
  const eid = actor.enterpriseId, selection = captureInput(body.capture), audio = captureAudio(body.recording);
  const raw = String(body.text || '').trim(), mediaIds = body.mediaIds as string[];
  if (body.speech !== undefined || selection.kind === 'quick' && audio || selection.kind === 'free' && !raw && !audio && !mediaIds.length) fail('invalid_construction', 422);
  if (audio && Number((await one(tx, sql`select count(*) n from app.assistant_speech_assets where enterprise_id=${eid} and conversation_id=${String(c.id)}`))!.n) >= 20) fail('speech_limit', 422);
  const draft: SiteDraft = { title: '现场施工进展', roomId: null, completed: '', pending: '', coordination: '', note: raw };
  let roomName = '', original = raw;
  if (selection.kind === 'quick') {
    const room = selection.roomId ? await one(tx, sql`select name from app.construction_rooms where enterprise_id=${eid} and project_id=${projectId} and id=${selection.roomId}`) : null;
    if (selection.roomId && !room) fail('invalid_construction', 422);
    roomName = room ? String(room.name) : selection.location === 'whole' ? '全屋' : '部位待核对';
    const work = siteQuickWorks.find(w => w.id === selection.workId)!.label;
    original = `${roomName} · ${work} · ${siteProgressLabels[selection.progress]}${raw ? '\n' + raw : ''}`;
    Object.assign(draft, { title: work + '现场记录', roomId: selection.roomId });
    if (selection.progress === 'done') draft.completed = work + '：做完了';
    else if (selection.progress === 'partial') { draft.completed = work + '：做了一部分'; draft.pending = work + '尚未做完'; }
    else if (selection.progress === 'not_started') draft.pending = work + '：还没做';
    else draft.coordination = work + '进展待核对';
  }
  const blocks = original ? [{ type: 'text' as const, text: original }] : [{ type: 'notice' as const, code: audio ? 'site_recording' : 'site_photos',
    fallbackText: audio ? `语音上报 · ${Math.ceil(audio.durationMs / 1000)}秒` : `现场照片 · ${mediaIds.length}张` }];
  const message = await appendMessage(tx, actor, String(c.id), { author: 'admin', clientMessageId: requestKey, purpose: 'site.source', content: { version: 1, blocks } });
  const r = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,status,data,room_id,room_name_snapshot)
    values(${eid},${projectId},${String(c.id)},${String(message.id)},${actor.principal.adminId},${selection.kind === 'quick' ? 'draft' : 'organizing'},${JSON.stringify(draft)}::jsonb,${draft.roomId},${roomName}) returning *`))!;
  for (let i = 0; i < mediaIds.length; i++) await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position)
    values(${eid},${projectId},${String(r.id)},${mediaIds[i]},${i})`);
  let speechId: string | null = null;
  if (audio) {
    const a = (await one(tx, sql`insert into app.assistant_speech_assets(enterprise_id,conversation_id,project_id,principal_key,request_key,source_hash,duration_ms,byte_size,data,configuration_hash,message_id)
      values(${eid},${String(c.id)},${projectId},${principalKey(actor)},${requestKey},${audio.hash},${audio.durationMs},${audio.bytes.length},${audio.bytes},${speechConfigurationHash() || ''},${String(message.id)}) returning id`))!;
    speechId = String(a.id);
  }
  await tx.execute(sql`insert into app.construction_site_record_versions(enterprise_id,project_id,record_id,version,actor_id,action,snapshot)
    values(${eid},${projectId},${String(r.id)},1,${actor.principal.adminId},'submitted',${JSON.stringify({ data: draft, roomId: draft.roomId, roomName, status: r.status, audience: 'internal', sourceMessageId: String(message.id), capture: selection })}::jsonb)`);
  await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${eid},'construction.record.captured.v1','construction_site_record',${String(r.id)},1,${JSON.stringify(actor.principal)}::jsonb,${requestKey},
    ${JSON.stringify({ projectId, recordId: String(r.id), messageId: String(message.id), selection, speechId, mediaIds })}::jsonb)`);
  const run = selection.kind === 'free' ? await scheduleCapturedRecord(tx, actor, c, r) : { runId: null, status: 'draft' };
  return { conversationId: String(c.id), messageId: String(message.id), recordId: String(r.id), runId: run.runId,
    status: 'received', organizationStatus: run.status, requestKey, speechId, mediaIds };
}
