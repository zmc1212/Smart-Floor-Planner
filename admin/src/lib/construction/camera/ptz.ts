import { sql } from 'drizzle-orm';
import { setTimeout as delay } from 'node:timers/promises';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import { cameraSession, parseCameraToken } from './service';
import { cameraWvp, type PtzCommand, type WvpClient } from './wvp';

const lock = (tx: PostgresTransaction, cid: string) => tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-ptz:${cid}`},0))`);
// Bounded 300ms pulses avoid depending on WebView pointer-up or an intact network.
// A durable STOP obligation survives process loss; the gateway watchdog drains it.
export async function cameraPtz(token: string, csrf: string, bindingId: string, command: unknown, sequence: unknown, upstream = cameraWvp()) {
  if (!['left','right','up','down','stop'].includes(String(command)) || !Number.isSafeInteger(sequence) || Number(sequence) < 1) fail('camera_invalid_command', 422);
  const { eid, hash } = parseCameraToken(token);
  const c = await withTenantTransaction(eid, async tx => {
    const s = await cameraSession(tx, token, csrf); if (!s.access.canControl) fail('camera_forbidden', 403);
    const camera = await one(tx, sql`select c.* from app.construction_camera_bindings b join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where b.enterprise_id=${eid} and b.project_id=${s.pid} and b.id=${bindingId} and b.ended_at is null and c.enabled and c.ptz_enabled`);
    if (!camera) fail('camera_ptz_unavailable', 409);
    await lock(tx, String(camera.id));
    const old = await one(tx, sql`select * from app.construction_camera_controls where enterprise_id=${eid} and camera_id=${String(camera.id)} for update`);
    if (old?.session_hash !== hash && old?.stop_required) fail('camera_control_busy', 409);
    if (command !== 'stop' && old?.session_hash === hash && Number(sequence) <= Number(old.sequence)) fail('camera_command_expired', 409);
    // A prior unknown STOP must be acknowledged before any new movement.
    if (command !== 'stop' && old?.stop_required) fail('camera_control_busy', 409);
    await tx.execute(sql`insert into app.construction_camera_controls(enterprise_id,camera_id,session_hash,sequence,expires_at,stop_required)
      values(${eid},${String(camera.id)},${hash},${Number(sequence)},now()+interval '2 seconds',true)
      on conflict(camera_id) do update set session_hash=excluded.session_hash,sequence=case when construction_camera_controls.session_hash=excluded.session_hash then greatest(construction_camera_controls.sequence,excluded.sequence) else excluded.sequence end,expires_at=excluded.expires_at,stop_required=true`);
    return camera;
  });
  let result = 'stopped';
  await withTenantTransaction(eid, async tx => {
    await lock(tx, String(c.id));
    const control = await one(tx, sql`select * from app.construction_camera_controls where enterprise_id=${eid} and camera_id=${String(c.id)} for update`);
    if (!control?.stop_required || control.session_hash !== hash) fail('camera_command_expired', 409);
    try {
      if (command !== 'stop') {
        const s = await cameraSession(tx, token, csrf); if (!s.access.canControl || Number(control.sequence) !== Number(sequence) || new Date(String(control.expires_at)).getTime() <= Date.now()) fail('camera_command_expired', 409);
        const enabled = await one(tx, sql`select c.id from app.construction_cameras c join app.construction_camera_bindings b on b.enterprise_id=c.enterprise_id and b.camera_id=c.id where c.id=${String(c.id)} and c.enabled and c.ptz_enabled and b.id=${bindingId} and b.project_id=${s.pid} and b.ended_at is null for share of c,b`);
        if (!enabled) fail('camera_ptz_unavailable',409);
        await upstream.ptz(String(c.device_id), String(c.channel_id), command as PtzCommand);
        await delay(300); result = 'pulse_sent';
      }
    } finally {
      // On failure this transaction rolls back, retaining the earlier STOP obligation.
      await upstream.ptz(String(c.device_id), String(c.channel_id), 'stop');
      await tx.execute(sql`update app.construction_camera_controls set stop_required=false,expires_at=now() where enterprise_id=${eid} and camera_id=${String(c.id)}`);
    }
  });
  return { state: result };
}
export async function cameraWatchdog(upstream?: WvpClient) {
  const due = await withPlatformTransaction(tx => rows(tx, sql`select c.enterprise_id,c.camera_id,d.device_id,d.channel_id from app.construction_camera_controls c
    join app.construction_cameras d on d.id=c.camera_id where c.stop_required and c.expires_at<=now() limit 50`));
  for (const c of due) {
    try {
      await withTenantTransaction(String(c.enterprise_id), async tx => {
        const acquired = await one(tx, sql`select pg_try_advisory_xact_lock(hashtextextended(${`camera-ptz:${c.camera_id}`},0)) as ok`);
        if (!acquired?.ok) return;
        const current = await one(tx, sql`select camera_id from app.construction_camera_controls where camera_id=${String(c.camera_id)} and stop_required and expires_at<=now() for update`);
        if (!current) return;
        await (upstream || cameraWvp()).ptz(String(c.device_id), String(c.channel_id), 'stop');
        await tx.execute(sql`update app.construction_camera_controls set stop_required=false where camera_id=${String(c.camera_id)}`);
      });
    } catch { /* Persist unknown STOP; retry on the next watchdog tick. */ }
  }
}
