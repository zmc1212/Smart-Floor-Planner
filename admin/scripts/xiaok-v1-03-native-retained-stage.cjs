/* eslint-disable @typescript-eslint/no-require-imports -- Loads the existing Windows Stable CLI adapter under tsx. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..'), admin = path.join(root, 'admin');
process.env.TSX_TSCONFIG_PATH = path.join(admin, 'tsconfig.json');
require('tsx/cjs'); require('@next/env').loadEnvConfig(admin, true);
const { sql } = require('drizzle-orm');
const { SignJWT } = require('jose');
const { withTenantTransaction, withPlatformTransaction } = require('../src/db/transaction.ts');
const { one, rows } = require('../src/db/repositories/assistant-repository.ts');
const { AdminUserRepository } = require('../src/db/repositories/admin-user-repository.ts');
const { MiniProgramIdentityRepository } = require('../src/db/repositories/miniprogram-identity-repository.ts');
const { UserRepository } = require('../src/db/repositories/user-repository.ts');
const { resolvePostgresRuntimeConfig, closePostgresPool } = require('../src/lib/postgresql.ts');
const { lockAssistantAcceptance } = require('./assistant-acceptance-safety.mjs');

const eid = '1454', work = path.join(root, 'tmp/v1-03-stage-coverage');
const output = path.join(work, process.argv[2] || 'native-stage-readback-01');
assert.match(path.basename(output), /^native-stage-readback-\d+$/);
assert.equal(path.dirname(output), work);
fs.mkdirSync(output);
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost','127.0.0.1'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner');
const sources = ['configured-reminders-01','configured-matched-reminders-02'];
const originals = sources.map(name => {
  const report = require(path.join(work, name, 'report.json'));
  assert.ok(report.configuredPassed && report.cleanup && report.finishedAt && report.drift.length === 0);
  assert.match(report.prefix, /^synthetic-v1-02-live-[\da-f-]+$/);
  assert.equal(report.attempts.length, 8);
  assert.ok(report.attempts.every(a => a.kind === 'stage' && a.result.detail.deliveryState === 'delivered' && a.result.detail.contentStatus === 'composed'));
  return report;
});
const fixture = originals.flatMap(r => r.fixture.bindings);
const conversations = fixture.map(b => b.conversationId);
const reportIds = originals.flatMap(r => r.attempts.map(a => a.reportId));
assert.equal(new Set(conversations).size, 10); assert.equal(new Set(reportIds).size, 16);
const retained = [];
const previous = process.argv[3];
if (previous) {
  assert.match(previous, /^native-stage-readback-\d+$/);
  const prior = require(path.join(work, previous, 'continuation.json')), native = require(path.join(work, previous, 'native.json'));
  assert.deepEqual(prior.reportIds, reportIds);
  assert.ok(prior.cleaned && !prior.drift.length && native.restored.restored);
  for (const item of native.journeys) {
    const saved = originals.flatMap(r => r.attempts).find(a => a.reportId === item.reportId);
    assert.ok(saved && item.reentry && saved.bindingId === item.bindingId && saved.revision === item.revision);
    assert.equal(item.stageKey, saved.result.detail.facts.projects[0].stageKey);
    assert.ok(item.missing ? !saved.result.detail.body[0].knowledgeSources.length : item.original.status === 200);
    retained.push(item.reportId);
  }
}
const evidence = { scope: 'real Stable and signed local HTTP; original saved reports only', reportIds, retained, http: [] };
const save = () => fs.writeFileSync(path.join(output, 'continuation.json'), JSON.stringify(evidence, null, 2));
const tenant = work => withTenantTransaction(eid, work);
const activatedStaff = [];
let release, reopened = false, before, baseline;
const from = ['admin/src','miniprogram','admin/scripts'];
const appFiles = execFileSync('rg', ['--files', ...from], { cwd: root, encoding: 'utf8' }).trim().split(/\r?\n/).map(p => p.replaceAll('\\','/'));
const deps = [...appFiles, 'admin/.env.local','admin/package.json','admin/package-lock.json',
  ...sources.flatMap(s => ['report.json','binding.json'].map(f => 'tmp/v1-03-stage-coverage/' + s + '/' + f)),
  'tmp/v1-03-stage-coverage/stable-connection-probe.cjs','tmp/v1-03-stage-coverage/stable-connection-01/probe.json',
  ...(previous ? ['continuation.json','native.json','binding.json'].map(f=>path.join(work,previous,f)) : []),
  'tmp/wechat-devtools-version-test/window.ps1','tmp/v1-02-conversation-list-visual/inspect-window.ps1',
  'D:/微信开发工具/微信web开发者工具/微信开发者工具.exe','D:/微信开发工具/微信web开发者工具/resources/app.asar'];
const hashes = () => Object.fromEntries([...new Set(deps)].sort().map(p => [p, createHash('sha256').update(fs.readFileSync(path.resolve(root,p))).digest('hex')]));
const ownedLedger = () => tenant(async tx => ({
  runs: await rows(tx, sql`select r.id::text,r.status,r.purpose,j.status as job
    from app.assistant_runs r left join app.assistant_jobs j on j.enterprise_id=r.enterprise_id and j.run_id=r.id
    where r.enterprise_id=${eid} and ${JSON.stringify(conversations)}::jsonb ? r.conversation_id::text order by r.id,j.id`),
  reports: await rows(tx, sql`select r.id::text,r.latest_revision,v.facts_hash,md5(v.body::text) body_hash,v.body_run_id::text
    from app.construction_reports r join app.construction_report_versions v on v.enterprise_id=r.enterprise_id and v.report_id=r.id
    where r.enterprise_id=${eid} and ${JSON.stringify(reportIds)}::jsonb ? r.id::text order by r.id,v.revision`),
  plan: await one(tx, sql`select enabled,version,dispatch_epoch from app.construction_report_settings where enterprise_id=${eid}`),
}));
async function reopen() {
  await tenant(async tx => {
    for (const {fixture: f, prefix} of originals) {
      for (const id of f.admins) assert.ok(await one(tx, sql`update app.admin_users set status='active'
        where enterprise_id=${eid} and id=${id} and status='disabled' and username like ${prefix+':%'}
        and phone is null and openid is null returning id`));
      for (const [i, id] of f.projects.entries()) {
        assert.ok(await one(tx, sql`update app.leads set archived_at=null where enterprise_id=${eid}
          and id=${f.leads[i]} and name like ${prefix+':lead:%'} and customer_user_id=${f.users[i]} and archived_at is not null returning id`));
        assert.ok(await one(tx, sql`update app.construction_projects set status='active',customer_access=true where enterprise_id=${eid}
          and id=${id} and lead_id=${f.leads[i]} and status='archived' and not customer_access returning id`));
      }
      for (const b of f.bindings) assert.ok(await one(tx, sql`update app.construction_followup_bindings set status='enabled'
        where enterprise_id=${eid} and id=${b.id} and conversation_id=${b.conversationId} and status='stopped' returning id`));
    }
  });
  reopened = true;
}
const archivedLeads = new Map();
async function close() {
  if (!reopened) return;
  await tenant(async tx => {
    for (const {fixture: f, prefix} of originals) {
      for (const b of f.bindings) assert.ok(await one(tx, sql`update app.construction_followup_bindings set status='stopped'
        where enterprise_id=${eid} and id=${b.id} and conversation_id=${b.conversationId} and status='enabled' returning id`));
      for (const [i,id] of f.projects.entries()) {
        assert.ok(await one(tx, sql`update app.construction_projects set status='archived',customer_access=false where enterprise_id=${eid}
          and id=${id} and lead_id=${f.leads[i]} returning id`));
        assert.ok(await one(tx, sql`update app.leads set archived_at=${archivedLeads.get(f.leads[i])}::timestamptz where enterprise_id=${eid}
          and id=${f.leads[i]} and name like ${prefix+':lead:%'} and archived_at is null returning id`));
      }
      for (const id of f.admins) assert.ok(await one(tx, sql`update app.admin_users set status='disabled' where enterprise_id=${eid}
        and id=${id} and username like ${prefix+':%'} and status='active' returning id`));
    }
  });
  await withPlatformTransaction(async tx => {
    for (const {uid,phone,aid} of activatedStaff) assert.ok(await one(tx, sql`update app.users u set phone=${phone},context_version=u.context_version+1
      where u.id=${uid} and exists(select 1 from app.admin_users a where a.id=${aid} and a.enterprise_id=${eid} and a.user_id=u.id) returning u.id`));
    for (const {fixture: f, prefix} of originals) for (const uid of f.users) assert.ok(await one(tx, sql`update app.users
      set context_version=context_version+1 where id=${uid} and nickname like ${prefix+':customer:%'} returning id`));
    assert.equal((await one(tx, sql`select count(*)::int active from app.assistant_jobs where status in ('queued','running')`)).active, 0);
  });
  assert.deepEqual(await ownedLedger(), baseline, 'No generation, source retrieval or report body change');
  evidence.cleaned = true;
}
async function signedActor(b, batch) {
  const aid = b.adminId || undefined, mode = aid ? 'staff' : 'customer', f = batch.fixture;
  const role = { customer: 'user', boss: 'enterprise_admin', worker: 'construction_staff', designer: 'designer' }[b.audience];
  const user = await withPlatformTransaction(async tx => {
    const mini = new MiniProgramIdentityRepository(tx);
    if (!aid) {
      const u = await mini.findUserById(BigInt(b.userId)); assert.ok(u?.nickname.startsWith(batch.prefix+':customer:')); return u;
    }
    const account = await new AdminUserRepository(tx).findById(BigInt(aid));
    assert.ok(account?.username.startsWith(batch.prefix + ':') && !account.phone && !account.openid);
    const u = await mini.ensureStaffUser(account), uid = String(u.id);
    assert.ok(!u.phone && /^合成实模验收/.test(u.nickname), 'The retained staff identity must be a labelled fixture');
    await new UserRepository(tx).update(u.id, { phone: '199' + uid.padStart(8, '0') });
    assert.ok(await mini.selectContext(u.id, { mode, staffId: BigInt(aid), enterpriseId: BigInt(eid) }));
    return u;
  });
  const uid = String(user.id);
  if (aid) activatedStaff.push({ uid, phone: user.phone, aid });
  assert.ok(process.env.JWT_SECRET);
  const token = await new SignJWT({ id: uid, mode, role, ...(aid ? { staffId: aid } : {}), enterpriseId: eid, contextVersion: Number(user.contextVersion), source: 'password' })
    .setProtectedHeader({ alg: 'HS256' }).setSubject(uid).setAudience('miniprogram').setIssuedAt().setExpirationTime('30m')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const leadId = aid ? undefined : f.leads[f.users.indexOf(uid)];
  if (!aid) assert.ok(leadId);
  return { uid, aid, role, token, name: b.audience, leadId, bid: b.id, cid: b.conversationId,
    reports: batch.attempts.filter(a => a.bindingId === b.id).map(a => ({ id: a.reportId, revision: a.revision, kind: a.kind,
      stageKey: a.result.detail.facts.projects[0].stageKey, body: a.result.detail.body })) };
}
async function request(a, suffix, input) {
  const t = performance.now();
  const r = await fetch('http://127.0.0.1:3006/api/miniprogram/' + suffix, {
    method: input ? 'POST' : 'GET', body: input && JSON.stringify(input),
    headers: { Authorization: 'Bearer ' + a.token, ...(input ? { 'Content-Type': 'application/json' } : {}),
      ...(a.entry ? { 'X-Assistant-Entry': a.entry } : {}) }, signal: AbortSignal.timeout(20000),
  });
  const envelope = await r.json();
  evidence.http.push({ path: suffix, status: r.status, code: envelope.code, ms: Math.round(performance.now()-t) }); save();
  return { status: r.status, data: envelope.data };
}
async function main() {
  release = await lockAssistantAcceptance(require(path.join(root,'tmp/xiaok-vector/connection.private.json')).DATABASE_URL);
  before = hashes(); baseline = await ownedLedger();
  assert.equal(baseline.plan.enabled, false); assert.equal(baseline.reports.length, reportIds.length);
  const probe = require(path.join(work,'stable-connection-01/probe.json'));
  assert.ok(probe.cleaned && probe.checks.some(check => check.ok && check.value?.results?.some(r => r.origin === 'http://127.0.0.1:3006' && r.method === 'POST' && r.status === 401)));
  for (const r of originals) for (const row of await tenant(tx => rows(tx, sql`select id::text,archived_at::text from app.leads where enterprise_id=${eid}
    and id in (${r.fixture.leads[0]},${r.fixture.leads[1]}) and archived_at is not null and name like ${r.prefix+':lead:%'}`))) archivedLeads.set(row.id,row.archived_at);
  assert.equal(archivedLeads.size, 4);
  await reopen();
  const actors = [];
  for (const r of originals) for (const b of r.fixture.bindings) actors.push(await signedActor(b, r));
  for (const a of actors) {
    if (a.leadId) {
      const entry = await request(a, 'assistant/entry-context', { leadId: a.leadId });
      assert.equal(entry.status, 200); assert.ok(entry.data.entryToken); a.entry = entry.data.entryToken;
    }
    const list = await request(a, 'assistant/followups/' + a.bid + '/reports'); assert.equal(list.status, 200);
    for (const r of a.reports) {
      const x = list.data.items.find(item => item.reportId === r.id && item.revision === r.revision);
      assert.equal(x.deliveryState,'delivered'); assert.deepEqual(x.body, r.body);
    }
  }
  const [a,b] = actors;
  const other = b.reports[0];
  assert.equal((await request(a,'assistant/followups/' + b.bid + '/reports/' + other.id + '?revision=' + other.revision)).status,404);
  evidence.savedReadbacks = reportIds.length; save();
  await release.assertHeld();
  const remaining = actors.map(a => ({...a, reports:a.reports.filter(r=>!retained.includes(r.id))})).filter(a=>a.reports.length);
  await require('./xiaok-v1-02-live-reports-native.cjs')({ root, output, actors: remaining, reuseReadySession: true });
  const native = require(path.join(output,'native.json'));
  assert.deepEqual([...retained,...native.journeys.map(j=>j.reportId)].sort(), [...reportIds].sort());
  assert.ok(native.restored.restored);
  evidence.nativeReadbacks = native.journeys.length;
  evidence.nativeReadbacksTotal = native.journeys.length+retained.length;
  evidence.passed = true;
}
main().catch(e => { evidence.error = e.stack; process.exitCode = 1; }).finally(async () => {
  try { await close(); } catch (e) { evidence.cleanupError = e.stack; process.exitCode = 1; }
  finally {
    try {
      if (before) {
        const after = hashes(), drift = Object.keys(before).filter(f => before[f] !== after[f]);
        fs.writeFileSync(path.join(output,'binding.json'),JSON.stringify({before,after,drift},null,2));
        evidence.drift = drift; if (drift.length) { evidence.passed = false; process.exitCode = 1; }
      }
      await closePostgresPool();
    } finally { await release?.(); evidence.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({passed:evidence.passed,cleaned:evidence.cleaned,error:evidence.error,cleanupError:evidence.cleanupError})); }
  }
});
