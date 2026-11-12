import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { object } from './contracts';
import { collaborationEnabled } from './collaboration-scope';
import { projectSchedule } from './site-schedule';
import { ownerProjectIssueStatus } from './customer';

const grantType = 'construction.family.progress-access.v1';

function latestGrant(tx: PostgresTransaction, eid: string, projectId: string, viewerId: string) {
  return one(tx, sql`select id::text,aggregate_version,payload from app.domain_event_outbox where enterprise_id=${eid}
    and type=${grantType} and aggregate_type='construction_family_viewer'
    and aggregate_id=${projectId + ':' + viewerId} order by aggregate_version desc limit 1`);
}

/** Customer identity is tenant-independent. Resolve only an authorized project ID. */
export async function customerProgressTenant(projectId: string, userId: string) {
  id(projectId); id(userId);
  const row = await withPlatformTransaction(tx => one(tx, sql`select p.enterprise_id::text from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.id=${projectId} and p.customer_access and p.status='active' and l.archived_at is null and (l.customer_user_id=${userId}
      or exists(select 1 from lateral (select payload from app.domain_event_outbox e where e.enterprise_id=p.enterprise_id
        and e.type=${grantType} and e.aggregate_type='construction_family_viewer'
        and e.aggregate_id=p.id::text || ':' || ${userId} order by e.aggregate_version desc limit 1) latest
        where latest.payload->>'allowed'='true' and latest.payload->>'ownerId'=l.customer_user_id::text))`));
  if (!row) fail('construction_not_found', 404);
  return String(row.enterprise_id);
}

export class CustomerProjectProgress {
  constructor(private readonly actor: ActorContext) {
    if (actor.principal.kind !== 'user' || !collaborationEnabled(actor.enterpriseId)) fail('construction_not_found', 404);
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
        const grant = await latestGrant(tx, eid, projectId, uid);
        const policy = grant?.payload as Row | undefined;
        if (!policy?.allowed || policy.ownerId !== project.customer_user_id) fail('construction_not_found', 404);
      }
      return { projectId, access: owner ? 'owner' : 'family_view',
        progress: await projectSchedule(tx, eid, project, owner ? { customerId: uid } : { family: true }),
        ...(owner ? { issues: await ownerProjectIssueStatus(tx, eid, uid, projectId) } : {}) };
    });
  }

  grant(projectId: string, viewerId: string, raw: unknown, requestKey: string) {
    id(viewerId); key(requestKey);
    const input = object(raw, ['expectedVersion', 'allowed']);
    if (typeof input.allowed !== 'boolean' || !Number.isSafeInteger(input.expectedVersion) || Number(input.expectedVersion) < 0) fail('invalid_construction', 422);
    return this.scoped(projectId, true, async (tx, project, eid, uid) => {
      if (project.customer_user_id !== uid || uid === viewerId) fail('construction_forbidden', 403);
      return idempotent(tx, this.actor, 'construction:family-view:' + projectId + ':' + viewerId, requestKey, input, async () => {
        if (input.allowed && !await one(tx, sql`select id from app.users where id=${viewerId} and enterprise_id=${eid}`)) fail('construction_not_found', 404);
        const prior = await latestGrant(tx, eid, projectId, viewerId);
        if (Number(prior?.aggregate_version || 0) !== input.expectedVersion) fail('version_conflict');
        const version = Number(input.expectedVersion) + 1;
        const event = (await one(tx, sql`insert into app.domain_event_outbox(enterprise_id,type,aggregate_type,aggregate_id,aggregate_version,actor_ref,correlation_id,payload)
          values(${eid},${grantType},'construction_family_viewer',${projectId + ':' + viewerId},${version},
            ${JSON.stringify(this.actor.principal)}::jsonb,${requestKey},
            ${JSON.stringify({ projectId, viewerId, ownerId: uid, allowed: input.allowed })}::jsonb) returning id::text`))!;
        return { projectId, viewerId, version, eventId: String(event.id), allowed: input.allowed };
      });
    });
  }
}
