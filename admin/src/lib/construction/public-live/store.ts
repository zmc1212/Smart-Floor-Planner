import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, type ActorContext } from '@/lib/assistant/contracts';
import { appendMessage } from '@/lib/assistant/core/conversation';
import { cameraAccess } from '../camera/service';
import { constructionAccess } from '../service';
import { siteActor } from '../site-chat';
import type { ConstructionActor } from '../contracts';
import { liveAudience, liveLabels, liveScope } from './contract';

export async function staffLiveAccess(tx: PostgresTransaction, actor: ConstructionActor, pid: string, write = false) {
  id(pid);
  // Photo materials lock enterprise/access, settings, then project rows. Reserve
  // the same leading locks before cameraAccess takes its project share lock.
  // Keep the original camera and identity/settings checks below unchanged.
  await constructionAccess(tx, actor);
  await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings
    where enterprise_id=${actor.enterpriseId} for update`);
  const access = await cameraAccess(tx, actor, id(pid));
  await new AssistantRepository(tx, siteActor(actor)).settings(write);
  if (!access.manage) fail('public_live_forbidden',403);
  const project = await one(tx, sql`select p.*,l.customer_user_id,l.archived_at,l.status as lead_status
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${actor.enterpriseId} and p.id=${pid} for share of p,l`);
  if (!project?.customer_user_id || !project.customer_access || project.archived_at || project.lead_status === 'closed') fail('public_live_source_changed',409);
  return { ...access, project };
}
export function liveRow(tx: PostgresTransaction, eid: string, liveId: string, lock = false) {
  return one(tx, sql`select * from app.construction_public_live where enterprise_id=${eid} and id=${id(liveId)} ${lock ? sql`for update` : sql`for share`}`);
}
export async function liveSource(tx: PostgresTransaction, eid: string, liveId: string, versionId?: string) {
  // Anonymous reads follow the same leading policy lock as management and
  // consent writes, while still permitting concurrent viewers to read.
  const policy = await one(tx, sql`select enterprise_id from app.assistant_enterprise_settings
    where enterprise_id=${eid} and enabled for share`);
  if (!policy) return null;
  const l = await liveRow(tx,eid,liveId);
  if (!l?.current_version_id || versionId && String(l.current_version_id) !== versionId) return null;
  const v = await one(tx, sql`select * from app.construction_public_live_versions where enterprise_id=${eid} and live_id=${liveId} and id=${String(l.current_version_id)} for share`);
  if (!v) return null;
  const source = await one(tx, sql`select c.device_id,c.channel_id,c.version,c.ptz_enabled,b.id as binding_id,p.name
    from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    join app.construction_projects p on p.enterprise_id=b.enterprise_id and p.id=b.project_id
    join app.leads lead on lead.enterprise_id=p.enterprise_id and lead.id=p.lead_id
    join app.enterprises e on e.id=p.enterprise_id and e.status='active'
    where b.enterprise_id=${eid} and b.project_id=${String(l.project_id)} and b.id=${String(v.binding_id)} and b.camera_id=${String(v.camera_id)}
      and b.ended_at is null and c.enabled and c.version=${Number(v.camera_version)} and p.status='active' and p.customer_access
      and lead.customer_user_id=${String(l.customer_id)} and lead.archived_at is null and lead.status<>'closed'
      and not exists(select 1 from app.construction_camera_controls ctrl where ctrl.enterprise_id=b.enterprise_id and ctrl.camera_id=c.id and ctrl.stop_required)
      and not exists(select 1 from app.construction_camera_sd_playbacks sd where sd.enterprise_id=b.enterprise_id and sd.binding_id=b.id and sd.state<>'stopped')
    for share of b,c,p,lead,e`);
  if (!source) return null;
  const actor = (v.scope as Row).preparedActor as ConstructionActor;
  const permission = await one(tx, actor?.miniProgramUserId
    ? sql`select app.construction_miniprogram_access(${String(l.prepared_by)}::bigint,${eid}::bigint,${id(actor.miniProgramUserId)}::bigint,${actor.miniProgramContextVersion ?? -1}::integer) as role`
    : sql`select app.construction_actor_access(${String(l.prepared_by)}::bigint,${eid}::bigint) as role`);
  if (!permission?.role || permission.role !== 'owner' && !await one(tx, sql`select admin_id from app.construction_members where enterprise_id=${eid} and project_id=${String(l.project_id)} and admin_id=${String(l.prepared_by)} and active and role='manager' for share`)) return null;
  if (l.status === 'published' && (!l.reviewed_by || (await one(tx,sql`select app.construction_actor_access(${String(l.reviewed_by)}::bigint,${eid}::bigint) as role`))?.role !== 'owner')) return null;
  return { live: l, version: v, source };
}
export function liveDto(l: Row,v: Row,available = true) {
  const scope = v.scope as Row;
  return { id: String(l.id), key: String(l.public_key), versionId: String(v.id), revision: Number(l.revision), status: String(l.status),
    statusLabel: liveLabels[String(l.status)] || '当前不可用', alias: String(v.alias), name: String(scope.name), audience: liveAudience, scope: liveScope,
    available, previewed: String(l.previewed_version_id) === String(v.id), reason: String(l.reason || ''), updatedAt: new Date(String(l.updated_at)).toISOString() };
}
export async function liveAudit(tx: PostgresTransaction,l: Row, actor: unknown,action: string,reason = '') {
  await tx.execute(sql`insert into app.construction_public_live_audits(enterprise_id,project_id,live_id,version_id,actor_ref,action,reason)
    values(${String(l.enterprise_id)},${String(l.project_id)},${String(l.id)},${String(l.current_version_id)},${JSON.stringify(actor)}::jsonb,${action},${reason})`);
}
/** Same original private destination; no new consultation or member is created. */
export async function liveEvent(tx: PostgresTransaction,l: Row,action: string,actor: ActorContext) {
  if(actor.enterpriseId!==String(l.enterprise_id))fail('public_live_unavailable',404);
  const event = (await one(tx,sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
    values(${String(l.enterprise_id)},'construction.public.live.v1','construction_public_live',${String(l.id)},${Number(l.revision)},${JSON.stringify(actor)}::jsonb,${String(l.id)},
      ${JSON.stringify({ liveId: String(l.id), versionId: String(l.current_version_id), customerId: String(l.customer_id), action })}::jsonb) returning id`))!;
  if (!l.conversation_id) {if(action==='submit')fail('public_live_owner_chat_required');return;}
  const c = await one(tx,sql`select c.id from app.assistant_conversations c
    join app.assistant_participants p on p.enterprise_id=c.enterprise_id and p.conversation_id=c.id and p.user_id=${String(l.customer_id)} and p.status='active'
    where c.enterprise_id=${String(l.enterprise_id)} and c.id=${String(l.conversation_id)} and c.purpose='customer_consultation' and c.status='open' for update of c,p`);
  if (!c) {if(action==='submit')fail('public_live_owner_chat_required');return;}
  // The authenticated caller is the system-event writer. The recipient is the
  // locked original conversation/participant, not a fabricated user identity.
  const m = await appendMessage(tx,actor,String(c.id),{author:'system',eventId:String(event.id),purpose:'construction.public.live',
    content:{version:1,blocks:[{type:'text',text: action === 'submit' ? '团队想公开一路现场直播，请先查看完整范围，再决定是否同意。' : `这路直播：${liveLabels[String(l.status)] || '状态已更新'}。照片和服务记录的授权不变。`}]}});
  await tx.execute(sql`update app.construction_public_live set message_id=${String(m.id)} where enterprise_id=${String(l.enterprise_id)} and id=${String(l.id)}`);
  await tx.execute(sql`insert into app.domain_event_deliveries(enterprise_id,event_id,consumer_key,status)
    values(${String(l.enterprise_id)},${String(event.id)},${'public-live:user:'+l.customer_id},'delivered') on conflict do nothing`);
}
