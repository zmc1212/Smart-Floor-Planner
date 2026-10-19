import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Focused C01 use of the established Stable CDP/SDK and memory-only journal. */
export async function run({ automationRoot, output, origin, customer }) {
  const load = createRequire(import.meta.url);
  const sdk = load(path.join(automationRoot, 'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator'));
  const { connect } = load(path.join(automationRoot, 'tmp/wechat-devtools-version-test/cdp.cjs'));
  const pwsh = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  const windowScript = path.join(automationRoot, 'tmp/wechat-devtools-version-test/window.ps1');
  const report = { started: new Date().toISOString(), checks: [], logicalViewport: [390, 844] };
  const save = () => fs.writeFileSync(path.join(output, 'native.json'), JSON.stringify(report, null, 2));
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function step(name, work) {
    try { const value = await work(); report.checks.push({ name, passed: true, result: value }); console.log(name + ': PASS'); return value; }
    catch (error) { report.checks.push({ name, passed: false, error: error.message }); throw error; }
    finally { save(); }
  }
  async function waitFor(read, label) {
    for (let i = 0; i < 180; i++) { const value = await read(); if (value) return value; await delay(500); }
    throw Error('Timed out: ' + label);
  }
  let mp, installed = false;
  const route = 'packages/assistant/chat/chat';
  async function stableEndpoint() {
    const targets = (await (await fetch('http://127.0.0.1:9431/json/list')).json()).filter(t => t.url.includes('electron-project.html'));
    assert.equal(targets.length, 1);
    const target = new URL(targets[0].url);
    assert.equal(path.win32.normalize(target.searchParams.get('projectpath')), path.win32.normalize(path.join(automationRoot, 'miniprogram')));
    assert.equal(target.searchParams.get('appVersion'), '2.02.2608080');
    return 'ws://127.0.0.1:' + target.searchParams.get('autoPort');
  }
  async function compile() {
    const endpoint = await stableEndpoint();
    const cdp = await connect('electron-project.html');
    try {
      const point = await cdp.evaluate(`(()=>{const b=[...document.querySelectorAll('[title="编译"]')].filter(e=>e.getBoundingClientRect().width>0);if(b.length!==1)throw Error('Compile action not unique');const r=b[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.call('Input.dispatchMouseEvent', { type, button: 'left', clickCount: 1, ...point });
      await delay(6000);
      return endpoint;
    } finally { cdp.close(); }
  }
  async function page() { const p = await mp.currentPage(); assert.equal(p.path, route); return p; }
  async function open() {
    await mp.redirectTo('/' + route + '?conversationId=' + customer.conversationId);
    return waitFor(async () => { const p = await page(), d = await p.data(); return !d.loading && !d.fatal && d.canSend ? p : null; }, 'C01 owned conversation reentry');
  }
  async function say(text) {
    const p = await page(); await (await p.$('.composer-input')).input(text);
    await waitFor(async () => await p.data('draft') === text, 'native composer value');
    await (await p.$('.send-button')).tap();
    return p;
  }
  async function settled(mode) {
    return waitFor(async () => { const p = await page(), d = await p.data();
      if (d.error && !d.busy && !d.pendingSend) throw Error(d.error);
      return !d.busy && !d.pendingSend && !d.draft && d.conversation?.mode === mode ? p : null;
    }, 'persisted mode ' + mode);
  }
  try {
    await step('existing Stable project, secondary window and no controller contention', async () => {
      const info = JSON.parse(cp.execFileSync(pwsh, ['-NoProfile', '-File', windowScript, '-Action', 'Inspect', '-IncludeHidden'], { encoding: 'utf8', windowsHide: true }));
      assert.equal(info.ProjectWindows, 1); assert.equal(info.OnSecondary, true);
      const productRoot = fileURLToPath(new URL('../../', import.meta.url));
      const clientFiles = cp.execFileSync('git', ['ls-files', 'miniprogram/packages/assistant', 'miniprogram/utils/assistant*', 'miniprogram/components/assistant*'], { cwd: productRoot, encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/);
      assert.ok(clientFiles.length > 0);
      for (const file of clientFiles) assert.equal(fs.readFileSync(path.join(productRoot, file), 'utf8').replace(/\r\n/g, '\n'), fs.readFileSync(path.join(automationRoot, file), 'utf8').replace(/\r\n/g, '\n'), 'Stable client differs: ' + file);
      report.clientSource = { files: clientFiles.length, logicallyIdentical: true };
      const active = cp.execFileSync(pwsh, ['-NoProfile', '-Command', '@(Get-NetTCPConnection -LocalPort 9420 -State Established -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8', windowsHide: true }).trim();
      assert.equal(Number(active), 0); return { projectWindows: info.ProjectWindows, onSecondary: info.OnSecondary };
    });
    await step('fresh Stable SDK at the approved390x844 baseline', async () => {
      let endpoint = await stableEndpoint(); mp = await sdk.connect({ wsEndpoint: endpoint });
      let info;
      try { info = await mp.systemInfo(); await (await mp.currentPage()).data(); }
      catch { await mp.disconnect(); endpoint = await compile(); mp = await sdk.connect({ wsEndpoint: endpoint }); info = await mp.systemInfo(); await (await mp.currentPage()).data(); }
      assert.equal(info.windowWidth, 390); assert.equal(info.windowHeight, 844);
      return { SDKVersion: info.SDKVersion, logical: [info.windowWidth, info.windowHeight] };
    });
    await step('owned real HTTP routes and memory-only synthetic session', async () => {
      await mp.evaluate((identity, backendOrigin) => {
        const app = getApp(); if (app.__qaShared || app.__qaMaterials || app.__qaC05 || app.__qaHandoffCancel) throw Error('Another native test is active');
        const s = { request: wx.request, getStorageSync: wx.getStorageSync, setStorageSync: wx.setStorageSync, removeStorageSync: wx.removeStorageSync,
          token: app.globalData.token, bootstrap: app.globalData.bootstrap, hydrate: app.hydrateStoredSession, memory: new Map(), requests: [], dropNext: false };
        app.__qaHandoffCancel = s; app.hydrateStoredSession = async () => {};
        wx.getStorageSync = k => s.memory.has(k) ? s.memory.get(k) : k === 'assistant-pending-v1' ? undefined : s.getStorageSync.call(wx, k);
        wx.setStorageSync = (k, v) => s.memory.set(k, v); wx.removeStorageSync = k => s.memory.delete(k);
        app.globalData.token = identity.token;
        app.globalData.bootstrap = { current: { mode: 'customer', role: 'user', context: { enterpriseId: identity.enterpriseId } } };
        s.memory.set('token', identity.token);
        wx.request = function (o) {
          const raw = String(o.url), index = raw.indexOf('/api/'), p = index < 0 ? '' : raw.slice(index), base = '/api/miniprogram/assistant';
          const allowed = p.startsWith(base + '/conversations/' + identity.conversationId + '/') || p === base + '/conversations/' + identity.conversationId
            || p === base + '/conversations' || (p === base + '/entry-context' && String(o.data?.conversationId) === identity.conversationId);
          if (!allowed) { o.fail?.({ errMsg: 'Synthetic-only transport refused request' }); return { abort() {} }; }
          const row = { path: p, method: o.method || 'GET', status: null, key: o.header?.['Idempotency-Key'] || o.header?.['idempotency-key'] || null,
            text: o.data?.content?.blocks?.[0]?.text || null };
          s.requests.push(row); const success = o.success;
          return s.request.call(wx, { ...o, url: backendOrigin + p, success(r) {
            row.status = r.statusCode;
            if (s.dropNext && o.method === 'POST' && p.endsWith('/messages') && r.statusCode >= 200 && r.statusCode < 300) {
              s.dropNext = false; row.lostReceipt = true; o.fail?.({ errMsg: 'Synthetic response-loss injection' }); return;
            }
            success?.(r);
          } });
        };
      }, customer, origin);
      installed = true; return { credentialsPersisted: false, businessEndpointsMocked: false };
    });
    await step('existing C01 waiting state and live composer', async () => {
      const p = await open(); assert.equal(await p.data('conversation.mode'), 'handoff_requested');
      assert.ok(await p.$('.composer-input')); return { mode: 'handoff_requested' };
    });
    await step('a refusal stays waiting through the original send path', async () => {
      await say('不要取消人工接待'); const p = await settled('handoff_requested');
      assert.ok(JSON.stringify(await p.data('messages')).includes('不要取消人工接待')); return { mode: 'handoff_requested' };
    });
    await step('committed cancellation with lost response keeps the original operation pending', async () => {
      await mp.evaluate(() => { getApp().__qaHandoffCancel.dropNext = true; }); await say('取消人工接待');
      await waitFor(async () => { const d = await (await page()).data(); return !d.busy && d.pendingSend && d.error; }, 'original uncertain send feedback');
      return { pendingOriginal: true };
    });
    await step('page reentry retains that pending operation without a replacement send', async () => {
      await mp.reLaunch('/pages/index/index'); const p = await open();
      assert.equal(await p.data('pendingSend'), true); assert.equal(await p.data('pendingText'), '取消人工接待');
      return { samePendingText: true };
    });
    await step('confirm-send recovers the same receipt and existing cancellation feedback', async () => {
      const p = await page(), buttons = await p.$$('button.notice-action'), confirm = [];
      for (const button of buttons) if (await button.text() === '确认发送结果') confirm.push(button);
      assert.equal(confirm.length, 1); await confirm[0].tap();
      const done = await settled('ai'); assert.ok(JSON.stringify(await done.data('messages')).includes('本次接续已结束，小K恢复回复。'));
      const attempts = await mp.evaluate(() => getApp().__qaHandoffCancel.requests.filter(r => r.text === '取消人工接待').map(r => ({ key: r.key, lostReceipt: r.lostReceipt, status: r.status })));
      assert.equal(attempts.length, 2); assert.ok(attempts[0].key); assert.equal(attempts[0].key, attempts[1].key);
      assert.equal(attempts[0].lostReceipt, true); return { sameKey: true, attempts: attempts.length, mode: 'ai' };
    });
    await step('cancelled state persists and uses the approved C01 composition', async () => {
      const p = await open(); assert.equal(await p.data('conversation.mode'), 'ai');
      await mp.callWxMethod('hideKeyboard'); await mp.screenshot({ path: path.join(output, 'native-cancelled.png') });
      return { mode: 'ai', screenshot: 'native-cancelled.png' };
    });
    await step('a new explicit request and cancellation remain available without a model', async () => {
      await say('请设计师接着聊'); await settled('handoff_requested');
      await say('不找设计师了'); await settled('ai'); return { requestThenCancel: true };
    });
    report.passed = true;
    return report;
  } finally {
    if (mp && installed) {
      report.transport = await mp.evaluate(() => {
        const app = getApp(), s = app.__qaHandoffCancel; if (!s) return { active: false };
        const requests = s.requests.map(({ path, method, status, lostReceipt }) => ({ path, method, status, lostReceipt }));
        wx.request = s.request; wx.getStorageSync = s.getStorageSync; wx.setStorageSync = s.setStorageSync; wx.removeStorageSync = s.removeStorageSync;
        app.globalData.token = s.token; app.globalData.bootstrap = s.bootstrap; app.hydrateStoredSession = s.hydrate;
        delete app.__qaHandoffCancel; return { active: false, requests };
      });
      try { await mp.reLaunch('/pages/index/index'); } catch { /* The original session/transport is already restored. */ }
    }
    if (mp) await mp.disconnect();
    report.finished = new Date().toISOString(); save();
  }
}
