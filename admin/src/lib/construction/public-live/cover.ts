import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { retainedSnapshot, snapshotRetentionJoins } from '../camera/snapshot-retention';
import { normalizeCameraSnapshot } from '../camera/service';
import { cameraWvp } from '../camera/wvp';
import { liveSource } from './store';

const slot = sql`date_bin(interval '15 minutes',now(),timestamptz '2000-01-01 00:00:00Z')`;

export function liveCover(tx: PostgresTransaction, eid: string, bid: string, vid: string, includeData = false) {
  return one(tx, sql`select s.id,s.captured_at ${includeData ? sql`,s.data` : sql``}
    from app.construction_camera_snapshots s ${snapshotRetentionJoins}
    where s.enterprise_id=${eid} and s.binding_id=${bid} and s.scheduled_live_version_id=${vid}
    and s.state='ready' and ${retainedSnapshot()}
    order by s.captured_at desc,s.id desc limit 1`);
}

export async function captureDueLiveCovers(upstream = cameraWvp()) {
  const due = await withPlatformTransaction(tx => rows(tx, sql`select l.enterprise_id,l.id,l.current_version_id
    from app.construction_public_live l where l.status='pending_owner'
    and not exists(select 1 from app.construction_camera_snapshots s where s.enterprise_id=l.enterprise_id
      and s.scheduled_live_version_id=l.current_version_id and s.scheduled_at=${slot})
    order by l.id limit 4`));
  let captured = 0;
  for (const candidate of due) {
    const eid = String(candidate.enterprise_id), lid = String(candidate.id), vid = String(candidate.current_version_id);
    const claim = await withTenantTransaction(eid, async tx => {
      const current = await liveSource(tx,eid,lid,vid);
      if (current?.live.status !== 'pending_owner') return null;
      const bid = String(current.version.binding_id);
      const row = await one(tx,sql`insert into app.construction_camera_snapshots
        (enterprise_id,project_id,binding_id,request_key,scheduled_live_version_id,scheduled_at)
        values(${eid},${String(current.live.project_id)},${bid},'public-live-cover',${vid},${slot})
        on conflict do nothing returning id`);
      return row && { id:String(row.id), bid, device:String(current.source.device_id), channel:String(current.source.channel_id) };
    });
    if (!claim) continue;
    let saved = false;
    try {
      const jpeg = await normalizeCameraSnapshot(await upstream.snapshot(claim.device,claim.channel));
      saved = await withTenantTransaction(eid,async tx => {
        const current = await liveSource(tx,eid,lid,vid);
        if (current?.live.status !== 'pending_owner') return false;
        const row = await one(tx,sql`update app.construction_camera_snapshots
          set state='ready',data=${jpeg.data},width=${jpeg.info.width},height=${jpeg.info.height},captured_at=now()
          where enterprise_id=${eid} and id=${claim.id} and state='pending' returning id`);
        if(!row)return false;
        await tx.execute(sql`insert into app.construction_audits(enterprise_id,project_id,actor_ref,action,snapshot)
          values(${eid},${String(current.live.project_id)},'{"kind":"system"}'::jsonb,'camera.snapshot.live_cover',
            ${JSON.stringify({id:claim.id,bindingId:claim.bid,versionId:vid})}::jsonb)`);
        return true;
      });
    } catch { /* Keep the claimed slot. A later slot may capture a fresh frame. */ }
    if (saved) captured++;
    else await withTenantTransaction(eid,tx => tx.execute(sql`update app.construction_camera_snapshots
      set state='failed' where enterprise_id=${eid} and id=${claim.id} and state='pending'`));
  }
  return { captured };
}
