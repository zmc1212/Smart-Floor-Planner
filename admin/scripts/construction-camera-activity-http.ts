// Read-only HTTP acceptance against the labelled local fixture; never writes a recording policy.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction, withPlatformTransaction } from '../src/db/transaction';
import { one } from '../src/db/repositories/assistant-repository';
import { closePostgresPool } from '../src/lib/postgresql';
import type { RecordingActivityPage } from '../src/lib/construction/camera-activity-contract';

async function run() {
  const root = path.resolve('..'), out = path.join(root, 'tmp/cloud-camera'); loadEnvConfig(path.join(root, 'admin'), true);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tmp/xiaok-vector/connection.private.json'), 'utf8'));
  const database = new URL(config.DATABASE_URL); assert.equal(database.port, '55432'); assert.ok(['127.0.0.1', 'localhost'].includes(database.hostname)); database.pathname = '/cloud_camera_eval'; process.env.DATABASE_URL = database.href;
  const fixture = JSON.parse(fs.readFileSync(path.join(out, 'fixture.private.json'), 'utf8'));
  const soak = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8'));
  assert.equal(soak.mode, '74h-soak'); assert.equal(soak.status, 'running');
  const report: Record<string, unknown> = { started: new Date().toISOString(), soakRunId: soak.runId, checks: [] };
  const ownFiles = ['admin/src/lib/construction/camera-activity.ts', 'admin/src/lib/construction/camera-activity-contract.ts', 'admin/src/components/construction/camera-panel.tsx', 'admin/src/components/construction/camera-activity.tsx', 'admin/src/app/api/construction/video-activity/projects/[projectId]/bindings/[bindingId]/route.ts', 'admin/scripts/construction-camera-activity-http.ts', 'tmp/cloud-camera/fixture.private.json', 'tmp/xiaok-vector/connection.private.json'];
  const files = [...new Set([...Object.keys(soak.before), ...ownFiles])];
  const bind = () => Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')]));
  report.before = bind();
  for (const [file, hash] of Object.entries(soak.before)) assert.equal((report.before as Record<string, string>)[file], hash, 'Long-soak source drift');
  const policy = () => withTenantTransaction(fixture.enterpriseId, tx => one(tx, sql`select enabled,retention_days,version from app.construction_camera_recording_policies where binding_id=${fixture.bindingId}`));
  report.policyBefore = await policy();
  try {
    await withPlatformTransaction(async tx => { assert.equal((await one(tx, sql`select name from app.enterprises where id=${fixture.enterpriseId}`))?.name, '测试专用 · 云工地摄像头'); });
    const origin = 'http://localhost:3018', url = origin + '/api/construction/video-activity/projects/' + fixture.projectId + '/bindings/' + fixture.bindingId;
    const login = await fetch(origin + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: fixture.username, password: fixture.password }), signal: AbortSignal.timeout(30000) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') + '; global_tenant_id=' + fixture.enterpriseId;
    assert.ok(cookie.includes('auth_token='));
    const checks = report.checks as unknown[], get = (target: string) => fetch(target, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
    const anonymous = await fetch(url); assert.equal(anonymous.status, 401); checks.push({ name: 'anonymous denied', status: 401 });
    const response = await get(url); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /no-store/);
    const page: RecordingActivityPage = (await response.json()).data;
    assert.ok(page.items.length > 1 && page.items.length <= 20);
    const allowed = ['id', 'createdAt', 'actor', 'event', 'enabled', 'retentionDays', 'usedPercent', 'reason'];
    for (const item of page.items) { assert.deepEqual(Object.keys(item).sort(), [...allowed].sort()); assert.match(item.event, /^(recording\.configure|storage\.(ok|warning|critical|blocked|unavailable))$/); }
    assert.equal(JSON.stringify(page).includes('/opt/media/'), false);
    checks.push({ name: 'actual persisted history with whitelisted fields', status: 200, count: page.items.length });
    const olderResponse = await get(url + '?beforeId=' + page.items[0].id); assert.equal(olderResponse.status, 200);
    const older: RecordingActivityPage = (await olderResponse.json()).data;
    assert.ok(older.items.length > 0); assert.ok(older.items.every(item => BigInt(item.id) < BigInt(page.items[0].id)));
    checks.push({ name: 'strict older-ID cursor', status: 200, count: older.items.length });
    const empty = await get(url + '?beforeId=1'); assert.equal(empty.status, 200); assert.deepEqual((await empty.json()).data, { items: [], nextCursor: null }); checks.push({ name: 'empty older page', status: 200 });
    const reentry = await get(url); assert.equal(reentry.status, 200); assert.ok(((await reentry.json()).data as RecordingActivityPage).items.some(item => item.id === page.items[0].id)); checks.push({ name: 'persisted reentry', status: 200 });
    for (const query of ['?beforeId=0', '?beforeId=1&beforeId=2', '?unexpected=1']) { const invalid = await get(url + query); assert.equal(invalid.status, 422); checks.push({ name: 'invalid query ' + query, status: 422 }); }
    const foreign = await get(url.replace(/\/bindings\/\d+$/, '/bindings/9223372036854775807')); assert.equal(foreign.status, 404); checks.push({ name: 'foreign binding denied', status: 404 });
    const write = await fetch(url, { method: 'POST', headers: { Cookie: cookie } }); assert.equal(write.status, 405); checks.push({ name: 'no mutation endpoint', status: 405 });
    const mini = await fetch(url, { headers: { Authorization: 'Bearer ' + fixture.miniToken } }); assert.equal(mini.status, 401); checks.push({ name: 'Mini token cannot impersonate an Admin session', status: 401 });
    report.policyAfter = await policy(); assert.deepEqual(report.policyAfter, report.policyBefore); assert.equal((report.policyAfter as { enabled: boolean }).enabled, true);
    const current = JSON.parse(fs.readFileSync(path.join(out, 'soak.json'), 'utf8')); assert.equal(current.runId, soak.runId); assert.equal(current.status, 'running'); report.soakObservations = current.observations;
    report.passed = true;
  } catch (error) { report.passed = false; report.error = (error as Error).message; process.exitCode = 1; }
  finally {
    report.after = bind(); report.drift = files.filter(file => (report.before as Record<string, string>)[file] !== (report.after as Record<string, string>)[file]);
    if ((report.drift as string[]).length) { report.passed = false; process.exitCode = 1; }
    report.finished = new Date().toISOString(); fs.writeFileSync(path.join(out, 'activity-http-' + String(report.started).replace(/[:.]/g, '-') + '.json'), JSON.stringify(report, null, 2)); fs.writeFileSync(path.join(out, 'activity-http.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: (report.checks as unknown[]).length, error: report.error, drift: report.drift, policyUnchanged: JSON.stringify(report.policyBefore) === JSON.stringify(report.policyAfter) }));
    await closePostgresPool();
  }
}
void run().catch(async error => { console.error(error.message); process.exitCode = 1; await closePostgresPool(); });
