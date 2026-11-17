import { sql } from 'drizzle-orm';
import { withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import { object, version, type ConstructionActor } from '../contracts';
import { cameraAccess } from './access';

export const coverIntervalMinHours = 1;
export const coverIntervalMaxHours = 24;
export const coverIntervalDefaultHours = 1;

export async function coverIntervalHours(tx: PostgresTransaction, eid: string) {
  const r = await one(tx, sql`select interval_hours,version from app.construction_camera_cover_defaults where enterprise_id=${eid}`);
  return { intervalHours: r ? Number(r.interval_hours) : coverIntervalDefaultHours, version: r ? Number(r.version) : 0 };
}

/** Owner-facing cover interval. Existing frames stay readable; the next slot follows the new interval. */
export async function saveCoverInterval(actor: ConstructionActor, pid: string, input: Record<string, unknown>) {
  object(input, ['intervalHours', 'expectedVersion']);
  const expected = input.expectedVersion === 0 ? 0 : version(input.expectedVersion);
  const hours = Number(input.intervalHours);
  if (!Number.isSafeInteger(input.intervalHours) || hours < coverIntervalMinHours || hours > coverIntervalMaxHours)
    fail('camera_invalid_cover_interval', 422);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    if (!(await cameraAccess(tx, actor, pid)).owner) fail('camera_forbidden', 403);
    const old = await one(tx, sql`select interval_hours,version from app.construction_camera_cover_defaults where enterprise_id=${actor.enterpriseId} for update`);
    if (old && Number(old.interval_hours) === hours) return { intervalHours: hours, version: Number(old.version) };
    if ((old ? Number(old.version) : 0) !== expected) fail('version_conflict', 409);
    const saved = await one(tx, sql`insert into app.construction_camera_cover_defaults(enterprise_id,interval_hours)
      values(${actor.enterpriseId},${hours}) on conflict(enterprise_id) do update set interval_hours=excluded.interval_hours,
      version=construction_camera_cover_defaults.version+1,updated_at=now() returning interval_hours,version`);
    await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
      values(${actor.enterpriseId},${pid},${JSON.stringify({ kind: 'admin', id: actor.adminId })}::jsonb,'camera.cover.default',
      ${JSON.stringify({ intervalHours: hours, version: Number(saved!.version) })}::jsonb)`);
    return { intervalHours: hours, version: Number(saved!.version) };
  });
}
