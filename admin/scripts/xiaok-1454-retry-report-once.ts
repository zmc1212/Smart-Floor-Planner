/** One authorized retry of an existing failed stage report under 1454. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const [bindingId, reportId, revisionArg] = process.argv.filter(a => /^\d+$/.test(a)).slice(-3);
assert.ok(bindingId && reportId && revisionArg, 'Usage: --development <bindingId> <reportId> <revision>');
const output = path.resolve('../tmp/xiaok-1454-full-flow-20261109/retry-01');
fs.mkdirSync(output, { recursive: true });
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const eid = '1454', base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const receipt: Record<string, unknown> = { bindingId, reportId, revision: Number(revisionArg) };
async function main() {
  const customer = (await withPlatformTransaction(tx => one(tx, sql`select id,context_version from app.users where id=645`)))!;
  const token = await new SignJWT({ sub: '645', id: '645', mode: 'customer', role: 'user', enterpriseId: eid,
    contextVersion: Number(customer.context_version), source: 'wechat' }).setProtectedHeader({ alg: 'HS256' }).setSubject('645')
    .setIssuedAt().setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const entryResponse = await fetch(`${base}/entry-context`, { method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: '3132' }) });
  const entry = (await entryResponse.json()) as { data?: { entryToken?: string } };
  receipt.entryHttp = { status: entryResponse.status, body: { ...entry, data: entry.data ? { ...entry.data, entryToken: entry.data.entryToken ? '[present]' : undefined } : null } };
  assert.ok(entry.data?.entryToken, 'Customer entry context');
  const response = await fetch(`${base}/followups/${bindingId}/reports/${reportId}/retry`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
      'X-Assistant-Entry': entry.data.entryToken },
    body: JSON.stringify({ revision: Number(revisionArg) }), signal: AbortSignal.timeout(60000) });
  receipt.retryHttp = { status: response.status, body: await response.json().catch(() => ({})) };
  const started = Date.now();
  let final: Record<string, unknown> | null = null;
  while (Date.now() - started < 300000) {
    const row = await withPlatformTransaction(tx => one(tx, sql`select v.body_run_id,v.knowledge_status,v.body_error_code,v.body,
      br.status body_status,br.error_code from app.construction_report_versions v
      left join app.assistant_runs br on br.enterprise_id=v.enterprise_id and br.id=v.body_run_id
      where v.enterprise_id=${eid} and v.report_id=${reportId} and v.revision=${Number(revisionArg)}`));
    final = row as Record<string, unknown>;
    if (row && (row.knowledge_status === 'ready' || ['failed', 'cancelled', 'indeterminate'].includes(String(row.body_status)))) break;
    await new Promise(r => setTimeout(r, 3000));
  }
  receipt.final = { ...final, body: final?.body ? '[composed]' : null };
  receipt.passed = final?.knowledge_status === 'ready' && final?.body_error_code === null;
}
main().then(async () => {
  receipt.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(output, 'retry.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt, null, 2));
  await closePostgresPool();
  assert.ok(receipt.passed, 'Retry did not compose');
}, async error => {
  receipt.failure = (error as Error).message;
  fs.writeFileSync(path.join(output, 'retry.json'), JSON.stringify(receipt, null, 2));
  console.error(error);
  await closePostgresPool();
  process.exitCode = 1;
});
