/** One real mixed-knowledge turn on the existing public-site conversation. */
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
loadEnvConfig(process.cwd(), true);
const uid = '645', eid = '1454', conversationId = '2444';
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const question = process.argv[2] || '这个公开工地水电阶段的做法，按你们企业工艺标准要注意什么？';
async function main() {
const token = await new SignJWT({ sub: uid, id: uid, mode: 'customer', role: 'user', enterpriseId: eid,
  contextVersion: 17, source: 'password' }).setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setIssuedAt()
  .setAudience('miniprogram').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
const before = await withTenantTransaction(eid, tx => one(tx, sql`select coalesce(max(id),0) id from app.assistant_runs where enterprise_id=${eid} and conversation_id=${conversationId}`));
const clientMessageId = 'mixed-live-' + Date.now();
const response = await fetch(base + '/conversations/' + conversationId + '/messages', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'Idempotency-Key': clientMessageId },
  body: JSON.stringify({ clientMessageId, content: { version: 1, blocks: [{ type: 'text', text: question }] } }) });
const receipt = await response.json() as Record<string, unknown>;
console.log('send', response.status, JSON.stringify(receipt));
const runId = (receipt.data as Record<string, unknown> | undefined)?.runId as string | undefined;
const end = Date.now() + 240000;
let run: Record<string, unknown> | undefined;
while (Date.now() < end) {
  run = await withTenantTransaction(eid, tx => one(tx, sql`select id::text,status,error_code,output_message_id::text from app.assistant_runs
    where enterprise_id=${eid} and conversation_id=${conversationId} and id > ${String(before!.id)} order by id desc limit 1`));
  if (run && ['succeeded', 'failed'].includes(String(run.status))) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
const id = String(run?.id || runId);
const steps = await withTenantTransaction(eid, tx => one(tx, sql`select jsonb_agg(jsonb_build_object('seq',step_seq,'kind',kind,'capability',capability_name,'status',status)) steps
  from app.assistant_run_steps where enterprise_id=${eid} and run_id=${id}`));
const answer = await withTenantTransaction(eid, tx => one(tx, sql`select content from app.assistant_messages where enterprise_id=${eid} and run_id=${id} and author_kind='assistant' order by id desc limit 1`));
console.log(JSON.stringify({ run, steps, answer }, null, 1));
}
main().finally(() => closePostgresPool());
