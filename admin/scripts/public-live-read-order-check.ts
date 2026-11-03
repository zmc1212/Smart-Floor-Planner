/** Real-service regression for the Admin photo/live mount lock inversion. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { AssistantRepository, one, type Row } from '@/db/repositories/assistant-repository';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { PublicMaterialService } from '@/lib/construction/public-service';
import { siteActor } from '@/lib/construction/site-chat';
import { closePostgresPool, getPostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { bindPublicLive, comparePublicLive } from './public-live-bindings.mjs';

async function main() {
  const target = new URL(resolvePostgresRuntimeConfig().connectionString);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55434');
  assert.equal(target.pathname, '/sfp_public_live_eval');
  const f = JSON.parse(fs.readFileSync('../tmp/public-live-package/fixture.json', 'utf8'));
  const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9)
    || '../tmp/public-live-package/admin-recovery01/read-order');
  assert.ok(!fs.existsSync(path.join(output, 'report.json'))); fs.mkdirSync(output, { recursive: true });
  const before = bindPublicLive(['admin/scripts/public-live-read-order-check.ts',
    'admin/src/lib/construction/public-service.ts', 'admin/src/lib/construction/public-live/service.ts']);
  fs.writeFileSync(path.join(output, 'before.json'), JSON.stringify(before, null, 2));
  const report: { at: string; scope: string; checks: Row[]; passed?: boolean; error?: string;
    drift?: string[]; cleanup?: boolean } = { at: new Date().toISOString(),
    scope: 'Fixed5: blocked-settings lock order, concurrent actual reads for3 management roles, tenant denial. Existing labelled1454/owned55434; no writes, model or media calls.', checks: [] };
  const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  const step = async (name: string, run: () => Promise<unknown>) => {
    try { const data = await run(); report.checks.push({ name, passed: true, data }); }
    catch (e) { report.checks.push({ name, passed: false, error: e instanceof Error ? e.stack : String(e),
      causeCode: (e as { cause?: { code?: string } }).cause?.code }); throw e; }
    finally { save(); }
  };
  try {
    await step('a live read waiting for settings must leave the project available to the photo transaction', async () => {
      const actor = { enterpriseId: f.eid, adminId: f.adminIds.enterprise_admin };
      let flight: Promise<{ success: boolean; error?: unknown }> | undefined;
      let failure: unknown, waitSeen = false;
      try {
        await withTenantTransaction(f.eid, async tx => {
          // Reuse the real photo scope's identity/settings prefix. NOWAIT probes
          // the conflicting row without causing another database deadlock.
          await new AssistantRepository(tx, siteActor(actor)).settings(false);
          const ownPid = Number((await one(tx, sql`select pg_backend_pid() as pid`))!.pid);
          flight = new PublicLiveService(actor).read(f.pid).then(() => ({ success: true }), error => ({ success: false, error }));
          for (let i = 0; i < 50; i++) {
            const waiting = await getPostgresPool().query(
              `select pid from pg_stat_activity where datname=current_database()
               and $1=any(pg_blocking_pids(pid)) and query like '%assistant_enterprise_settings%'`, [ownPid]);
            if (waiting.rows.length) { waitSeen = true; break; }
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          assert.ok(waitSeen, 'actual live read must reach the controlled settings wait');
          assert.ok(await one(tx, sql`select id from app.construction_projects
            where enterprise_id=${f.eid} and id=${f.pid} for update nowait`));
        });
      } catch (e) { failure = e; }
      finally {
        const settled = await flight;
        assert.ok(!settled || settled.success, 'live read must settle after the owning transaction releases settings');
      }
      if (failure) throw failure;
      return { waitingAtSettings: waitSeen, projectLockAcquired: true, allTransactionsReleased: true };
    });
    for (const role of ['enterprise_admin', 'admin', 'super_admin']) {
      await step('concurrent photo/live read and reentry for ' + role, async () => {
        const actor = { enterpriseId: f.eid, adminId: f.adminIds[role] };
        const [photo, live] = await Promise.all([
          new PublicMaterialService(actor).read(f.pid), new PublicLiveService(actor).read(f.pid),
        ]);
        assert.equal((photo.material as Row).status, 'published');
        assert.ok(((photo.material as Row).photos as unknown[]).length);
        assert.equal(live.canPrepare, true); assert.equal(live.canReview, true);
        const reentry = await new PublicMaterialService(actor).read(f.pid);
        assert.equal((reentry.material as Row).versionId, (photo.material as Row).versionId);
        return { photoVersion: (photo.material as Row).versionId, liveRevision: live.revision };
      });
    }
    await step('foreign-tenant actor still cannot read the project', async () => {
      await assert.rejects(new PublicLiveService({ enterpriseId: f.control,
        adminId: f.adminIds.enterprise_admin }).read(f.pid), e => (e as { status?: number }).status === 403);
      return { denied: true };
    });
    report.passed = true;
  } catch (e) { report.passed = false; report.error = e instanceof Error ? e.stack : String(e); }
  finally { report.drift = comparePublicLive(before); await closePostgresPool(); report.cleanup = true; save(); }
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks, drift: report.drift, cleanup: report.cleanup }, null, 2));
  if (!report.passed || report.drift?.length) process.exitCode = 1;
}
main().catch(e => { console.error(e); process.exitCode = 1; });
