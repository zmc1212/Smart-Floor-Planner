import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { assistantHttp } from '@/lib/assistant/application/http';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { AdminUserRepository } from '@/db/repositories/admin-user-repository';
import { MiniProgramIdentityRepository } from '@/db/repositories/miniprogram-identity-repository';
import { signMiniProgramToken, type MiniProgramJWTPayload } from '@/lib/miniprogram-jwt';
import { closePostgresPool } from '@/lib/postgresql';
import { lockAssistantAcceptance } from './assistant-acceptance-safety.mjs';

// Replay only the already delivered preparation/design reminders in the isolated clone.
const root = path.resolve('..'), eid = '1454';
const evidenceDir = 'tmp/v1-03-stage-coverage';
const paths = ['tmp/xiaok-vector/connection.private.json', 'tmp/v1-02-live-reports/terminal-scheduler05/report.json',
  `${evidenceDir}/early-stage-reminders-01/report.json`];
const readJson = (p: string) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8').replace(/^\uFEFF/, ''));
const [config, seed, early] = paths.map(readJson);
assert.ok(seed.cleanup && seed.prefix.startsWith('synthetic-report-composition-') && early.passed && early.cleanup && !early.drift.length);
assert.deepEqual(early.fixture, seed.fixture);
const { projects, admins, users, bindingIds } = early.fixture as Record<string, string[]>;
const delivered = early.checks.at(-1).result as Array<{ bindingId: string; reportId: string; projectId: string; stageKey: string; audience: string }>;
assert.equal(delivered.length, 8);
assert.deepEqual([...new Set(delivered.map(r => r.stageKey))].sort(), ['design', 'preparation']);
const outputName = process.argv[2] || 'native-early-readback-01';
assert.match(outputName, /^native-early-readback-\d+$/);
const output = path.join(root, evidenceDir, outputName);
fs.mkdirSync(output);
loadEnvConfig(process.cwd(), true);
const target = new URL(config.DATABASE_URL);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55432' && target.pathname === '/xiaok_embedding_eval');
process.env.DATABASE_URL = target.toString();
const deps = [...paths, 'admin/.env.local', 'admin/package-lock.json', 'admin/tsconfig.json',
  ...execFileSync('rg', ['--files', 'admin/src', 'admin/scripts', 'miniprogram'], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\', '/')),
  'tmp/wechat-devtools-version-test/window.ps1', 'tmp/v1-02-conversation-list-visual/inspect-window.ps1',
  'D:/微信开发工具/微信web开发者工具/微信开发者工具.exe', 'D:/微信开发工具/微信web开发者工具/resources/app.asar'];
const hashes = () => Object.fromEntries([...new Set(deps)].sort().map(p => [p, createHash('sha256').update(fs.readFileSync(path.resolve(root, p))).digest('hex')]));
const evidence: Row = { scope: 'Existing Stable window, saved isolated reports, real authenticated route handlers; no new generation', requests: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(evidence, null, 2));
const tenant = <T>(work: Parameters<typeof withTenantTransaction<T>>[1]) => withTenantTransaction(eid, work);
let release: Awaited<ReturnType<typeof lockAssistantAcceptance>> | undefined, reopened = false, before: ReturnType<typeof hashes> | undefined;
const staff = new Set<string>(), signed = new Set<bigint>(), syntheticWechat = new Map<bigint, string>();
const roles = { customer: 'user', worker: 'construction_staff', designer: 'designer', boss: 'enterprise_admin' } as const;
const server = createServer(async (incoming, response) => {
  try {
    const url = new URL(incoming.url || '/', 'http://127.0.0.1'), method = incoming.method || 'GET';
    const prefix = '/api/miniprogram/assistant/';
    const route = url.pathname.slice(prefix.length);
    const allowed = method === 'GET' ? /^(followups(?:\/\d+(?:\/(?:conversation|reports)(?:\/[\w-]+)?)?)?|conversations(?:\/\d+(?:\/messages)?)?)$/
      : /^(entry-context|followups\/\d+\/(?:seen|reports\/\d+\/acknowledge))$/;
    if (!url.pathname.startsWith(prefix) || !['GET', 'POST'].includes(method) || !allowed.test(route)) {
      response.writeHead(404).end(); return;
    }
    const parts: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of incoming) { bytes += chunk.length; assert.ok(bytes <= 8192); parts.push(chunk); }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (typeof value === 'string') headers.set(name, value);
    const result = await assistantHttp(new Request(url, { method, headers, ...(method === 'POST' ? { body: Buffer.concat(parts).toString('utf8') } : {}) }), route.split('/'));
    (evidence.requests as Row[]).push({ route, method, status: result.status });
    response.writeHead(result.status, Object.fromEntries(result.headers)).end(Buffer.from(await result.arrayBuffer()));
  } catch { response.writeHead(503).end(); }
});
const ledger = () => tenant(tx => rows(tx, sql`select r.id::text,r.latest_revision,v.facts_hash,md5(v.body::text) body_hash,v.run_id::text,v.body_run_id::text
  from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
  where r.enterprise_id=${eid} and ${JSON.stringify(delivered.map(r => r.reportId))}::jsonb ? r.id::text order by r.id,v.revision`));
async function main() {
  release = await lockAssistantAcceptance(target.toString(), { waitForLock: true });
  before = hashes();
  const baseline = await ledger(); assert.equal(baseline.length, delivered.length);
  const bindings = await tenant(async tx => {
    for (const id of admins) assert.ok(await one(tx, sql`update app.admin_users set status='active' where enterprise_id=${eid} and id=${id}
      and status='disabled' and username like ${seed.prefix + ':%'} and phone is null and openid is null returning id`));
    for (const id of projects) assert.ok(await one(tx, sql`update app.construction_projects p set status='active',customer_access=true
      from app.leads l where p.enterprise_id=${eid} and p.id=${id} and p.status='archived' and not p.customer_access
      and l.enterprise_id=p.enterprise_id and l.id=p.lead_id and l.archived_at is null and l.name like ${seed.prefix + ':lead:%'} returning p.id`));
    const result = [];
    for (const id of bindingIds) {
      const b = await one(tx, sql`update app.construction_followup_bindings set status='enabled' where enterprise_id=${eid} and id=${id}
        and status='stopped' returning id::text,user_id::text,admin_id::text,conversation_id::text,audience`);
      assert.ok(b && (users.includes(String(b.user_id)) || admins.includes(String(b.admin_id)))); result.push(b);
    }
    return result;
  });
  reopened = true;
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const apiOrigin = `http://127.0.0.1:${address.port}`;
  const actors = [];
  for (const b of bindings) {
    const aid = b.admin_id ? String(b.admin_id) : undefined, audience = String(b.audience);
    const mode = aid ? 'staff' : 'customer';
    assert.ok(Object.hasOwn(roles, audience));
    const role: MiniProgramJWTPayload['role'] = roles[audience as keyof typeof roles];
    const openid = 'xiaok-early-readback-' + randomUUID();
    const user = await withPlatformTransaction(async tx => {
      const identity = new MiniProgramIdentityRepository(tx);
      if (!aid) {
        const u = await identity.findUserById(BigInt(String(b.user_id)));
        assert.ok(u?.nickname!.startsWith(seed.prefix + ':') && !await identity.findWechatIdentityByUserId(u.id));
        await identity.attachWechatIdentity({ userId: u.id, openid });
        return u;
      }
      const account = await new AdminUserRepository(tx).findById(BigInt(aid));
      assert.ok(account?.username.startsWith(seed.prefix + ':') && !account.phone && !account.openid);
      const u = await identity.ensureStaffUser(account!); assert.ok(!u.phone);
      await tx.execute(sql`update app.users set phone=${'199' + String(u.id).padStart(8, '0')} where id=${String(u.id)}`);
      assert.ok(await identity.selectContext(u.id, { mode, staffId: BigInt(aid), enterpriseId: BigInt(eid) }));
      return u;
    });
    signed.add(user.id);
    if (aid) staff.add(String(user.id));
    else syntheticWechat.set(user.id, openid);
    const uid = String(user.id), bid = String(b.id), token = await signMiniProgramToken({ id: uid, sub: uid, mode, role,
      ...(aid ? { staffId: aid } : {}), enterpriseId: eid, contextVersion: Number(user.contextVersion), source: aid ? 'password' : 'wechat' });
    const headers: Record<string, string> = { Authorization: 'Bearer ' + token };
    const lead = !aid ? await tenant(tx => one(tx, sql`select l.id::text from app.leads l join app.construction_projects p on p.enterprise_id=l.enterprise_id and p.lead_id=l.id
      where l.enterprise_id=${eid} and l.customer_user_id=${uid} and p.id=${delivered.find(r => r.bindingId === bid)!.projectId}`)) : undefined;
    const leadId = lead && String(lead.id);
    if (!aid) {
      assert.ok(leadId);
      const r = await fetch(apiOrigin + '/api/miniprogram/assistant/entry-context', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId }) });
      assert.equal(r.status, 200); headers['X-Assistant-Entry'] = (await r.json()).data.entryToken;
    }
    const expected = [];
    for (const saved of delivered.filter(item => item.bindingId === bid)) {
      const response = await fetch(`${apiOrigin}/api/miniprogram/assistant/followups/${bid}/reports/${saved.reportId}?revision=1`, { headers });
      assert.equal(response.status, 200);
      const { data } = await response.json();
      assert.equal(data.deliveryState, 'delivered'); assert.ok(data.readAt);
      assert.deepEqual(data.facts.projects.map((p: Row) => [p.id, p.stageKey]), [[saved.projectId, saved.stageKey]]);
      assert.deepEqual(data.body.map((p: Row) => [p.projectId, p.standards, p.knowledgeSources]), [[saved.projectId, [], []]]);
      expected.push({ id: saved.reportId, revision: 1, kind: 'stage', stageKey: saved.stageKey, body: data.body });
    }
    actors.push({ name: audience, uid, aid, role, token, bid, cid: String(b.conversation_id), leadId, reports: expected, headers });
  }
  const customers = actors.filter(a => a.name === 'customer'); assert.equal(customers.length, 2);
  const [a, b] = customers;
  const denied = await fetch(`${apiOrigin}/api/miniprogram/assistant/followups/${b.bid}/reports/${b.reports[0].id}?revision=1`, { headers: a.headers });
  assert.equal(denied.status, 404);
  evidence.httpReadbacks = delivered.length; save();
  await release.assertHeld();
  const { default: native } = await import('./xiaok-v1-02-live-reports-native.cjs');
  const result = await native({ root, output, actors, apiOrigin, reuseReadySession: true }) as
    Awaited<ReturnType<typeof native>> & { journeys: unknown[]; restored: { restored: boolean } };
  assert.equal(result.journeys.length, delivered.length); assert.ok(result.restored.restored);
  assert.deepEqual(await ledger(), baseline);
  evidence.nativeReadbacks = result.journeys.length; evidence.passed = true;
}
main().catch(e => { evidence.error = (e as Error).stack; evidence.passed = false; process.exitCode = 1; }).finally(async () => {
  try {
    if (server.listening) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    if (reopened) await tenant(async tx => {
      for (const id of bindingIds) await tx.execute(sql`update app.construction_followup_bindings set status='stopped' where enterprise_id=${eid} and id=${id} and status='enabled'`);
      for (const id of projects) await tx.execute(sql`update app.construction_projects set status='archived',customer_access=false where enterprise_id=${eid} and id=${id}`);
      for (const id of admins) await tx.execute(sql`update app.admin_users set status='disabled' where enterprise_id=${eid} and id=${id} and username like ${seed.prefix + ':%'}`);
    });
    if (signed.size) await withPlatformTransaction(async tx => {
      for (const [id, openid] of syntheticWechat) assert.ok(await one(tx, sql`delete from app.wechat_identities
        where user_id=${String(id)} and openid=${openid} returning user_id`));
      for (const id of signed) await tx.execute(sql`update app.users set context_version=context_version+1
        ${staff.has(String(id)) ? sql`,phone=null` : sql``} where id=${String(id)}`);
    });
    evidence.cleaned = true;
    if (before) {
      const after = hashes(), drift = Object.keys(before).filter(p => before![p] !== after[p]);
      fs.writeFileSync(path.join(output, 'binding.json'), JSON.stringify({ before, after, drift }, null, 2));
      evidence.drift = drift; assert.deepEqual(drift, []);
    }
  } catch (e) { evidence.cleanupError = (e as Error).stack; evidence.passed = false; process.exitCode = 1; }
  finally { try { await closePostgresPool(); } finally { await release?.(); save(); console.log(JSON.stringify({ passed: evidence.passed, error: evidence.error, cleanupError: evidence.cleanupError })); } }
});
