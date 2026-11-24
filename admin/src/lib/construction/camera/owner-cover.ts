import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import { cameraAccess, customerCameraPlayback, type CameraCustomerActor, type CameraCustomerIdentity } from './access';
import { debugSignalStream } from './debug-source';
import { privateSnapshot, retainedSnapshot, snapshotRetentionJoins } from './snapshot-retention';
import { cameraWvp } from './wvp';

type Cover = { capturedAt: string; jpeg: string };
type CoverEntry = { expires: number; frame: Promise<Cover | null> };
const covers = new Map<string, CoverEntry>();
const coverLifetimeMs = 60_000;
const coverLimit = 64;
const maxCoverBytes = 192_000;
const ownerCoverKey = 'owner-cover';
const storedCoverMaxAge = sql`interval '24 hours'`;

async function locate(tx: PostgresTransaction, actor: CameraCustomerActor, projectId: string) {
  const eid = actor.enterpriseId;
  const access = await cameraAccess(tx, actor, projectId);
  if ('liveOnly' in access && access.liveOnly) fail('camera_project_unavailable', 404);
  return one(tx, sql`select b.id::text,c.name,c.device_id,c.channel_id,c.version
    from app.construction_camera_bindings b join app.construction_cameras c
      on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    where b.enterprise_id=${eid} and b.project_id=${projectId} and b.ended_at is null and c.enabled
    order by c.id limit 1 for share of b,c`);
}

async function source(actor: CameraCustomerActor, projectId: string) {
  return withTenantTransaction(actor.enterpriseId, tx => locate(tx, actor, projectId));
}

/** Recent frames for an authorized active binding, through the shared retention policy. */
export function storedCameraCover(tx: PostgresTransaction, eid: string, projectId: string, bindingId: string, includePrivate = false) {
  const scheduled = sql`s.request_key=${ownerCoverKey} and s.scheduled_at is not null
    and s.scheduled_live_version_id is null and not ${privateSnapshot()}`;
  const audience = includePrivate ? sql`((${scheduled}) or ${privateSnapshot()})` : sql`(${scheduled})`;
  return one(tx, sql`select s.captured_at,s.data,(${scheduled}) as scheduled
    from app.construction_camera_snapshots s ${snapshotRetentionJoins}
    where s.enterprise_id=${eid} and s.project_id=${projectId} and s.binding_id=${bindingId} and ${audience}
      and s.state='ready' and s.data is not null and ${retainedSnapshot()} and s.captured_at>now()-${storedCoverMaxAge}
    order by s.captured_at desc,s.id desc limit 1`);
}

const sourceKey = (actor: CameraCustomerActor, projectId: string, camera: Row) =>
  [actor.enterpriseId, projectId, actor.userId, actor.grantVersion, camera.id, camera.version].join(':');

/** Keep cover frames small enough for the owner home and mobile player. */
export async function cameraCoverJpeg(image: Buffer) {
  const jpeg = await sharp(image, { limitInputPixels: 32_000_000 }).rotate()
    .resize({ width: 640, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 })
    .toBuffer({ resolveWithObject: true });
  if (jpeg.data.length > maxCoverBytes) fail('camera_snapshot_too_large', 502);
  return jpeg;
}

function capture(sourceId: string, camera: Row, snapshot: (device: string, channel: string) => Promise<Buffer>) {
  const now = Date.now(), saved = covers.get(sourceId);
  if (saved && now < saved.expires) return saved.frame;
  const frame = (async () => {
    const jpeg = await cameraCoverJpeg(await snapshot(String(camera.device_id), String(camera.channel_id)));
    return { capturedAt: new Date().toISOString(), jpeg: jpeg.data.toString('base64') };
  })().catch(() => null);
  covers.delete(sourceId);
  if (covers.size >= coverLimit) covers.delete(covers.keys().next().value!);
  covers.set(sourceId, { expires: now + coverLifetimeMs, frame });
  return frame;
}

async function syntheticCover(origin: string): Promise<Cover | null> {
  const url = new URL(`/${debugSignalStream.app}/${debugSignalStream.stream}/cover.jpg`, origin);
  const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000) });
  const capturedAt = Date.parse(response.headers.get('X-Camera-Captured-At') ?? '');
  const size = Number(response.headers.get('Content-Length'));
  if (!response.ok || response.headers.get('Content-Type') !== 'image/jpeg' ||
    !Number.isFinite(capturedAt) || !Number.isSafeInteger(size) || size < 1 || size > maxCoverBytes) {
    await response.body?.cancel();
    return null;
  }
  const { data } = await cameraCoverJpeg(Buffer.from(await response.arrayBuffer()));
  return { capturedAt: new Date(capturedAt).toISOString(), jpeg: data.toString('base64') };
}

/**
 * Owner home cover. The gateway stores an interval frame in the background, so
 * a sleeping 4G camera normally costs nothing here. When no stored frame exists
 * yet, one synchronous capture keeps the first visit working as before.
 */
export async function ownerSiteCover(identity: CameraCustomerIdentity, projectId: string,
  snapshot = (device: string, channel: string) => cameraWvp().snapshot(device, channel)) {
  const { actor, debugCamera } = await customerCameraPlayback(identity, projectId);
  if (debugCamera) {
    if (!debugCamera.syntheticOrigin) return { camera: { name: debugCamera.item.name, cover: null } };
    const cover = await syntheticCover(debugCamera.syntheticOrigin).catch(() => null);
    const current = await customerCameraPlayback(identity, projectId);
    if (!current.debugCamera?.syntheticOrigin || current.actor.debug?.scope !== actor.debug?.scope ||
      current.actor.grantVersion !== actor.grantVersion) fail('camera_project_unavailable', 404);
    return { camera: { name: current.debugCamera.item.name, cover } };
  }
  const camera = await source(actor, projectId);
  if (!camera) return { camera: null };
  const stored = await withTenantTransaction(actor.enterpriseId, tx => storedCameraCover(tx, actor.enterpriseId, projectId, String(camera.id)));
  if (stored?.data) return { camera: { name: String(camera.name), cover: {
    capturedAt: new Date(String(stored.captured_at)).toISOString(), jpeg: Buffer.from(stored.data as Buffer).toString('base64'),
  } } };
  const key = sourceKey(actor, projectId, camera);
  const cover = await capture(key, camera, snapshot);
  // The adapter may take time. A revoked grant or changed binding must not get
  // the bytes of a frame captured before the change.
  const current = await source(actor, projectId);
  if (!current || sourceKey(actor, projectId, current) !== key) fail('camera_project_unavailable', 404);
  return { camera: { name: String(current.name), cover } };
}

type DueCover = { enterprise_id: string; project_id: string; binding_id: string; device_id: string; channel_id: string; slot: Date };

/**
 * Capture the cover of each active project's displayed camera once per
 * configured interval. Only the binding shown on the owner home is captured,
 * so additional cameras are not woken. Failures keep the claimed slot; the
 * next interval tries again.
 */
export async function captureDueOwnerCovers(upstream = cameraWvp()) {
  const due = await withPlatformTransaction(tx => rows(tx, sql`select * from (
    select b.enterprise_id,b.project_id,b.id binding_id,c.device_id,c.channel_id,
      date_bin(make_interval(hours => coalesce(d.interval_hours,1)),now(),timestamptz '2000-01-01 00:00:00+00') slot
    from app.construction_camera_bindings b
    join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    join app.construction_projects j on j.enterprise_id=b.enterprise_id and j.id=b.project_id
    join app.leads l on l.enterprise_id=j.enterprise_id and l.id=j.lead_id
    join app.enterprises e on e.id=b.enterprise_id
    left join app.construction_camera_cover_defaults d on d.enterprise_id=b.enterprise_id
    where b.ended_at is null and c.enabled and j.status='active' and l.archived_at is null and e.status='active'
      and exists(select 1 from app.construction_camera_customer_grants g
        where g.enterprise_id=b.enterprise_id and g.project_id=b.project_id and g.enabled)
      and not exists (select 1 from app.construction_camera_bindings b2
        join app.construction_cameras c2 on c2.enterprise_id=b2.enterprise_id and c2.id=b2.camera_id
        where b2.enterprise_id=b.enterprise_id and b2.project_id=b.project_id and b2.ended_at is null and c2.enabled and c2.id<c.id)
  ) q where not exists (select 1 from app.construction_camera_snapshots s
      where s.enterprise_id=q.enterprise_id and s.binding_id=q.binding_id and s.request_key=${ownerCoverKey} and s.scheduled_at=q.slot)
    order by q.binding_id limit 8`)) as unknown as DueCover[];
  let captured = 0;
  for (const item of due) {
    const eid = String(item.enterprise_id), pid = String(item.project_id), bid = String(item.binding_id);
    const claim = await withTenantTransaction(eid, async tx => {
      const current = await one(tx, sql`select b.id from app.construction_camera_bindings b
        join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
        where b.enterprise_id=${eid} and b.id=${bid} and b.ended_at is null and c.enabled for share of b,c`);
      if (!current) return null;
      return one(tx, sql`insert into app.construction_camera_snapshots(enterprise_id,project_id,binding_id,request_key,scheduled_at)
        values(${eid},${pid},${bid},${ownerCoverKey},${item.slot}) on conflict do nothing returning id`);
    });
    if (!claim) continue;
    let saved = false;
    try {
      const device = String(item.device_id), channel = String(item.channel_id);
      // WVP's snapshot controller can time out while a 4G stream is starting.
      // Wait for the shared live stream through its normal start endpoint first.
      await upstream.play(device, channel);
      const jpeg = await cameraCoverJpeg(await upstream.snapshot(device, channel));
      saved = !!(await withTenantTransaction(eid, tx => one(tx, sql`update app.construction_camera_snapshots
        set state='ready',data=${jpeg.data},width=${jpeg.info.width},height=${jpeg.info.height},captured_at=now()
        where enterprise_id=${eid} and id=${String(claim.id)} and state='pending' returning id`)));
    } catch { /* Keep the claimed slot. A later interval captures a fresh frame. */ }
    if (saved) captured++;
    else await withTenantTransaction(eid, tx => tx.execute(sql`update app.construction_camera_snapshots
      set state='failed' where enterprise_id=${eid} and id=${String(claim.id)} and state='pending'`));
  }
  return { captured };
}
