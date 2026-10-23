// Actual read-only service acceptance; never saves a recording policy or calls WVP.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '../src/db/transaction';
import { one } from '../src/db/repositories/assistant-repository';
import { closePostgresPool } from '../src/lib/postgresql';
import type { RecordingCoverage } from '../src/lib/construction/recording-coverage';

async function run() {
  const root = path.resolve('..'), out = path.join(root, 'tmp/cloud-camera'); loadEnvConfig(path.join(root, 'admin'), true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
  const database = new URL(config.DATABASE_URL); assert.equal(database.port, '55432'); assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname)); database.pathname = '/cloud_camera_eval'; process.env.DATABASE_URL = database.href;
  const fixture = JSON.parse(fs.readFileSync(path.join(out, 'fixture.private.json'), 'utf8'));
  const soak = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8'));
  assert.equal(soak.mode, '74h-soak'); assert.equal(soak.status, 'running');
  const report: Record<string, unknown> = { started: new Date().toISOString(), soakRunId: soak.runId, checks: [] };
  const ownFiles = ['admin/src/lib/construction/camera-coverage.ts', 'admin/src/lib/construction/recording-coverage.ts', 'admin/src/components/construction/camera-panel.tsx', 'admin/src/components/construction/camera-coverage.tsx', 'admin/src/app/api/construction/video-coverage/projects/[projectId]/bindings/[bindingId]/route.ts', 'admin/src/lib/tenant-route.ts', 'admin/scripts/construction-camera-coverage-http.ts', 'tmp/cloud-camera/fixture.private.json', 'tmp/xiaok-vector/connection.private.json'];
  const files = [...new Set([...Object.keys(soak.before), ...ownFiles])];
  const bind = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
  report.before = bind();
  for (const [file, hash] of Object.entries(soak.before)) assert.equal((report.before as Record<string, string>)[file], hash, 'Long-soak source drift');
  const policy = () => withTenantTransaction(fixture.enterpriseId, tx => one(tx, sql`select enabled,retention_days,version from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`));
  report.policyBefore = await policy();
  try {
    await withPlatformTransaction(async tx => { assert.equal((await one(tx, sql`select name from app.enterprises where id=${fixture.enterpriseId}`))?.name, '测试专用 · 云工地摄像头'); });
    const latest = await withTenantTransaction(fixture.enterpriseId, tx => one(tx, sql`select started_at from app.construction_recordings where binding_id=${fixture.bindingId} and state='ready' order by started_at desc limit 1`));
    assert.ok(latest);
    const day = new Date(new Date(String(latest.started_at)).getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const origin = 'http://localhost:3018', base = origin + '/api/construction/video-coverage/projects/' + fixture.projectId + '/bindings/' + fixture.bindingId, url = base + '?day=' + day;
    const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fixture.username, password: fixture.password }), signal: AbortSignal.timeout(30000) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') + '; global_tenant_id=' + fixture.enterpriseId;
    assert.ok(cookie.includes('auth_token='));
    const checks = report.checks as unknown[], get = (target: string) => fetch(target, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
    const anonymous = await fetch(url); assert.equal(anonymous.status, 401); checks.push({ name: 'anonymous denied', status: 401 });
    const response = await get(url); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /no-store/);
    const page: RecordingCoverage = (await response.json()).data;
    assert.ok(page.segments > 0 && page.coveredMilliseconds > 0); assert.equal(page.bindingId, fixture.bindingId); assert.equal(page.day, day);
    assert.equal(page.truncated, false); assert.equal(page.limit, 1000);
    assert.deepEqual(Object.keys(page).sort(), ['bindingId', 'day', 'sampledAt', 'from', 'to', 'limit', 'truncated', 'segments', 'ranges', 'gaps', 'coveredMilliseconds', 'gapMilliseconds'].sort());
    for (const range of page.ranges) assert.deepEqual(Object.keys(range).sort(), ['from', 'to', 'milliseconds', 'segments'].sort());
    for (const gap of page.gaps) assert.deepEqual(Object.keys(gap).sort(), ['from', 'to', 'milliseconds'].sort());
    assert.equal(JSON.stringify(page).includes('/opt/media/'), false);
    checks.push({ name: 'actual sealed coverage with whitelisted fields', status: 200, segments: page.segments, coveredMilliseconds: page.coveredMilliseconds, gaps: page.gaps.length });
    const reentry = await get(url); assert.equal(reentry.status, 200); assert.ok(((await reentry.json()).data as RecordingCoverage).coveredMilliseconds >= page.coveredMilliseconds); checks.push({ name: 'persisted reentry', status: 200 });
    const empty = await get(base + '?day=2020-01-01'); assert.equal(empty.status, 200); const emptyData: RecordingCoverage = (await empty.json()).data; assert.equal(emptyData.segments, 0); assert.deepEqual(emptyData.gaps, []); checks.push({ name: 'empty date does not imply downtime', status: 200 });
    for (const query of ['', '?day=2026-02-30', '?day=' + day + '&day=' + day, '?day=' + day + '&unexpected=1']) { const invalid = await get(base + query); assert.equal(invalid.status, 422); checks.push({ name: 'invalid query ' + query, status: 422 }); }
    const foreign = await get(base.replace(/\/bindings\/\d+$/, '/bindings/9223372036854775807') + '?day=' + day); assert.equal(foreign.status, 404); checks.push({ name: 'foreign binding denied', status: 404 });
    const write = await fetch(url, { method: 'POST', headers: { Cookie: cookie } }); assert.equal(write.status, 405); checks.push({ name: 'no mutation endpoint', status: 405 });
    const mini = await fetch(url, { headers: { Authorization: 'Bearer ' + fixture.miniToken } }); assert.equal(mini.status, 401); checks.push({ name: 'Mini token cannot impersonate an Admin session', status: 401 });
    report.policyAfter = await policy(); assert.deepEqual(report.policyAfter, report.policyBefore); assert.equal((report.policyAfter as { enabled: boolean }).enabled, true);
    const current = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8')); assert.equal(current.runId, soak.runId); assert.equal(current.status, 'running'); report.soakObservations = current.observations;
    report.passed = true;
  } catch (error) { report.passed = false; report.error = (error as Error).message; process.exitCode = 1; }
  finally {
    report.after = bind(); report.drift = files.filter(file => (report.before as Record<string, string>)[file] !== (report.after as Record<string, string>)[file]);
    if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
    report.finished = new Date().toISOString(); fs.writeFileSync(path.join(out, 'coverage-http-' + String(report.started).replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(out, 'coverage-http.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: (report.checks as unknown[]).length, error: report.error, drift: report.drift, policyUnchanged: JSON.stringify(report.policyBefore) === JSON.stringify(report.policyAfter) }));
    await closePostgresPool();
  }
}
void run().catch(async error => { console.error(error.message); process.exitCode = 1; await closePostgresPool(); });
