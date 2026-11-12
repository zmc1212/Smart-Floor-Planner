import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fingerprint, safeText } from '@/lib/assistant/contracts';
import { publishedSiteRecord } from './site-publications';
import { siteRecordText, type SiteDraft } from './site-contract';
import type { ConstructionActor } from './contracts';

export type PublicSource = { kind: 'site_record' | 'consultation_message'; id: string; version: number | null; conversationId: string | null;
  sourceHash: string; text: string; role: string; date: string; media: Array<{ id: string; width: number; height: number }> };
export async function privateSourceAccess(tx: PostgresTransaction, eid: string, aid: string, cid: string) {
  return !!await one(tx, sql`select c.id from app.assistant_conversations c
    join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.admin_id=${aid} and ap.status='active' and ap.participant_role='handoff_staff'
    join app.admin_users a on a.enterprise_id=c.enterprise_id and a.id=ap.admin_id and a.status='active' and a.role in ('designer','enterprise_admin') and a.must_change_password=false
    where c.enterprise_id=${eid} and c.id=${cid} and c.purpose='customer_consultation' and c.status='open' and c.mode='human'
      and c.entry_snapshot->'handoff'->>'state'='active' and c.entry_snapshot->'handoff'->>'ownerId'=${aid} for share of c,ap,a`);
}
export async function materialSource(tx: PostgresTransaction, project: Row, kind: string, sourceId: string): Promise<PublicSource | null> {
  const eid = String(project.enterprise_id), uid = String(project.customer_user_id || project.customer_id);
  if (kind === 'site_record') {
    const r = await publishedSiteRecord(tx, eid, uid, sourceId, undefined, true);
    if (!r || String(r.project_id) !== String(project.project_id || project.id)) return null;
    const body = siteRecordText(r.data as SiteDraft, String(r.room_name_snapshot));
    const media = await rows(tx, sql`select m.id::text,m.width,m.height from app.construction_site_attachments a join app.construction_site_media m
      on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
      where a.enterprise_id=${eid} and a.project_id=${String(r.project_id)} and a.record_id=${sourceId} and m.deleted_at is null order by a.position`);
    return { kind: 'site_record', id: sourceId, version: Number(r.published_version), conversationId: null,
      sourceHash: fingerprint({ body, version: r.published_version }), text: body, role: '现场记录（团队已核对）', date: new Date(String(r.published_at)).toISOString(),
      media: media as PublicSource['media'] };
  }
  if (kind !== 'consultation_message') return null;
  const row = await one(tx, sql`select m.*,c.entry_snapshot from app.assistant_messages m
    join app.assistant_conversations c on c.enterprise_id=m.enterprise_id and c.id=m.conversation_id and c.purpose='customer_consultation' and c.status='open'
    join app.assistant_participants ap on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=${uid} and ap.status='active'
    where m.enterprise_id=${eid} and m.id=${sourceId} and m.author_kind in ('user','admin')
      and coalesce(c.entry_snapshot->>'retentionRedacted','false')<>'true'
      and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=${String(project.lead_id)}) for share of m,c,ap`);
  if (!row) return null;
  const body = safeText(row.content as Parameters<typeof safeText>[0]);
  if (!body.trim() || body.length > 1800 || row.purpose === 'public.decision') return null;
  return { kind: 'consultation_message', id: sourceId, version: null, conversationId: String(row.conversation_id),
    sourceHash: fingerprint({ body, author: row.author_kind, message: sourceId }), text: body,
    role: row.author_kind === 'user' ? '业主（匿名）' : '服务人员', date: new Date(String(row.created_at)).toISOString(), media: [] };
}
export async function availableStaffSources(tx: PostgresTransaction, actor: ConstructionActor, project: Row, manage: boolean) {
  const eid = actor.enterpriseId, pid = String(project.id), result: PublicSource[] = [];
  const recordIds = await rows(tx, sql`select id::text from app.construction_site_records where enterprise_id=${eid} and project_id=${pid}
    and status='published' and audience='customer' ${manage ? sql`` : sql`and author_id=${actor.adminId}`} order by published_at desc,id desc limit 50`);
  for (const row of recordIds) { const source = await materialSource(tx, project, 'site_record', String(row.id)); if (source) result.push(source); }
  const cids = await rows(tx, sql`select c.id::text from app.assistant_conversations c join app.assistant_participants ap
    on ap.enterprise_id=c.enterprise_id and ap.conversation_id=c.id and ap.user_id=${String(project.customer_user_id)} and ap.status='active'
    where c.enterprise_id=${eid} and c.purpose='customer_consultation' and c.status='open' and c.mode='human'
    and c.entry_snapshot->'handoff'->>'ownerId'=${actor.adminId}
    and (coalesce(c.entry_snapshot->>'kind','')<>'lead' or c.entry_snapshot->>'id'=${String(project.lead_id)}) order by c.id desc limit 5`);
  for (const c of cids) {
    if (!await privateSourceAccess(tx, eid, actor.adminId, String(c.id))) continue;
    const messages = await rows(tx, sql`select id::text from app.assistant_messages where enterprise_id=${eid} and conversation_id=${String(c.id)} and author_kind in ('user','admin') order by seq desc limit 30`);
    for (const row of messages.reverse()) { const source = await materialSource(tx, project, 'consultation_message', String(row.id)); if (source) result.push(source); }
  }
  return result;
}
/** Why a published version can no longer be read. A transient read error is
 * never reported as "this source does not exist": `source_unreadable` is a
 * retryable infrastructure state, `source_forbidden` means the viewer/original
 * lost access, `source_changed` means the version/source no longer qualifies
 * (edited, re-published, withdrawn, replaced) and `source_missing` means the
 * original record was deleted. */
export type PublicSourceFailure = 'source_changed' | 'source_missing' | 'source_forbidden' | 'source_unreadable';
export type PublicSourceStatus = { ok: true } | { ok: false; reason: PublicSourceFailure };
const sourceFailure = (reason: PublicSourceFailure): PublicSourceStatus => ({ ok: false, reason });
/** Classify one reference whose material lookup returned nothing. The original
 * row still decides deletion, while an existing row that no longer satisfies
 * the publication predicate is a changed source, not a missing one. */
async function missingSourceReason(tx: PostgresTransaction, site: Row, kind: string, sourceId: string): Promise<PublicSourceFailure> {
  const eid = String(site.enterprise_id), pid = String(site.project_id), uid = String(site.customer_user_id || '');
  if (kind === 'site_record') {
    const record = await one(tx, sql`select id,published_customer_id from app.construction_site_records
      where enterprise_id=${eid} and project_id=${pid} and id=${sourceId}`);
    if (!record) return 'source_missing';
    return record.published_customer_id && String(record.published_customer_id) !== uid ? 'source_forbidden' : 'source_changed';
  }
  if (kind !== 'consultation_message') return 'source_missing';
  const message = await one(tx, sql`select m.id,c.status,c.purpose,c.entry_snapshot from app.assistant_messages m
    left join app.assistant_conversations c on c.enterprise_id=m.enterprise_id and c.id=m.conversation_id
    where m.enterprise_id=${eid} and m.id=${sourceId}`);
  if (!message) return 'source_missing';
  // The original message still exists, but the consultation that authorised the
  // private excerpt is closed, repurposed or redacted: the viewer lost access.
  if (!message.status || String(message.status) !== 'open' || String(message.purpose) !== 'customer_consultation'
    || String((message.entry_snapshot as Row | null)?.retentionRedacted || 'false') === 'true') return 'source_forbidden';
  return 'source_changed';
}
/** Same predicate is used before consent, publication, generation commit, search and every media GET.
 * Callers that need to explain an unavailable version use this status so a
 * network/read failure is never presented as withdrawn content. */
export async function publicSourceStatus(tx: PostgresTransaction, site: Row, version: Row): Promise<PublicSourceStatus> {
  try {
    const content = version.content as { sourceCount?: number; photoCount?: number };
    const refs = await rows(tx, sql`select * from app.construction_public_sources where enterprise_id=${String(site.enterprise_id)} and site_id=${String(site.id)} and version_id=${String(version.id)} order by position`);
    if (!refs.length || refs.length !== content.sourceCount) return sourceFailure('source_changed');
    for (const ref of refs) {
      const sourceId = ref.kind === 'site_record' ? ref.record_id : ref.message_id;
      if (!sourceId) return sourceFailure('source_changed');
      let current: PublicSource | null;
      try { current = await materialSource(tx, site, String(ref.kind), String(sourceId)); }
      catch { return sourceFailure('source_unreadable'); }
      if (!current) return sourceFailure(await missingSourceReason(tx, site, String(ref.kind), String(sourceId)));
      if (current.sourceHash !== ref.source_hash || (ref.kind === 'site_record' && current.version !== ref.record_version)
        || (ref.kind === 'consultation_message' && current.conversationId !== String(ref.conversation_id))) return sourceFailure('source_changed');
    }
    const media = await rows(tx, sql`select m.source_record_id,m.source_media_id,m.source_hash as expected_hash,original.source_hash,original.deleted_at from app.construction_public_media m
      left join app.construction_site_media original on original.enterprise_id=m.enterprise_id and original.project_id=m.project_id and original.id=m.source_media_id
      where m.enterprise_id=${String(site.enterprise_id)} and m.site_id=${String(site.id)} and m.version_id=${String(version.id)}`);
    if (media.length !== content.photoCount) return sourceFailure('source_changed');
    for (const photo of media) {
      if (!photo.source_record_id || !photo.source_media_id || !photo.expected_hash) return sourceFailure('source_changed');
      // The left join supplies the original media hash; a missing original was
      // deleted, while a deleted/replaced one is a changed source.
      if (!photo.source_hash) return sourceFailure('source_missing');
      if (photo.deleted_at || photo.expected_hash !== photo.source_hash) return sourceFailure('source_changed');
      if (!refs.some(r => r.kind === 'site_record' && String(r.record_id) === String(photo.source_record_id))) return sourceFailure('source_changed');
    }
    return { ok: true };
  } catch { return sourceFailure('source_unreadable'); }
}
export async function publicSourcesAvailable(tx: PostgresTransaction, site: Row, version: Row) {
  return (await publicSourceStatus(tx, site, version)).ok;
}
