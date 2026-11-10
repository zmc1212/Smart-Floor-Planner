import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, requireCapability, safeText, AssistantError, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, cancelQueuedRun, cancelRuns, idempotent, newRun } from '@/lib/assistant/core/conversation';
import { object } from './contracts';
import { publicRevision, type PublicContent } from './public-contract';
import { publicAudit, publicEvent } from './public-service';
import { publicCandidates, publicMaterial, publicMaterialDto, publishedPublicMaterial } from './public-read';
import { readMemory } from '@/lib/assistant/agent/memory';
import { recommendationRegion } from '@/lib/assistant/location/region';
import { CITY_OPTIONS } from '@/lib/portfolio/regions';
import { discoveryRequest } from '@/lib/assistant/core/discovery';

type PublicIntroMarker = { siteId: string; versionId: string; attempts: number; runId?: string };
/** One model opening per visited site version and consultation. It is an ordinary
 * customer reply run, so existing admission, quota, retry and failure semantics
 * apply unchanged; the client already follows the conversation's latest run. */
async function schedulePublicIntro(tx: PostgresTransaction, actor: ActorContext, cid: string, siteId: string, versionId: string) {
  const c = await one(tx, sql`select * from app.assistant_conversations where enterprise_id=${actor.enterpriseId} and id=${cid} for update`);
  if (!c || c.status !== 'open' || c.mode !== 'ai') return 'unavailable' as const;
  const markers = ((c.entry_snapshot as Row).publicIntros || []) as PublicIntroMarker[];
  // Leaving one site for another retires its pending opening; the visited site
  // keeps its own queued/answered opening instead of generating another.
  for (const other of markers) if (other.runId && (String(other.siteId) !== siteId || String(other.versionId) !== versionId))
    await cancelQueuedRun(tx, actor.enterpriseId, String(other.runId));
  const current = markers.find(m => String(m.siteId) === siteId && String(m.versionId) === versionId);
  if (current?.runId) {
    const previous = await one(tx, sql`select status from app.assistant_runs where enterprise_id=${actor.enterpriseId} and id=${String(current.runId)}`);
    if (!previous || ['queued','running','succeeded'].includes(String(previous.status))) return 'existing' as const;
    // One failed generation may be retried on a later entry; never loop on it.
    if (Number(current.attempts) >= 2) return 'unavailable' as const;
  }
  const notice = await one(tx, sql`select id from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${cid}
    and purpose='construction.public.context' order by seq desc limit 1`);
  if (!notice) return 'unavailable' as const;
  // Someone who already spoke in this consultation does not need an opening.
  if (await one(tx, sql`select id from app.assistant_messages where enterprise_id=${actor.enterpriseId} and conversation_id=${cid}
    and author_kind in ('user','admin') limit 1`)) return 'unavailable' as const;
  const settings = (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${actor.enterpriseId}`))!;
  await tx.execute(sql`savepoint public_intro_admission`);
  let runId: string;
  try {
    const run = await newRun(tx, actor, c, settings, String(notice.id), undefined, { kind: 'user_message', messageId: String(notice.id) }, 'public.site.intro');
    runId = run.runId;
    await tx.execute(sql`release savepoint public_intro_admission`);
  } catch (error) {
    await tx.execute(sql`rollback to savepoint public_intro_admission`);
    await tx.execute(sql`release savepoint public_intro_admission`);
    if (!(error instanceof AssistantError) || !['assistant_quota_exceeded','conversation_busy','assistant_disabled','provider_outcome_unknown','context_changed'].includes(error.code)) throw error;
    return 'unavailable' as const;
  }
  const next = [...markers.filter(m => String(m.siteId) !== siteId || String(m.versionId) !== versionId),
    { siteId, versionId, attempts: Number(current?.attempts || 0) + 1, runId }];
  await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(entry_snapshot,'{publicIntros}',${JSON.stringify(next)}::jsonb)
    where enterprise_id=${actor.enterpriseId} and id=${cid}`);
  return 'queued' as const;
}

export class PublicCustomerService {
  constructor(readonly actor: ActorContext, readonly conversationId: string) {
    requireCapability(actor, 'assistant.chat.self'); id(conversationId);
    if (actor.principal.kind !== 'user') fail('assistant_capability_forbidden', 403);
  }
  private scope<T>(fn: (tx: PostgresTransaction, c: Row) => Promise<T>, write = false) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const repo = new AssistantRepository(tx, this.actor); await repo.settings(write);
      return fn(tx, await repo.conversation(this.conversationId));
    });
  }
  private async ownerSite(tx: PostgresTransaction, c: Row, siteId: string, versionId: string) {
    const site = await one(tx, sql`select s.*,p.lead_id,l.customer_user_id from app.construction_public_sites s
      join app.construction_projects p on p.enterprise_id=s.enterprise_id and p.id=s.project_id
      join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      where s.enterprise_id=${this.actor.enterpriseId} and s.id=${siteId} and s.customer_id=${this.actor.principal.kind === 'user' ? this.actor.principal.userId : ''}
        and l.customer_user_id=s.customer_id for update of s`);
    const entry = c.entry_snapshot as Row;
    if (!site || String(site.current_version_id) !== versionId || (entry.kind === 'lead' && String(entry.id) !== String(site.lead_id))) fail('public_consent_unavailable', 404);
    return site;
  }
  consent(siteId: string, versionId: string) {
    [siteId, versionId].forEach(id);
    return this.scope(async (tx, c) => {
      const site = await this.ownerSite(tx, c, siteId, versionId);
      if (site.status === 'draft') fail('public_consent_unavailable', 404);
      const material = await publicMaterial(tx, this.actor.enterpriseId, siteId, versionId);
      if (!material) return { available: false, id: siteId, versionId, revision: Number(site.revision), status: site.status };
      return { available: true, ...await publicMaterialDto(tx, material.site, material.version), previewed: String(site.previewed_version_id) === versionId };
    });
  }
  decide(siteId: string, action: string, input: Row, requestKey: string) {
    id(siteId); id(input.versionId); key(requestKey); object(input, ['versionId','expectedRevision']);
    const revision = publicRevision(input.expectedRevision);
    if (!['preview','approve','decline','withdraw'].includes(action)) fail('invalid_public_material', 422);
    return this.scope(async (tx, c) => {
      const site = await this.ownerSite(tx, c, siteId, String(input.versionId));
      // Historical receipts cannot restore material after its live source or access is revoked.
      const needsMaterial = action === 'preview' || action === 'approve';
      const material = needsMaterial ? await publicMaterial(tx, this.actor.enterpriseId, siteId, String(input.versionId)) : null;
      if (needsMaterial && !material) fail('public_source_unavailable');
      return idempotent(tx, this.actor, 'public:owner:' + action + ':' + siteId, requestKey, input, async () => {
        if (Number(site.revision) !== revision) fail('version_conflict');
        if (c.status !== 'open') fail('conversation_read_only');
        if (['preview','approve','decline'].includes(action) && site.status !== 'pending_owner') fail('public_state_conflict');
        if (action === 'approve' && String(site.previewed_version_id) !== String(site.current_version_id)) fail('public_preview_required', 422);
        if (action === 'withdraw' && !['pending_owner','owner_approved','published','rejected','declined','withdrawn'].includes(String(site.status))) fail('public_state_conflict');
        const next = action === 'preview' ? 'pending_owner' : action === 'approve' ? 'owner_approved' : action === 'decline' ? 'declined' : 'withdrawn';
        const updated = (await one(tx, sql`update app.construction_public_sites set status=${next},revision=revision+1,updated_at=now(),
          previewed_version_id=${action === 'preview' ? String(site.current_version_id) : site.previewed_version_id as string | null},
          consented_version_id=${action === 'approve' ? String(site.current_version_id) : null},
          consented_by=${action === 'approve' && this.actor.principal.kind === 'user' ? this.actor.principal.userId : null},reviewed_by=null
          where enterprise_id=${this.actor.enterpriseId} and id=${siteId} returning *`))!;
        await publicAudit(tx, updated, String(updated.current_version_id), this.actor.principal, 'owner.' + action);
        if (action !== 'preview') await publicEvent(tx, updated, 'construction.public.status.v1');
        return { id: siteId, versionId: String(updated.current_version_id), revision: Number(updated.revision), status: next,
          ...(action === 'preview' && material ? { material: await publicMaterialDto(tx, updated, material.version) } : {}) };
      });
    }, !['withdraw','decline'].includes(action));
  }
  ownerMedia(siteId: string, versionId: string, mediaId: string) {
    [siteId, versionId, mediaId].forEach(id);
    return this.scope(async (tx, c) => {
      const site = await this.ownerSite(tx, c, siteId, versionId);
      if (site.status === 'draft' || !await publicMaterial(tx, this.actor.enterpriseId, siteId, versionId)) fail('public_consent_unavailable', 404);
      const media = await one(tx, sql`select data,mime_type from app.construction_public_media where enterprise_id=${this.actor.enterpriseId} and site_id=${siteId} and version_id=${versionId} and id=${mediaId}`);
      if (!media) fail('public_consent_unavailable', 404);
      return { data: media.data as Buffer, mimeType: String(media.mime_type) };
    });
  }
  recommendations(replyId?: string) {
    return this.scope(async (tx, c) => {
      const request = replyId ? await discoveryRequest(tx, this.actor.enterpriseId, c, replyId, 'sites') : null;
      const messages = await rows(tx, sql`select content from app.assistant_messages where enterprise_id=${this.actor.enterpriseId}
        and conversation_id=${this.conversationId} and author_kind='user' ${request ? sql`and seq<=${request.seq}` : sql``}
        order by seq desc limit 10`);
      const areas = await publicCandidates(tx, this.actor.enterpriseId);
      const memory = readMemory(c.entry_snapshot);
      const housing = memory.facts.filter(f => f.field === 'housing' && f.status === 'current').map(f => f.value).join(' ');
      const latestText = request ? request.text.replace(/[？?]/g, '') : messages[0] ? safeText(messages[0].content as Parameters<typeof safeText>[0]) : '';
      const region = recommendationRegion(c.entry_snapshot, housing, latestText);
      if (region) return { items: areas.filter(a => a.cityCode === region.cityCode && (!region.district || a.district === region.district)).slice(0, 3),
        enterpriseId: this.actor.enterpriseId, needRegion: false, region };
      // A place named in the newest request decides. When it cannot be resolved
      // (ambiguous, negated or unsupported), ask instead of reusing an older city.
      if (CITY_OPTIONS.some(city => latestText.includes(city.label.replace(/市$/, ''))))
        return { items: [], enterpriseId: this.actor.enterpriseId, needRegion: true };
      const texts = [...messages.map(m => ((m.content as { blocks: Array<{ text?: string }> }).blocks || []).map(b => b.text || '').join('\n')),
        ...(memory.facts || []).filter(f => f.field === 'housing' && f.status === 'current').map(f => f.value)];
      let matching: typeof areas = [];
      for (const sentence of texts) {
        if (/不在|不住|不是|不要|不想|不确定|没定|假如|假设/.test(sentence)) continue;
        const matches = areas.filter(a => sentence.includes(a.district) || sentence.includes(a.district.replace(/[区县]$/, '')));
        if (!matches.length) continue;
        const cities = new Set(matches.map(a => a.cityCode));
        matching = cities.size === 1 ? matches : matches.filter(a => sentence.includes(a.cityName.replace(/市$/, '')));
        break;
      }
      return { items: matching.slice(0, 3), enterpriseId: this.actor.enterpriseId, needRegion: !matching.length };
    });
  }
  context(siteId: string, input: Row, requestKey: string) {
    id(siteId); id(input.versionId); key(requestKey); object(input, ['versionId']);
    return this.scope(async (tx, c) => idempotent(tx, this.actor, 'public:context:' + this.conversationId, requestKey, { siteId, ...input }, async () => {
      if (c.status !== 'open') fail('conversation_read_only');
      const material = await publishedPublicMaterial(tx, this.actor.enterpriseId, siteId, String(input.versionId));
      if (!material) fail('public_site_unavailable', 404);
      const refs = ((c.entry_snapshot as Row).publicSiteContexts || []) as Array<{ siteId: string; versionId: string }>;
      const ref = { siteId, versionId: String(input.versionId) };
      if (refs.length >= 100 && !refs.some(r => r.siteId === siteId && r.versionId === ref.versionId)) fail('need_memory_limit', 422);
      await cancelRuns(tx, this.actor, this.conversationId, undefined, false, 'public.site.intro');
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot=jsonb_set(jsonb_set(entry_snapshot,'{activePublicSite}',${JSON.stringify(ref)}::jsonb),
        '{publicSiteContexts}',${JSON.stringify([...refs.filter(r => r.siteId !== siteId || r.versionId !== ref.versionId), ref])}::jsonb),context_revision=context_revision+1,version=version+1
        where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
      const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${this.actor.enterpriseId},'construction.public.context.v1','assistant_conversation',${this.conversationId},${Number(c.version)+1},${JSON.stringify(this.actor.principal)}::jsonb,${this.conversationId},${JSON.stringify(ref)}::jsonb) returning id`))!;
      const content = material.version.content as PublicContent;
      await appendMessage(tx, this.actor, this.conversationId, { author: 'system', eventId: String(event.id), purpose: 'construction.public.context',
        content: { version: 1, blocks: [{ type: 'text', text: `正在围观：${content.name}。这是你的咨询，不会加入业主原会话。` }] } });
      const intro = await schedulePublicIntro(tx, this.actor, this.conversationId, siteId, ref.versionId);
      return { id: siteId, versionId: ref.versionId, conversationId: this.conversationId, intro };
    }), true);
  }
  detach(requestKey: string) {
    key(requestKey);
    return this.scope(async (tx, c) => idempotent(tx, this.actor, 'public:detach:' + this.conversationId, requestKey, {}, async () => {
      if (c.status !== 'open') fail('conversation_read_only');
      await cancelRuns(tx, this.actor, this.conversationId);
      await tx.execute(sql`update app.assistant_conversations set entry_snapshot=entry_snapshot-'activePublicSite',context_revision=context_revision+1,version=version+1 where enterprise_id=${this.actor.enterpriseId} and id=${this.conversationId}`);
      return { conversationId: this.conversationId, detached: true };
    }), true);
  }
}
