import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, fingerprint, id, key } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { constructionAccess } from './service';
import { siteActor, siteDto } from './site-chat';
import { object, text, type ConstructionActor } from './contracts';
import { excerptOf, publicMaterialInput, publicRevision, type PublicContent, type PublicPhotoInput } from './public-contract';
import { availableStaffSources, materialSource, privateSourceAccess, type PublicSource } from './public-sources';
import { publicMaterial, publicMaterialDto } from './public-read';
import { currentStage, readStageSettings } from './stages-store';

export async function publicAudit(tx: PostgresTransaction, site: Row, versionId: string, actor: unknown, action: string, reason = '') {
  await tx.execute(sql`insert into app.construction_public_audits(enterprise_id,project_id,site_id,version_id,actor_ref,action,reason)
    values(${String(site.enterprise_id)},${String(site.project_id)},${String(site.id)},${versionId},${JSON.stringify(actor)}::jsonb,${action},${reason})`);
}
export async function publicEvent(tx: PostgresTransaction, site: Row, type: string) {
  return one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${String(site.enterprise_id)},${type},'construction_public_site',${String(site.id)},${Number(site.revision)},'{"kind":"system"}',${String(site.id)},
      ${JSON.stringify({ siteId: String(site.id), versionId: String(site.current_version_id), customerId: String(site.customer_id) })}::jsonb)
    on conflict do nothing returning id`);
}
async function preparedPhoto(tx: PostgresTransaction, eid: string, pid: string, photo: PublicPhotoInput) {
  const original = await one(tx, sql`select m.* from app.construction_site_attachments a join app.construction_site_media m
    on m.enterprise_id=a.enterprise_id and m.project_id=a.project_id and m.id=a.media_id
    where a.enterprise_id=${eid} and a.project_id=${pid} and a.record_id=${photo.recordId} and a.media_id=${photo.mediaId} and m.deleted_at is null for share of a,m`);
  if (!original) fail('public_source_unavailable', 409);
  const width = Number(original.width), height = Number(original.height);
  const overlay = photo.masks.map(mask => ({
    input: Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${Math.floor(mask.x * width)}" y="${Math.floor(mask.y * height)}" width="${Math.ceil(mask.width * width) + 1}" height="${Math.ceil(mask.height * height) + 1}" fill="#17202b"/></svg>`),
  }));
  const data = await sharp(original.data as Buffer).composite(overlay).jpeg({ quality: 86 }).toBuffer();
  if (data.length > 4 * 1024 * 1024) fail('invalid_public_material', 422);
  return { ...photo, data, width, height, sourceHash: String(original.source_hash), contentHash: createHash('sha256').update(new Uint8Array(data)).digest('hex') };
}
export class PublicMaterialService {
  constructor(readonly actor: ConstructionActor) {}
  private scope<T>(pid: string, write: boolean, fn: (tx: PostgresTransaction, p: Row, permission: { manage: boolean; owner: boolean; write: boolean }) => Promise<T>) {
    id(pid);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const owner = await constructionAccess(tx, this.actor), repository = new AssistantRepository(tx, siteActor(this.actor));
      await repository.settings(write);
      const p = await one(tx, sql`select p.*,l.customer_user_id,l.archived_at,l.status as lead_status from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id where p.enterprise_id=${this.actor.enterpriseId} and p.id=${pid} for update of p`);
      const member = await one(tx, sql`select role from app.construction_members where enterprise_id=${this.actor.enterpriseId} and project_id=${pid} and admin_id=${this.actor.adminId} and active for share`);
      if (!p || (!owner && !member) || p.status === 'archived' || p.archived_at || p.lead_status === 'closed') fail('construction_not_found', 404);
      const permission = { owner, manage: owner || member?.role === 'manager', write: (owner || !!member && member.role !== 'observer') && p.status === 'active' && !!p.customer_access };
      if (write && !permission.write) fail('construction_forbidden', 403);
      return fn(tx, p, permission);
    });
  }
  read(pid: string) {
    return this.scope(pid, false, async (tx, project, permission) => {
      const eid = this.actor.enterpriseId;
      const sourceItems = permission.write ? await availableStaffSources(tx, this.actor, project, permission.manage) : [];
      const site = await one(tx, sql`select * from app.construction_public_sites where enterprise_id=${eid} and project_id=${pid} for update`);
      let material = null;
      if (site) {
        const selected = await publicMaterial(tx, eid, String(site.id));
        if (selected && (permission.manage || String(site.prepared_by) === this.actor.adminId)) {
          const refs = await rows(tx, sql`select * from app.construction_public_sources where enterprise_id=${eid} and site_id=${String(site.id)} and version_id=${String(site.current_version_id)} order by position`);
          let privateReadable = ['owner_approved','published'].includes(String(site.status));
          if (!privateReadable) {
            privateReadable = true;
            for (const ref of refs) if (ref.kind === 'consultation_message' && (!ref.conversation_id || !await privateSourceAccess(tx, eid, this.actor.adminId, String(ref.conversation_id)))) privateReadable = false;
          }
          if (privateReadable) {
            const photos = await rows(tx, sql`select id::text,source_record_id::text as "recordId",source_media_id::text as "mediaId",masks,width,height from app.construction_public_media where enterprise_id=${eid} and site_id=${String(site.id)} and version_id=${String(site.current_version_id)} order by position`);
            material = { ...await publicMaterialDto(tx, selected.site, selected.version),
              sources: refs.map((r, i) => ({ kind: r.kind, id: String(r.kind === 'site_record' ? r.record_id : r.message_id), sourceHash: String(r.source_hash), text: (selected.version.content as PublicContent).excerpts[i].text })),
              draftPhotos: photos, reason: String(site.reason || '') };
          }
        }
      }
      return siteDto({ ...permission, revision: Number(site?.revision || 0), material, sourceItems,
        unavailable: !!site && !material, projectName: project.name,
        audits: site && (permission.manage || String(site.prepared_by) === this.actor.adminId) ? await rows(tx, sql`select action,reason,created_at from app.construction_public_audits where enterprise_id=${eid} and site_id=${String(site.id)} order by id desc limit 30`) : [] }) as Row;
    });
  }
  save(pid: string, input: Row, requestKey: string) {
    object(input, ['expectedRevision', 'material']); key(requestKey);
    const revision = publicRevision(input.expectedRevision), draft = publicMaterialInput(input.material);
    return this.scope(pid, true, async (tx, project, permission) => {
      const eid = this.actor.enterpriseId, aid = this.actor.adminId;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`public-material:${eid}:${aid}:${requestKey}`},0))`);
      return idempotent(tx, siteActor(this.actor), 'public:save:' + pid, requestKey, input, async () => {
        let site = await one(tx, sql`select * from app.construction_public_sites where enterprise_id=${eid} and project_id=${pid} for update`);
        if (Number(site?.revision || 0) !== revision) fail('version_conflict');
        if (site && !permission.manage && String(site.prepared_by) !== aid) fail('construction_forbidden', 403);
        const sources: PublicSource[] = [];
        for (const selected of draft.sources) {
          const source = await materialSource(tx, project, selected.kind, selected.id);
          if (!source || source.sourceHash !== selected.sourceHash || !excerptOf(source.text, selected.text)) fail('public_source_unavailable', 409);
          if (source.kind === 'consultation_message' && !await privateSourceAccess(tx, eid, aid, source.conversationId!)) fail('construction_forbidden', 403);
          if (source.kind === 'site_record' && !permission.manage && !await one(tx, sql`select id from app.construction_site_records where enterprise_id=${eid} and project_id=${pid} and id=${source.id} and author_id=${aid}`)) fail('construction_forbidden', 403);
          sources.push(source);
        }
        const photos = [];
        for (const photo of draft.photos) photos.push(await preparedPhoto(tx, eid, pid, photo));
        const settings = await readStageSettings(tx, eid);
        const content: PublicContent = { name: draft.name, cityCode: draft.cityCode, cityName: draft.cityName, district: draft.district,
          stageName: currentStage(project, settings.stages)?.name || '现场记录', sourceCount: sources.length, photoCount: photos.length,
          excerpts: sources.map((source, i) => ({ role: source.role, text: draft.sources[i].text, date: source.date })) };
        if (!site) site = (await one(tx, sql`insert into app.construction_public_sites(enterprise_id,project_id,prepared_by,customer_id) values(${eid},${pid},${aid},${String(project.customer_user_id)}) returning *`))!;
        const ordinal = Number((await one(tx, sql`select coalesce(max(ordinal),0)+1 as n from app.construction_public_versions where enterprise_id=${eid} and site_id=${String(site.id)}`))!.n);
        const hash = fingerprint({ content, sources: sources.map(s => ({ kind: s.kind, id: s.id, hash: s.sourceHash })), photos: photos.map(p => ({ id: p.mediaId, hash: p.contentHash, masks: p.masks })) });
        const v = (await one(tx, sql`insert into app.construction_public_versions(enterprise_id,project_id,site_id,ordinal,content,content_hash,prepared_by)
          values(${eid},${pid},${String(site.id)},${ordinal},${JSON.stringify(content)}::jsonb,${hash},${aid}) returning id`))!;
        for (let i = 0; i < sources.length; i++) {
          const s = sources[i];
          await tx.execute(sql`insert into app.construction_public_sources(enterprise_id,project_id,site_id,version_id,position,kind,record_id,record_version,conversation_id,message_id,source_hash)
            values(${eid},${pid},${String(site.id)},${String(v.id)},${i},${s.kind},${s.kind === 'site_record' ? s.id : null},${s.version},${s.conversationId},${s.kind === 'consultation_message' ? s.id : null},${s.sourceHash})`);
        }
        for (let i = 0; i < photos.length; i++) {
          const p = photos[i];
          await tx.execute(sql`insert into app.construction_public_media(enterprise_id,project_id,site_id,version_id,source_record_id,source_media_id,position,masks,source_hash,content_hash,mime_type,width,height,data,byte_size)
            values(${eid},${pid},${String(site.id)},${String(v.id)},${p.recordId},${p.mediaId},${i},${JSON.stringify(p.masks)}::jsonb,${p.sourceHash},${p.contentHash},'image/jpeg',${p.width},${p.height},${p.data},${p.data.length})`);
        }
        site = (await one(tx, sql`update app.construction_public_sites set current_version_id=${String(v.id)},revision=revision+1,status='draft',prepared_by=${aid},customer_id=${String(project.customer_user_id)},
          previewed_version_id=null,consented_version_id=null,consented_by=null,reviewed_by=null,reason='',updated_at=now() where enterprise_id=${eid} and id=${String(site.id)} returning *`))!;
        await publicAudit(tx, site, String(v.id), { kind: 'admin', id: aid }, 'save');
        return { id: String(site.id), versionId: String(v.id), revision: Number(site.revision), status: String(site.status) };
      });
    });
  }
  media(pid: string, mediaId: string, versionId?: string, sourceRecordId?: string) {
    id(mediaId); if (versionId) id(versionId); if (sourceRecordId) id(sourceRecordId);
    return this.scope(pid, false, async (tx, project, permission) => {
      const eid = this.actor.enterpriseId;
      if (sourceRecordId) {
        if (!permission.write) fail('construction_forbidden', 403);
        const sources = await availableStaffSources(tx, this.actor, project, permission.manage);
        if (!sources.some(s => s.kind === 'site_record' && s.id === sourceRecordId && s.media.some(m => m.id === mediaId))) fail('public_source_unavailable', 404);
        const media = await one(tx, sql`select data,mime_type from app.construction_site_media where enterprise_id=${eid} and project_id=${pid} and id=${mediaId} and deleted_at is null`);
        if (!media) fail('public_source_unavailable', 404);
        return { data: media.data as Buffer, mimeType: String(media.mime_type) };
      }
      const site = await one(tx, sql`select * from app.construction_public_sites where enterprise_id=${eid} and project_id=${pid} for update`);
      if (!site || !versionId || (!permission.manage && String(site.prepared_by) !== this.actor.adminId)
        || !await publicMaterial(tx, eid, String(site.id), versionId)) fail('public_source_unavailable', 404);
      if (!['owner_approved','published'].includes(String(site.status))) {
        const refs = await rows(tx, sql`select conversation_id from app.construction_public_sources where enterprise_id=${eid} and site_id=${String(site.id)} and version_id=${versionId} and kind='consultation_message'`);
        for (const ref of refs) if (!ref.conversation_id || !await privateSourceAccess(tx, eid, this.actor.adminId, String(ref.conversation_id))) fail('construction_forbidden', 403);
      }
      const media = await one(tx, sql`select data,mime_type from app.construction_public_media where enterprise_id=${eid} and site_id=${String(site.id)} and version_id=${versionId} and id=${mediaId}`);
      if (!media) fail('public_source_unavailable', 404);
      return { data: media.data as Buffer, mimeType: String(media.mime_type) };
    });
  }
  mutate(pid: string, action: string, input: Row, requestKey: string) {
    object(input, ['expectedRevision', 'versionId', 'reason']); key(requestKey); id(input.versionId);
    const revision = publicRevision(input.expectedRevision), reason = text(input.reason || '', 500, false);
    if (!['submit','publish','reject','withdraw'].includes(action)) fail('invalid_public_material', 422);
    if (['reject','withdraw'].includes(action) && !reason) fail('invalid_public_material', 422);
    return this.scope(pid, true, async (tx, _p, permission) => {
      const eid = this.actor.enterpriseId, aid = this.actor.adminId;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`public-material:${eid}:${aid}:${requestKey}`},0))`);
      const site = await one(tx, sql`select * from app.construction_public_sites where enterprise_id=${eid} and project_id=${pid} for update`);
      if (!site || (!permission.manage && String(site.prepared_by) !== aid)) fail('construction_forbidden', 403);
      if (['publish','reject'].includes(action) && !permission.owner) fail('construction_forbidden', 403);
      return idempotent(tx, siteActor(this.actor), 'public:' + action + ':' + pid, requestKey, input, async () => {
        if (Number(site.revision) !== revision || String(site.current_version_id) !== input.versionId) fail('version_conflict');
        if (action !== 'withdraw' && !await publicMaterial(tx, eid, String(site.id), String(input.versionId))) fail('public_source_unavailable');
        if (action === 'submit' && site.status !== 'draft') fail('public_state_conflict');
        if (['publish','reject'].includes(action) && (site.status !== 'owner_approved' || String(site.consented_version_id) !== String(site.current_version_id) || String(site.consented_by) !== String(site.customer_id))) fail('public_consent_required');
        if (action === 'submit') {
          const privateRefs = await rows(tx, sql`select conversation_id from app.construction_public_sources where enterprise_id=${eid} and site_id=${String(site.id)} and version_id=${String(site.current_version_id)} and kind='consultation_message'`);
          for (const ref of privateRefs) if (!ref.conversation_id || !await privateSourceAccess(tx, eid, aid, String(ref.conversation_id))) fail('construction_forbidden', 403);
        }
        const next = action === 'submit' ? 'pending_owner' : action === 'publish' ? 'published' : action === 'reject' ? 'rejected' : 'withdrawn';
        const updated = (await one(tx, sql`update app.construction_public_sites set status=${next},revision=revision+1,reason=${reason},updated_at=now(),
          reviewed_by=${action === 'publish' ? aid : null},
          previewed_version_id=${action === 'submit' ? null : site.previewed_version_id as string | null},
          consented_version_id=${['submit','withdraw','reject'].includes(action) ? null : site.consented_version_id as string | null},
          consented_by=${['submit','withdraw','reject'].includes(action) ? null : site.consented_by as string | null}
          where enterprise_id=${eid} and id=${String(site.id)} returning *`))!;
        await publicAudit(tx, updated, String(updated.current_version_id), { kind: 'admin', id: aid }, action, reason);
        await publicEvent(tx, updated, action === 'submit' ? 'construction.public.consent.v1' : 'construction.public.status.v1');
        return { id: String(updated.id), versionId: String(updated.current_version_id), revision: Number(updated.revision), status: next };
      });
    });
  }
}
