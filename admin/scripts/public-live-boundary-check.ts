/** Fixed local-only SQL/service boundary checks; no model or native calls. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction, type PostgresTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { constructionCounts, deleteConstructionData } from '@/db/repositories/construction-cleanup';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { PublicLiveCustomer } from '@/lib/construction/public-live/customer';
import { stopLiveProxies } from '@/lib/construction/public-live/media';
import type { ActorContext } from '@/lib/assistant/contracts';
import { bindPublicLive, comparePublicLive } from './public-live-bindings.mjs';

loadEnvConfig(process.cwd(), true);
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['localhost', '127.0.0.1'].includes(target.hostname) && target.port === '55434' && target.pathname === '/sfp_public_live_eval');
const f = JSON.parse(fs.readFileSync('../tmp/public-live-package/fixture.json', 'utf8')) as {
  eid: string; control: string; pid: string; cid: string; bindingId: string; users: Record<string, string>;
  adminIds: Record<string, string>; actor: ActorContext; visitor: ActorContext;
};
const engineeringOnly = process.argv.includes('--boundaries-only');
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || (engineeringOnly ? '../tmp/public-live-package/boundary-independent01' : '../tmp/public-live-package/boundary01'));
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Preserve previous attempts');
fs.mkdirSync(output, { recursive: true });
const report: { at: string; checks: Row[]; scope?: string; excluded?: string; setup?: unknown; before?: unknown; drift?: string[]; passed?: boolean; error?: string; cleanup?: unknown } = { at: new Date().toISOString(), checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const eid = BigInt(f.eid);
const service = new PublicLiveService({ enterpriseId: f.eid, adminId: f.adminIds.enterprise_admin });
const customer = new PublicLiveCustomer(f.actor, f.cid);
const current = (tx: PostgresTransaction) => one(tx, sql`select id,status,revision,current_version_id,prepared_by,customer_id,reason from app.construction_public_live where enterprise_id=${eid} and project_id=${f.pid}`);
const snapshot = () => withTenantTransaction(eid, async tx => ({
  counts: await constructionCounts(tx, eid),
  live: await current(tx),
  photos: await rows(tx, sql`select id,status,revision,current_version_id from app.construction_public_sites where enterprise_id=${eid} order by id`),
  proxies: await rows(tx, sql`select id,state from app.construction_public_live_proxies where enterprise_id=${eid} order by id`),
}));
async function rollbackProbe(scope: 'tenant' | 'platform', fn: (tx: PostgresTransaction) => Promise<Row>) {
  const marker = new Error('intentional-boundary-rollback');
  let result: Row = {};
  const run = scope === 'platform' ? withPlatformTransaction : (cb: (tx: PostgresTransaction) => Promise<never>) => withTenantTransaction(eid, cb);
  try { await run(async tx => { result = await fn(tx); throw marker; }); }
  catch (e) { if (e !== marker) throw e; }
  return result;
}
async function step(name: string, fn: () => Promise<unknown>) {
  assert.deepEqual(comparePublicLive(report.before), [], 'Bound source/configuration drifted before next check');
  try { report.checks.push({ name, passed: true, data: await fn() }); }
  catch (e) { report.checks.push({ name, passed: false, error: e instanceof Error ? e.stack : String(e) }); throw e; }
  finally { save(); console.log(name + ': ' + (report.checks.at(-1)?.passed ? 'PASS' : 'FAIL')); }
}
async function main() {
  report.before = bindPublicLive([
    'admin/scripts/public-live-boundary-check.ts', 'admin/src/db/repositories/construction-cleanup.ts',
    'admin/src/lib/construction/public-live/service.ts', 'admin/src/lib/construction/public-live/customer.ts',
    'admin/drizzle/0113_construction_camera_retention_defaults.sql', 'admin/drizzle/0114_construction_public_live.sql',
    'admin/drizzle/0115_construction_camera_customer_grants.sql', 'tmp/public-live-package/fixture.json',
  ]);
  save();
  try {
    if (engineeringOnly) {
      report.scope = 'Independent SQL identity/role/cleanup engineering checks only; no original-chat delivery, media or native acceptance';
      report.excluded = 'boundary01 failed original-chat message assertion remains failed. Original-chat discriminator proves app.users invisible under sfp_app tenant RLS, causing liveEvent join to skip append. No runtime repair.';
      // Reuse the retained labelled staff role instead of assuming a seeded
      // system_roles row for the built-in enterprise_admin role.
      const fixtureService = new PublicLiveService({ enterpriseId: f.eid, adminId: f.adminIds.construction_staff });
      const view = await fixtureService.read(f.pid);
      const draft = await fixtureService.save(f.pid, { expectedRevision: view.revision, bindingId: f.bindingId, alias: '合成SQL边界机位', name: '合成公开工地 · SQL边界检查' }, randomUUID());
      const pending = await fixtureService.mutate(f.pid, 'submit', { expectedRevision: draft.revision, versionId: draft.versionId }, randomUUID());
      assert.equal(pending.status, 'pending_owner');
      report.setup = { liveId: pending.id, versionId: pending.versionId, status: pending.status, source: 'Existing service writes for isolated boundary fixtures only, not a delivery replay or pass' };
      save();
    } else await step('Admin UI write persists in original owner consultation; unrelated visitor denied', async () => {
      const view = await service.read(f.pid), m = view.material;
      assert.ok(m); assert.equal(m.status, 'pending_owner');
      assert.equal(m.name, '合成公开工地 · Admin定点复核'); assert.equal(m.alias, '客厅全景复核机位');
      const owner = await customer.read();
      assert.equal(owner.items.length, 1); assert.equal(owner.items[0].versionId, m.versionId);
      await assert.rejects(new PublicLiveCustomer(f.visitor, f.cid).read());
      const event = await withTenantTransaction(eid, tx => one(tx, sql`select m.conversation_id,m.purpose from app.assistant_messages m join app.construction_public_live l on l.enterprise_id=m.enterprise_id and l.message_id=m.id where l.enterprise_id=${eid} and l.id=${m.id}`));
      assert.equal(String(event?.conversation_id), f.cid); assert.equal(event?.purpose, 'construction.public.live');
      return { id: m.id, versionId: m.versionId, status: m.status, originalConversation: f.cid, visitorDenied: true };
    });
    const baseline = await snapshot();
    await step('Five public-live cleanup tables obey actual non-bypass tenant RLS', async () => {
      const role = await withTenantTransaction(eid, tx => one(tx, sql`select rolsuper,rolbypassrls from pg_roles where rolname=current_user`));
      assert.equal(role?.rolsuper, false); assert.equal(role?.rolbypassrls, false);
      const live = baseline.counts.filter(x => x.table.startsWith('construction_public_live'));
      assert.equal(live.length, 5); assert.ok(live.some(x => x.count > 0));
      const hidden = await withTenantTransaction(f.control, tx => constructionCounts(tx, eid));
      assert.ok(hidden.every(x => x.count === 0));
      return { publicLiveTables: live, otherTenantRows: 0, role: 'sfp_app' };
    });
    await step('Role permission change withdraws grant; restoring role does not revive it; rollback preserves fixture', async () => {
      const result = await rollbackProbe('platform', async tx => {
        const live = (await current(tx))!;
        const role = (await one(tx, sql`select r.role_key,r.menu_keys from app.system_roles r join app.admin_users a on a.role=r.role_key where a.id=${String(live.prepared_by)}`))!;
        assert.ok(role);
        const keys = Array.isArray(role.menu_keys) ? role.menu_keys.map(String) : [];
        await tx.execute(sql`update app.system_roles set menu_keys=array_append(menu_keys,'synthetic-public-live-boundary') where role_key=${String(role.role_key)}`);
        const withdrawn = (await current(tx))!;
        assert.equal(withdrawn.status, 'withdrawn'); assert.equal(withdrawn.reason, 'role_access_changed');
        assert.equal(Number(withdrawn.revision), Number(live.revision) + 1);
        await tx.execute(sql`update app.system_roles set menu_keys=ARRAY(select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb)) where role_key=${String(role.role_key)}`);
        assert.equal((await current(tx))?.status, 'withdrawn');
        return { role: role.role_key, restorationRevives: false };
      });
      assert.deepEqual(await snapshot(), baseline); return result;
    });
    await step('Owner context and preparer identity changes withdraw durably through restoration inside rollback probes', async () => {
      for (const kind of ['owner_context', 'preparer_password'] as const) {
        await rollbackProbe('platform', async tx => {
          const live = (await current(tx))!;
          if (kind === 'owner_context') {
            const user = (await one(tx, sql`select context_version from app.users where id=${f.users.owner}`))!;
            await tx.execute(sql`update app.users set context_version=context_version+1 where id=${f.users.owner}`);
            assert.equal((await current(tx))?.status, 'withdrawn');
            await tx.execute(sql`update app.users set context_version=${Number(user.context_version)} where id=${f.users.owner}`);
          } else {
            const admin = (await one(tx, sql`select must_change_password from app.admin_users where id=${String(live.prepared_by)}`))!;
            await tx.execute(sql`update app.admin_users set must_change_password=not must_change_password where id=${String(live.prepared_by)}`);
            assert.equal((await current(tx))?.status, 'withdrawn');
            await tx.execute(sql`update app.admin_users set must_change_password=${Boolean(admin.must_change_password)} where id=${String(live.prepared_by)}`);
          }
          assert.equal((await current(tx))?.status, 'withdrawn');
          return { restorationRevives: false };
        });
        assert.deepEqual(await snapshot(), baseline);
      }
      return { probes: ['owner_context', 'preparer_password'], restorationRevives: false, rollbackVerified: true };
    });
    await step('Tenant cleanup blocks an unresolved owned proxy without deleting any rows', async () => {
      const result = await rollbackProbe('tenant', async tx => {
        const proxy = (await one(tx, sql`select id from app.construction_public_live_proxies where enterprise_id=${eid} order by id desc limit 1`))!;
        assert.ok(proxy, 'Use retained real owned proxy attempt');
        await tx.execute(sql`update app.construction_public_live_proxies set state='stopping' where enterprise_id=${eid} and id=${String(proxy.id)}`);
        await assert.rejects(deleteConstructionData(tx, eid), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === 'public_live_stop_required');
        assert.deepEqual(await constructionCounts(tx, eid), baseline.counts);
        return { proxyId: String(proxy.id), simulatedStoppingInsideRollbackOnly: true, blocked: true };
      });
      assert.deepEqual(await snapshot(), baseline); return result;
    });
    await step('Cleared proxy obligations allow real domain deletion, all rolled back; control tenant cannot delete', async () => {
      const hidden = await withTenantTransaction(f.control, tx => deleteConstructionData(tx, eid));
      assert.ok(hidden.every(x => x.count === 0)); assert.deepEqual(await snapshot(), baseline);
      const result = await rollbackProbe('tenant', async tx => {
        await tx.execute(sql`update app.construction_public_live_proxies set state='stopped' where enterprise_id=${eid}`);
        const deleted = await deleteConstructionData(tx, eid);
        assert.ok(deleted.some(x => x.table === 'construction_public_live' && x.count > 0));
        assert.ok((await constructionCounts(tx, eid)).every(x => x.count === 0));
        return { deletedPublicLiveTables: deleted.filter(x => x.table.startsWith('construction_public_live')), allDomainRowsAbsentInsideTransaction: true };
      });
      assert.deepEqual(await snapshot(), baseline); return { ...result, rollbackVerified: true, controlTenantDeleted: 0 };
    });
    report.passed = true;
  } catch (e) { report.passed = false; report.error = e instanceof Error ? e.stack : String(e); }
  finally {
    try {
      const view = await service.read(f.pid), m = view.material;
      if (m && m.status !== 'withdrawn') await service.mutate(f.pid, 'withdraw', { expectedRevision: m.revision, versionId: m.versionId, reason: 'Synthetic bounded checks complete' }, randomUUID());
      report.cleanup = m ? await stopLiveProxies(f.eid, m.id) : { stopped: true };
    } catch (e) { report.cleanup = { stopped: false, error: e instanceof Error ? e.message : String(e) }; report.passed = false; }
    report.drift = comparePublicLive(report.before); if (report.drift.length) report.passed = false;
    save(); await closePostgresPool();
  }
  if (!report.passed) process.exitCode = 1;
}
main().catch(async e => { report.passed = false; report.error = e instanceof Error ? e.stack : String(e); save(); await closePostgresPool(); process.exitCode = 1; });
