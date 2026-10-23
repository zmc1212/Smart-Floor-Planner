import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { cameraAccess } from './camera/service';
import type { ConstructionActor } from './contracts';
import { capacityFromSamples, type RecordingCapacity } from './recording-capacity';

const iso = (value: unknown) => value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
export async function cameraCapacity(actor: ConstructionActor, projectId: string, bindingId: string): Promise<RecordingCapacity> {
  const pid = id(projectId), bid = id(bindingId);
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const access = await cameraAccess(tx, actor, pid);
    if (!access.owner) fail('camera_forbidden', 403);
    const binding = await one(tx, sql`select b.id from app.construction_camera_bindings b
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where b.enterprise_id=${actor.enterpriseId} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled for share of b,c`);
    if (!binding) fail('camera_binding_unavailable', 404);
    const samples = await rows(tx, sql`select bytes,round(extract(epoch from (ended_at-started_at))*1000)::bigint duration_ms,started_at,ended_at
      from app.construction_recordings where enterprise_id=${actor.enterpriseId} and project_id=${pid} and binding_id=${bid}
      and state='ready' and started_at>=now()-interval '24 hours' and ended_at<=now()+interval '60 seconds'
      order by started_at desc,id desc limit 12`);
    const totals = await one(tx, sql`select count(*) filter(where state in ('ready','deleting'))::integer segments,
      coalesce(sum(bytes) filter(where state in ('ready','deleting')),0)::text bytes,
      count(*) filter(where state='deleting')::integer pending,
      count(*) filter(where state='deleting' and last_error is not null)::integer failed
      from app.construction_recordings where enterprise_id=${actor.enterpriseId} and project_id=${pid} and binding_id=${bid}`);
    return {
      bindingId: bid, sampledAt: new Date().toISOString(),
      ...capacityFromSamples(samples.map(r => ({ bytes: String(r.bytes), durationMs: String(r.duration_ms), startedAt: iso(r.started_at), endedAt: iso(r.ended_at) }))),
      indexed: { segments: Number(totals?.segments || 0), bytes: String(totals?.bytes || '0'), pendingDeletion: Number(totals?.pending || 0), failedDeletion: Number(totals?.failed || 0) },
    };
  });
}
