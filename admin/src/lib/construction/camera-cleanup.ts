import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { cameraAccess } from './camera/service';
import type { ConstructionActor } from './contracts';
import { recordingCleanup, type RecordingCleanupPage } from './camera-cleanup-contract';

export async function cameraCleanup(actor: ConstructionActor, projectId: string, bindingId: string, beforeId?: string): Promise<RecordingCleanupPage> {
  const pid = id(projectId), bid = id(bindingId), cursor = beforeId === undefined ? null : id(beforeId);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const access = await cameraAccess(tx, actor, pid);
    if (!access.owner) fail('camera_forbidden', 403);
    const binding = await one(tx, sql`select b.id from app.construction_camera_bindings b
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where b.enterprise_id=${actor.enterpriseId} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled for share of b,c`);
    if (!binding) fail('camera_binding_unavailable', 404);
    const found = await rows(tx, sql`select id,started_at,ended_at,bytes,state,deleted_at,last_error
      from app.construction_recordings where enterprise_id=${actor.enterpriseId} and project_id=${pid} and binding_id=${bid}
      and state in ('deleting','deleted','missing') ${cursor === null ? sql`` : sql`and id<${cursor}`}
      order by id desc limit 21`);
    const page = found.slice(0, 20);
    return { items: page.map(recordingCleanup), nextCursor: found.length > 20 ? String(page.at(-1)!.id) : null };
  });
}
