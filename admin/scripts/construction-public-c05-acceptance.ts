/** C05 real-HTTP acceptance. Only the existing labelled enterprise2404 fixtures
 * are mutable. JWTs remain in memory; neither results nor logs contain sessions.
 * Run from admin: node --import tsx scripts/construction-public-c05-acceptance.ts --development
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadEnvConfig } from '@next/env';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';

type Scenario = { name: string; projectId: string; leadId: string; conversationId: string; recordId: string; siteId: string; versionId: string; revision: number; status: string };
type Manifest = { prefix: string; enterpriseId: string; adminId: string; ownerId: string; visitorId: string; visitorConversationId: string; complete: boolean; scenarios: Scenario[] };
type Reply = { status: number; body: { data: Row; code?: string }; cache: string | null };
const root = path.resolve('..'), output = path.join(root, 'tmp/xiaok-vector/c05-batch');
const require = createRequire(path.resolve('package.json'));

async function main() {
  loadEnvConfig(process.cwd(), true);
  const { signMiniProgramToken } = await import('@/lib/miniprogram-jwt');
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.ok(process.argv.includes('--development') && ['localhost', '127.0.0.1'].includes(target.hostname)
    && target.port === '5432' && target.pathname === '/smart_floor_planner', 'Explicit approved development target required');
  const manifestPath = path.join(root, 'tmp/xiaok-vector/p4b-development-fixture.json');
  const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(manifest.complete && manifest.enterpriseId === '2404' && /^p4b-development-/.test(manifest.prefix));
  fs.mkdirSync(output, { recursive: true });
  const report: { startedAt: string; checks: Row[]; passed?: boolean; error?: string; cleanup?: Row; finishedAt?: string } = { startedAt: new Date().toISOString(), checks: [] };
  const reportPath = path.join(output, process.argv.includes('--native') ? 'c05-native-driver.json' : 'c05-http.json');
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  const operator = await withPlatformTransaction(async tx => {
    const enterprise = await one(tx, sql`select name,code from app.enterprises where id=${manifest.enterpriseId}`);
    assert.ok(enterprise && String(enterprise.name).startsWith('测试专用 · 小K公开工地') && enterprise.code === manifest.prefix);
    const admin = await one(tx, sql`select id,status from app.admin_users where id=${manifest.adminId} and enterprise_id=${manifest.enterpriseId} and username=${manifest.prefix} and role='enterprise_admin'`);
    assert.ok(admin, 'Synthetic operator mismatch');
    for (const uid of [manifest.ownerId, manifest.visitorId]) {
      assert.ok(await one(tx, sql`select user_id from app.wechat_identities where user_id=${uid} and openid=${manifest.prefix + uid}`), 'Synthetic identity mismatch');
    }
    return admin;
  });
  const selected = { decision: manifest.scenarios.find(s => s.siteId === '2')!, decline: manifest.scenarios.find(s => s.siteId === '5')!, unknown: manifest.scenarios.find(s => s.siteId === '1')! };
  for (const scenario of Object.values(selected)) {
    assert.ok(scenario && /^测试工地 · /.test(scenario.name));
    const row = await withTenantTransaction(manifest.enterpriseId, tx => one(tx, sql`select p.id from app.construction_projects p join app.leads l on l.enterprise_id=p.enterprise_id and l.id=p.lead_id
      where p.enterprise_id=${manifest.enterpriseId} and p.id=${scenario.projectId} and p.name=${scenario.name} and p.lead_id=${scenario.leadId} and l.customer_user_id=${manifest.ownerId}`));
    assert.ok(row, 'Synthetic project mismatch');
  }
  let enabled = false;
  try {
    await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='active' where id=${manifest.adminId} and enterprise_id=${manifest.enterpriseId} and username=${manifest.prefix}`));
    enabled = true;
    const versions = await withPlatformTransaction(tx => rows(tx, sql`select id::text,context_version from app.users where id in (${manifest.ownerId},${manifest.visitorId})`));
    const token = (uid: string) => signMiniProgramToken({ sub: uid, id: uid, mode: 'customer', role: 'user', contextVersion: Number(versions.find(v => v.id === uid)!.context_version), source: 'wechat' });
    const ownerToken = await token(manifest.ownerId), visitorToken = await token(manifest.visitorId);
    const adminToken = await new SignJWT({ id: manifest.adminId, role: 'enterprise_admin', enterpriseId: manifest.enterpriseId, permissions: ['construction-projects'] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('20m').sign(new TextEncoder().encode(process.env.JWT_SECRET));
    const request = async (url: string, auth = '', method = 'GET', body?: Row, key = randomUUID(), staff = false): Promise<Reply> => {
      const response = await fetch('http://localhost:3006' + url, { method, headers: { 'Content-Type': 'application/json',
        ...(auth ? { Authorization: 'Bearer ' + auth } : {}), ...(staff ? { Cookie: 'auth_token=' + adminToken } : {}), 'Idempotency-Key': key },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
      return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
    };
    const state = (s: Scenario) => withTenantTransaction(manifest.enterpriseId, tx => one(tx, sql`select id::text,current_version_id::text,revision,status,previewed_version_id::text,consented_version_id::text,reviewed_by::text from app.construction_public_sites where enterprise_id=${manifest.enterpriseId} and id=${s.siteId}`));
    const ownerPath = (s: Scenario, suffix: string) => '/api/miniprogram/assistant/conversations/' + s.conversationId + '/public-sites/' + s.siteId + suffix;
    const staffPath = (s: Scenario, suffix = '') => '/api/construction/projects/' + s.projectId + '/public-materials' + suffix;
    const args = (r: Row) => ({ versionId: String(r.current_version_id || r.versionId), expectedRevision: Number(r.revision) });
    const ok = (r: Reply) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.data; };
    const replace = async (s: Scenario) => {
      const view = ok(await request(staffPath(s), '', 'GET', undefined, randomUUID(), true)), m = view.material as Row;
      assert.ok(m, 'Synthetic source no longer available');
      return ok(await request(staffPath(s), '', 'POST', { expectedRevision: view.revision, material: {
        name: m.name, cityCode: m.cityCode, district: m.district, sources: m.sources,
        photos: (m.draftPhotos as Row[]).map(p => ({ recordId: p.recordId, mediaId: p.mediaId, masks: p.masks })),
      } }, randomUUID(), true));
    };
    const prepare = async (s: Scenario) => {
      const draft = await replace(s);
      const submitted = ok(await request(staffPath(s, '/submit'), '', 'POST', args(draft), randomUUID(), true));
      ok(await request('/api/miniprogram/assistant/conversations/' + s.conversationId + '/messages', ownerToken));
      return submitted;
    };
    const count = (s: Scenario, action: string) => withTenantTransaction(manifest.enterpriseId, async tx => Number((await one(tx, sql`select count(*) n from app.construction_public_audits where enterprise_id=${manifest.enterpriseId} and site_id=${s.siteId} and action=${action}`))!.n));
    const step = async (name: string, work: () => Promise<unknown>) => { const result = await work(); report.checks.push({ name, passed: true, result }); save(); console.log(name + ': PASS'); };
    for (const scenario of Object.values(selected)) await prepare(scenario);
    if (process.argv.includes('--native')) {
      const native = require(path.join(output, 'c05-native.cjs'));
      await native.run({ root, output, selected, ownerToken, visitorToken, visitorConversationId: manifest.visitorConversationId, request, state, count, prepare, replace, ownerPath, staffPath, args, ok });
      report.passed = true;
    } else {
      const s = selected.decision;
      await step('unpreviewed approval denied without a consent write', async () => {
        const before = (await state(s))!, r = await request(ownerPath(s, '/approve'), ownerToken, 'POST', args(before));
        assert.equal(r.status, 422); assert.equal(r.body.code, 'public_preview_required'); assert.deepEqual(await state(s), before);
      });
      await step('owner read/reentry, visitor and other-lead denials', async () => {
        const before = (await state(s))!, url = ownerPath(s, '?versionId=' + before.current_version_id);
        assert.equal((await request(url, ownerToken)).status, 200);
        assert.equal((await request(url, visitorToken)).status, 404);
        assert.equal((await request(url.replace('/' + s.conversationId + '/', '/' + selected.decline.conversationId + '/'), ownerToken)).status, 404);
        assert.deepEqual(await state(s), before);
      });
      await step('decline is durable and same-key retry does not duplicate its audit', async () => {
        const target = selected.decline, input = args((await state(target))!), key = randomUUID(), before = await count(target, 'owner.decline');
        const result = ok(await request(ownerPath(target, '/decline'), ownerToken, 'POST', input, key));
        assert.equal(result.status, 'declined'); assert.deepEqual(ok(await request(ownerPath(target, '/decline'), ownerToken, 'POST', input, key)), result);
        assert.equal(await count(target, 'owner.decline'), before + 1); assert.equal((await state(target))!.consented_version_id, null);
        assert.equal((await request(ownerPath(target, '/decline'), ownerToken, 'POST', { ...input, expectedRevision: 999 }, key)).status, 409);
      });
      await step('full preview and approval are separate durable operations', async () => {
        const preview = ok(await request(ownerPath(s, '/preview'), ownerToken, 'POST', args((await state(s))!)));
        assert.ok(preview.material); assert.equal((await state(s))!.consented_version_id, null);
        const approved = ok(await request(ownerPath(s, '/approve'), ownerToken, 'POST', args(preview)));
        assert.equal(approved.status, 'owner_approved'); assert.equal((await request('/api/public/construction/2404/sites/' + s.siteId)).status, 404);
      });
      await step('lost approval response reconciles the original key after client recreation', async () => {
        const target = selected.unknown, memory = new Map([['token', 'c05-test-session']]), runtime = globalThis as typeof globalThis & { wx?: unknown }, previous = runtime.wx;
        runtime.wx = { getStorageSync: (k: string) => memory.get(k), setStorageSync: (k: string, v: never) => memory.set(k, structuredClone(v)) };
        try {
          const { AssistantClient } = require(path.join(root, 'miniprogram/packages/assistant/lib/client.js'));
          const { PublicChatController } = require(path.join(root, 'miniprogram/packages/assistant/lib/public-sites.js'));
          let lose = true;
          const calls: Row[] = [];
          const bridge = async (url: string, method: string, input: Row, options: { headers: Record<string, string> }) => {
            const reply = await request('/api' + url, ownerToken, method, method === 'GET' ? undefined : input, options.headers['Idempotency-Key']);
            if (method !== 'GET') calls.push({ url, input, key: options.headers['Idempotency-Key'] });
            if (reply.status >= 400) throw { statusCode: reply.status, code: reply.body.code };
            if (lose && url.endsWith('/approve')) { lose = false; throw { statusCode: 503 }; }
            return reply.body;
          };
          const controller = (client: unknown) => new PublicChatController({ emit() {}, identity: () => 'c05-test-session', client, media: { clear() {}, async load() {} } });
          const messages = () => request('/api/miniprogram/assistant/conversations/' + target.conversationId + '/messages', ownerToken).then(r => ok(r).items);
          const first = controller(new AssistantClient(bridge)); await first.load(target.conversationId, '2404', await messages());
          const input = args((await state(target))!), cardKey = target.siteId + '_' + input.versionId;
          assert.equal(await first.decide(cardKey, 'preview'), true);
          const before = await count(target, 'owner.approve'); assert.equal(await first.decide(cardKey, 'approve'), false);
          assert.ok(first.state.publicPending); assert.equal((await state(target))!.status, 'owner_approved');
          first.clear(); const second = controller(new AssistantClient(bridge)); await second.load(target.conversationId, '2404', await messages());
          assert.ok(second.state.publicPending); assert.equal(await second.retry(), true);
          assert.deepEqual(calls.at(-1), calls.at(-2)); assert.equal(await count(target, 'owner.approve'), before + 1);
          return { exactActionVersionRevisionAndKey: true, approvalAudits: 1 };
        } finally { runtime.wx = previous; }
      });
      await step('review publication, new-version revocation and fresh approval gate', async () => {
        const published = ok(await request(staffPath(s, '/publish'), '', 'POST', args((await state(s))!), randomUUID(), true));
        const detail = ok(await request('/api/public/construction/2404/sites/' + s.siteId + '?versionId=' + published.versionId));
        assert.ok((detail.photos as Row[]).length);
        const draft = await replace(s); assert.notEqual(draft.versionId, published.versionId);
        assert.equal((await state(s))!.consented_version_id, null); assert.equal((await state(s))!.previewed_version_id, null);
        assert.equal((await request('/api/public/construction/2404/sites/' + s.siteId + '?versionId=' + published.versionId)).status, 404);
        assert.equal((await request(ownerPath(s, '/approve'), ownerToken, 'POST', args(published))).status, 404);
        const pending = ok(await request(staffPath(s, '/submit'), '', 'POST', args(draft), randomUUID(), true));
        assert.equal((await request(ownerPath(s, '/approve'), ownerToken, 'POST', args(pending))).status, 422);
      });
      await step('withdraw is durable, exact-key idempotent and keeps public links unavailable', async () => {
        const target = selected.unknown, input = args((await state(target))!), key = randomUUID(), before = await count(target, 'owner.withdraw');
        const result = ok(await request(ownerPath(target, '/withdraw'), ownerToken, 'POST', input, key));
        assert.deepEqual(ok(await request(ownerPath(target, '/withdraw'), ownerToken, 'POST', input, key)), result);
        assert.equal(result.status, 'withdrawn'); assert.equal(await count(target, 'owner.withdraw'), before + 1);
        assert.equal((await request('/api/public/construction/2404/sites/' + target.siteId)).status, 404);
      });
      report.passed = true;
    }
  } catch (error) {
    report.passed = false; report.error = error instanceof Error ? error.message : 'C05 acceptance failed'; throw error;
  } finally {
    try {
      if (enabled) await withPlatformTransaction(tx => tx.execute(sql`update app.admin_users set status='disabled' where id=${manifest.adminId} and enterprise_id=${manifest.enterpriseId} and username=${manifest.prefix}`));
      for (const scenario of manifest.scenarios) {
        const current = await withTenantTransaction(manifest.enterpriseId, tx => one(tx, sql`select current_version_id::text,revision,status from app.construction_public_sites where enterprise_id=${manifest.enterpriseId} and id=${scenario.siteId}`));
        if (current) { scenario.versionId = String(current.current_version_id); scenario.revision = Number(current.revision); scenario.status = String(current.status); }
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      const current = await withPlatformTransaction(tx => one(tx, sql`select status from app.admin_users where id=${operator.id}`));
      assert.equal(current?.status, 'disabled'); report.cleanup = { syntheticOperatorDisabled: true, fixtureManifestRefreshed: true };
    } finally { report.finishedAt = new Date().toISOString(); save(); await closePostgresPool(); }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'C05 acceptance failed'); process.exitCode = 1; void closePostgresPool(); });
