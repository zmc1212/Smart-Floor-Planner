/** Actual isolated service receipts, no model, media create or native call. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool, resolvePostgresRuntimeConfig } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import type { ActorContext } from '@/lib/assistant/contracts';
import { PublicLiveService } from '@/lib/construction/public-live/service';
import { PublicLiveCustomer } from '@/lib/construction/public-live/customer';
import { liveEvent } from '@/lib/construction/public-live/store';
import { stopLiveProxies } from '@/lib/construction/public-live/media';
import { siteActor } from '@/lib/construction/site-chat';
import { bindPublicLive, comparePublicLive } from './public-live-bindings.mjs';

loadEnvConfig(process.cwd(), true);
const target = new URL(resolvePostgresRuntimeConfig().connectionString);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55434' && target.pathname === '/sfp_public_live_eval');
const f = JSON.parse(fs.readFileSync('../tmp/public-live-package/fixture.json', 'utf8')) as {
  prefix: string; eid: string; control: string; pid: string; cid: string; bindingId: string;
  users: Record<string,string>; adminIds: Record<string,string>; actor: ActorContext; visitor: ActorContext;
};
assert.equal(f.eid, '1454'); assert.ok(f.prefix.startsWith('synthetic-public-live-'));
const output = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/public-live-package/delivery-service01');
assert.ok(!fs.existsSync(path.join(output, 'report.json')), 'Preserve original attempts');
fs.mkdirSync(output, { recursive: true });
const report: { checks: Row[]; before?: unknown; baseline?: unknown; final?: unknown; passed?: boolean; error?: string; drift?: string[]; cleanup?: unknown } = { checks: [] };
const save = () => fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
const caller = { enterpriseId: f.eid, adminId: f.adminIds.enterprise_admin };
const staff = new PublicLiveService(caller), owner = new PublicLiveCustomer(f.actor, f.cid);
const conversation = new ConversationService(f.actor);
const counts = () => withTenantTransaction(f.eid, async tx => ({
  messages: Number((await one(tx, sql`select count(*) n from app.assistant_messages where enterprise_id=${f.eid} and conversation_id=${f.cid} and purpose='construction.public.live'`))!.n),
  outbox: Number((await one(tx, sql`select count(*) n from app.domain_event_outbox where enterprise_id=${f.eid} and type='construction.public.live.v1'`))!.n),
  deliveries: Number((await one(tx, sql`select count(*) n from app.domain_event_deliveries where enterprise_id=${f.eid} and consumer_key=${'public-live:user:' + f.users.owner}`))!.n),
  conversations: Number((await one(tx, sql`select count(*) n from app.assistant_conversations where enterprise_id=${f.eid}`))!.n),
  runs: Number((await one(tx, sql`select count(*) n from app.assistant_runs where enterprise_id=${f.eid}`))!.n),
  jobs: Number((await one(tx, sql`select count(*) n from app.assistant_jobs where enterprise_id=${f.eid}`))!.n),
  visibleGlobalUsers: Number((await one(tx, sql`select count(*) n from app.users where id=${f.users.owner}`))!.n),
}));
async function step(name: string, work: () => Promise<unknown>) {
  assert.deepEqual(comparePublicLive(report.before), [], 'Source/config drift before next check');
  try { report.checks.push({ name, passed: true, data: await work() }); }
  catch (e) { report.checks.push({ name, passed: false, error: e instanceof Error ? e.stack : String(e) }); throw e; }
  finally { save(); console.log(name + ': ' + (report.checks.at(-1)?.passed ? 'PASS' : 'FAIL')); }
}
async function messageReceipt() {
  const view = await staff.read(f.pid), live = view.material;
  assert.ok(live);
  const cards = await owner.read(), card = cards.items.find(c => c.id === live.id);
  assert.ok(card); assert.notEqual(card.messageId, 'null');
  const stored = await withTenantTransaction(f.eid, tx => one(tx, sql`select id,conversation_id,author_kind,purpose,content from app.assistant_messages where enterprise_id=${f.eid} and id=${card.messageId}`));
  assert.ok(stored); assert.equal(String(stored.conversation_id), f.cid); assert.equal(stored.purpose, 'construction.public.live'); assert.equal(stored.author_kind, 'system');
  const visible = await conversation.messages(f.cid);
  assert.ok(visible.items.some(m => String(m.id) === card.messageId), 'Actual owner message projection must contain the card destination');
  return { live, card, message: stored };
}
async function main() {
  report.before = bindPublicLive(['admin/scripts/public-live-delivery-check.ts', 'admin/src/lib/construction/public-live/store.ts', 'admin/src/lib/construction/public-live/service.ts', 'admin/src/lib/construction/public-live/customer.ts', 'tmp/public-live-package/fixture.json']);
  const baseline = await counts(); report.baseline = baseline; save();
  let state: Awaited<ReturnType<PublicLiveService['save']>>;
  try {
    await step('Real staff submit appends and owner reads the original-chat message; same key creates no duplicate', async () => {
      const view = await staff.read(f.pid);
      state = await staff.save(f.pid, { expectedRevision: view.revision, bindingId: f.bindingId, alias: '合成投递核验机位', name: '合成公开工地 · 原咨询投递核验' }, randomUUID());
      const body = { expectedRevision: state.revision, versionId: state.versionId }, key = randomUUID();
      state = await staff.mutate(f.pid, 'submit', body, key);
      const first = await messageReceipt(); assert.equal(first.live.status, 'pending_owner');
      assert.match(JSON.stringify(first.message.content), /团队想公开一路现场直播/);
      const after = await counts(); assert.equal(after.messages, baseline.messages + 1); assert.equal(after.deliveries, baseline.deliveries + 1);
      assert.equal(after.visibleGlobalUsers, 0, 'Do not open the global users table');
      assert.deepEqual(await staff.mutate(f.pid, 'submit', body, key), state); assert.deepEqual(await counts(), after);
      await assert.rejects(new PublicLiveCustomer(f.visitor, f.cid).read());
      return { conversationId: f.cid, messageId: first.card.messageId, status: state.status, sameKeyMessagesAdded: 0, visibleGlobalUsers: 0 };
    });
    await step('Owner decision, review and stop persist actual separate messages in the same consultation', async () => {
      let current = (await owner.read()).items[0];
      await owner.decide(current.id, 'preview', { expectedRevision: current.revision, versionId: current.versionId }, randomUUID());
      current = (await owner.read()).items[0];
      await owner.decide(current.id, 'approve', { expectedRevision: current.revision, versionId: current.versionId }, randomUUID());
      const approved = await messageReceipt(); assert.equal(approved.live.status, 'owner_approved');
      state = await staff.mutate(f.pid, 'publish', { expectedRevision: approved.live.revision, versionId: approved.live.versionId }, randomUUID());
      const published = await messageReceipt(); assert.equal(published.live.status, 'published');
      const key = randomUUID(), body = { expectedRevision: published.live.revision, versionId: published.live.versionId, reason: '合成投递核验结束' };
      state = await staff.mutate(f.pid, 'withdraw', body, key);
      const stopped = await messageReceipt(); assert.equal(stopped.live.status, 'withdrawn'); assert.equal(stopped.card.canDecide, false);
      const after = await counts(); assert.equal(after.messages, baseline.messages + 4); assert.equal(after.deliveries, baseline.deliveries + 4);
      assert.deepEqual(await staff.mutate(f.pid, 'withdraw', body, key), state); assert.deepEqual(await counts(), after);
      return { approvedMessage: approved.card.messageId, publishedMessage: published.card.messageId, stoppedMessage: stopped.card.messageId, conversationId: f.cid, sameKeyStopMessagesAdded: 0 };
    });
    await step('Cross-tenant access and lost original recipient fail closed; the whole failed event transaction rolls back', async () => {
      const before = await counts();
      await assert.rejects(new PublicLiveService({ ...caller, enterpriseId: f.control }).read(f.pid));
      for (const bad of ['recipient', 'tenant'] as const) {
        await assert.rejects(withTenantTransaction(f.eid, async tx => {
          const live = (await one(tx, sql`select * from app.construction_public_live where enterprise_id=${f.eid} and project_id=${f.pid} for update`))!;
          await liveEvent(tx, { ...live, revision: Number(live.revision) + 1000, ...(bad === 'recipient' ? { customer_id: f.users.visitor } : {}) }, 'submit', { ...siteActor(caller), ...(bad === 'tenant' ? { enterpriseId: f.control } : {}) });
        }), (e: unknown) => !!e && typeof e === 'object' && 'code' in e && e.code === (bad === 'recipient' ? 'public_live_owner_chat_required' : 'public_live_unavailable'));
        assert.deepEqual(await counts(), before);
      }
      assert.equal(before.conversations, baseline.conversations); assert.equal(before.runs, baseline.runs); assert.equal(before.jobs, baseline.jobs);
      return { recipientRejected: true, crossTenantRejected: true, rollbackVerified: true, conversationsAdded: 0, runsAdded: 0, jobsAdded: 0 };
    });
    report.passed = true;
  } catch (e) { report.passed = false; report.error = e instanceof Error ? e.stack : String(e); }
  finally {
    try {
      const live = (await staff.read(f.pid)).material;
      if (live && live.status !== 'withdrawn') await staff.mutate(f.pid, 'withdraw', { expectedRevision: live.revision, versionId: live.versionId, reason: '合成投递测试清理' }, randomUUID());
      report.cleanup = live ? await stopLiveProxies(f.eid, live.id) : { stopped: true };
    } catch (e) { report.cleanup = { stopped: false, error: e instanceof Error ? e.message : String(e) }; report.passed = false; }
    report.final = await counts(); report.drift = comparePublicLive(report.before); if (report.drift.length) report.passed = false;
    save(); await closePostgresPool();
  }
  if (!report.passed) process.exitCode = 1;
}
main().catch(async e => { report.passed = false; report.error = e instanceof Error ? e.stack : String(e); save(); await closePostgresPool(); process.exitCode = 1; });
