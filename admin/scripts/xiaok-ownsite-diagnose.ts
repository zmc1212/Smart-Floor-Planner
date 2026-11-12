/* Read-only diagnosis for run 2609: what report-474 facts and project-237
 * stage/records reached the answer step, and what the run actually stored. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const eid = '1454';
const out = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-ownsite-fix-20261110/diagnose-01.json');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const t = <T>(fn: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, fn);
const text = (c: unknown) => {
  const v = c as Row;
  return Array.isArray(v?.blocks) ? v.blocks.map((b: Row) => b.text ?? '').join('\n') : JSON.stringify(v);
};

async function main() {
  const report: Row & { run?: Row; conversation?: Row; messages?: Row[]; steps?: Row[]; report474?: Row; project?: Row; records?: Row[] } = { at: new Date().toISOString() };
  report.run = await t(tx => one(tx, sql`select id,status,error_code,conversation_id,trigger_message_id,policy_snapshot,started_at,completed_at from app.assistant_runs where enterprise_id=${eid} and id='2609'`));
  report.conversation = await t(tx => one(tx, sql`select id,purpose,mode,status,entry_snapshot,updated_at
    from app.assistant_conversations where enterprise_id=${eid} and id='1522'`));
  report.messages = await t(tx => rows(tx, sql`select id,author_kind,run_id,created_at,content from app.assistant_messages
    where enterprise_id=${eid} and conversation_id='1522' order by id desc limit 14`));
  report.steps = await t(tx => rows(tx, sql`select step_seq,kind,capability_name,capability_version,status,input_summary,
    private_checkpoint,source_refs from app.assistant_run_steps where enterprise_id=${eid} and run_id='2609' order by step_seq`));
  report.report474 = await t(tx => one(tx, sql`select r.id,r.kind,r.binding_id,r.latest_revision,r.created_at,
    v.status version_status,v.facts,v.facts_hash,v.generated_at,v.period_end,v.cutoff_at,v.body_run_id
    from app.construction_reports r join app.construction_report_versions v
      on v.enterprise_id=r.enterprise_id and v.report_id=r.id and v.revision=r.latest_revision
    where r.enterprise_id=${eid} and r.id='474'`));
  report.project = await t(tx => one(tx, sql`select id,name,current_stage_key,version,status,customer_access,updated_at
    from app.construction_projects where enterprise_id=${eid} and id='237'`));
  report.records = await t(tx => rows(tx, sql`select id,project_id,room_name_snapshot room,status,version,published_at,created_at,data
    from app.construction_site_records where enterprise_id=${eid} and project_id='237' order by id desc limit 12`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(report, null, 2));

  const facts = report.report474?.facts as Row | undefined;
  const summary: Row & { contextStep?: unknown } = {
    run: { id: report.run?.id, status: report.run?.status,
      protocol: (report.run?.policy_snapshot as Row)?.protocol ?? null,
      pipeline: (report.run?.policy_snapshot as Row)?.pipeline ?? null,
      policyKeys: Object.keys((report.run?.policy_snapshot as Row | undefined) ?? {}),
      trigger: report.run?.trigger_message_id, conversation: report.run?.conversation_id },
    selection: (((report.conversation?.entry_snapshot as Row)?.reportContext as Row | undefined)?.selection) ?? null,
    report474: { binding: report.report474?.binding_id, project: null,
      revision: report.report474?.latest_revision, factsHash: report.report474?.facts_hash },
    factsProjectIds: Array.isArray(facts?.projects) ? facts.projects.map((p: Row) => p.id) : null,
    messageTurns: (report.messages as Row[]).map(m => ({ id: m.id, author: m.author_kind, run: m.run_id,
      at: m.created_at, text: text(m.content).slice(0, 180) })),
    stepNames: (report.steps as Row[]).map(s => ({ seq: s.step_seq, kind: s.kind, name: s.capability_name, status: s.status })),
    stage: report.project?.current_stage_key,
    recordIds: (report.records as Row[]).map(r => ({ id: r.id, status: r.status, version: r.version,
      room: r.room, published: r.published_at })),
  };
  const contextStep = (report.steps as Row[]).find(s => Number(s.step_seq) === 740);
  const snap = (contextStep?.private_checkpoint as Row)?.snapshot as Row | undefined;
  summary.contextStep = contextStep ? {
    status: contextStep.status,
    selection: (snap?.reportReference as Row)?.selection ?? null,
    dataProjects: Array.isArray(snap?.data) ? snap.data.map((p: Row) => ({ id: p.id, stage: p.stageKey,
      records: Array.isArray(p.records) ? p.records.map((r: Row) => ({ id: r.id, version: r.version })) : null,
      publishedItems: Array.isArray(p.publishedRecordItems) ? p.publishedRecordItems.length : null })) : null,
    displayText: typeof snap?.displayText === 'string' ? snap.displayText.slice(0, 1200) : null,
  } : null;
  console.log(JSON.stringify(summary, null, 2));
}
main().finally(() => closePostgresPool());




