import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { signFamilyInvite, type FamilyInvitePayload } from '@/lib/miniprogram-jwt';
import { object } from './contracts';
import {
  familyAggregateId,
  familyGrantAggregate,
  familyGrantType,
  latestFamilyGrant,
} from './family-access';
import { projectSchedule } from './site-schedule';
import { ownerProjectIssueStatus } from './customer';

function maskPhone(value: unknown) {
  const phone = String(value || '');
  return /^\d{7,}$/.test(phone) ? phone.slice(0, 3) + '****' + phone.slice(-4) : '';
}

/**
 * Family accounts intentionally may not belong to the project enterprise, so
 * users.enterprise_id can be null or point elsewhere. Read that one identity
 * under an explicit platform scope and restore the tenant scope before any
 * business query continues.
 */
async function withPlatformUserRead<T>(tx: PostgresTransaction, read: () => Promise<T>): Promise<T> {
  const current = await one(tx, sql`select coalesce(current_setting('app.is_platform_admin', true), 'false') as value`);
  const previous = String(current?.value || 'false');
  await tx.execute(sql`select set_config('app.is_platform_admin','true',true)`);
  try {
    return await read();
  } finally {
    await tx.execute(sql`select set_config('app.is_platform_admin',${previous},true)`);
  }
}

/**
 * Resolve the tenant and owner of an active, customer-visible project without
 * requiring the scanning account to be a member yet. Used only to turn a
 * signed Mini Program code scene into the same invitation payload a shared
 * card carries; ownership and single use are re-checked by acceptInvite.
 */
export async function familyInviteTarget(projectId: string) {
  id(projectId);
  const row = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id::text as enterprise_id,
    l.customer_user_id::text as owner_id
    from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.id=${projectId} and p.customer_access and p.status='active' and l.archived_at is null`));
  if (!row || !row.owner_id) return null;
  return { enterpriseId: String(row.enterprise_id), ownerId: String(row.owner_id) };
}

/** Customer identity is tenant-independent. Resolve only an authorized project ID. */
export async function customerProgressTenant(projectId: string, userId: string) {
  id(projectId); id(userId);
  const row = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id::text from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.id=${projectId} and p.customer_access and p.status='active' and l.archived_at is null and (l.customer_user_id=${userId}
      or exists(select 1 from lateral (select payload from app.domain_event_outbox e where e.enterprise_id=p.enterprise_id
        and e.type=${familyGrantType} and e.aggregate_type=${familyGrantAggregate}
        and e.aggregate_id=p.id::text || ':' || ${userId} order by e.aggregate_version desc limit 1) latest
        where latest.payload->>'allowed'='true' and latest.payload->>'ownerId'=l.customer_user_id::text))`));
  if (!row) fail('construction_not_found', 404);
  return String(row.enterprise_id);
}

/**
 * Projects the customer can read as the primary owner or an active family
 * viewer. This is deliberately tenant-independent because a family account may
 * not belong to the project enterprise.
 */
export async function customerConstructionProjects(
  userId: string,
  filter: { leadId?: string; projectId?: string } = {}
) {
  const uid = id(userId);
  const leadId = filter.leadId ? id(filter.leadId) : '';
  const projectId = filter.projectId ? id(filter.projectId) : '';
  const result = await withPlatformTransaction(tx => rows(tx, sql`select p.id::text as id,p.name,l.id::text as lead_id,
      l.customer_user_id::text as owner_id,
      case when l.customer_user_id=${uid} then 'owner' else 'family' end as role
    from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.status='active' and p.customer_access and l.archived_at is null
      and (l.customer_user_id=${uid} or exists(
        select 1 from app.domain_event_outbox e
        where e.enterprise_id=p.enterprise_id and e.type=${familyGrantType}
          and e.aggregate_type=${familyGrantAggregate}
          and e.aggregate_id=p.id::text || ':' || ${uid}
          and e.payload->>'allowed'='true' and e.payload->>'ownerId'=l.customer_user_id::text
          and not exists(select 1 from app.domain_event_outbox next
            where next.enterprise_id=e.enterprise_id and next.type=e.type
              and next.aggregate_type=e.aggregate_type and next.aggregate_id=e.aggregate_id
              and next.aggregate_version>e.aggregate_version)))
      ${leadId ? sql`and l.id=${leadId}` : sql``}
      ${projectId ? sql`and p.id=${projectId}` : sql``}
    order by p.id limit 30`));
  return result.map(row => ({
    id: String(row.id),
    name: String(row.name),
    leadId: String(row.lead_id),
    role: String(row.role),
  }));
}

export class CustomerProjectProgress {
  constructor(private readonly actor: ActorContext) {
    // Family progress and live-only viewing are customer features authorized by
    // the project owner, not projections of the cross-role collaboration slice.
    if (actor.principal.kind !== 'user') fail('construction_not_found', 404);
  }

  private scoped<T>(projectId: string, write: boolean,
    execute: (tx: PostgresTransaction, project: Row, eid: string, uid: string) => Promise<T>) {
    id(projectId);
    const { enterpriseId: eid, contextVersion, principal } = this.actor;
    if (principal.kind !== 'user') fail('construction_not_found', 404);
    const uid = principal.userId;
    return withTenantTransaction(eid, async tx => {
      const identity = await one(tx, sql`select app.assistant_identity_is_current(${uid}::bigint,${contextVersion}::integer) as valid`);
      if (!identity?.valid) fail('identity_context_invalid', 401);
      const project = await one(tx, sql`select p.*,l.customer_user_id::text from app.construction_projects p
        join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
        join app.enterprises e on e.id=p.enterprise_id and e.status='active'
        where p.enterprise_id=${eid} and p.id=${projectId} and p.customer_access and p.status='active' and l.archived_at is null
        ${write ? sql`for update of p for share of l,e` : sql`for share of p,l,e`}`);
      if (!project) fail('construction_not_found', 404);
      return execute(tx, project, eid, uid);
    });
  }

  read(projectId: string) {
    return this.scoped(projectId, false, async (tx, project, eid, uid) => {
      const owner = project.customer_user_id === uid;
      if (!owner) {
        const grant = await latestFamilyGrant(tx, eid, projectId, uid);
        const policy = grant?.payload as Row | undefined;
        if (!policy?.allowed || String(policy.ownerId) !== String(project.customer_user_id)) fail('construction_not_found', 404);
      }
      return { projectId, access: owner ? 'owner' : 'family_view',
        progress: await projectSchedule(tx, eid, project, owner ? { customerId: uid } : { family: true }),
        ...(owner ? { issues: await ownerProjectIssueStatus(tx, eid, uid, projectId) } : {}) };
    });
  }

  /** Owner-issued, single-use share card for one family account. */
  invite(projectId: string) {
    return this.scoped(projectId, false, async (_tx, project, eid, uid) => {
      if (String(project.customer_user_id) !== uid) fail('construction_forbidden', 403);
      return signFamilyInvite({ projectId, ownerId: uid, enterpriseId: eid });
    });
  }

  acceptInvite(invite: FamilyInvitePayload) {
    return this.scoped(invite.projectId, true, async (tx, project, eid, uid) => {
      const ownerId = String(project.customer_user_id);
      if (ownerId !== String(invite.ownerId)) fail('construction_invite_invalid', 404);
      if (ownerId === uid) fail('construction_forbidden', 403);
      const viewer = await withPlatformUserRead(tx, () => one(tx, sql`select id from app.users
        where id=${uid} and (openid is not null or phone is not null) for share`));
      if (!viewer) fail('construction_not_found', 404);
      const correlation = 'family-invite:' + String(invite.jti);
      // A share card is single-use. Serialize concurrent accepts of the same jti
      // before reading the latest grant or the consumed correlation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${correlation},0))`);
      const prior = await latestFamilyGrant(tx, eid, invite.projectId, uid);
      const policy = prior?.payload as Row | undefined;
      if (policy?.allowed === true && String(policy.ownerId) === ownerId)
        return { projectId: invite.projectId, access: 'family_view', version: Number(prior!.aggregate_version) };
      const used = await one(tx, sql`select aggregate_id from app.domain_event_outbox
        where enterprise_id=${eid} and type=${familyGrantType} and correlation_id=${correlation} limit 1`);
      if (used) fail('family_invite_used', 409);
      const version = Number(prior?.aggregate_version || 0) + 1;
      const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
        values(${eid},${familyGrantType},${familyGrantAggregate},${familyAggregateId(invite.projectId, uid)},${version},
          ${JSON.stringify({ kind: 'user', userId: ownerId })}::jsonb,${correlation},
          ${JSON.stringify({ projectId: invite.projectId, viewerId: uid, ownerId, allowed: true, source: 'invite' })}::jsonb)
        returning id::text`))!;
      return { projectId: invite.projectId, access: 'family_view', version, eventId: String(event.id) };
    });
  }

  /** Current family viewers for the owner's management panel. */
  viewers(projectId: string) {
    return this.scoped(projectId, false, async (tx, project, eid, uid) => {
      if (String(project.customer_user_id) !== uid) fail('construction_forbidden', 403);
      const grants = await rows(tx, sql`select distinct on (aggregate_id) aggregate_id,aggregate_version,payload,updated_at
        from app.domain_event_outbox
        where enterprise_id=${eid} and type=${familyGrantType} and aggregate_type=${familyGrantAggregate}
          and aggregate_id like ${projectId + ':%'}
        order by aggregate_id,aggregate_version desc`);
      const viewers: Row[] = [];
      for (const grant of grants) {
        const policy = grant.payload as Row | undefined;
        if (policy?.allowed !== true || String(policy.ownerId) !== uid) continue;
        const parts = String(grant.aggregate_id).split(':'), viewerId = parts[parts.length - 1];
        if (!/^[1-9]\d*$/.test(viewerId)) continue;
        const viewer = await withPlatformUserRead(tx, () => one(tx, sql`select nickname,phone from app.users where id=${viewerId}`));
        viewers.push({ viewerId, nickname: String(viewer?.nickname || '家人'),
          phoneMasked: maskPhone(viewer?.phone), version: Number(grant.aggregate_version),
          updatedAt: grant.updated_at });
      }
      return viewers;
    });
  }

  grant(projectId: string, viewerId: string, raw: unknown, requestKey: string) {
    id(viewerId); key(requestKey);
    const input = object(raw, ['expectedVersion', 'allowed']);
    if (typeof input.allowed !== 'boolean' || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) fail('invalid_construction', 422);
    return this.scoped(projectId, true, async (tx, project, eid, uid) => {
      if (String(project.customer_user_id) !== uid || uid === viewerId) fail('construction_forbidden', 403);
      return idempotent(tx, this.actor, 'construction:family-view:' + projectId + ':' + viewerId, requestKey, input, async () => {
        // Family accounts may belong to another enterprise; project scope, not
        // the users.enterprise_id column, is the authorization boundary.
        if (input.allowed && !await withPlatformUserRead(tx, () => one(tx, sql`select id from app.users
          where id=${viewerId} and (openid is not null or phone is not null)`)))
          fail('construction_not_found', 404);
        const prior = await latestFamilyGrant(tx, eid, projectId, viewerId);
        if (Number(prior?.aggregate_version || 0) !== Number(input.expectedVersion)) fail('version_conflict');
        const version = Number(input.expectedVersion) + 1;
        const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
          values(${eid},${familyGrantType},${familyGrantAggregate},${familyAggregateId(projectId, viewerId)},${version},
            ${JSON.stringify(this.actor.principal)}::jsonb,${requestKey},
            ${JSON.stringify({ projectId, viewerId, ownerId: uid, allowed: input.allowed })}::jsonb) returning id::text`))!;
        if (!input.allowed) {
          // Revocation invalidates an open live view immediately; cameraAccess
          // re-checks the family grant on every heartbeat as a second guard.
          await tx.execute(sql`update app.construction_camera_sessions set expires_at=now()
            where enterprise_id=${eid} and project_id=${projectId} and actor->>'kind'='customer'
              and actor->>'userId'=${viewerId} and closed_at is null`);
        }
        return { projectId, viewerId, version, eventId: String(event.id), allowed: input.allowed };
      });
    });
  }
}
