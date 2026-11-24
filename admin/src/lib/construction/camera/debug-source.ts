import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { fingerprint, id } from '@/lib/assistant/contracts';

const databaseId = z.string().refine(value => {
  try { return id(value) === value; } catch { return false; }
});
const allowlist = {
  revision: z.number().int().positive(),
  enterpriseId: databaseId,
  allow: z.array(z.object({ projectId: databaseId, userId: databaseId }).strict()).nonempty(),
};
const syntheticOrigin = z.string().refine(value => {
  try {
    const address = new URL(value);
    return address.protocol === 'http:' && address.origin === value && Boolean(address.port) &&
      ['sfp-camera-debug', '127.0.0.1', 'localhost'].includes(address.hostname);
  } catch { return false; }
});
const source = z.union([
  z.object({ ...allowlist, sourceProjectId: databaseId, sourceBindingId: databaseId }).strict()
    .refine(config => config.allow.every(target => target.projectId !== config.sourceProjectId)),
  z.object({ ...allowlist, syntheticOrigin }).strict(),
]);

export const debugSignalBinding = 'test-pattern';
export const debugSignalStream = { app: 'sfp_debug', stream: 'test_pattern' } as const;

const debugItem = { name: '调试机位', ptz_enabled: false } as const;
const syntheticItem = { ...debugItem, id: debugSignalBinding, binding_id: debugSignalBinding };

type DebugSource = z.infer<typeof source> & { scope: string };

export function debugCameraSource(enterpriseId: string, targetProjectId: string, userId: string): DebugSource | null {
  const raw = process.env.CAMERA_DEBUG_SOURCE;
  if (!raw) return null;
  try {
    const config = source.safeParse(JSON.parse(raw));
    if (!config.success || config.data.enterpriseId !== enterpriseId ||
      !config.data.allow.some(target => target.projectId === targetProjectId && target.userId === userId)) return null;
    return { ...config.data, scope: fingerprint(config.data) };
  } catch {
    return null;
  }
}

// A usable project camera takes priority over either debug source.
export async function availableDebugCamera(tx: PostgresTransaction, config: DebugSource, targetProjectId: string) {
  const noProjectCamera = sql`not exists (
    select 1 from app.construction_camera_bindings target
    join app.construction_cameras own on own.enterprise_id=target.enterprise_id and own.id=target.camera_id
    where target.enterprise_id=${config.enterpriseId} and target.project_id=${targetProjectId}
      and target.ended_at is null and own.enabled
  )`;
  if ('syntheticOrigin' in config) {
    const available = await one(tx, sql`select 1 where ${noProjectCamera}`);
    return available ? { item: syntheticItem, syntheticOrigin: config.syntheticOrigin } : null;
  }
  const camera = await one(tx, sql`select c.id, b.id as binding_id
    from app.construction_camera_bindings b
    join app.construction_cameras c on c.enterprise_id=b.enterprise_id and c.id=b.camera_id
    join app.construction_projects p on p.enterprise_id=b.enterprise_id and p.id=b.project_id
    join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
    where b.enterprise_id=${config.enterpriseId} and b.project_id=${config.sourceProjectId}
      and b.id=${config.sourceBindingId} and b.ended_at is null and c.enabled
      and p.status='active' and not p.customer_access and l.archived_at is null and l.customer_user_id is null
      and ${noProjectCamera} for share of b,c,p,l`);
  return camera ? { item: { ...debugItem, id: String(camera.id), binding_id: String(camera.binding_id) } } : null;
}
