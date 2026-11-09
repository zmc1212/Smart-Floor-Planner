import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { lockRetentionDefault, nodeRetentionDays } from './retention-defaults';

// Queries use s/p/d for the snapshot, its saved policy and enterprise default.
// A retired binding and SD mode retain their saved policy just like cloud history.
export const snapshotRetentionDays = () => sql`coalesce(p.retention_days,d.retention_days,${Math.min(3, nodeRetentionDays())})`;
export const snapshotRetentionJoins = sql`
  left join app.construction_camera_recording_policies p on p.enterprise_id=s.enterprise_id and p.project_id=s.project_id and p.binding_id=s.binding_id
  left join app.construction_camera_retention_defaults d on d.enterprise_id=s.enterprise_id`;
export const retainedSnapshot = () => sql`s.state<>'expired' and coalesce(s.captured_at,s.created_at)>now()-${snapshotRetentionDays()}*interval '1 day'`;
// 0115 requires one private author; 0117 scheduled public covers require neither.
// Private viewing must also work without the optional public-preview migration.
export const privateSnapshot = () => sql`(s.actor_id is not null or s.actor_user_id is not null)`;

export async function purgeCameraSnapshots() {
  const candidates = await withPlatformTransaction(tx => rows(tx, sql`
    select s.id,s.enterprise_id,s.binding_id from app.construction_camera_snapshots s ${snapshotRetentionJoins}
    where s.state='ready' and s.captured_at<=now()-${snapshotRetentionDays()}*interval '1 day'
    order by s.captured_at,s.id limit 100`));
  let expired = 0;
  for (const candidate of candidates) {
    expired += await withTenantTransaction(String(candidate.enterprise_id), async tx => {
      const eid = String(candidate.enterprise_id), bid = String(candidate.binding_id);
      // Match policy-save ordering, then recheck after selection. A concurrent
      // extension must preserve valid bytes; two cleaners must emit one audit.
      await lockRetentionDefault(tx, eid);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-recording:${bid}`},0))`);
      const image = await one(tx, sql`select s.id,s.project_id,${snapshotRetentionDays()} retention_days
        from app.construction_camera_snapshots s ${snapshotRetentionJoins}
        where s.enterprise_id=${eid} and s.id=${String(candidate.id)} and s.state='ready'
        and s.captured_at<=now()-${snapshotRetentionDays()}*interval '1 day' for update of s`);
      if (!image) return 0;
      await tx.execute(sql`update app.construction_camera_snapshots set state='expired',data=null where enterprise_id=${eid} and id=${String(image.id)}`);
      await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
        values(${eid},${String(image.project_id)},'{"kind":"system"}'::jsonb,'camera.snapshot.expire',
        ${JSON.stringify({ id: String(image.id), bindingId: bid, retentionDays: Number(image.retention_days) })}::jsonb)`);
      return 1;
    });
  }
  return { expired };
}
