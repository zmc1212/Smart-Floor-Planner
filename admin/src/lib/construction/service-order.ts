import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail, id, key, type ActorContext } from '@/lib/assistant/contracts';
import { idempotent } from '@/lib/assistant/core/conversation';
import { choice, object, text, version, type ConstructionActor } from './contracts';
import { constructionAccess } from './service';
import {
  cameraCount, canActOnPoint, canCancel, canConfirm, canExit, canExtend, canQuote, canRepair, canSchedule, cents,
  depositDisposition, extensionDays as extensionDaysInput, money, orderDate, quoteLines, repairIssue, repairResolution,
  retentionDays, scheduledFor, serviceDays, servicePoints,
} from './service-order-contract';

const actorContext = (actor: ConstructionActor): ActorContext => ({ enterpriseId: actor.enterpriseId, principal: { kind: 'admin', adminId: actor.adminId }, contextVersion: 1, capabilities: [] });

async function projectAccess(tx: PostgresTransaction, actor: ConstructionActor, projectId: string) {
  const owner = await constructionAccess(tx, actor), pid = id(projectId);
  const project = await one(tx, sql`select p.id,p.name,p.status from app.construction_projects p
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where p.enterprise_id=${actor.enterpriseId} and p.id=${pid} and l.archived_at is null for share of p,l`);
  if (!project) fail('service_order_project_unavailable', 404);
  const member = await one(tx, sql`select role from app.construction_members
    where enterprise_id=${actor.enterpriseId} and project_id=${pid} and admin_id=${actor.adminId} and active for share`);
  // Commercial amounts are limited to the enterprise owner and the project manager.
  if (!owner && member?.role !== 'manager') fail('service_order_project_unavailable', 404);
  return { project, owner, manager: owner || member?.role === 'manager' };
}
async function audit(tx: PostgresTransaction, actor: ConstructionActor, pid: string, action: string, snapshot: Row) {
  await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
    values(${actor.enterpriseId},${pid},${JSON.stringify({ kind: 'admin', id: actor.adminId })}::jsonb,${'service_order.' + action},${JSON.stringify(snapshot)}::jsonb)`);
}
async function loadOrder(tx: PostgresTransaction, eid: string, pid: string, orderId: string, lock = false) {
  const order = await one(tx, sql`select o.* from app.construction_service_orders o
    where o.enterprise_id=${eid} and o.project_id=${pid} and o.id=${id(orderId)} ${lock ? sql`for update` : sql``}`);
  if (!order) fail('service_order_not_found', 404);
  return order;
}
async function orderPoints(tx: PostgresTransaction, eid: string, orderId: unknown) {
  return rows(tx, sql`select p.*,r.name as room_name from app.construction_service_order_points p
    left join app.construction_rooms r on r.enterprise_id=p.enterprise_id and r.id=p.room_id
    where p.enterprise_id=${eid} and p.order_id=${id(String(orderId))} order by p.seq`);
}
async function latestQuote(tx: PostgresTransaction, eid: string, orderId: unknown) {
  return await one(tx, sql`select * from app.construction_service_order_quotes
    where enterprise_id=${eid} and order_id=${id(String(orderId))} order by version desc limit 1`) ?? null;
}
async function orderRepairs(tx: PostgresTransaction, eid: string, orderId: unknown) {
  return rows(tx, sql`select r.*,p.name as point_name from app.construction_service_order_repairs r
    left join app.construction_service_order_points p on p.enterprise_id=r.enterprise_id and p.order_id=r.order_id and p.id=r.point_id
    where r.enterprise_id=${eid} and r.order_id=${id(String(orderId))} order by r.id desc limit 30`);
}
async function orderExtensionDays(tx: PostgresTransaction, eid: string, orderId: unknown) {
  const found = await one(tx, sql`select coalesce(sum(days),0)::int as days from app.construction_service_order_extensions
    where enterprise_id=${eid} and order_id=${id(String(orderId))}`);
  return Number(found?.days || 0);
}
function serviceEndsAt(order: Row, extensionDays: number) {
  const acceptedAt = orderDate(order.accepted_at);
  if (!acceptedAt) return null;
  return new Date(new Date(acceptedAt).getTime() + (Number(order.service_days) + extensionDays) * 86400000).toISOString();
}
function view(order: Row, points: Row[], quote: Row | null, canActOn: boolean, repairs: Row[], extensionDays: number) {
  return {
    id: String(order.id), status: String(order.status), cameraCount: Number(order.camera_count),
    retentionDays: Number(order.retention_days), serviceDays: Number(order.service_days),
    requestNote: String(order.request_note || ''), version: Number(order.version),
    quoteVersion: Number(order.quote_version), confirmedQuoteVersion: order.confirmed_quote_version === null ? null : Number(order.confirmed_quote_version),
    scheduledFor: orderDate(order.scheduled_for), installerId: order.installer_id === null ? null : String(order.installer_id),
    acceptedAt: orderDate(order.accepted_at), cancelledAt: orderDate(order.cancelled_at), cancelReason: String(order.cancel_reason || ''),
    exitedAt: orderDate(order.exited_at), exitReason: String(order.exit_reason || ''),
    depositReturnedCents: cents(order.deposit_returned_cents), depositDeductedCents: cents(order.deposit_deducted_cents),
    depositNote: String(order.deposit_note || ''), extensionDays, serviceEndsAt: serviceEndsAt(order, extensionDays),
    createdAt: orderDate(order.created_at), canAct: canActOn,
    quote: quote ? {
      version: Number(quote.version), totalCents: cents(quote.total_cents), depositCents: cents(quote.deposit_cents),
      note: String(quote.note || ''), lines: Array.isArray(quote.lines) ? quote.lines : [], createdAt: orderDate(quote.created_at),
    } : null,
    points: points.map(point => ({
      id: String(point.id), seq: Number(point.seq), name: String(point.name),
      roomId: point.room_id === null ? null : String(point.room_id), roomName: point.room_name ? String(point.room_name) : null,
      positionNote: String(point.position_note || ''), status: String(point.status),
      installedAt: orderDate(point.installed_at), acceptedAt: orderDate(point.accepted_at),
    })),
    repairs: repairs.map(repair => ({
      id: String(repair.id), status: String(repair.status), issue: String(repair.issue),
      resolution: String(repair.resolution || ''), pointId: repair.point_id === null ? null : String(repair.point_id),
      pointName: repair.point_name ? String(repair.point_name) : null,
      openedAt: orderDate(repair.opened_at), closedAt: orderDate(repair.closed_at), version: Number(repair.version),
    })),
  };
}

export class ServiceOrderService {
  constructor(readonly actor: ConstructionActor) {}
  async list(projectId: string) {
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      const orders = await rows(tx, sql`select o.*,a.display_name as installer_name from app.construction_service_orders o
        left join app.admin_users a on a.enterprise_id=o.enterprise_id and a.id=o.installer_id
        where o.enterprise_id=${eid} and o.project_id=${pid} order by o.id desc limit 20`);
      const items = [];
      for (const order of orders) {
        const canActOn = access.owner || (order.installer_id !== null && String(order.installer_id) === this.actor.adminId);
        items.push({ ...view(order, await orderPoints(tx, eid, order.id), await latestQuote(tx, eid, order.id), canActOn,
          await orderRepairs(tx, eid, order.id), await orderExtensionDays(tx, eid, order.id)),
          installerName: order.installer_name ? String(order.installer_name) : null });
      }
      return { project: { id: String(access.project.id), name: String(access.project.name), status: String(access.project.status) }, owner: access.owner, items };
    });
  }
  async create(projectId: string, input: Row, requestKey?: string) {
    object(input, ['cameraCount', 'retentionDays', 'serviceDays', 'note']);
    const cameras = cameraCount(input.cameraCount), retention = retentionDays(input.retentionDays), span = serviceDays(input.serviceDays);
    const note = text(input.note ?? '', 200, false);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      if (access.project.status !== 'active') fail('service_order_project_inactive', 409);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:create', key(requestKey), input, async () => {
        if (await one(tx, sql`select id from app.construction_service_orders where enterprise_id=${eid} and project_id=${pid}
          and status not in ('accepted','cancelled','exited')`)) fail('service_order_open_exists', 409);
        const created = (await one(tx, sql`insert into app.construction_service_orders(enterprise_id,project_id,camera_count,retention_days,service_days,request_note,created_by)
          values(${eid},${pid},${cameras},${retention},${span},${note},${this.actor.adminId}) returning id,version`))!;
        await audit(tx, this.actor, pid, 'create', { orderId: String(created.id), cameraCount: cameras, retentionDays: retention, serviceDays: span });
        return { id: String(created.id), version: Number(created.version) };
      });
    });
  }
  async quote(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'lines', 'depositCents', 'note']);
    const { lines, totalCents } = quoteLines(input.lines), deposit = money(input.depositCents), note = text(input.note ?? '', 500, false);
    const expected = version(input.expectedVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:quote:' + id(orderId), key(requestKey), input, async () => {
        const order = await loadOrder(tx, eid, pid, orderId, true);
        if (!canQuote(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        const next = Number(order.quote_version) + 1;
        await tx.execute(sql`insert into app.construction_service_order_quotes(enterprise_id,project_id,order_id,version,lines,total_cents,deposit_cents,note,created_by)
          values(${eid},${pid},${String(order.id)},${next},${JSON.stringify(lines)}::jsonb,${totalCents},${deposit},${note},${this.actor.adminId})`);
        // A new quote version always withdraws the previous confirmation.
        await tx.execute(sql`update app.construction_service_orders set status='quoted',quote_version=${next},confirmed_quote_version=null,
          version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, 'quote', { orderId: String(order.id), quoteVersion: next, totalCents, depositCents: deposit });
        return { id: String(order.id), version: Number(order.version) + 1, quoteVersion: next };
      });
    });
  }
  async confirm(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'quoteVersion']);
    const expected = version(input.expectedVersion), quoteVersion = version(input.quoteVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:confirm:' + id(orderId), key(requestKey), input, async () => {
        const order = await loadOrder(tx, eid, pid, orderId, true);
        if (order.status === 'confirmed' && Number(order.confirmed_quote_version) === quoteVersion) {
          return { id: String(order.id), version: Number(order.version), quoteVersion };
        }
        if (!canConfirm(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        if (Number(order.quote_version) !== quoteVersion) fail('service_order_quote_changed', 409);
        const quote = (await one(tx, sql`select total_cents,deposit_cents from app.construction_service_order_quotes
          where enterprise_id=${eid} and order_id=${String(order.id)} and version=${quoteVersion}`))!;
        await tx.execute(sql`update app.construction_service_orders set status='confirmed',confirmed_quote_version=${quoteVersion},
          version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, 'confirm', { orderId: String(order.id), quoteVersion, totalCents: cents(quote.total_cents), depositCents: cents(quote.deposit_cents) });
        return { id: String(order.id), version: Number(order.version) + 1, quoteVersion, totalCents: cents(quote.total_cents), depositCents: cents(quote.deposit_cents) };
      });
    });
  }
  async schedule(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'scheduledFor', 'installerId', 'points']);
    const at = scheduledFor(input.scheduledFor), installerId = id(input.installerId), points = servicePoints(input.points);
    const expected = version(input.expectedVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:schedule:' + id(orderId), key(requestKey), input, async () => {
        const order = await loadOrder(tx, eid, pid, orderId, true);
        if (!canSchedule(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        const existing = await orderPoints(tx, eid, order.id);
        // Installed or accepted points already carry evidence; they can no longer be replaced.
        if (existing.some(point => point.status !== 'pending')) fail('service_order_points_locked', 409);
        if (!await one(tx, sql`select a.id from app.admin_users a join app.construction_members m
          on m.enterprise_id=a.enterprise_id and m.admin_id=a.id and m.project_id=${pid} and m.active and m.role='manager'
          where a.enterprise_id=${eid} and a.id=${installerId} and a.status='active' for share of a,m`)) fail('service_order_installer_unavailable', 422);
        for (const point of points) {
          if (!point.roomId) continue;
          if (!await one(tx, sql`select id from app.construction_rooms where enterprise_id=${eid} and project_id=${pid} and id=${point.roomId} for share`)) fail('service_order_room_unavailable', 422);
        }
        await tx.execute(sql`delete from app.construction_service_order_points where enterprise_id=${eid} and order_id=${String(order.id)} and status='pending'`);
        let seq = 0;
        for (const point of points) await tx.execute(sql`insert into app.construction_service_order_points(enterprise_id,project_id,order_id,seq,name,room_id,position_note)
          values(${eid},${pid},${String(order.id)},${++seq},${point.name},${point.roomId},${point.positionNote})`);
        await tx.execute(sql`update app.construction_service_orders set status='scheduled',scheduled_for=${at},installer_id=${installerId},
          version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, 'schedule', { orderId: String(order.id), scheduledFor: at, installerId, points: seq });
        return { id: String(order.id), version: Number(order.version) + 1, points: seq };
      });
    });
  }
  async point(projectId: string, orderId: string, pointId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'action']);
    const action = choice(input.action, ['install', 'accept'] as const), expected = version(input.expectedVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      return idempotent(tx, actorContext(this.actor), `construction:service-order:point:${action}:${id(orderId)}:${id(pointId)}`, key(requestKey), input, async () => {
        const order = await loadOrder(tx, eid, pid, orderId, true);
        const canAct = access.owner || (order.installer_id !== null && String(order.installer_id) === this.actor.adminId);
        if (!canAct) fail('service_order_forbidden', 403);
        if (!canActOnPoint(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        const point = await one(tx, sql`select * from app.construction_service_order_points
          where enterprise_id=${eid} and order_id=${String(order.id)} and id=${id(pointId)} for update`);
        if (!point) fail('service_order_point_not_found', 404);
        if (action === 'install') {
          if (point.status === 'pending') await tx.execute(sql`update app.construction_service_order_points set status='installed',
            installed_at=now(),installed_by=${this.actor.adminId},updated_at=now() where enterprise_id=${eid} and id=${String(point.id)}`);
          else if (point.status !== 'installed' && point.status !== 'accepted') fail('service_order_point_conflict', 409);
        } else {
          if (point.status === 'installed') await tx.execute(sql`update app.construction_service_order_points set status='accepted',
            accepted_at=now(),accepted_by=${this.actor.adminId},updated_at=now() where enterprise_id=${eid} and id=${String(point.id)}`);
          else if (point.status !== 'accepted') fail('service_order_point_not_installed', 409);
        }
        const remaining = (await one(tx, sql`select count(*)::int as open from app.construction_service_order_points
          where enterprise_id=${eid} and order_id=${String(order.id)} and status<>'accepted'`))!;
        const completed = Number(remaining.open) === 0;
        await tx.execute(sql`update app.construction_service_orders set status=${completed ? 'accepted' : String(order.status)},
          accepted_at=${completed ? sql`now()` : sql`null`},version=version+1,updated_at=now()
          where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, action === 'install' ? 'point.install' : 'point.accept', { orderId: String(order.id), pointId: id(pointId), completed });
        return { id: String(order.id), version: Number(order.version) + 1, pointId: id(pointId), pointStatus: action === 'install' ? 'installed' : 'accepted', orderStatus: completed ? 'accepted' : String(order.status) };
      });
    });
  }
  async cancel(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'reason']);
    const reason = text(input.reason, 200), expected = version(input.expectedVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:cancel:' + id(orderId), key(requestKey), input, async () => {
        const order = await loadOrder(tx, eid, pid, orderId, true);
        if (order.status === 'cancelled' && order.cancel_reason === reason) return { id: String(order.id), version: Number(order.version) };
        if (!canCancel(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        await tx.execute(sql`update app.construction_service_orders set status='cancelled',cancelled_at=now(),cancel_reason=${reason},
          version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, 'cancel', { orderId: String(order.id), reason });
        return { id: String(order.id), version: Number(order.version) + 1 };
      });
    });
  }
  async repair(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['issue', 'pointId']);
    const issue = repairIssue(input.issue);
    const pointId = input.pointId === undefined || input.pointId === null || input.pointId === '' ? null : id(input.pointId);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:repair:' + id(orderId), key(requestKey), input, async () => {
        // Lifecycle lock first: repair, extension and exit must share one order-row lock order.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`service-order-lifecycle:${eid}:${pid}`},0))`);
        const order = await loadOrder(tx, eid, pid, orderId, true);
        const canAct = access.owner || (order.installer_id !== null && String(order.installer_id) === this.actor.adminId);
        if (!canAct) fail('service_order_forbidden', 403);
        if (!canRepair(String(order.status))) fail('service_order_conflict', 409);
        if (pointId !== null && !await one(tx, sql`select id from app.construction_service_order_points
          where enterprise_id=${eid} and order_id=${String(order.id)} and id=${pointId} for share`)) fail('service_order_point_not_found', 404);
        const created = (await one(tx, sql`insert into app.construction_service_order_repairs(enterprise_id,project_id,order_id,point_id,issue,opened_by)
          values(${eid},${pid},${String(order.id)},${pointId},${issue},${this.actor.adminId}) returning id,version,status`))!;
        await audit(tx, this.actor, pid, 'repair.open', { orderId: String(order.id), repairId: String(created.id), pointId });
        return { id: String(created.id), version: Number(created.version), status: String(created.status) };
      });
    });
  }
  async repairAction(projectId: string, orderId: string, repairId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'action', 'resolution']);
    const action = choice(input.action, ['resolve', 'cancel'] as const), expected = version(input.expectedVersion);
    const resolution = action === 'resolve' ? repairResolution(input.resolution) : '';
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId), rid = id(repairId);
      return idempotent(tx, actorContext(this.actor), `construction:service-order:repair:${action}:${id(orderId)}:${rid}`, key(requestKey), input, async () => {
        const order = await loadOrder(tx, eid, pid, orderId, true);
        const repair = await one(tx, sql`select * from app.construction_service_order_repairs
          where enterprise_id=${eid} and order_id=${String(order.id)} and id=${rid} for update`);
        if (!repair) fail('service_order_repair_not_found', 404);
        const canAct = access.owner || (order.installer_id !== null && String(order.installer_id) === this.actor.adminId);
        if (action === 'cancel' ? !access.owner : !canAct) fail('service_order_forbidden', 403);
        const target = action === 'resolve' ? 'resolved' : 'cancelled';
        if (repair.status === target && String(repair.resolution || '') === resolution) {
          return { id: String(repair.id), version: Number(repair.version), status: target };
        }
        if (repair.status !== 'open') fail('service_order_repair_conflict', 409);
        if (Number(repair.version) !== expected) fail('version_conflict', 409);
        if (!canRepair(String(order.status))) fail('service_order_conflict', 409);
        await tx.execute(sql`update app.construction_service_order_repairs set status=${target},resolution=${resolution},
          closed_by=${this.actor.adminId},closed_at=now(),updated_at=now(),version=version+1
          where enterprise_id=${eid} and id=${String(repair.id)}`);
        await audit(tx, this.actor, pid, action === 'resolve' ? 'repair.resolve' : 'repair.cancel',
          { orderId: String(order.id), repairId: String(repair.id), pointId: repair.point_id === null ? null : String(repair.point_id) });
        return { id: String(repair.id), version: Number(repair.version) + 1, status: target };
      });
    });
  }
  async extend(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'days', 'note']);
    const days = extensionDaysInput(input.days), note = text(input.note ?? '', 200, false), expected = version(input.expectedVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:extend:' + id(orderId), key(requestKey), input, async () => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`service-order-lifecycle:${eid}:${pid}`},0))`);
        const order = await loadOrder(tx, eid, pid, orderId, true);
        if (!canExtend(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        const total = await orderExtensionDays(tx, eid, order.id);
        if (Number(order.service_days) + total + days > 3650) fail('service_order_extension_limit', 422);
        await tx.execute(sql`insert into app.construction_service_order_extensions(enterprise_id,project_id,order_id,days,note,created_by)
          values(${eid},${pid},${String(order.id)},${days},${note},${this.actor.adminId})`);
        await tx.execute(sql`update app.construction_service_orders set version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, 'extend', { orderId: String(order.id), days, totalDays: total + days });
        return { id: String(order.id), version: Number(order.version) + 1, extensionDays: total + days, serviceEndsAt: serviceEndsAt(order, total + days) };
      });
    });
  }
  async exit(projectId: string, orderId: string, input: Row, requestKey?: string) {
    object(input, ['expectedVersion', 'reason', 'depositReturnedCents', 'depositDeductedCents', 'depositNote']);
    const reason = text(input.reason, 200), disposition = depositDisposition(input), expected = version(input.expectedVersion);
    return withTenantTransaction(this.actor.enterpriseId, async tx => {
      const eid = this.actor.enterpriseId, pid = id(projectId), access = await projectAccess(tx, this.actor, projectId);
      if (!access.owner) fail('service_order_forbidden', 403);
      return idempotent(tx, actorContext(this.actor), 'construction:service-order:exit:' + id(orderId), key(requestKey), input, async () => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`service-order-lifecycle:${eid}:${pid}`},0))`);
        const order = await loadOrder(tx, eid, pid, orderId, true);
        const receipt = { id: String(order.id), version: Number(order.version) + 1, status: 'exited' };
        if (order.status === 'exited' && order.exit_reason === reason
          && Number(order.deposit_returned_cents) === disposition.returnedCents
          && Number(order.deposit_deducted_cents) === disposition.deductedCents && String(order.deposit_note || '') === disposition.note) {
          return { ...receipt, version: Number(order.version) };
        }
        if (!canExit(String(order.status))) fail('service_order_conflict', 409);
        if (Number(order.version) !== expected) fail('version_conflict', 409);
        const open = await one(tx, sql`select count(*)::int as open from app.construction_service_order_repairs
          where enterprise_id=${eid} and order_id=${String(order.id)} and status='open'`);
        if (Number(open!.open) > 0) fail('service_order_repairs_open', 409);
        // Serialize with camera binding so an exit cannot slip past its device check.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`service-order-camera:${eid}:${pid}`},0))`);
        const devices = await one(tx, sql`select count(*)::int as active from app.construction_camera_bindings
          where enterprise_id=${eid} and project_id=${pid} and ended_at is null`);
        if (Number(devices!.active) > 0) fail('service_order_devices_active', 409);
        const quote = await one(tx, sql`select deposit_cents from app.construction_service_order_quotes
          where enterprise_id=${eid} and order_id=${String(order.id)} and version=${Number(order.confirmed_quote_version)}`);
        const depositCents = cents(quote?.deposit_cents) ?? 0;
        if (disposition.returnedCents + disposition.deductedCents > depositCents) fail('service_order_deposit_exceeds', 422);
        await tx.execute(sql`update app.construction_service_orders set status='exited',exited_at=now(),exit_reason=${reason},
          deposit_returned_cents=${disposition.returnedCents},deposit_deducted_cents=${disposition.deductedCents},deposit_note=${disposition.note},
          version=version+1,updated_at=now() where enterprise_id=${eid} and id=${String(order.id)}`);
        await audit(tx, this.actor, pid, 'exit', { orderId: String(order.id), reason, depositReturnedCents: disposition.returnedCents,
          depositDeductedCents: disposition.deductedCents, depositCents });
        return { ...receipt, depositCents };
      });
    });
  }
}
