/* eslint-disable @typescript-eslint/no-require-imports -- The parent tsx runner loads the existing Stable CLI adapter. */
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), assert = require('node:assert/strict');

module.exports = async ctx => {
  const { root, output, actors } = ctx, project = path.join(root, 'miniprogram'), route = 'packages/assistant/chat/chat';
  const pwsh = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  const report = { scope: 'Stable scheduled reports on the approved private follow-up views with actual local service readback', checks: [], captures: [] };
  let cli, installed = false;
  const sessions = new Map(), delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const server = require('node:http').createServer((request, response) => {
    if (sessions.has(request.url)) {
      const value = sessions.get(request.url); sessions.delete(request.url);
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); return;
    }
    report.faultRequests = (report.faultRequests || 0) + 1;
    response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ success: false, code: 'assistant_unavailable', error: 'assistant_unavailable' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const save = () => fs.writeFileSync(path.join(output, 'native.json'), JSON.stringify(report, null, 2));
  const wait = async (fn, label, attempts = 45) => { for (let i = 0; i < attempts; i++) { const value = await fn(); if (value) return value; await delay(400); } throw Error(label + ' did not settle'); };
  const step = async (name, fn) => { try { const data = await fn(); report.checks.push({ name, passed: true, data }); console.log('native ' + name + ': PASS'); return data; }
    catch (e) { report.checks.push({ name, passed: false, error: e.stack }); throw e; } finally { save(); } };
  const page = () => wait(async () => { const p = await cli.currentPage(); return p?.path === route ? p : null; }, 'exact approved chat route');
  const tap = async (p, selector) => { const element = await p.$(selector); assert.ok(element, selector); await element.tap(); };
  const ready = (p, a) => wait(async () => { const d = await p.data(); return d.followupContext?.bindingId === a.bid && d.followupChat.conversation?.id === a.cid
    && !d.followupChat.loading && !d.followupLoading && !d.followupBusy && !d.followupPending ? d : null; }, 'exact saved private destination');
  const capture = async name => {
    assert.equal((await cli.pageStack()).at(-1).path, route); await delay(300);
    const file = path.join(output, name + '.png'); assert.ok(!fs.existsSync(file)); await cli.screenshot({ path: file });
    const bytes = fs.readFileSync(file); report.captures.push({ file, route, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }); save();
  };
  const evaluateSource = source => cli.call('automation_evaluate', { project, fnSource: source });
  const openWorkmanship = async (p, projectId, ownerDaily) => {
    if (ownerDaily) {
      await tap(p, '.followup-owner-detail-process .followup-text-action[data-project="' + projectId + '"]');
      return 'native tap';
    }
    // The generic sheet shares a class and project data with its record
    // buttons. Read the exact rendered source control, then run its bound
    // handler without relying on Stable's ambiguous compound selector tap.
    const buttons = await cli.evaluate(() => new Promise(resolve => {
      wx.createSelectorQuery().selectAll('.followup-detail-sheet .followup-text-action')
        .fields({ dataset: true, size: true }).exec(results => resolve(results[0]));
    }));
    const sources = buttons.filter(item => String(item.dataset.project) === projectId && !item.dataset.record && item.width > 0 && item.height > 0);
    assert.equal(sources.length, 1, 'Exact rendered workmanship control');
    const fn = () => getCurrentPages().at(-1).openReportSource({ currentTarget: { dataset: { project: '__PROJECT__' } } });
    await evaluateSource(fn.toString().replace('__PROJECT__', projectId));
    return 'verified rendered control and native handler';
  };
  const enter = async a => {
    await cli.reLaunch('/' + route + (a.name === 'customer' ? '?leadId=' + a.leadId : '?followup=1'));
    const p = await page();
    await wait(async () => { const d = await p.data(); return !d.loading && !d.fatal && !d.followupListLoading; }, 'existing role entry');
    // Reuse a named production handler. The stopped root-selector investigation
    // is not repeated or upgraded to a gesture acceptance claim.
    const fn = () => getCurrentPages().at(-1).selectFollowup({ currentTarget: { dataset: { id: '__BINDING__' } } });
    await evaluateSource(fn.toString().replace('__BINDING__', a.bid)); await ready(p, a); return p;
  };
  const identity = async a => {
    const ticket = '/session/' + require('node:crypto').randomUUID();
    sessions.set(ticket, { token: a.token, uid: a.uid, aid: a.aid, role: a.role, name: a.name, port: server.address().port });
    const fn = async () => {
      const app = getApp(), s = app.__qaLiveFollowups;
      const v = await new Promise((resolve, reject) => s.request.call(wx, { url: '__IDENTITY_URL__', method: 'GET', success: r => resolve(r.data), fail: reject }));
      const mode = v.name === 'customer' ? 'customer' : 'staff';
      const context = { mode, enterpriseId: '1454', enterpriseName: '微云', ...(mode === 'staff' ? { staffId: v.aid, staffRole: v.role } : {}) };
      s.port = v.port; app.globalData.token = v.token;
      app.globalData.userInfo = { ...context, id: v.uid, _id: v.uid, role: mode === 'customer' ? 'user' : 'staff', nickname: '合成测试·报告事实追问', phone: 'synthetic' };
      app.globalData.bootstrap = { current: { mode, role: mode === 'customer' ? 'user' : v.role, context,
        capabilities: mode === 'customer' ? ['customer.service', 'account'] : ['account', 'construction', 'assistant.followup.self'] }, badges: { status: 'ok', counts: {} } };
      app.globalData.sessionHydrated = true; app.globalData.sessionRecovery = null; app.globalData.sessionHydrating = false;
      app.globalData.sessionHydrationPromise = Promise.resolve(); app.globalData.customerTab = 'xiaok';
      s.memory.set('token', v.token); s.memory.set('userInfo', app.globalData.userInfo); return { installed: true };
    };
    const result = await evaluateSource(fn.toString().replace('__IDENTITY_URL__', 'http://127.0.0.1:' + server.address().port + ticket));
    assert.equal(result.result.result.installed, true); assert.equal(sessions.size, 0); return enter(a);
  };
  try {
    await step('one verified existing Stable window and fresh compilation', async () => {
      cli = require(path.join(root, 'admin/scripts/wechatide-native-client.ts')).wechatideNativeClient(project, output);
      cli.evaluate = async fn => (await evaluateSource(fn.toString())).result.result;
      report.argumentTransport = { argsFiles: false, credentials: 'one-use loopback memory only' };
      report.status = await cli.call('check_wechatide_status', { skillVersion: '0.3.11' }); assert.equal(report.status.loginExpired, false);
      assert.ok(['equal', 'agent_ahead'].includes(report.status.versionRelation));
      const projects = (await cli.call('project_list')).projects.filter(p => path.resolve(p.projectPath).toLowerCase() === project.toLowerCase());
      assert.ok(projects.length); assert.ok(projects.every(p => p.appId === JSON.parse(fs.readFileSync(path.join(project, 'project.config.json'))).appid));
      report.placement = JSON.parse(cp.execFileSync(pwsh, ['-NoProfile', '-File', path.join(root, 'tmp/wechat-devtools-version-test/window.ps1'), '-Action', 'Inspect', '-IncludeHidden'], { encoding: 'utf8', windowsHide: true }));
      report.savedPlacement = JSON.parse(cp.execFileSync(pwsh, ['-NoProfile', '-File', path.join(root, 'tmp/v1-02-conversation-list-visual/inspect-window.ps1')], { encoding: 'utf8', windowsHide: true }));
      assert.equal(report.placement.ProjectWindows, 1);
      assert.equal(report.savedPlacement.Handle, report.placement.Handle); assert.equal(report.savedPlacement.ProjectWindows, 1);
      assert.ok(report.placement.OnSecondary || report.savedPlacement.Minimized && report.savedPlacement.SavedOnSecondary);
      assert.equal(report.savedPlacement.ForegroundBefore, report.savedPlacement.ForegroundAfter);
      await cli.call('simulator_refresh', { project }); await delay(1800);
      try { report.systemInfo = await cli.systemInfo(); }
      catch (e) { report.initialRuntimeFailure = e.message; await cli.call('simulator_refresh', { project }); await delay(1800); report.systemInfo = await cli.systemInfo(); }
      assert.equal(report.systemInfo.windowWidth, 390); assert.equal(report.systemInfo.windowHeight, 844); assert.equal(report.systemInfo.SDKVersion, '3.17.2');
      assert.deepEqual(await cli.evaluate(() => Object.keys(getApp()).filter(k => /^__qa/.test(k))), []);
      return { existingWindow: true, compiled: true, rootGestures: 'not exercised' };
    });
    await step('memory-only local transport and exact original destinations', async () => {
      await cli.evaluate(() => {
        const app = getApp(); if (Object.keys(app).some(k => /^__qa/.test(k))) throw Error('Native controller already present');
        const s = { request: wx.request, download: wx.downloadFile, get: wx.getStorageSync, set: wx.setStorageSync, remove: wx.removeStorageSync,
          hydrate: app.hydrateStoredSession, saved: { ...app.globalData }, memory: new Map(), requests: [],
          openDocument: wx.openDocument, opened: [], downloads: [] };
        app.__qaLiveFollowups = s; app.hydrateStoredSession = async () => {};
        wx.getStorageSync = k => s.memory.has(k) ? s.memory.get(k) : String(k).startsWith('assistant-') ? undefined : s.get.call(wx, k);
        wx.setStorageSync = (k, v) => s.memory.set(k, v); wx.removeStorageSync = k => s.memory.delete(k);
        wx.request = options => {
          const raw = String(options.url), at = raw.indexOf('/api/'), suffix = at < 0 ? '' : raw.slice(at), method = options.method || 'GET';
          if (!/^\/api\/(miniprogram\/(assistant\/(followups|entry-context|conversations|catalog)|bootstrap)|auth\/miniprogram|branding\/)/.test(suffix)
            || method !== 'GET' && !/^\/api\/miniprogram\/assistant\/(followups|entry-context)/.test(suffix)) { options.fail?.({ errMsg: 'Synthetic followup denied unrelated API' }); return { abort() {} }; }
          const item = { path: suffix, method, key: options.header?.['Idempotency-Key'], clientMessageId: options.data?.clientMessageId }; s.requests.push(item);
          return s.request.call(wx, { ...options, url: 'http://127.0.0.1:3006' + suffix,
            success(response) { item.status = response.statusCode; item.runId = response.data?.data?.runId; item.messageId = response.data?.data?.messageId; options.success?.(response); },
            fail(error) { item.status = 'network_failure'; options.fail?.(error); } });
        };
        wx.openDocument = options => {
          s.opened.push({ fileType: options.fileType, showMenu: options.showMenu });
          options.success?.({ errMsg: 'protocol observer only' });
        };
        wx.downloadFile = options => {
          const suffix = String(options.url).split('/api/')[1] || '';
          if (!/^miniprogram\/assistant\/followups\//.test(suffix)) { options.fail?.({ errMsg: 'Unexpected report media' }); return { abort() {} }; }
          return s.download.call(wx, { ...options, url: 'http://127.0.0.1:3006/api/' + suffix,
            success(response) { s.downloads.push(response.statusCode); options.success?.(response); } });
        };
      }); installed = true;
      return { credentialsPersisted: false, noSyntheticAnswer: true, rootSelectorRetries: 0 };
    });
    for (const a of actors) {
      await step(a.name + ' ' + a.bid + ' daily and weekly native details and reentry', async () => {
        const results = [];
        for (const expected of a.reports) {
          let p = await identity(a);
          const card = '.followup-card-action[data-report="' + expected.id + '"][data-revision="' + expected.revision + '"]';
          await wait(() => p.$(card), 'delivered report card');
          await tap(p, card);
          const detail = await wait(async () => {
            const d = (await p.data()).followupDetail;
            return d?.reportId === expected.id && Number(d.revision) === Number(expected.revision) && d.readAt ? d : null;
          }, 'rendered detail and persisted read receipt');
          assert.ok(await p.$('.followup-detail-title'));
          assert.equal(detail.projects.length, expected.body.length);
          for (const entry of expected.body) {
            const actual = detail.projects.find(project => project.id === entry.projectId);
            assert.ok(actual);
            assert.ok(actual.knowledgeSources.some(source => source.sourceId === entry.knowledgeSources[0].sourceId));
            assert.ok(JSON.stringify(actual).includes('请优先核对原记录中的这一项'));
          }
          if (a.name === 'customer') assert.ok(!JSON.stringify(detail).includes('蓝色工具箱'));
          await capture(a.name + '-' + a.bid + '-' + expected.kind);
          const first = expected.body[0], source = first.knowledgeSources[0];
          const sourceEntry = await openWorkmanship(p, first.projectId, a.name === 'customer' && expected.kind === 'daily');
          const quote = await wait(async () => {
            const d = await p.data();
            return d.reportSource?.available && !d.reportSourceLoading ? d.reportSource : null;
          }, 'authorized workmanship source');
          assert.equal(quote.id, source.sourceId);
          assert.ok(quote.quote && first.standards.some(item => item.citations.some(c => c.quote === quote.quote)));
          assert.equal(quote.originalAvailable, true);
          const before = await cli.evaluate(() => getApp().__qaLiveFollowups.opened.length);
          const originalButton = await wait(() => p.$('.sheet-panel .notice-action'), 'rendered original-file control', 12);
          await originalButton.tap();
          const original = await wait(async () => {
            const observed = await cli.evaluate(() => {
              const s = getApp().__qaLiveFollowups;
              return { opened: s.opened, downloads: s.downloads };
            });
            return observed.opened[before] ? { ...observed.opened[before], status: observed.downloads[before] } : null;
          }, 'authenticated original download and viewer dispatch');
          assert.deepEqual(original, { fileType: 'pdf', showMenu: false, status: 200 });
          // Reopen the same real report after a fresh native route entry.
          p = await enter(a);
          await wait(() => p.$(card), 'persisted report card');
          await tap(p, card);
          const reopened = await wait(async () => {
            const d = (await p.data()).followupDetail;
            return d?.reportId === expected.id && Number(d.revision) === Number(expected.revision) && d.readAt ? d : null;
          }, 'persisted report reentry');
          assert.deepEqual(reopened.projects.map(p => p.id), detail.projects.map(p => p.id));
          const result = { reportId: expected.id, kind: expected.kind, revision: expected.revision, source: source.sourceId, sourceEntry, original, reentry: true };
          results.push(result);
          (report.journeys ??= []).push({ audience: a.name, bindingId: a.bid, ...result });
          save(); console.log('native ' + a.name + ' ' + a.bid + ' ' + expected.kind + ' original and reentry: PASS');
        }
        return results;
      });
    }
    report.passed = true; return report;
  } catch (e) { report.passed = false; report.error = e.stack; try { if (cli) await capture('failure'); } catch (failure) { report.captureError = failure.message; } throw e; }
  finally {
    try {
      if (cli && installed) {
        report.restored = await cli.evaluate(() => {
          const app = getApp(), s = app.__qaLiveFollowups; if (!s) return false;
          for (const p of getCurrentPages()) { p.followupChatController?.hide(); p.followups?.hide(); p.controller?.hide(); }
          wx.request = s.request; wx.downloadFile = s.download; wx.openDocument = s.openDocument;
          wx.getStorageSync = s.get; wx.setStorageSync = s.set; wx.removeStorageSync = s.remove;
          app.hydrateStoredSession = s.hydrate; for (const k of Object.keys(app.globalData)) if (!(k in s.saved)) delete app.globalData[k];
          Object.assign(app.globalData, s.saved); delete app.__qaLiveFollowups;
          return { restored: true, requests: s.requests, downloads: s.downloads, viewerDispatches: s.opened };
        });
        await cli.reLaunch('/pages/index/index');
      }
    } catch (e) { report.cleanupError = e.stack; report.passed = false; throw e; }
    finally { await new Promise(resolve => server.close(resolve)); if (cli) await cli.disconnect(); save(); }
  }
};
