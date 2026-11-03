import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { object, type ConstructionActor } from '../contracts';
import { cameraAccess } from './access';

export async function currentCameraCustomerGrant(tx: PostgresTransaction, eid: string, pid: string) {
  const customer = await one(tx, sql`select l.customer_user_id,l.name from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${eid} and p.id=${pid} and l.archived_at is null for share of p,l`);
  if (!customer?.customer_user_id) return null;
  const grant = await one(tx, sql`select * from app.construction_camera_customer_grants where enterprise_id=${eid}
    and project_id=${pid} and user_id=${String(customer.customer_user_id)}`);
  return { userId: String(customer.customer_user_id), name: String(customer.name || '当前业主'), version: Number(grant?.version || 0),
    enabled: grant?.enabled === true, captureEnabled: grant?.capture_enabled === true, ptzEnabled: grant?.ptz_enabled === true };
}

export async function saveCameraCustomerGrant(actor: ConstructionActor, projectId: string, input: Row) {
  object(input, ['userId', 'enabled', 'captureEnabled', 'ptzEnabled', 'expectedVersion']);
  const pid = id(projectId), uid = id(input.userId), eid = actor.enterpriseId;
  if (!['enabled', 'captureEnabled', 'ptzEnabled'].every(k => typeof input[k] === 'boolean') ||
    !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0 ||
    (!input.enabled && (input.captureEnabled || input.ptzEnabled))) fail('camera_invalid_request', 422);
  return withTenantTransaction(eid, async tx => {
    if (!(await cameraAccess(tx, actor, pid)).owner) fail('camera_forbidden', 403);
    // All grant writes share this lock, including a first save without a row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-customer:${eid}:${pid}`},0))`);
    const customer = await currentCameraCustomerGrant(tx, eid, pid);
    if (!customer || customer.userId !== uid) fail('construction_customer_unavailable', 409);
    if (customer.enabled === input.enabled && customer.captureEnabled === input.captureEnabled && customer.ptzEnabled === input.ptzEnabled)
      return customer;
    if (customer.version !== input.expectedVersion) fail('version_conflict', 409);
    const next = await one(tx, sql`insert into app.construction_camera_customer_grants
      (enterprise_id,project_id,user_id,enabled,capture_enabled,ptz_enabled,updated_by)
      values(${eid},${pid},${uid},${input.enabled as boolean},${input.captureEnabled as boolean},${input.ptzEnabled as boolean},${actor.adminId})
      on conflict(enterprise_id,project_id,user_id) do update set enabled=excluded.enabled,capture_enabled=excluded.capture_enabled,
      ptz_enabled=excluded.ptz_enabled,version=construction_camera_customer_grants.version+1,updated_by=excluded.updated_by,updated_at=now()
      returning version`);
    // A grant version is captured by each entry. Changing any grant revokes old
    // entries/sessions without locking sessions in the opposite request order.
    await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
      values(${eid},${pid},${JSON.stringify({ kind: 'admin', id: actor.adminId })}::jsonb,'camera.customer.grant',
      ${JSON.stringify({ userId: uid, enabled: input.enabled, captureEnabled: input.captureEnabled, ptzEnabled: input.ptzEnabled, version: Number(next!.version) })}::jsonb)`);
    return { ...customer, enabled: input.enabled, captureEnabled: input.captureEnabled, ptzEnabled: input.ptzEnabled, version: Number(next!.version) };
  });
}
