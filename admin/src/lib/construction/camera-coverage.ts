import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail, id } from '@/lib/assistant/contracts';
import { cameraAccess } from './camera/service';
import { shanghaiDay } from './camera/recording-contract';
import type { ConstructionActor } from './contracts';
import { recordingCoverage, type RecordingCoverage } from './recording-coverage';

const date = (value: unknown) => new Date(value instanceof Date ? value.getTime() : String(value));
export async function cameraCoverage(actor: ConstructionActor, projectId: string, bindingId: string, day: unknown): Promise<RecordingCoverage> {
  const pid = id(projectId), bid = id(bindingId), { from, to } = shanghaiDay(day), limit = 1000;
  return withTenantTransaction(actor.enterpriseId, async tx => {
    const access = await cameraAccess(tx, actor, pid);
    if (!access.owner) fail('camera_forbidden', 403);
    const binding = await one(tx, sql`select b.id,now() sampled_at from app.construction_camera_bindings b
      join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where b.enterprise_id=${actor.enterpriseId} and b.project_id=${pid} and b.id=${bid} and b.ended_at is null and c.enabled for share of b,c`);
    if (!binding) fail('camera_binding_unavailable', 404);
    // The same conservative retention rule as private playback. Include a file
    // crossing midnight, clipping it only in this read model. No path or ID is
    // returned and this summary is not a fresh physical-media availability test.
    const samples = await rows(tx, sql`select r.started_at,r.ended_at from app.construction_recordings r
      join app.construction_camera_recording_policies p on p.enterprise_id=r.enterprise_id and p.binding_id=r.binding_id and p.project_id=r.project_id
      where r.enterprise_id=${actor.enterpriseId} and r.project_id=${pid} and r.binding_id=${bid} and r.state='ready'
      and r.ended_at>${from} and r.started_at<${to}
      and r.started_at+r.clock_offset_min_ms*interval '1 millisecond'>=now()-p.retention_days*interval '1 day'
      order by r.started_at,r.id limit ${limit + 1}`);
    return {
      bindingId: bid, day: day as string, sampledAt: date(binding.sampled_at).toISOString(), from: from.toISOString(), to: to.toISOString(), limit, truncated: samples.length > limit,
      ...recordingCoverage(from, to, samples.slice(0, limit).map(row => ({ startedAt: date(row.started_at), endedAt: date(row.ended_at) }))),
    };
  });
}
