import {sql} from 'drizzle-orm';
import type {PostgresTransaction} from '@/db/transaction';
import {one} from '@/db/repositories/assistant-repository';
import {fail} from '@/lib/assistant/contracts';

export function nodeRetentionDays() {
  const n=Number(process.env.CAMERA_NODE_RETENTION_DAYS||7);
  if(!Number.isSafeInteger(n)||n<1||n>30)fail('camera_recording_not_configured',503);
  return n;
}
export async function retentionDefault(tx:PostgresTransaction,eid:string) {
  const r=await one(tx,sql`select retention_days,version from app.construction_camera_retention_defaults where enterprise_id=${eid}`);
  return {retentionDays:r?Number(r.retention_days):Math.min(3,nodeRetentionDays()),version:r?Number(r.version):0};
}
// Serialize enterprise propagation and per-camera saves before worker/binding locks.
export async function lockRetentionDefault(tx:PostgresTransaction,eid:string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`camera-retention-default:${eid}`},0))`);
}
