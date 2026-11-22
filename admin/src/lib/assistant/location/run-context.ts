import { sql } from 'drizzle-orm';
import type { PostgresTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { fail } from '../contracts';
import { nearbyLocationVersion } from './region';

const locationStep = 2020;

/** Register the dependency under the same conversation lock as the region read. */
export async function recordRunLocationUse(tx: PostgresTransaction, enterpriseId: string, runId: string, entry: unknown) {
  const version = nearbyLocationVersion(entry);
  await tx.execute(sql`insert into app.assistant_run_steps(enterprise_id,run_id,step_seq,kind,status,input_summary)
    values(${enterpriseId},${runId},${locationStep},'agent_location_context','succeeded',${JSON.stringify({ version })}::jsonb)
    on conflict (enterprise_id,run_id,step_seq) do nothing`);
}

export async function assertRunLocationCurrent(tx: PostgresTransaction, enterpriseId: string, run: Row, entry: unknown) {
  const admitted = (run.policy_snapshot as Row).nearbyLocationVersion;
  const current = nearbyLocationVersion(entry);
  if ((admitted ?? 0) === current) return;
  // Older active replies could have received the region in their opening prompt.
  if (admitted === undefined) fail('context_changed');
  const bound = await one(tx, sql`select input_summary from app.assistant_run_steps where enterprise_id=${enterpriseId}
    and run_id=${String(run.id)} and step_seq=${locationStep} and kind='agent_location_context'`);
  if (bound && (bound.input_summary as Row).version !== current) fail('context_changed');
}
