/* Read-only comparison of the three own-site runs: policy keys, step names,
 * trigger/answer text and report selection. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const eid = '1454';
const out = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-ownsite-fix-20261110/runs.json');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const text = (c: unknown) => {
  const v = c as Row;
  return Array.isArray(v?.blocks) ? v.blocks.map((b: Row) => b.text ?? '').join('\n') : JSON.stringify(v);
};

async function main() {
  const data: Row[] = [];
  for (const runId of ['2604', '2606', '2609']) {
    const run = await withTenantTransaction(eid, tx => one(tx, sql`select r.id,r.status,r.conversation_id,r.trigger_message_id,
      r.policy_snapshot,m.content trigger_content from app.assistant_runs r left join app.assistant_messages m
      on m.enterprise_id=r.enterprise_id and m.conversation_id=r.conversation_id and m.id=r.trigger_message_id
      where r.enterprise_id=${eid} and r.id=${runId}`));
    const steps = await withTenantTransaction(eid, tx => rows(tx, sql`select step_seq,kind,capability_name,status,input_summary
      from app.assistant_run_steps where enterprise_id=${eid} and run_id=${runId} order by step_seq`));
    const answers = await withTenantTransaction(eid, tx => rows(tx, sql`select id,author_kind,content,created_at from app.assistant_messages
      where enterprise_id=${eid} and conversation_id=${run?.conversation_id} and run_id=${runId} and author_kind='assistant'
      order by id desc limit 2`));
    const p = (run?.policy_snapshot ?? {}) as Row;
    data.push({ runId, status: run?.status, conversation: run?.conversation_id,
      question: text(run?.trigger_content), protocol: p.protocol ?? null,
      identity: p.identity ?? p.pipeline ?? null,
      policyKeys: Object.keys(p), reportCoordination: p.reportCoordination ?? null,
      steps: steps.map(s => ({ seq: s.step_seq, kind: s.kind, name: s.capability_name, status: s.status,
        input: s.input_summary })),
      answers: answers.map(a => ({ id: a.id, at: a.created_at, text: text(a.content) })) });
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  for (const d of data) {
    console.log('== run ' + d.runId + ' ==');
    console.log(JSON.stringify({ status: d.status, conversation: d.conversation, protocol: d.protocol,
      reportCoordination: d.reportCoordination, question: d.question,
      steps: d.steps.map((s: Row) => s.seq + ':' + s.kind + ':' + s.name), answer: d.answers[0]?.text?.slice(0, 220) }, null, 1));
  }
}
main().finally(() => closePostgresPool());

