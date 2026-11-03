import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import type { ConstructionActor } from '../contracts';
import { constructionAccess } from '../service';

export type CameraCustomerIdentity = { userId: string; contextVersion: number };
export type CameraCustomerActor = CameraCustomerIdentity & { kind: 'customer'; enterpriseId: string; grantVersion: number };
export type CameraActor = ConstructionActor | CameraCustomerActor;
export const isCameraCustomer = (actor: CameraActor): actor is CameraCustomerActor => 'kind' in actor && actor.kind === 'customer';
export const cameraActorRef = (actor: CameraActor) => isCameraCustomer(actor)
  ? { kind: 'user', id: actor.userId } : { kind: 'admin', id: actor.adminId };

async function customerIdentity(tx: PostgresTransaction, actor: CameraCustomerIdentity, eid: string) {
  id(actor.userId);
  if (!Number.isSafeInteger(actor.contextVersion) || actor.contextVersion < 1 ||
    !(await one(tx, sql`select app.assistant_identity_is_current(${actor.userId}::bigint,${actor.contextVersion}::integer) valid`))?.valid)
    fail('camera_session_expired', 401);
  if (!await one(tx, sql`select id from app.enterprises where id=${eid} and status='active' for share`))
    fail('camera_project_unavailable', 404);
}

/** Shared by entry exchange, every API/media request and the SD stop worker. */
export async function cameraAccess(tx: PostgresTransaction, actor: CameraActor, projectId: string) {
  const pid = id(projectId), eid = id(actor.enterpriseId);
  if (isCameraCustomer(actor)) {
    await customerIdentity(tx, actor, eid);
    if (!Number.isSafeInteger(actor.grantVersion) || actor.grantVersion < 1) fail('camera_project_unavailable', 404);
    const p = await one(tx, sql`select p.id,p.name,p.status,g.capture_enabled,g.ptz_enabled
      from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.construction_camera_customer_grants g on g.enterprise_id=p.enterprise_id and g.project_id=p.id and g.user_id=l.customer_user_id
      where p.enterprise_id=${eid} and p.id=${pid} and p.status='active' and l.archived_at is null
        and l.customer_user_id=${actor.userId} and g.enabled and g.version=${actor.grantVersion} for share of p,l,g`);
    if (!p) fail('camera_project_unavailable', 404);
    return { project: { id: p.id, name: p.name, status: p.status }, manage: false, owner: false,
      canCapture: p.capture_enabled === true, canControl: p.ptz_enabled === true };
  }
  const owner = await constructionAccess(tx, actor);
  const p = await one(tx, sql`select p.id,p.name,p.status from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.id=${pid} and p.status='active' and l.archived_at is null for share of p,l`);
  if (!p) fail('camera_project_unavailable', 404);
  const m = await one(tx, sql`select role from app.construction_members where enterprise_id=${eid} and project_id=${pid} and admin_id=${actor.adminId} and active for share`);
  if (!owner && !m) fail('camera_project_unavailable', 404);
  const manage = owner || m?.role === 'manager';
  return { project: p, manage, owner, canCapture: manage, canControl: manage };
}

/** Platform lookup returns only routing IDs for this current customer's own grant. */
export async function customerCameraActor(identity: CameraCustomerIdentity, projectId: string): Promise<CameraCustomerActor> {
  const located = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id,g.version
    from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    join app.construction_camera_customer_grants g on g.enterprise_id=p.enterprise_id and g.project_id=p.id and g.user_id=l.customer_user_id
    where p.id=${id(projectId)} and l.customer_user_id=${id(identity.userId)} and l.archived_at is null and g.enabled`));
  if (!located) fail('camera_project_unavailable', 404);
  return { ...identity, kind: 'customer', enterpriseId: String(located.enterprise_id), grantVersion: Number(located.version) };
}

export async function customerCameraProjects(identity: CameraCustomerIdentity, leadId: string) {
  const located = await withPlatformTransaction(tx => one(tx, sql`select enterprise_id from app.leads
    where id=${id(leadId)} and customer_user_id=${id(identity.userId)} and archived_at is null`));
  if (!located?.enterprise_id) fail('camera_project_unavailable', 404);
  const eid = String(located.enterprise_id);
  return withTenantTransaction(eid, async tx => {
    await customerIdentity(tx, identity, eid);
    return { items: await rows(tx, sql`select p.id,p.name from app.construction_projects p
      join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      join app.construction_camera_customer_grants g on g.enterprise_id=p.enterprise_id and g.project_id=p.id and g.user_id=l.customer_user_id
      where p.enterprise_id=${eid} and l.id=${leadId} and l.customer_user_id=${identity.userId} and l.archived_at is null
      and p.status='active' and g.enabled order by p.id`) };
  });
}
