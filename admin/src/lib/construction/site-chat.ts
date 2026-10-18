import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, assistantWritesEnabled, one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage, cancelRuns, idempotent, newRun } from '@/lib/assistant/core/conversation';
import { normalizeImage } from '@/lib/assistant/media/service';
import { constructionAccess } from './service';
import { object, text, version, type ConstructionActor } from './contracts';
import { siteDraft } from './site-contract';
import { appendSiteResponse, querySiteMaterials, resolveSiteQuery, sharedMediaUsed, siteMessageIntent, siteResponse } from './site-queries';
import { handleSiteIssue, parseSiteVersions, projectSiteIssues, siteIssueCommand } from './site-issues';
import { sharedMaterialMedia, sharedMaterials } from './site-materials';
import { handlePlan, planCommand, projectPlans } from './site-plans';
import { handleSiteResolution, projectResolutionVersions, resolutionCommand, validateResolutionReceipt } from './site-resolution';

export function siteActor(a: ConstructionActor): ActorContext {
  return { enterpriseId: a.enterpriseId, principal: { kind: 'admin', adminId: a.adminId }, contextVersion: 1,
    capabilities: ['assistant.project.shared'], entry: { miniProgramUserId: a.miniProgramUserId || null, miniProgramContextVersion: a.miniProgramContextVersion ?? 0 } };
}
export function siteDto(v: unknown): unknown {
  return typeof v === 'bigint' ? String(v) : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(siteDto)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, siteDto(x)])) : v;
}
export async function recordVersion(tx: PostgresTransaction, eid: string, record: Row, actorId: string, action: string) {
  await tx.execute(sql`insert into app.construction_site_record_versions(enterprise_id,project_id,record_id,version,actor_id,action,snapshot)
    values(${eid},${String(record.project_id)},${String(record.id)},${Number(record.version)},${actorId},${action},
    ${JSON.stringify(siteDto({ data: record.data, roomId: record.room_id, status: record.status, audience: record.audience,
      roomName: record.room_name_snapshot, publishedCustomerId: record.published_customer_id, reason: record.withdrawal_reason, sourceMessageId: record.source_message_id }))}::jsonb)`);
}
export class SiteChatService {
  readonly actor: ActorContext;
  constructor(readonly staff: ConstructionActor) { this.actor = siteActor(staff); }
  authorize(projectId: string, write = false) { return this.scope(projectId, write, async () => undefined); }
  private scope<T>(projectId: string, write: boolean, fn: (tx: PostgresTransaction, c: Row, p: Row, permission: { manage: boolean; write: boolean }) => Promise<T>) {
    id(projectId);
    return withTenantTransaction(this.staff.enterpriseId, async tx => {
      const a = this.staff, eid = a.enterpriseId;
      const owner = await constructionAccess(tx, a);
      const repo = new AssistantRepository(tx, this.actor);
      const settings = await repo.settings(write);
      // Serialize first-entry creation without making a personal copy of the conversation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`site-chat:${eid}:${projectId}`},0))`);
      let link = await one(tx, sql`select conversation_id from app.construction_chats where enterprise_id=${eid} and project_id=${projectId}`);
      if (!link) {
        const p = await one(tx, sql`select p.id from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
          where p.enterprise_id=${eid} and p.id=${projectId} and p.status<>'archived' and l.archived_at is null
          and (${owner} or exists(select 1 from app.construction_members m where m.enterprise_id=p.enterprise_id and m.project_id=p.id and m.admin_id=${a.adminId} and m.active)) for share of p,l`);
        if (!p) fail('construction_not_found', 404);
        const c = (await one(tx, sql`insert into app.assistant_conversations(enterprise_id,purpose,entry_snapshot,policy_version)
          values(${eid},'project_collaboration',${JSON.stringify({ kind: 'construction_project', id: projectId })}::jsonb,${Number(settings?.policy_version || 1)}) returning id`))!;
        await tx.execute(sql`insert into app.construction_chats(enterprise_id,project_id,conversation_id) values(${eid},${projectId},${String(c.id)})`);
        link = { conversation_id: c.id };
      }
      const c = await repo.conversation(String(link.conversation_id));
      const p = (await one(tx, sql`select p.*,l.customer_user_id,l.archived_at from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        where p.enterprise_id=${eid} and p.id=${projectId} for share of p,l`))!;
      const member = await one(tx, sql`select role from app.construction_members where enterprise_id=${eid} and project_id=${projectId} and admin_id=${a.adminId} and active for share`);
      const permission = { manage: owner || member?.role === 'manager', write: (owner || (!!member && member.role !== 'observer')) && p.status === 'active' && assistantWritesEnabled(settings) };
      if (write && (!permission.write || p.status !== 'active')) fail('construction_forbidden', 403);
      return fn(tx, c, p, permission);
    });
  }
  read(projectId: string, beforeSeq = '9223372036854775807', limit = 30) {
    id(beforeSeq);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail('invalid_construction', 422);
    return this.scope(projectId, false, async (tx, c, p, permission) => {
      const eid = this.staff.enterpriseId;
      const issues = await projectSiteIssues(tx, eid, projectId);
      const plans = await projectPlans(tx, eid, projectId);
      const messages = await rows(tx, sql`select m.id,m.seq,m.author_kind,m.admin_id,m.content,m.created_at,a.display_name
        from app.assistant_messages m left join app.admin_users a on a.id=m.admin_id
        where m.enterprise_id=${eid} and m.conversation_id=${String(c.id)} and m.seq<${beforeSeq} and m.author_kind='admin' order by m.seq desc limit ${limit}`);
      const items: { message: Row; record: Row | null; response?: Row; issue?: unknown }[] = [];
      for (const message of messages.reverse()) {
        const record = await one(tx, sql`select r.*,coalesce(a.display_name,'项目管理人员') as approved_name,q.status as run_status,q.error_code,
          coalesce(q.policy_snapshot->'agent'->>'imageInput','false')='true' as image_input,
          exists(select 1 from app.assistant_quota_reservations qr where qr.enterprise_id=r.enterprise_id and qr.run_id=r.run_id and qr.status in ('held','reconciling')) as pending_cost
          from app.construction_site_records r left join app.admin_users a on a.id=r.approved_by
          left join app.assistant_runs q on q.enterprise_id=r.enterprise_id and q.id=r.run_id
          where r.enterprise_id=${eid} and r.project_id=${projectId} and r.source_message_id=${String(message.id)}`);
        if (!record) {
          const response = await siteResponse(tx, eid, projectId, String(c.id), String(message.id), issues);
          if (response) items.push({ message, response, record: null });
          continue;
        }
        const media = await rows(tx, sql`select a.id,a.width,a.height,a.byte_size from app.construction_site_attachments x join app.construction_site_media a
          on a.enterprise_id=x.enterprise_id and a.project_id=x.project_id and a.id=x.media_id
          where x.enterprise_id=${eid} and x.project_id=${projectId} and x.record_id=${String(record.id)} and a.deleted_at is null order by x.position`);
        const canEdit = permission.write && (permission.manage || String(record.author_id) === this.staff.adminId);
        items.push({ message, issue: issues.find(i => i.recordId === String(record.id)) || null,
          record: { ...record, canEdit, canPublishCustomer: permission.manage, media } });
      }
      const settings = await one(tx, sql`select stages from app.construction_stage_settings where enterprise_id=${eid}`);
      const stage = ((settings?.stages || []) as Row[]).find(s => s.key === p.current_stage_key);
      const rooms = await rows(tx, sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${projectId} order by id`);
      const materials: Record<string, string> = {};
      for (const room of rooms) materials[String(room.id)] = (await sharedMaterials(tx, eid, projectId, String(room.id))).version;
      const records = Object.fromEntries(items.filter(i => i.record).map(i => [String(i.record!.id), Number(i.record!.version)]));
      // A durable issue may outlive the latest message page. Supply its current
      // source revision so explicit recovery does not depend on an old UI cache.
      if (issues.length) for (const record of await rows(tx, sql`select r.id,r.version from app.construction_site_records r
        where r.enterprise_id=${eid} and r.project_id=${projectId} and r.id in
          (select value::bigint from jsonb_array_elements_text(${JSON.stringify(issues.map(i => i.recordId))}::jsonb)) order by r.id for share`)) {
        records[String(record.id)] = Number(record.version);
      }
      return siteDto({ conversationId: c.id, project: { id: p.id, name: p.name, status: p.status, customerAccess: p.customer_access, stageName: stage?.name || '' },
        ...permission, rooms, plans,
        items, versions: { records,
          issues: Object.fromEntries(issues.map(i => [i.issueId, i.revision])), materials,
          plans: Object.fromEntries(plans.map(p => [p.id, p.revision])), resolutions: await projectResolutionVersions(tx, eid, projectId) },
        nextCursor: messages.length === limit ? String(messages[0].seq) : null }) as Row;
    });
  }
  materialMedia(projectId: string, grantId: string, mediaId: string) {
    id(grantId); id(mediaId);
    return this.scope(projectId, false, tx => sharedMaterialMedia(tx, this.staff.enterpriseId, projectId, grantId, mediaId));
  }
  send(projectId: string, body: Row, requestKey: string) {
    object(body, ['text', 'mediaIds', 'versions']); key(requestKey);
    const versions = parseSiteVersions(body.versions);
    const raw = text(body.text, 4000, false), mediaIds = body.mediaIds;
    if (!Array.isArray(mediaIds) || mediaIds.length > 4 || new Set(mediaIds).size !== mediaIds.length || (!raw && !mediaIds.length)) fail('invalid_construction', 422);
    mediaIds.forEach(id);
    return this.scope(projectId, true, async (tx, c, _p, permission) => {
      const result = await idempotent(tx, this.actor, 'site:send:' + projectId, requestKey, body, async () => {
      const eid = this.staff.enterpriseId;
      for (const mid of mediaIds) if (!await one(tx, sql`select id from app.construction_site_media a where a.enterprise_id=${eid} and a.project_id=${projectId} and a.id=${mid}
        and a.uploader_id=${this.staff.adminId} and a.deleted_at is null and not exists(select 1 from app.construction_site_attachments x where x.enterprise_id=a.enterprise_id and x.project_id=a.project_id and x.media_id=a.id)
        and not ${sharedMediaUsed(eid, projectId, mid)} for share`)) fail('construction_media_unavailable', 422);
      const intent = siteIssueCommand(raw) || planCommand(raw) || resolutionCommand(raw) ? 'request' : siteMessageIntent(raw, mediaIds.length);
      const message = await appendMessage(tx, this.actor, String(c.id), { author: 'admin', clientMessageId: requestKey, purpose: 'site.source',
        content: { version: 1, blocks: raw ? [{ type: 'text', text: raw }] : [{ type: 'notice', code: 'site_photos', fallbackText: `现场照片 · ${mediaIds.length}张` }] } });
      if (intent !== 'report') {
        const plan = intent === 'request' ? await handlePlan(tx, this.actor, projectId, String(message.id), raw, mediaIds, versions, permission.manage) : null;
        const issue = intent === 'request' ? await handleSiteIssue(tx, this.actor, projectId, String(message.id), raw, versions, permission.manage) : null;
        const resolution = intent === 'request' ? await handleSiteResolution(tx, this.actor, projectId, String(message.id), raw, versions, permission.manage) : null;
        const issueQuery = intent === 'query' && /事项|这件事|在等谁|谁.*(?:处理|回复)|有没有下文/.test(raw);
        const issueQueryId = /事项\s*[#＃]?([1-9]\d{0,18})/.exec(raw)?.[1] || '';
        const issueText = issueQuery ? (await projectSiteIssues(tx, eid, projectId)).filter(i => !issueQueryId || i.issueId === issueQueryId).map(i => i.text).join('\n\n') || '本项目当前没有对应的持续事项。' : '';
        const snapshot = intent === 'query' && !issueQuery ? await querySiteMaterials(tx, eid, projectId, await resolveSiteQuery(tx, eid, projectId, raw)) : null;
        await appendSiteResponse(tx, this.actor, String(c.id), projectId, String(message.id), mediaIds, intent,
          plan?.text || resolution?.text || issue?.text || issueText || snapshot?.text || (intent === 'request' ? '请先查对应现场记录，再说“跟进记录编号”。已有事项可以说“接手事项编号”“转交事项编号给姓名”或“回复事项编号：处理结果”；取消或恢复请说明原因。有权管理人员可明确回传本次状态，回复不等于已解决。' : '原话已保留在本项目。需要查资料时请说明房间；现场进展可直接发文字或照片。'),
          plan ? { planId: plan.id } : resolution ? { issueId: resolution.issueId, revision: resolution.revision, lifecycleId: resolution.lifecycleId } : issue ? { issueId: issue.issueId, revision: issue.revision } : issueQuery ? { issueQuery: true, issueQueryId } : snapshot ? { query: snapshot.query, version: snapshot.version, queriedAt: snapshot.queriedAt,
            sources: snapshot.sources.map(source => ({ ref: source.ref, hash: source.hash, sourceMessageId: source.sourceMessageId,
              roomId: source.roomId, mediaIds: source.mediaIds, audience: source.audience, basis: source.basis })) } : {});
        return { conversationId: String(c.id), messageId: String(message.id), recordId: null, runId: null, status: 'succeeded', intent,
          ...(plan ? { planId: plan.id } : {}), ...(issue ? { issueId: issue.issueId, revision: issue.revision } : {}),
          ...(resolution ? { issueId: resolution.issueId, lifecycleId: resolution.lifecycleId, lifecycleRevision: resolution.lifecycleRevision, evidenceId: resolution.evidenceId } : {}) };
      }
      const result = await newRun(tx, this.actor, c, (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!, String(message.id), undefined,
        { kind: 'user_message', messageId: String(message.id) }, 'site.record');
      const r = (await one(tx, sql`insert into app.construction_site_records(enterprise_id,project_id,conversation_id,source_message_id,author_id,run_id)
        values(${eid},${projectId},${String(c.id)},${String(message.id)},${this.staff.adminId},${String(result.runId)}) returning id`))!;
      for (let i = 0; i < mediaIds.length; i++) await tx.execute(sql`insert into app.construction_site_attachments(enterprise_id,project_id,record_id,media_id,position) values(${eid},${projectId},${String(r.id)},${mediaIds[i]},${i})`);
      return { ...result, recordId: String(r.id) };
      });
      await validateResolutionReceipt(tx, this.staff.enterpriseId, projectId, result);
      return result;
    });
  }
  async upload(projectId: string, requestKey: string, bytes: Buffer) {
    key(requestKey); await this.scope(projectId, true, async () => undefined);
    const image = await normalizeImage(bytes);
    return this.scope(projectId, true, async tx => {
      const eid = this.staff.enterpriseId, aid = this.staff.adminId;
      const existing = await one(tx, sql`select id,source_hash,deleted_at from app.construction_site_media where enterprise_id=${eid} and project_id=${projectId} and uploader_id=${aid} and request_key=${requestKey}`);
      if (existing) { if (existing.source_hash !== image.hash) fail('idempotency_conflict'); if (existing.deleted_at) fail('construction_media_unavailable', 404); return { id: String(existing.id) }; }
      if (Number((await one(tx, sql`select count(*) n from app.construction_site_media where enterprise_id=${eid} and project_id=${projectId} and deleted_at is null`))!.n) >= 500) fail('media_limit', 422);
      const m = (await one(tx, sql`insert into app.construction_site_media(enterprise_id,project_id,uploader_id,request_key,source_hash,mime_type,width,height,byte_size,data)
        values(${eid},${projectId},${aid},${requestKey},${image.hash},${image.mime},${image.width},${image.height},${image.data.length},${image.data}) returning id`))!;
      return { id: String(m.id) };
    });
  }
  media(projectId: string, mediaId: string) {
    id(mediaId);
    return this.scope(projectId, false, async tx => {
      const m = await one(tx, sql`select data,mime_type from app.construction_site_media m where enterprise_id=${this.staff.enterpriseId} and project_id=${projectId} and id=${mediaId} and deleted_at is null
        and (uploader_id=${this.staff.adminId} or exists(select 1 from app.construction_site_attachments a where a.enterprise_id=m.enterprise_id and a.project_id=m.project_id and a.media_id=m.id)
          or ${sharedMediaUsed(this.staff.enterpriseId, projectId, mediaId)})`);
      if (!m) fail('construction_media_unavailable', 404);
      return { data: m.data as Buffer, mime: String(m.mime_type) };
    });
  }
  removeMedia(projectId: string, mediaId: string, requestKey: string) {
    id(mediaId); key(requestKey);
    return this.scope(projectId, true, tx => idempotent(tx, this.actor, `site:${projectId}:media:${mediaId}:remove`, requestKey, {}, async () => {
      const eid = this.staff.enterpriseId;
      const m = await one(tx, sql`update app.construction_site_media m set data=null,deleted_at=coalesce(deleted_at,now())
        where enterprise_id=${eid} and project_id=${projectId} and id=${mediaId} and uploader_id=${this.staff.adminId}
        and not exists(select 1 from app.construction_site_attachments a where a.enterprise_id=m.enterprise_id and a.project_id=m.project_id and a.media_id=m.id)
        and not ${sharedMediaUsed(eid, projectId, mediaId)} returning id`);
      if (!m) fail('construction_media_unavailable', 404);
      return { id: mediaId };
    }));
  }
  mutate(projectId: string, recordId: string, action: string, body: Row, requestKey: string) {
    id(recordId); key(requestKey);
    const allowed: Record<string, string[]> = { edit: ['expectedVersion', 'data'], publish: ['expectedVersion', 'audience'], withdraw: ['expectedVersion', 'reason'], retry: ['expectedVersion'] };
    if (!allowed[action]) fail('construction_not_found', 404);
    object(body, allowed[action]); version(body.expectedVersion);
    return this.scope(projectId, true, (tx, c, p, permission) => idempotent(tx, this.actor, `site:${projectId}:${recordId}:${action}`, requestKey, body, async () => {
      const eid = this.staff.enterpriseId;
      const r = await one(tx, sql`select * from app.construction_site_records where enterprise_id=${eid} and project_id=${projectId} and id=${recordId} for update`);
      if (!r || (!permission.manage && String(r.author_id) !== this.staff.adminId)) fail('construction_forbidden', 403);
      if (Number(r.version) !== body.expectedVersion) fail('version_conflict');
      if (action === 'retry') {
        if (r.status !== 'organizing' || !r.source_message_id) fail('context_changed');
        const old = await one(tx, sql`select status from app.assistant_runs where enterprise_id=${eid} and id=${String(r.run_id)}`);
        if (!old || !['failed', 'cancelled'].includes(String(old.status)) || await one(tx, sql`select id from app.assistant_quota_reservations where enterprise_id=${eid} and run_id=${String(r.run_id)} and status in ('held','reconciling')`)) fail('site_retry_unavailable');
        const result = await newRun(tx, this.actor, c, (await one(tx, sql`select * from app.assistant_enterprise_settings where enterprise_id=${eid}`))!, String(r.source_message_id), String(r.run_id),
          { kind: 'user_message', messageId: String(r.source_message_id) }, 'site.record');
        await tx.execute(sql`update app.construction_site_records set run_id=${String(result.runId)},version=version+1,updated_at=now() where enterprise_id=${eid} and id=${recordId}`);
        return { id: recordId, version: Number(r.version) + 1, ...result };
      }
      if (r.run_id) await cancelRuns(tx, this.actor, String(c.id), String(r.run_id));
      if (action === 'edit') {
        const data = siteDraft(body.data);
        const room = data.roomId ? await one(tx, sql`select id,name from app.construction_rooms where enterprise_id=${eid} and project_id=${projectId} and id=${data.roomId}`) : null;
        if (data.roomId && !room) fail('invalid_construction', 422);
        // A correction immediately revokes the previous publication; it requires a new explicit review.
        await tx.execute(sql`update app.construction_site_records set data=${JSON.stringify(data)}::jsonb,room_id=${data.roomId},room_name_snapshot=${String(room?.name || '')},status='draft',audience='internal',published_version=null,published_customer_id=null,approved_by=null,published_at=null,withdrawal_reason='' where enterprise_id=${eid} and id=${recordId}`);
      } else if (action === 'publish') {
        if (r.status !== 'draft' || !r.source_message_id || !['internal', 'customer'].includes(String(body.audience))) fail('context_changed');
        if (body.audience === 'customer' && (!permission.manage || !p.customer_access || !p.customer_user_id || p.archived_at)) fail('construction_forbidden', 403);
        const data = siteDraft(r.data);
        if (![data.completed, data.pending, data.coordination, data.note].some(Boolean)) fail('site_review_required', 422);
        if (data.roomId && !await one(tx, sql`select id from app.construction_rooms where enterprise_id=${eid} and project_id=${projectId} and id=${data.roomId} and name=${String(r.room_name_snapshot)}`)) fail('context_changed');
        if (await one(tx, sql`select x.media_id from app.construction_site_attachments x join app.construction_site_media m on m.enterprise_id=x.enterprise_id and m.project_id=x.project_id and m.id=x.media_id where x.enterprise_id=${eid} and x.project_id=${projectId} and x.record_id=${recordId} and m.deleted_at is not null`)) fail('construction_media_unavailable', 409);
        await tx.execute(sql`update app.construction_site_records set status='published',audience=${String(body.audience)},published_version=version+1,
          published_customer_id=${body.audience === 'customer' ? String(p.customer_user_id) : null},approved_by=${this.staff.adminId},published_at=now() where enterprise_id=${eid} and id=${recordId}`);
      } else {
        const reason = text(body.reason, 500);
        if (r.status !== 'published') fail('context_changed');
        await tx.execute(sql`update app.construction_site_records set status='withdrawn',audience='internal',published_version=null,published_customer_id=null,withdrawal_reason=${reason} where enterprise_id=${eid} and id=${recordId}`);
      }
      const updated = (await one(tx, sql`update app.construction_site_records set version=version+1,updated_at=now() where enterprise_id=${eid} and id=${recordId} returning *`))!;
      await recordVersion(tx, eid, updated, this.staff.adminId, action);
      await tx.execute(sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${eid},${'construction.record.' + action + '.v1'},'construction_site_record',${recordId},${Number(updated.version)},
        ${JSON.stringify(this.actor.principal)}::jsonb,${requestKey},${JSON.stringify({ projectId, recordId, version: updated.version })}::jsonb)`);
      return { id: recordId, version: Number(updated.version), status: updated.status, audience: updated.audience };
    }));
  }
  versions(projectId: string, recordId: string) {
    id(recordId);
    return this.scope(projectId, false, async tx => siteDto({ items: await rows(tx, sql`select v.version,v.action,v.snapshot,v.created_at,a.display_name from app.construction_site_record_versions v left join app.admin_users a on a.id=v.actor_id
      where v.enterprise_id=${this.staff.enterpriseId} and v.project_id=${projectId} and v.record_id=${recordId} order by v.version desc limit 50`) }) as Row);
  }
  operation(projectId: string, requestKey: string) {
    key(requestKey);
    return this.scope(projectId, false, async tx => {
      const eid = this.staff.enterpriseId, aid = this.staff.adminId;
      const found = await rows(tx, sql`select result from app.assistant_idempotency_records where enterprise_id=${eid} and principal_key=${'admin:' + aid} and key=${requestKey}
        and (operation=${'site:send:' + projectId} or operation like ${'site:' + projectId + ':%'}) limit 2`);
      const media = await one(tx, sql`select id from app.construction_site_media where enterprise_id=${eid} and project_id=${projectId} and uploader_id=${aid} and request_key=${requestKey} and deleted_at is null`);
      if (found.length + Number(!!media) > 1) fail('idempotency_conflict');
      if (found[0]?.result) await validateResolutionReceipt(tx, eid, projectId, found[0].result as Row);
      return { found: !!found.length || !!media, result: found[0]?.result || (media ? { id: String(media.id) } : null) };
    });
  }
}
