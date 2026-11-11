/** FastGPT audit-source positive control: while the deployment binds the V2
 * bridge, one real customer chat turn must land a run-correlated 'agentV2'
 * record in the configured audit ledger. The receipt is bound to the
 * acceptance batch and to this deployment/audit source, and anchors the
 * ledger prefix it saw, so a native round can prove - against the same
 * ledger - that the log was neither shortened nor rebuilt before opening its
 * own window. A historical receipt can never serve as another round's
 * positive control. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { fastGPTAgentV2Configuration } from '@/lib/assistant/fastgpt/agent-v2/config';
import { auditDeployment, auditPrefixHash, auditProbeMode, auditProbeSchemaVersion } from '@/lib/assistant/fastgpt/agent-v2/audit-window';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'));
const batchId = String(process.argv.find(a => a.startsWith('--batch='))?.slice(8) || process.env.XIAOK_AUDIT_BATCH || '').trim();
assert.ok(batchId, 'Acceptance batch id required: pass --batch=<id> (or XIAOK_AUDIT_BATCH) so the receipt belongs to this round');
const eid = '1454', customerId = '645', leadId = '3132';
const receiptPath = path.resolve(process.argv.find(a => a.startsWith('--receipt='))?.slice(10)
  || '../tmp/xiaok-native-executor-20261111-recovery/four-questions/audit-probe.json');
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const base = 'http://127.0.0.1:3006/api/miniprogram/assistant';
const workflowsFile = process.env.XIAOK_FASTGPT_WORKFLOWS_FILE?.trim();
assert.ok(workflowsFile, 'XIAOK_FASTGPT_WORKFLOWS_FILE is required for the audit-source probe');
const workflows = JSON.parse(fs.readFileSync(path.resolve(workflowsFile), 'utf8')) as Record<string, unknown>;
const deployment = auditDeployment(path.resolve(workflowsFile), workflows, base);
const auditFile = deployment.auditFile;
const auditLines = () => fs.existsSync(auditFile) ? fs.readFileSync(auditFile, 'utf8').trim().split(/\r?\n/).filter(Boolean) : [];
const auditBefore = auditLines().length;

async function main() {
  // The bridge must be the bound runtime for this probe; the native switch
  // would make a V2 chat turn impossible by design.
  const bound = fastGPTAgentV2Configuration(eid);
  assert.ok(bound, 'The V2 bridge must be bound while the audit probe runs');
  const customerVersion = Number((await withPlatformTransaction(tx => one(tx,
    sql`select context_version from app.users where id=${customerId}`)))!.context_version);
  const token = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid,
    contextVersion: customerVersion, source: 'wechat' }).setProtectedHeader({ alg: 'HS256' }).setSubject(customerId)
    .setIssuedAt().setAudience('miniprogram').setExpirationTime('2h').sign(new TextEncoder().encode(process.env.JWT_SECRET!));
  const api = async (route: string, init: { method?: string; body?: Row; entry?: string; key?: string } = {}) => {
    const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
    if (init.entry) headers['X-Assistant-Entry'] = init.entry;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    if (init.key) headers['Idempotency-Key'] = init.key;
    const response = await fetch(base + route, { method: init.method || (init.body !== undefined ? 'POST' : 'GET'), headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined, signal: AbortSignal.timeout(60000) });
    const data = await response.json().catch(() => ({})) as Row;
    assert.ok(response.status === 200 || response.status === 202, route + ': ' + response.status + '/' + String(data.code || ''));
    return data;
  };
  const entry = String(((await api('/entry-context', { body: { leadId } })).data as Row).entryToken);
  const cid = String(((await api('/conversations', { body: { entryToken: entry }, key: randomUUID() })).data as Row).id);
  const clientMessageId = randomUUID();
  await api(`/conversations/${cid}/messages`, { key: clientMessageId,
    body: { clientMessageId, content: { version: 1, blocks: [{ type: 'text', text: '装修时水电改造验收要注意什么？' }] } } });
  const run = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 360000) {
      const r = await withTenantTransaction(eid, tx => one(tx, sql`select id,status,error_code from app.assistant_runs
        where enterprise_id=${eid} and conversation_id=${cid} and purpose='reply' order by id desc limit 1`));
      if (r && !['queued', 'running'].includes(String(r.status))) return r;
      await new Promise(resolve => setTimeout(resolve, 2500));
    }
    throw new Error('probe run timed out');
  })();
  assert.equal(String(run.status), 'succeeded', 'The V2 probe run must succeed: ' + String(run.error_code || ''));
  const runId = String(run.id);
  const correlated = await (async () => {
    const started = Date.now();
    while (Date.now() - started < 60000) {
      const hit = auditLines().slice(auditBefore).map(line => JSON.parse(line) as Row)
        .find(record => String(record.kind) === 'agentV2'
          && String((record.value as Row | undefined)?.runId ?? (record as Row).runId ?? '') === runId);
      if (hit) return hit;
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    return undefined;
  })();
  assert.ok(correlated, 'The audit ledger must gain an agentV2 record correlated to the probe run ' + runId);
  const ledger = auditLines(), after = ledger.length;
  const verifiedAt = new Date().toISOString();
  const receipt = { schemaVersion: auditProbeSchemaVersion, batchId, probeRunId: runId, conversationId: cid,
    auditFile, deployment: { ...deployment },
    probe: { mode: auditProbeMode, binding: bound.binding, verifiedAt },
    window: { before: auditBefore, after, prefixHash: auditPrefixHash(ledger, after) } };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: true, batchId, probeRunId: runId, auditLines: after, receipt: receiptPath }));
  await closePostgresPool();
}
main().catch(async error => {
  console.log(JSON.stringify({ passed: false, error: (error as Error).message }));
  await closePostgresPool();
  process.exitCode = 1;
});
