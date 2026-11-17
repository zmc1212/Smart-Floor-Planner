import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '@/lib/assistant/contracts';
import { cameraAccess, customerCameraActor, type CameraCustomerActor, type CameraCustomerIdentity } from './access';
import { cameraWvp } from './wvp';

type Cover = { capturedAt: string; jpeg: string };
type CoverEntry = { expires: number; frame: Promise<Cover | null> };
const covers = new Map<string, CoverEntry>();
const coverLifetimeMs = 60_000;
const coverLimit = 64;

async function source(actor: CameraCustomerActor, projectId: string) {
  const eid = actor.enterpriseId;
  return withTenantTransaction(eid, async tx => {
    const access = await cameraAccess(tx, actor, projectId);
    if ('liveOnly' in access && access.liveOnly) fail('camera_project_unavailable', 404);
    return one(tx, sql`select b.id::text,c.name,c.device_id,c.channel_id,c.version
      from app.construction_camera_bindings b join app.construction_cameras c
        on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
      where b.enterprise_id=${eid} and b.project_id=${projectId} and b.ended_at is null and c.enabled
      order by c.id limit 1 for share of b,c`);
  });
}

const sourceKey = (actor: CameraCustomerActor, projectId: string, camera: Row) =>
  [actor.enterpriseId, projectId, actor.userId, actor.grantVersion, camera.id, camera.version].join(':');

function capture(sourceId: string, camera: Row, snapshot: (device: string, channel: string) => Promise<Buffer>) {
  const now = Date.now(), saved = covers.get(sourceId);
  if (saved && now < saved.expires) return saved.frame;
  const frame = (async () => {
    const image = await snapshot(String(camera.device_id), String(camera.channel_id));
    const capturedAt = new Date().toISOString();
    const jpeg = await sharp(image, { limitInputPixels: 32_000_000 }).rotate()
      .resize({ width: 640, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    return jpeg.length <= 192_000 ? { capturedAt, jpeg: jpeg.toString('base64') } : null;
  })().catch(() => null);
  covers.delete(sourceId);
  if (covers.size >= coverLimit) covers.delete(covers.keys().next().value!);
  covers.set(sourceId, { expires: now + coverLifetimeMs, frame });
  return frame;
}

/** One passive preview for the current binding, outside the manual capture history. */
export async function ownerSiteCover(identity: CameraCustomerIdentity, projectId: string,
  snapshot = (device: string, channel: string) => cameraWvp().snapshot(device, channel)) {
  const actor = await customerCameraActor(identity, projectId);
  const camera = await source(actor, projectId);
  if (!camera) return { camera: null };
  const key = sourceKey(actor, projectId, camera);
  const cover = await capture(key, camera, snapshot);
  // The adapter may take time. A revoked grant or changed binding must not get
  // the bytes of a frame captured before the change.
  const current = await source(actor, projectId);
  if (!current || sourceKey(actor, projectId, current) !== key) fail('camera_project_unavailable', 404);
  return { camera: { name: String(current.name), cover } };
}
