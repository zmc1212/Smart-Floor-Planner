/** Stage preparation for the 20261121 agent-evaluation full-flow round.
 * The full-flow acceptance progresses the labelled synthetic project to
 * `furnishing` and requires a fresh stage event; a same-stage progress with
 * sendReminder=false emits none. When project 237 already sits in furnishing
 * (as prior rounds left it), move it one recorded step back to `installation`
 * first, so the acceptance replays the same installation→furnishing journey.
 * Real service write on the labelled synthetic project only; no reminder. */
import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd(), true);
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConstructionService } from '@/lib/construction/service';
import { sql } from 'drizzle-orm';

const eid = '1454', projectId = '237', ownerId = '2853';

async function main() {
  const service = new ConstructionService({ enterpriseId: eid, adminId: ownerId });
  const current = (await service.execute('detail', { projectId })).project as Record<string, unknown>;
  const stage = String(current.current_stage_key || '');
  console.log(JSON.stringify({ projectId, currentStage: stage, version: Number(current.version) }));
  if (stage !== 'furnishing') { console.log('STAGE-PREP-NOOP'); return; }
  const progressed = await service.execute('progress', { projectId, expectedVersion: Number(current.version),
    stageKey: 'installation', note: '合成全流程测试：预回退到安装节点，供验收重放安装→软装推进', sendReminder: false },
    randomUUID());
  const after = await withTenantTransaction(eid, tx => one(tx,
    sql`select current_stage_key from app.construction_projects where enterprise_id=${eid} and id=${projectId}`));
  assert.equal(String(after!.current_stage_key), 'installation');
  console.log(JSON.stringify({ progressedTo: 'installation', version: Number(progressed.version) }));
  console.log('STAGE-PREP-OK');
}
main().catch((error: Error) => { console.error('STAGE-PREP-FAIL: ' + error.message); process.exitCode = 1; })
  .finally(() => closePostgresPool());
