import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { ConstructionReportService, reportPlanDto } from '@/lib/construction/report-service';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
const eid = '1454', adminId = '2853';
const output = path.resolve('../tmp/xiaok-report-plan-20261109');
fs.mkdirSync(output, { recursive: true });

const service = new ConstructionReportService({ enterpriseId: eid, adminId });
const bindingRows = () => withTenantTransaction(eid, tx => rows(tx, sql`select id,audience,status,project_id,admin_id,user_id,conversation_id
  from app.construction_followup_bindings where enterprise_id=${eid} order by id`));

async function main() {
  const before = reportPlanDto(await service.settings() as Row, eid);
  const bindingsBefore = await bindingRows();
  if (before.enabled) {
    console.log(JSON.stringify({ alreadyEnabled: true, version: before.version }));
    await closePostgresPool();
    return;
  }
  const saved = await service.configure({
    expectedVersion: before.version, enabled: true, dailyTime: before.dailyTime, weeklyTime: before.weeklyTime,
    projectIds: before.projectIds, stageKeys: before.stageKeys, stageEnabled: before.stageEnabled, weeklyDay: before.weeklyDay,
    audiences: before.audiences, inactivePolicy: 'pause_inactive',
  }, `enable-1454-report-plan-${new Date().toISOString().slice(0, 10)}-01`);
  const after = reportPlanDto(saved, eid);
  const bindingsAfter = await bindingRows();
  const keys = (list: Row[]) => new Set(list.map(b => `${String(b.id)}:${String(b.audience)}:${String(b.status)}`));
  const old = keys(bindingsBefore);
  const created = bindingsAfter.filter(b => !old.has(`${String(b.id)}:${String(b.audience)}:${String(b.status)}`));
  const record = {
    capturedAt: new Date().toISOString(), enterpriseId: eid, actor: { kind: 'admin', adminId },
    before, after, nextDailyAt: saved.next_daily_at, nextWeeklyAt: saved.next_weekly_at,
    bindingsBefore: bindingsBefore.length, bindingsAfter: bindingsAfter.length,
    created: created.map(b => ({ id: String(b.id), audience: String(b.audience), status: String(b.status),
      projectId: b.project_id ?? null, adminId: b.admin_id ?? null, userId: b.user_id ?? null, conversationId: String(b.conversation_id) })),
    enabledBindings: bindingsAfter.filter(b => b.status === 'enabled').map(b => ({ id: String(b.id), audience: String(b.audience),
      projectId: b.project_id ?? null, adminId: b.admin_id ?? null, userId: b.user_id ?? null })),
  };
  fs.writeFileSync(path.join(output, 'enable-01.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ enabled: after.enabled, versionBefore: before.version, versionAfter: after.version,
    nextDailyAt: record.nextDailyAt, nextWeeklyAt: record.nextWeeklyAt, created: created.length, enabledBindings: record.enabledBindings.length }));
  await closePostgresPool();
}
main().catch(async e => { console.error(e); await closePostgresPool(); process.exit(1); });
