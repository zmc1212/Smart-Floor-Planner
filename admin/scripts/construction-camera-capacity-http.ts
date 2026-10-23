// Local fixture sign-in and read-only capacity API checks. Never saves a policy.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '../src/db/transaction';
import { one } from '../src/db/repositories/assistant-repository';
import { closePostgresPool } from '../src/lib/postgresql';

async function run() {
  const root = path.resolve('..'), out = path.join(root, 'tmp/cloud-camera'); loadEnvConfig(path.join(root, 'admin'), true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
  const database = new URL(config.DATABASE_URL); assert.equal(database.port, '55432'); assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname)); database.pathname = '/cloud_camera_eval'; process.env.DATABASE_URL = database.href;
  const fixture = JSON.parse(fs.readFileSync(path.join(out, 'fixture.private.json'), 'utf8'));
  const soak = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8'));
  assert.equal(soak.mode, '74h-soak'); assert.equal(soak.status, 'running');
  const report: Record<string, unknown> = { started: new Date().toISOString(), soakRunId: soak.runId, checks: [] };
  const ownFiles = ['admin/src/lib/construction/camera-capacity.ts', 'admin/src/lib/construction/recording-capacity.ts', 'admin/src/components/construction/camera-panel.tsx', 'admin/src/components/construction/recording-capacity-preview.tsx', 'admin/src/app/api/construction/video-capacity/projects/[projectId]/bindings/[bindingId]/route.ts', 'admin/scripts/construction-camera-capacity-http.ts', 'tmp/cloud-camera/fixture.private.json', 'tmp/xiaok-vector/connection.private.json'];
  const files = [...new Set([...Object.keys(soak.before), ...ownFiles])];
  const bind = () => Object.fromEntries(files.map(f => [f, createHash('sha256').update(fs.readFileSync(path.resolve(root, f))).digest('hex')]));
  report.before = bind(); for (const [f, hash] of Object.entries(soak.before)) assert.equal((report.before as Record<string, string>)[f], hash, 'Never test after long-soak source drift');
  const policy = () => withTenantTransaction(fixture.enterpriseId, tx => one(tx, sql`select enabled,retention_days,version from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`));
  report.policyBefore = await policy();
  try {
    await withPlatformTransaction(async tx => { assert.equal((await one(tx, sql`select name from app.enterprises where id=${fixture.enterpriseId}`))?.name, '测试专用 · 云工地摄像头'); });
    const origin = 'http://localhost:3018', url = origin + '/api/construction/video-capacity/projects/' + fixture.projectId + '/bindings/' + fixture.bindingId;
    const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fixture.username, password: fixture.password }), signal: AbortSignal.timeout(30000) });
    assert.equal(login.status, 200); const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') + '; global_tenant_id=' + fixture.enterpriseId; assert.ok(cookie.includes('auth_token='));
    const checks = report.checks as unknown[];
    const anonymous = await fetch(url); assert.equal(anonymous.status, 401); checks.push({ name: 'anonymous denied', status: 401 });
    const response = await fetch(url, { headers: { Cookie: cookie } }); assert.equal(response.status, 200);
    const payload = await response.json(); assert.equal(payload.data.bindingId, fixture.bindingId); assert.ok(payload.data.sample.segments > 0); assert.ok(BigInt(payload.data.bytesPerDay) > 0n);
    assert.equal(JSON.stringify(payload).includes('/opt/media/'), false); checks.push({ name: 'authenticated actual sealed samples', status: 200, sample: payload.data.sample, bytesPerDay: payload.data.bytesPerDay });
    const foreign = await fetch(url.replace(/\/bindings\/\d+$/, '/bindings/9223372036854775807'), { headers: { Cookie: cookie } }); assert.equal(foreign.status, 404); checks.push({ name: 'foreign binding denied', status: 404 });
    const invalid = await fetch(url + '?unexpected=1', { headers: { Cookie: cookie } }); assert.equal(invalid.status, 422); checks.push({ name: 'unexpected query denied', status: 422 });
    const write = await fetch(url, { method: 'POST', headers: { Cookie: cookie } }); assert.equal(write.status, 405); checks.push({ name: 'no mutation endpoint', status: 405 });
    const mini = await fetch(url, { headers: { Authorization: 'Bearer ' + fixture.miniToken } }); assert.equal(mini.status, 401); checks.push({ name: 'Mini token cannot become an Admin session', status: 401 });
    report.policyAfter = await policy(); assert.deepEqual(report.policyAfter, report.policyBefore); assert.equal((report.policyAfter as { enabled: boolean }).enabled, true);
    const current = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8')); assert.equal(current.runId, soak.runId); assert.equal(current.status, 'running'); report.soakObservations = current.observations;
    report.passed = true;
  } catch (error) { report.passed = false; report.error = (error as Error).message; process.exitCode = 1; }
  finally {
    report.after = bind(); report.drift = files.filter(f => (report.before as Record<string, string>)[f] !== (report.after as Record<string, string>)[f]);
    if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
    report.finished = new Date().toISOString(); fs.writeFileSync(path.join(out, 'capacity-http-' + String(report.started).replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(out, 'capacity-http.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: (report.checks as unknown[]).length, error: report.error, drift: report.drift, policyUnchanged: JSON.stringify(report.policyBefore) === JSON.stringify(report.policyAfter) })); await closePostgresPool();
  }
}
void run().catch(async error => { console.error(error.message); process.exitCode = 1; await closePostgresPool(); });
