import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key, type ActorContext } from '../contracts';
import { adaptSurveyGraphToRooms, parseFormalSurveyLayout } from '@/lib/survey-graph';
import { renderMiniAiFloorPlanControlPng, resolveMiniAiFloorPlanTarget } from '@/lib/ai/mini-ai-floorplan';
import { appendMessage, cancelRuns, newRun } from '../core/conversation';
import { agentConfig } from '../agent/config';
import { authorizeHandoffStaff } from '../handoff/service';

export const MAX_MEDIA_BYTES = 4 * 1024 * 1024;
type FormalSource = { leadId: string; floorPlanId: string; layoutHash: string; roomId: string; name: string };
async function formalPlan(repo: AssistantRepository, userId: string, leadId: string) {
  const p = await one(repo.tx, sql`select f.id,f.name,f.layout_data from app.leads l join app.floor_plans f
    on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id
    where l.enterprise_id=${repo.actor.enterpriseId} and l.id=${id(leadId)} and l.customer_user_id=${userId}
      and l.archived_at is null and f.status='completed' for share of l,f`);
  if (!p || !parseFormalSurveyLayout(p.layout_data)) return null;
  return p;
}
async function sourceAvailable(repo: AssistantRepository, m: Row) {
  const ref = m.source_ref as FormalSource | null;
  if (!ref) return true;
  const p = await formalPlan(repo, String(m.customer_user_id), ref.leadId);
  return !!p && String(p.id) === ref.floorPlanId;
}
export async function normalizeImage(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) fail('media_invalid', 422);
  try {
    const image = sharp(bytes, { limitInputPixels: 24000000, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['png', 'jpeg'].includes(meta.format || '') || (meta.pages || 1) !== 1) fail('media_invalid', 422);
    // Decode/re-encode to reject malformed files and remove EXIF/location data.
    const { data, info } = await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
    if (data.length > MAX_MEDIA_BYTES) fail('media_invalid', 422);
    return { data, width: info.width, height: info.height, mime: 'image/jpeg', hash: createHash('sha256').update(bytes).digest('hex') };
  } catch { fail('media_invalid', 422); }
}
export function mediaDto(m: Row) {
  return { id: String(m.id), kind: m.kind, roomName: m.room_name, width: Number(m.width), height: Number(m.height),
    bytes: Number(m.byte_size), createdAt: m.created_at, source: m.source_ref || null };
}

export class AssistantMediaService {
  constructor(readonly actor: ActorContext) {}
  private scoped<T>(conversationId: string, write: boolean, work: (repo: AssistantRepository, c: Row) => Promise<T>) {
    id(conversationId);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor);
      await repo.settings(write);
      let c: Row | undefined;
      if (this.actor.principal.kind === 'user') c = await repo.conversation(conversationId);
      else {
        if (write) fail('assistant_capability_forbidden', 403);
        const staff = await authorizeHandoffStaff(repo);
        c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${this.actor.enterpriseId}
          and id=${conversationId} and purpose='customer_consultation' and status='open' for update`);
        const h = (c?.entry_snapshot as Row)?.handoff as Row | undefined;
        if (!h || h.mediaConsent !== true || h.state !== 'active' ||
          (h.state === 'active' && (String(h.ownerId) !== String(staff.id) || !await one(tx, sql`select id from app.assistant_participants
            where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and admin_id=${String(staff.id)}
            and participant_role='handoff_staff' and status='active' and grant_basis->>'requestId'=${String(h.requestId)}`)))) fail('assistant_resource_not_found', 404);
      }
      if (!c || (c.entry_snapshot as Row)?.retentionRedacted) fail('assistant_resource_not_found', 404);
      return work(repo, c);
    });
  }
  list(conversationId: string) {
    return this.scoped(conversationId, false, async repo => {
      const found = await rows(repo.tx, sql`select id,kind,room_name,width,height,byte_size,created_at,source_ref,customer_user_id
        from app.assistant_media where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and deleted_at is null order by id`);
      const items = [];
      for (const m of found) if (await sourceAvailable(repo, m)) items.push(mediaDto(m));
      return { items };
    });
  }
  read(conversationId: string, mediaId: string) {
    id(mediaId);
    return this.scoped(conversationId, false, async repo => {
      const m = await one(repo.tx, sql`select data,mime_type,source_ref,customer_user_id from app.assistant_media where enterprise_id=${this.actor.enterpriseId}
        and conversation_id=${conversationId} and id=${mediaId} and deleted_at is null`);
      if (!m || !await sourceAvailable(repo, m)) fail('assistant_resource_not_found', 404);
      return { data: m.data as Buffer, mime: String(m.mime_type) };
    });
  }
  async upload(conversationId: string, requestKey: string, bytes: Buffer, kind: unknown, roomName: unknown, source?: FormalSource) {
    key(requestKey);
    if (!['image', 'floorplan'].includes(String(kind)) || typeof roomName !== 'string' || roomName.trim().length > 80) fail('media_invalid', 422);
    // Authenticate before expensive decode; revalidate again at the write boundary.
    await this.scoped(conversationId, true, async () => undefined);
    const image = await normalizeImage(bytes), room = roomName.trim();
    return this.scoped(conversationId, true, async (repo, c) => {
      if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
      if (source) {
        const current = await formalPlan(repo, this.actor.principal.userId, source.leadId);
        if (!current || String(current.id) !== source.floorPlanId || fingerprint(current.layout_data) !== source.layoutHash) fail('context_changed');
      }
      const existing = await one(repo.tx, sql`select id,source_hash,kind,room_name,source_ref,deleted_at from app.assistant_media
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and request_key=${requestKey}`);
      if (existing) {
        if (existing.source_hash !== image.hash || existing.kind !== kind || existing.room_name !== room || fingerprint(existing.source_ref) !== fingerprint(source || null)) fail('idempotency_conflict');
        if (existing.deleted_at) fail('assistant_resource_not_found', 404);
        return { id: String(existing.id), conversationId };
      }
      if (c.status !== 'open' || !['ai', 'human', 'handoff_requested'].includes(String(c.mode))) fail('conversation_read_only');
      const count = await one(repo.tx, sql`select count(*) n from app.assistant_media where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId}`);
      if (Number(count!.n) >= 20) fail('media_limit', 422);
      const m = (await one(repo.tx, sql`insert into app.assistant_media(enterprise_id,conversation_id,customer_user_id,request_key,source_hash,kind,room_name,mime_type,width,height,byte_size,data,source_ref)
        values(${this.actor.enterpriseId},${conversationId},${this.actor.principal.userId},${requestKey},${image.hash},${String(kind)},${room},${image.mime},${image.width},${image.height},${image.data.length},${image.data},${source ? JSON.stringify(source) : null}::jsonb) returning id`))!;
      const message = await appendMessage(repo.tx, this.actor, conversationId, { author: 'user', clientMessageId: 'media:' + requestKey,
        purpose: 'media.upload', content: { version: 1, blocks: [{ type: 'notice', code: 'media_uploaded', fallbackText: (kind === 'floorplan' ? '已上传户型参考图' : '已上传参考图片') + '，可在本次图片资料中查看。' }] } });
      // Only a capability-verified enterprise opt-in schedules perception. Legacy
      // mode retains the honest receipt; both paths commit atomically with media.
      // Waiting/human conversations keep their existing no-AI-interjection policy.
      if (c.mode === 'ai') {
        const settings = (await one(repo.tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${this.actor.enterpriseId}`))!;
        const agent = agentConfig(settings.agent_config);
        if (agent?.imageInput) {
          await newRun(repo.tx, this.actor, c, settings, String(message.id));
        }
        const event = await one(repo.tx, sql`insert into app.domain_event_outbox
          (enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
          values(${this.actor.enterpriseId},'assistant.media.received.v1','assistant_conversation',${conversationId},
            ${Number(c.version) + 1},${JSON.stringify(this.actor.principal)}::jsonb,${requestKey},
            ${JSON.stringify({ mediaId: String(m.id) })}::jsonb) returning id`);
        await appendMessage(repo.tx, this.actor, conversationId, { author: 'system', eventId: String(event!.id), purpose: 'media.receipt',
          content: { version: 1, blocks: [{ type: 'notice', code: 'media_received',
            fallbackText: agent?.imageInput ? '图片已收到，小K正在查看。' : '图片已收到。目前小K暂不能识别图片内容，你可以补充想咨询的问题，或请设计师接着聊。' }] } });
      }
      return { id: String(m.id), conversationId };
    });
  }
  floorPlans(conversationId: string) {
    return this.scoped(conversationId, false, async repo => {
      if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
      const plans = await rows(repo.tx, sql`select l.id lead_id,f.id,f.name,f.layout_data from app.leads l join app.floor_plans f
        on f.enterprise_id=l.enterprise_id and f.id=l.primary_floor_plan_id where l.enterprise_id=${this.actor.enterpriseId}
        and l.customer_user_id=${this.actor.principal.userId} and l.archived_at is null and f.status='completed' order by l.id desc limit 100`);
      return { items: plans.filter(p => parseFormalSurveyLayout(p.layout_data)).map(p => ({
        leadId: String(p.lead_id), id: String(p.id), name: String(p.name), layoutHash: fingerprint(p.layout_data),
        rooms: adaptSurveyGraphToRooms(p.layout_data).map(r => ({ id: r.id, name: r.name })),
      })) };
    });
  }
  async attachFormal(conversationId: string, requestKey: string, input: Row) {
    if (Object.keys(input).some(k => !['leadId','floorPlanId','layoutHash','roomId'].includes(k)) || typeof input.roomId !== 'string' || input.roomId.length > 128) fail('invalid_message', 422);
    const p = await this.scoped(conversationId, true, async repo => {
      if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
      return formalPlan(repo, this.actor.principal.userId, id(input.leadId));
    });
    if (!p || String(p.id) !== input.floorPlanId || fingerprint(p.layout_data) !== input.layoutHash) fail('context_changed');
    let target;
    try { target = resolveMiniAiFloorPlanTarget(p.layout_data, input.roomId ? 'single_room' : 'whole_floor_plan', input.roomId || undefined); }
    catch { fail('invalid_message', 422); }
    const bytes = await renderMiniAiFloorPlanControlPng(p.layout_data, 1600, input.roomId || undefined);
    return this.upload(conversationId, requestKey, bytes, 'floorplan', input.roomId ? target.targetLabel : '', {
      leadId: String(input.leadId), floorPlanId: String(p.id), layoutHash: String(input.layoutHash), roomId: input.roomId, name: String(p.name),
    });
  }
  remove(conversationId: string, mediaId: string) {
    id(mediaId);
    // Deletion remains possible when enterprise writing is disabled or the conversation is archived.
    return this.scoped(conversationId, false, async repo => {
      if (this.actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
      await cancelRuns(repo.tx, this.actor, conversationId);
      await repo.tx.execute(sql`update app.assistant_conversations set context_revision=context_revision+1,version=version+1,updated_at=now()
        where enterprise_id=${this.actor.enterpriseId} and id=${conversationId}`);
      const m = await one(repo.tx, sql`update app.assistant_media set data=null,room_name='',source_ref=null,deleted_at=coalesce(deleted_at,now())
        where enterprise_id=${this.actor.enterpriseId} and conversation_id=${conversationId} and id=${mediaId} returning id`);
      if (!m) fail('assistant_resource_not_found', 404);
      return { id: mediaId, conversationId };
    });
  }
}
