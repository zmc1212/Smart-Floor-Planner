import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { cameraAccess } from './camera/service';
import type { ConstructionActor } from './contracts';
import { recordingActivity, type RecordingActivityPage } from './camera-activity-contract';

export async function cameraActivity(actor: ConstructionActor, projectId: string, bindingId: string, beforeId?: string): Promise<RecordingActivityPage> {
  const pid = id(projectId), bid = id(bindingId), cursor = beforeId === undefined ? null : id(beforeId);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const access = await cameraAccess(tx, actor, pid);
    if (!access.owner) fail('camera_forbidden', 403);
    const binding = await one(tx, sql`select b.id from app.construction_camera_bindings b
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where b.enterprise_id=${actor.enterpriseId} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled for share of b,c`);
    if (!binding) fail('camera_binding_unavailable', 404);
    const found = await rows(tx, sql`select id,created_at,actor_ref,action,snapshot from app.construction_audits
      where enterprise_id=${actor.enterpriseId} and project_id=${pid} and snapshot->>'bindingId'=${bid}
      and action in ('camera.recording.configure','camera.storage.ok','camera.storage.warning','camera.storage.critical','camera.storage.blocked','camera.storage.unavailable')
      ${cursor === null ? sql`` : sql`and id<${cursor}`} order by id desc limit 21`);
    const page = found.slice(0, 20);
    return { items: page.map(row => recordingActivity(row)!), nextCursor: found.length > 20 ? String(page.at(-1)!.id) : null };
  });
}
