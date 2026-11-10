/** Native acceptance for XiaoK incremental conversation sync on 2026-11-10:
 * silent re-entry, one metadata read per 7 s idle tick, delta append with
 * path-level setData, older-page coexistence, backlog/timeout/special-message
 * fallbacks and the server `reset` contract. Real 3006 service, real Worker,
 * Stable DevTools. Uses one clearly labelled synthetic customer conversation and
 * restores every fixture row, app global and storage key afterwards. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SignJWT } from 'jose';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction, withTenantTransaction } from '@/db/transaction';
import { one, rows, type Row } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { wechatideNativeClient } from './wechatide-native-client';

loadEnvConfig(process.cwd(), true);
assert.ok(process.argv.includes('--development'), 'Development only');
const root = path.resolve('..'), eid = '1454', customerId = '645';
const baseOutput = path.resolve(process.argv.find(a => a.startsWith('--output='))?.slice(9) || '../tmp/xiaok-incremental-sync-20261110');
const round = (() => {
  for (let index = 1; index < 100; index += 1) {
    const dir = path.join(baseOutput, 'round-' + String(index).padStart(2, '0'));
    if (!fs.existsSync(path.join(dir, 'report.json'))) return dir;
  }
  throw new Error('Too many acceptance rounds');
})();
const target = new URL(process.env.DATABASE_URL!);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '5432' && target.pathname === '/smart_floor_planner', 'Development database only');
fs.mkdirSync(round, { recursive: true });
const project = path.join(root, 'miniprogram');
const mp = wechatideNativeClient(project, round);
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const title = '增量同步验收-' + path.basename(round) + '-' + Date.now();
const report: Row = { startedAt: new Date().toISOString(), enterpriseId: eid, customerId, scope: 'incremental conversation sync', checks: [], failures: [], notes: [] };
const save = () => fs.writeFileSync(path.join(round, 'report.json'), JSON.stringify(report, null, 2));
const tenantOne = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => one(tx, q));
const tenantRows = (q: ReturnType<typeof sql>) => withTenantTransaction(eid, tx => rows(tx, q));
const platformOne = (q: ReturnType<typeof sql>) => withPlatformTransaction(tx => one(tx, q));

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { recursive: true, withFileTypes: true })
    .filter(e => e.isFile()).map(e => (dir + '/' + path.relative(path.join(root, dir), path.join(e.parentPath, e.name))).replaceAll('\\', '/'));
}
const bind = () => Object.fromEntries([...new Set([
  ...walk('miniprogram/packages/assistant'), ...walk('miniprogram/utils'), ...walk('admin/src/lib/assistant'),
  'admin/src/lib/construction/reminders.ts', 'admin/src/lib/construction/site-plans.ts',
  'admin/src/lib/construction/site-publications.ts', 'admin/src/lib/construction/public-projections.ts',
  'docs/xiaok-assistant-message-sync-contract.zh-CN.md', 'admin/scripts/xiaok-incremental-sync-acceptance-20261110.ts',
  'admin/scripts/wechatide-native-client.ts',
].sort())].map(f => [f, createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex')]));
const before = bind();
report.bindingBefore = createHash('sha256').update(JSON.stringify(before)).digest('hex');
save();

async function step(name: string, fn: () => Promise<unknown>) {
  const started = Date.now();
  try {
    const data = await fn();
    (report.checks as Row[]).push({ name, passed: true, elapsedMs: Date.now() - started, data }); console.log(name + ': PASS'); save(); return data;
  } catch (e) {
    (report.checks as Row[]).push({ name, passed: false, elapsedMs: Date.now() - started, error: (e as Error).message });
    (report.failures as Row[]).push({ name, error: (e as Error).stack || (e as Error).message }); save(); throw e;
  }
}
async function waitFor<T>(label: string, fn: () => Promise<T | undefined | false>, timeoutMs: number, intervalMs = 500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn(); if (value) return value; await delay(intervalMs);
  }
  throw new Error(label + ' timed out after ' + Math.round(timeoutMs / 1000) + 's');
}
const evaluate = async <T>(source: string, ...args: unknown[]): Promise<T> => {
  const r = await mp.call('automation_evaluate', { project, fnSource: source, args });
  return r.result.result as T;
};

async function waitState(label: string, predicate: (state: Row) => boolean, timeoutMs: number, intervalMs = 500) {
  const started = Date.now();
  let last: Row | undefined;
  while (Date.now() - started < timeoutMs) {
    last = await evaluate<Row>(PAGE);
    if (predicate(last)) return last;
    await delay(intervalMs);
  }
  throw new Error(label + ' timed out: ' + JSON.stringify({ count: last && last.count, cursor: last && last.cursor,
    lastSeq: last && last.lastSeq, busy: last && last.busy, loading: last && last.loading, error: last && last.error,
    controller: last && last.controller, life: last && (last.life as Row[]).slice(-10),
    requests: last && (last.requests as Row[]).slice(-8) }));
}

const PAGE = `() => {
  const app = getApp(), p = getCurrentPages().at(-1), d = p ? p.data : {};
  return {
    route: p ? p.route : null, now: Date.now(),
    loading: !!d.loading, busy: !!d.busy, error: d.error || '', fatal: !!d.fatal, needsLogin: !!d.needsLogin,
    conversationId: d.conversation ? String(d.conversation.id) : '',
    lastSeq: d.conversation && d.conversation.lastSeq !== undefined && d.conversation.lastSeq !== null ? String(d.conversation.lastSeq) : null,
    scrollTarget: d.scrollTarget || '', cursor: d.messageCursor === undefined || d.messageCursor === null ? null : String(d.messageCursor),
    ids: (d.messages || []).map(m => String(m.id)), seqs: (d.messages || []).map(m => String(m.seq)),
    consentIds: (d.messages || []).filter(m => m.publicConsent).map(m => String(m.id)),
    patches: p && p.__syncSetter ? p.__syncSetter.patches : [],
    requests: app.__syncProbe ? app.__syncProbe.requests : [], probeInstalled: !!(app.__syncProbe && app.__syncProbe.installed),
    mark: app.__syncProbe && app.__syncProbe.mark ? Number(app.__syncProbe.mark) : 0,
    stack: getCurrentPages().map(page => page.route), stackLength: getCurrentPages().length,
    pageProbe: !!(p && p.__syncSetter), origin: !!(p && p.__syncOrigin),
    life: p && p.__lifeLog ? p.__lifeLog : [],
    controller: p && p.controller ? { visible: p.controller.visible, ready: p.controller.ready, busy: !!p.controller.state.busy,
      conversationId: p.controller.conversationId, epoch: p.controller.epoch, timer: !!p.controller.timer,
      latestSeq: p.controller.latestSeq, seqConversationId: p.controller.seqConversationId,
      lastFullSyncAt: p.controller.lastFullSyncAt, run: p.controller.state.run ? p.controller.state.run.status : null } : null,
    count: (d.messages || []).length,
  };
}`;

const MEASURE = `() => {
  const app = getApp();
  try {
    const query = wx.createSelectorQuery();
    let offset = null, end = null;
    query.select('.conversation-scroll').scrollOffset(res => { offset = res ? Number(res.scrollTop) : null; });
    query.select('#conversation-end').boundingClientRect(res => { end = res ? Number(res.top) : null; });
    query.exec(() => { app.__syncScroll = { at: Date.now(), scrollTop: offset, endTop: end }; });
    return { started: true };
  } catch (error) {
    app.__syncScroll = { at: Date.now(), scrollTop: null, endTop: null, error: String((error && error.message) || error) };
    return { started: false };
  }
}`;

const READ_MEASURE = `() => getApp().__syncScroll || null`;

const RESET = `() => {
  const app = getApp(); const p = getCurrentPages().at(-1);
  if (app.__syncProbe) { app.__syncProbe.requests = []; app.__syncProbe.mark = Date.now(); }
  if (p && p.__syncSetter) p.__syncSetter.patches = [];
  if (p && p.__lifeLog) p.__lifeLog.length = 0;
  return true;
}`;

const INSTALL_PAGE = `() => {
  const p = getCurrentPages().at(-1);
  if (!p || p.route !== 'packages/assistant/chat/chat') return { ok: false, route: p ? p.route : null };
  p.__syncOrigin = true;
  const c = p.controller;
  if (c && !c.__lifeProbe) {
    c.__lifeProbe = p.__lifeLog = [];
    ['show', 'refresh', 'snapshot', 'hide', 'scheduleConversation'].forEach(name => {
      const original = c[name].bind(c);
      c[name] = function (...args) {
        p.__lifeLog.push({ at: Date.now(), fn: name,
          arg: args[0] === undefined || args[0] === null ? null : typeof args[0] === 'object' ? 'object' : String(args[0]),
          bg: args[2] === undefined ? null : !!args[2], epoch: c.epoch, visible: c.visible, timer: !!c.timer });
        return original(...args);
      };
    });
  }
  if (!p.__syncSetter) {
    const original = p.setData;
    const log = p.__syncSetter = { patches: [] };
    p.setData = function (patch, callback) {
      if (patch && typeof patch === 'object') {
        const keys = Object.keys(patch);
        log.patches.push({ at: Date.now(), keys, loadingTrue: patch.loading === true,
          wholeList: Array.isArray(patch.messages), paths: keys.filter(key => /^messages\\[\\d+\\]$/.test(key)).length });
      }
      return original.call(p, patch, callback);
    };
  }
  return { ok: true, patches: p.__syncSetter.patches.length };
}`;


const ASSISTANT = '/api/miniprogram/assistant';
const isConversation = (r: Row, cid: string) => r.method === 'GET' && r.url.endsWith(ASSISTANT + '/conversations/' + cid);
const isMessages = (r: Row, cid: string) => r.method === 'GET' && r.url.includes(ASSISTANT + '/conversations/' + cid + '/messages');
const measure = async () => {
  await evaluate(MEASURE);
  await delay(500);
  return (await evaluate<Row>(READ_MEASURE)) || { scrollTop: null, endTop: null };
};

let fixtureId = '';
let sessionToken = '';
let baseUrl = '';
let screenshotCount = 0;

async function shot(name: string) {
  const file = path.join(round, name + '.png');
  await mp.screenshot({ path: file });
  screenshotCount += 1;
  report['shot-' + name] = { logical: [390, 844], bytes: fs.statSync(file).size };
  save();
  return file;
}
async function appendMessage(options: { seq: number; author: 'user' | 'assistant' | 'system'; text: string; purpose?: string; event?: number }) {
  const created = await tenantOne(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose,source_event_id)
    values(${eid},${Number(fixtureId)},${options.seq},${options.author},
      ${options.author === 'user' ? Number(customerId) : null},
      ${JSON.stringify({ version: 1, blocks: [{ type: 'text', text: options.text }] })}::jsonb,
      ${options.purpose || 'reply'},${options.event ?? null})
    returning id,seq`);
  await tenantOne(sql`update app.assistant_conversations set last_seq=${options.seq}, updated_at=now()
    where enterprise_id=${eid} and id=${Number(fixtureId)}`);
  return created!;
}
const conversationRow = async () => (await tenantOne(sql`select id,last_seq,(select count(*) from app.assistant_messages m
  where m.enterprise_id=c.enterprise_id and m.conversation_id=c.id) as messages
  from app.assistant_conversations c where c.enterprise_id=${eid} and c.id=${Number(fixtureId)}`))!;

async function cleanup() {
  const result: Row = { steps: [] };
  const attempt = async (name: string, fn: () => Promise<unknown>) => {
    try { result.steps.push({ name, ok: true, data: await fn() }); }
    catch (e) { result.steps.push({ name, ok: false, error: (e as Error).message }); }
  };
  await attempt('leave chat page', async () => { await mp.reLaunch('/pages/index/index'); return true; });
  await attempt('restore app session and request wrapper', async () => evaluate(`() => {
    const app = getApp(); const saved = app.__qaSyncSaved;
    if (saved) {
      app.globalData.token = saved.token; app.globalData.bootstrap = saved.bootstrap; app.globalData.userInfo = saved.userInfo;
      app.hydrateStoredSession = saved.hydrate;
      if (saved.request) wx.request = saved.request;
      if (saved.resume) wx.setStorageSync('assistant-active-conversation-v1', saved.resume);
      else wx.removeStorageSync('assistant-active-conversation-v1');
      if (saved.token) wx.setStorageSync('token', saved.token); else wx.removeStorageSync('token');
    } else wx.removeStorageSync('assistant-active-conversation-v1');
    delete app.__syncProbe; delete app.__qaSyncSaved;
    return true;
  }`));
  await attempt('delete synthetic conversation', async () => {
    if (!fixtureId) return { skipped: true };
    await withTenantTransaction(eid, async tx => {
      await tx.execute(sql`delete from app.assistant_messages where enterprise_id=${eid} and conversation_id=${Number(fixtureId)}`);
      await tx.execute(sql`delete from app.assistant_participants where enterprise_id=${eid} and conversation_id=${Number(fixtureId)}`);
      await tx.execute(sql`delete from app.domain_event_deliveries where enterprise_id=${eid} and consumer_key=${'construction:plan:' + fixtureId}`);
      await tx.execute(sql`delete from app.construction_links where enterprise_id=${eid} and conversation_id=${Number(fixtureId)}`);
      await tx.execute(sql`delete from app.assistant_conversations where enterprise_id=${eid} and id=${Number(fixtureId)}`);
    });
    const gone = await tenantOne(sql`select count(*) as n from app.assistant_conversations where enterprise_id=${eid} and id=${Number(fixtureId)}`);
    return { remaining: Number(gone!.n) };
  });
  await attempt('delete stale fixtures', async () => (await tenantOne(sql`select count(*) as n from app.assistant_conversations
    where enterprise_id=${eid} and title like ${'增量同步验收-%'}`))!.n);
  report.cleanup = result;
  report.bindingAfter = createHash('sha256').update(JSON.stringify(bind())).digest('hex');
  report.finishedAt = new Date().toISOString();
  save();
  return result;
}

async function main() {
  try {
    await step('preflight: Stable window, dev service, enterprise and identity', async () => {
      const info = await mp.systemInfo();
      if (info && info.windowWidth) {
        assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844);
      }
      const settings = (await platformOne(sql`select enabled,policy_version,retention_days from app.assistant_enterprise_settings where enterprise_id=${eid}`))!;
      assert.equal(settings.enabled, true, 'Assistant must be enabled for enterprise ' + eid);
      const user = (await platformOne(sql`select id,nickname,context_version from app.users where id=${customerId}`))!;
      const jobs = (await platformOne(sql`select count(*) filter (where status in ('queued','running')) as active from app.assistant_jobs`))!;
      report.queue = { activeJobs: Number(jobs.active) };
      return { logical: [info && info.windowWidth, info && info.windowHeight], policyVersion: Number(settings.policy_version),
        retentionDays: Number(settings.retention_days), customer: { id: String(user.id), contextVersion: Number(user.context_version) }, activeJobs: Number(jobs.active) };
    });

    await step('fixture: labelled synthetic conversation with 35 messages', async () => {
      const created = (await tenantOne(sql`insert into app.assistant_conversations(enterprise_id,purpose,status,mode,title,entry_snapshot,policy_version,context_revision,last_seq)
        values(${eid},'customer_consultation','open','ai',${title},${JSON.stringify({ kind: 'lead', id: '0' })}::jsonb,62,1,35) returning id`))!;
      fixtureId = String(created.id);
      const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
      await tenantOne(sql`insert into app.assistant_participants(enterprise_id,conversation_id,principal_kind,user_id,participant_role,grant_basis,status)
        values(${eid},${Number(fixtureId)},'user',${Number(customerId)},'owner',${JSON.stringify({ kind: 'self', contextVersion: version })}::jsonb,'active')`);
      await tenantOne(sql`insert into app.assistant_messages(enterprise_id,conversation_id,seq,author_kind,user_id,content,purpose)
        select ${eid},${Number(fixtureId)},g,case when g%2=1 then 'user' else 'assistant' end,
          case when g%2=1 then ${Number(customerId)}::bigint else null end,
          jsonb_build_object('version','1','blocks',jsonb_build_array(jsonb_build_object('type','text','text','验收消息 '||g))),
          'reply'
        from generate_series(1,35) g`);
      const state = await conversationRow();
      assert.equal(Number(state.last_seq), 35); assert.equal(Number(state.messages), 35);
      sessionToken = await new SignJWT({ sub: customerId, id: customerId, mode: 'customer', role: 'user', enterpriseId: eid,
        contextVersion: version, source: 'wechat' })
        .setProtectedHeader({ alg: 'HS256' }).setSubject(customerId).setIssuedAt().setAudience('miniprogram').setExpirationTime('2h')
        .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
      const response = await fetch('http://192.168.10.32:3006/api/miniprogram/assistant/conversations/' + fixtureId,
        { headers: { Authorization: 'Bearer ' + sessionToken } });
      assert.equal(response.status, 200, 'Service must expose the synthetic conversation');
      const envelope = await response.json() as Row;
      const detail = (envelope.data || {}) as Row;
      assert.equal(String(detail.id), fixtureId); assert.equal(String(detail.lastSeq), '35');
      assert.equal(detail.mode, 'ai');
      return { conversationId: fixtureId, messages: 35, lastSeq: 35, serviceLastSeq: String(detail.lastSeq), mode: detail.mode };
    });

    await step('customer session and request/setData probes installed', async () => {
      const version = Number((await platformOne(sql`select context_version from app.users where id=${customerId}`))!.context_version);
      const probe = await evaluate<Row>(`(f) => {
        const app = getApp();
        app.__qaSyncSaved = { token: app.globalData.token, bootstrap: app.globalData.bootstrap, userInfo: app.globalData.userInfo,
          hydrate: app.hydrateStoredSession, request: wx.request, resume: wx.getStorageSync('assistant-active-conversation-v1') };
        app.hydrateStoredSession = async () => {};
        app.globalData.token = f.token; app.globalData.userInfo = { _id: f.customerId, role: 'user' };
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', capabilities: ['customer.projects','customer.service','account'],
          context: { enterpriseId: f.enterpriseId } } };
        wx.setStorageSync('token', f.token);
        wx.removeStorageSync('assistant-active-conversation-v1');
        const log = app.__syncProbe = { requests: [], installed: false };
        const original = wx.request;
        const wrapped = function (options) {
          const url = String((options && options.url) || '');
          const data = (options && options.data) || {};
          log.requests.push({ at: Date.now(), method: String((options && options.method) || 'GET').toUpperCase(), url,
            afterSeq: data.afterSeq === undefined ? null : String(data.afterSeq),
            beforeSeq: data.beforeSeq === undefined ? null : String(data.beforeSeq),
            limit: data.limit === undefined ? null : Number(data.limit) });
          return original.call(wx, options);
        };
        wx.request = wrapped;
        log.installed = wx.request === wrapped;
        return { installed: log.installed, token: !!app.globalData.token };
      }`, { token: sessionToken, customerId, enterpriseId: eid });
      assert.equal(probe.installed, true, 'wx.request probe must wrap the runtime request');
      await mp.redirectTo('/packages/assistant/chat/chat?conversationId=' + fixtureId);
      const ready = await waitFor<Row>('chat entry', async () => {
        const now = await evaluate<Row>(PAGE);
        if (now.needsLogin) throw new Error('Customer session rejected: ' + now.error);
        return now.route === 'packages/assistant/chat/chat' && !now.loading && now.conversationId === fixtureId ? now : undefined;
      }, 120000, 800);
      const pageProbe = await evaluate<Row>(INSTALL_PAGE);
      assert.equal(pageProbe.ok, true, 'Page setData probe must install on the chat page');
      const requests = ready.requests as Row[];
      const conversation = requests.find(r => isConversation(r, fixtureId));
      assert.ok(conversation, 'Opening the chat must read the conversation');
      baseUrl = String(conversation!.url).slice(0, -('/conversations/' + fixtureId).length);
      report.baseUrl = baseUrl;
      assert.equal(String(ready.lastSeq), '35');
      assert.equal(ready.count, 30, 'First window is the latest 30 messages');
      assert.equal(String((ready.seqs as string[])[0]), '6');
      assert.equal(String((ready.seqs as string[]).at(-1)), '35');
      assert.equal(String(ready.cursor), '6');
      return { route: ready.route, count: ready.count, firstSeq: (ready.seqs as string[])[0], cursor: ready.cursor, requests: requests.length };
    });

    let baseline: Row | undefined;
    await step('baseline: rendered window, cursor and scroll position', async () => {
      const now = await evaluate<Row>(PAGE);
      const scroll = await measure();
      baseline = { ids: now.ids, seqs: now.seqs, scrollTop: scroll.scrollTop, endTop: scroll.endTop, scrollTarget: now.scrollTarget };
      await shot('01-baseline');
      const state = await conversationRow();
      assert.equal(Number(state.last_seq), 35, 'Reading must not append to the fixture conversation');
      return { count: now.count, scrollTop: scroll.scrollTop, endTop: scroll.endTop, scrollTarget: now.scrollTarget, lastSeq: Number(state.last_seq) };
    });

    await step('re-entry: silent sync keeps the rendered window and scroll', async () => {
      await evaluate(RESET);
      // Push a second chat instance so leaving and returning exercises the real
      // onHide/onShow path without relying on an unrelated page's own guards.
      await evaluate(`(f) => { wx.navigateTo({ url: '/packages/assistant/chat/chat?conversationId=' + f.id, fail: () => {} }); return true; }`, { id: fixtureId });
      await waitFor('second chat page', async () => (await evaluate<Row>(PAGE)).stackLength === 2, 30000, 500);
      await delay(1500);
      await evaluate(`() => { const app = getApp(); app.__syncProbe.mark = Date.now(); wx.navigateBack({ delta: 1, fail: () => {} }); return true; }`);
      let back: Row;
      try {
        back = await waitFor<Row>('chat re-entry', async () => {
          const now = await evaluate<Row>(PAGE);
          return now.stackLength === 1 && now.route === 'packages/assistant/chat/chat' && now.conversationId === fixtureId && now.origin ? now : undefined;
        }, 40000, 500);
      } catch (error) {
        const now = await evaluate<Row>(PAGE);
        throw new Error('chat re-entry failed: stack=' + JSON.stringify(now.stack) + ' route=' + now.route
          + ' conversationId=' + now.conversationId + ' loading=' + now.loading + ' count=' + now.count + ' error=' + now.error);
      }
      back = back!;
      await delay(2500);
      const after = await evaluate<Row>(PAGE);
      const scroll = await measure();
      const patches = after.patches as Row[];
      const requests = (after.requests as Row[]).filter(r => Number(r.at) >= Number(after.mark));
      const conversationReads = requests.filter(r => isConversation(r, fixtureId));
      const messageReads = requests.filter(r => isMessages(r, fixtureId));
      // The immediate silent re-sync lands within the first seconds; a later 7 s
      // tick may also fall inside this observation window.
      const early = conversationReads.filter(r => Number(r.at) - Number(after.mark) < 6000);
      const diagnostics = { stack: after.stack, pageProbe: after.pageProbe, loading: after.loading, fatal: after.fatal,
        error: after.error, count: after.count, scrollTarget: after.scrollTarget, patches: patches.length,
        conversationReads: conversationReads.length, early: early.length, messageReads: messageReads.length, mark: after.mark,
        life: (after.life as Row[]).filter(entry => Number(entry.at) >= Number(after.mark)).slice(-24), controller: after.controller };
      assert.equal(patches.some(p => p.loadingTrue), false, 'Silent re-entry must never flash the full-screen loader ' + JSON.stringify(diagnostics));
      assert.equal(patches.some(p => p.wholeList || p.paths), false, 'Silent re-entry must not rewrite the message list ' + JSON.stringify(diagnostics));
      assert.deepEqual(after.ids, baseline!.ids, 'Rendered message ids must be identical ' + JSON.stringify(diagnostics));
      assert.equal(after.scrollTarget, baseline!.scrollTarget, 'Scroll target must stay unchanged');
      if (baseline!.scrollTop !== null && scroll.scrollTop !== null)
        assert.ok(Math.abs(Number(scroll.scrollTop) - Number(baseline!.scrollTop)) <= 1, 'Scroll offset must be preserved');
      if (baseline!.endTop !== null && scroll.endTop !== null)
        assert.ok(Math.abs(Number(scroll.endTop) - Number(baseline!.endTop)) <= 2, 'Visible bottom edge must stay in place');
      assert.equal(early.length, 1, 'One immediate silent metadata read on re-entry ' + JSON.stringify(diagnostics));
      assert.equal(messageReads.length, 0, 'Re-entry must not re-fetch messages');
      assert.equal(back.loading, false);
      await shot('02-reentry');
      return { conversationReads: conversationReads.length, messageReads: messageReads.length,
        patches: patches.length, loadingFlash: false, scrollTop: scroll.scrollTop, baselineScrollTop: baseline!.scrollTop,
        endTop: scroll.endTop, baselineEndTop: baseline!.endTop, count: after.count, controller: after.controller };
    });

    await step('idle: one conversation request per 7 s and no message read', async () => {
      await evaluate(RESET);
      const start = Date.now();
      const atStart = await evaluate<Row>(PAGE);
      await delay(15500);
      const now = await evaluate<Row>(PAGE);
      const requests = now.requests as Row[];
      const conversationReads = requests.filter(r => isConversation(r, fixtureId));
      const messageReads = requests.filter(r => isMessages(r, fixtureId));
      const times = conversationReads.map(r => Number(r.at));
      const gaps = times.slice(1).map((at, index) => at - times[index]);
      assert.equal(atStart.controller && atStart.controller.timer, true,
        'The poll timer must be armed while the chat is visible: ' + JSON.stringify(atStart.controller));
      assert.ok(conversationReads.length >= 2 && conversationReads.length <= 3,
        'A 15.5 s idle window holds two or three 7 s ticks, got ' + conversationReads.length + ' controller=' + JSON.stringify(now.controller));
      assert.equal(messageReads.length, 0, 'Idle polling must not read messages');
      for (const gap of gaps) assert.ok(gap >= 6500 && gap <= 8500, 'Tick gap must be about 7 s, got ' + gap);
      save();
      return { windowMs: Date.now() - start, conversationReads: conversationReads.length, messageReads: messageReads.length, gaps };
    });

    await step('delta: two appended messages arrive as a path-level append', async () => {
      await evaluate(RESET);
      const first = await appendMessage({ seq: 36, author: 'user', text: '增量验收：客户新消息' });
      const second = await appendMessage({ seq: 37, author: 'assistant', text: '增量验收：小K新回复' });
      const now = await waitState('delta append', state => state.count === 32, 20000);
      const requests = (now.requests as Row[]).filter(r => isMessages(r, fixtureId));
      const deltas = requests.filter(r => r.afterSeq !== null);
      const full = requests.filter(r => r.afterSeq === null);
      const patches = (now.patches as Row[]).filter(p => p.paths || p.wholeList);
      assert.equal(deltas.length, 1, 'One delta request for a two-message append');
      assert.equal(String(deltas[0].afterSeq), '35');
      assert.equal(full.length, 0, 'A small append must not trigger a full read');
      const appendPatchRow = patches.find(p => p.paths === 2);
      assert.ok(appendPatchRow, 'Delta must reach setData as messages[n] paths');
      assert.equal(appendPatchRow!.wholeList, false, 'Path-level append must not ship the whole array');
      assert.ok((appendPatchRow!.keys as string[]).includes('messages[30]') && (appendPatchRow!.keys as string[]).includes('messages[31]'));
      assert.equal(String((now.ids as string[]).at(-2)), String(first.id));
      assert.equal(String((now.ids as string[]).at(-1)), String(second.id));
      assert.equal(String(now.lastSeq), '37');
      await shot('03-delta');
      return { afterSeq: '35', deltaRequests: deltas.length, fullReads: full.length, pathKeys: appendPatchRow!.keys, count: now.count, lastSeq: now.lastSeq };
    });

    await step('older page and delta merge without losing messages', async () => {
      await evaluate(RESET);
      await evaluate(`() => getCurrentPages().at(-1).olderMessages()`);
      const older = await waitState('older page', state => state.count === 37, 20000);
      assert.equal(String((older.seqs as string[])[0]), '1');
      assert.equal(older.cursor, null, 'Five older messages exhaust the cursor');
      const appended = await appendMessage({ seq: 38, author: 'user', text: '增量验收：上拉历史后的新消息' });
      const merged = await waitState('merge after older page', state => state.count === 38, 20000);
      const seqs = merged.seqs as string[];
      assert.deepEqual(seqs.slice(0, 5), ['1', '2', '3', '4', '5']);
      assert.equal(seqs.at(-1), '38');
      assert.equal(new Set(merged.ids as string[]).size, 38, 'No duplicate or lost messages');
      const messagesRequests = (merged.requests as Row[]).filter(r => isMessages(r, fixtureId));
      const delta = messagesRequests.filter(r => r.afterSeq !== null);
      assert.equal(delta.length, 1);
      assert.equal(String(delta[0].afterSeq), '37');
      const appendPatchRow = (merged.patches as Row[]).find(p => p.paths === 1);
      assert.ok(appendPatchRow, 'A tail append after an older page still uses a path-level setData');
      assert.ok((appendPatchRow!.keys as string[]).includes('messages[37]'));
      await shot('04-older-delta');
      return { count: merged.count, head: seqs.slice(0, 3), tail: seqs.slice(-2), afterSeq: '37', pathKeys: appendPatchRow!.keys };
    });

    await step('backlog over 200 falls back to a full window', async () => {
      await evaluate(RESET);
      await tenantOne(sql`update app.assistant_conversations set last_seq=838 where enterprise_id=${eid} and id=${Number(fixtureId)}`);
      const now = await waitState('backlog fallback', state => String(state.lastSeq) === '838', 20000);
      const requests = (now.requests as Row[]).filter(r => isMessages(r, fixtureId));
      const deltas = requests.filter(r => r.afterSeq !== null);
      const full = requests.filter(r => r.afterSeq === null && r.limit === 30);
      assert.equal(deltas.length, 0, 'A 800-sequence gap must not be requested as a delta');
      assert.equal(full.length, 1, 'Backlog must be pulled as one full window');
      assert.equal(now.count, 30);
      assert.equal(String((now.seqs as string[])[0]), '9');
      assert.equal(String((now.seqs as string[]).at(-1)), '38');
      const messages = (now.patches as Row[]).filter(p => p.wholeList);
      assert.ok(messages.length >= 1, 'A full window replaces the list');
      await shot('05-backlog');
      return { lastSeq: now.lastSeq, deltaRequests: deltas.length, fullReads: full.length, count: now.count, firstSeq: (now.seqs as string[])[0] };
    });

    await step('idle after the full window reads metadata only', async () => {
      await evaluate(RESET);
      await delay(7500);
      const now = await evaluate<Row>(PAGE);
      const requests = now.requests as Row[];
      assert.equal(requests.filter(r => isConversation(r, fixtureId)).length, 1);
      assert.equal(requests.filter(r => isMessages(r, fixtureId)).length, 0, 'A synced window must not be re-read while idle');
      return { conversationReads: 1, messageReads: 0 };
    });

    await step('special message type: public consent falls back to a full read', async () => {
      await evaluate(RESET);
      const consent = await appendMessage({ seq: 839, author: 'system', purpose: 'construction.public.consent', event: 3998,
        text: '团队整理了一份公开预览，想请你核对。是否公开，由你决定。' });
      const now = await waitState('consent fallback', state => String(state.lastSeq) === '839'
        && (state.ids as string[]).includes(String(consent.id)), 25000);
      const requests = (now.requests as Row[]).filter(r => isMessages(r, fixtureId));
      const deltas = requests.filter(r => r.afterSeq !== null);
      const full = requests.filter(r => r.afterSeq === null && r.limit === 30);
      assert.equal(deltas.length, 1, 'The delta is attempted first');
      assert.equal(String(deltas[0].afterSeq), '838');
      assert.equal(full.length, 1, 'A decision-bearing message must be re-projected by a full window');
      assert.ok((now.consentIds as string[]).includes(String(consent.id)), 'The pulled message carries publicConsent');
      assert.equal(now.count, 30);
      assert.equal(String((now.seqs as string[]).at(-1)), '839');
      await shot('06-public-consent');
      return { messageId: String(consent.id), afterSeq: '838', fullReads: full.length, consentIds: now.consentIds, count: now.count };
    });

    await step('sixty-second window forces a full re-projection', async () => {
      await evaluate(RESET);
      const started = await evaluate<Row>(PAGE);
      const fullSyncAt = Number(started.now);
      const stale = await waitState('stale full sync', state => (state.requests as Row[])
        .some(r => isMessages(r, fixtureId) && r.afterSeq === null), 80000, 1000);
      const full = (stale.requests as Row[]).filter(r => isMessages(r, fixtureId) && r.afterSeq === null);
      const elapsed = Number(full[0].at) - fullSyncAt;
      assert.ok(elapsed >= 59000, 'Stale fallback must wait for the 60 s window, got ' + elapsed + 'ms');
      const reads = (stale.requests as Row[]).filter(r => isMessages(r, fixtureId));
      assert.equal(reads.some(r => r.afterSeq !== null), false);
      const refreshed = stale as Row;
      assert.equal(refreshed.count, 30);
      assert.equal(String((refreshed.seqs as string[]).at(-1)), '839');
      return { elapsedMs: elapsed, fullReads: full.length, count: refreshed.count };
    });

    await step('delta resumes after a full sync', async () => {
      await evaluate(RESET);
      const added = await appendMessage({ seq: 840, author: 'assistant', text: '增量验收：全量同步后的新回复' });
      const now = await waitState('delta after full sync', state => (state.ids as string[]).includes(String(added.id)), 20000);
      const requests = (now.requests as Row[]).filter(r => isMessages(r, fixtureId));
      const deltas = requests.filter(r => r.afterSeq !== null);
      assert.equal(deltas.length, 1, 'A fresh full sync enables delta again');
      assert.equal(String(deltas[0].afterSeq), '839');
      assert.equal(String((now.ids as string[]).at(-1)), String(added.id));
      return { afterSeq: '839', count: now.count };
    });

    await step('delta burst pages through more than one window without loss', async () => {
      await evaluate(RESET);
      const created: Row[] = [];
      for (let seq = 841; seq <= 875; seq += 1) created.push(await appendMessage({ seq, author: seq % 2 ? 'user' : 'assistant', text: '突发验收消息 ' + seq }));
      const now = await waitState('burst delta', state => (state.ids as string[]).includes(String(created.at(-1)!.id)), 30000);
      const requests = (now.requests as Row[]).filter(r => isMessages(r, fixtureId));
      const deltas = requests.filter(r => r.afterSeq !== null);
      assert.equal(requests.filter(r => r.afterSeq === null).length, 0, 'A drained delta must not need a full read');
      assert.equal(deltas.length, 2, 'Thirty-five messages span two delta pages, got ' + deltas.length);
      assert.deepEqual(deltas.map(r => String(r.afterSeq)), ['840', '870']);
      const ids = now.ids as string[];
      assert.equal(ids.length, 65, 'Thirty rendered plus thirty-five appended');
      assert.equal(new Set(ids).size, 65);
      for (const item of created) assert.ok(ids.includes(String(item.id)), 'Burst message missing: ' + item.seq);
      const seqs = (now.seqs as string[]).map(Number);
      for (let index = 1; index < seqs.length; index += 1) assert.ok(seqs[index] > seqs[index - 1], 'Ascending order broken at ' + index);
      await shot('07-burst');
      return { deltas: deltas.map(r => String(r.afterSeq)), count: ids.length, firstSeq: seqs[0], lastSeq: seqs.at(-1) };
    });

    await step('server reset contract answers an ahead cursor with reset', async () => {
      const response = await fetch(baseUrl + '/conversations/' + fixtureId + '/messages?limit=30&afterSeq=900',
        { headers: { Authorization: 'Bearer ' + sessionToken } });
      assert.equal(response.status, 200, 'reset probe must reach the service');
      const envelope = await response.json() as Row;
      const body = (envelope.data || {}) as Row;
      assert.equal(body.reset, true, 'A cursor beyond last_seq must return reset');
      assert.equal((body.items || []).length, 0);
      assert.equal(String(body.latestSeq), '875');
      assert.equal(String(body.afterCursor), '900', 'Reset echoes the requested cursor');
      save();
      return { status: response.status, reset: body.reset, items: (body.items || []).length, latestSeq: String(body.latestSeq), afterCursor: String(body.afterCursor) };
    });

    await step('retention shrink keeps the client on a full window', async () => {
      await evaluate(RESET);
      await tenantOne(sql`delete from app.assistant_messages where enterprise_id=${eid} and conversation_id=${Number(fixtureId)} and seq>845`);
      await tenantOne(sql`update app.assistant_conversations set last_seq=845 where enterprise_id=${eid} and id=${Number(fixtureId)}`);
      const now = await waitState('shrink fallback', state => state.count === 30
        && String((state.seqs as string[]).at(-1)) === '845', 25000);
      const requests = (now.requests as Row[]).filter(r => isMessages(r, fixtureId));
      assert.equal(requests.filter(r => r.afterSeq !== null).length, 0, 'A cursor ahead of last_seq must not be sent as a delta');
      assert.equal(requests.filter(r => r.afterSeq === null).length, 1);
      assert.equal(String(now.lastSeq), '845');
      return { lastSeq: now.lastSeq, count: now.count, fullReads: 1, deltaReads: 0 };
    });

    (report.notes as Row[]).push({
      covered: ['silent re-entry', '7 s single metadata request', 'delta append with messages[n] setData', 'older page + delta merge',
        'backlog > 200', 'idle after full window', 'publicConsent special type', '60 s stale window', 'delta after full sync',
        'multi-window delta burst', 'server reset contract', 'retention shrink'],
      uncovered: ['physical device', 'BLE laser meter', 'real WeChat authorization/login', 'planDecision native fallback (requires a real construction plan in this conversation; covered by client unit tests)',
        'client reset:true branch reachability (cursor-ahead state is guarded by the backlog check before the delta call)'],
    });
  } finally {
    await cleanup();
    await mp.disconnect();
    await closePostgresPool();
  }
}

main().then(() => {
  const failed = (report.failures as Row[]).length;
  console.log('ACCEPTANCE ' + (failed ? 'FAILED' : 'PASSED') + ' checks=' + (report.checks as Row[]).length + ' screenshots=' + screenshotCount);
  process.exit(failed ? 1 : 0);
}).catch(async error => {
  console.error(error);
  try { await cleanup(); } catch { /* cleanup already attempted */ }
  await closePostgresPool();
  process.exit(1);
});
