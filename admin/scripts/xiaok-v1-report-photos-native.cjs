/* eslint-disable @typescript-eslint/no-require-imports -- Loaded by the bounded tsx service driver. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const crypto = require('node:crypto'), cp = require('node:child_process'), assert = require('node:assert/strict');

module.exports = async ({ root, output, actors, assistantHttp, withdraw }) => {
  const project = path.join(root, 'miniprogram'), route = 'packages/assistant/chat/chat';
  const cli = require(path.join(root, 'admin/scripts/wechatide-native-client.ts')).wechatideNativeClient(project, output);
  const evidence = { scope: 'Existing approved report/original-photo components; synthetic identities and loopback transport, real authenticated handlers', checks: [], requests: [], captures: [] };
  const file = path.join(output, 'native.json'), save = () => fs.writeFileSync(file, JSON.stringify(evidence, null, 2));
  const evaluate = async source => (await cli.call('automation_evaluate', { project, fnSource: source })).result.result;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => { const end = Date.now() + 40000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(400); } throw Error('Native timeout: ' + label); };
  const sessions = new Map(); let installed = false, failDetail = false;
  const server = http.createServer(async (req, res) => {
    try {
      if (sessions.has(req.url)) { const v = sessions.get(req.url); sessions.delete(req.url); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ...v, port: server.address().port })); return; }
      const actor = actors.find(a => req.headers.authorization === 'Bearer ' + a.token);
      if (!actor || !String(req.url).startsWith('/api/miniprogram/assistant/')) { res.writeHead(403); res.end(); return; }
      if (failDetail && /\/reports\/\d+\?/.test(req.url) && !req.url.includes('/projects/')) {
        failDetail = false; evidence.requests.push({ path: req.url, status: 503, fault: 'controlled actual HTTP failure' });
        res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, code: 'assistant_unavailable' })); return;
      }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await assistantHttp(request, req.url.split('?')[0].slice('/api/miniprogram/assistant/'.length).split('/'));
      const bytes = Buffer.from(await response.arrayBuffer());
      evidence.requests.push({ path: req.url, status: response.status, actor: actor.name, method: req.method,
        ...(req.url.includes('/media/') && response.ok ? { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } : {}) });
      save(); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes);
    } catch (e) { evidence.serverError = String(e); save(); res.writeHead(503); res.end(); }
  });
  const capture = async name => {
    assert.equal((await cli.pageStack()).at(-1).path, route); await pause(250);
    const target = path.join(output, name + '.png'); await cli.screenshot({ path: target });
    const b = fs.readFileSync(target); evidence.captures.push({ file: target, route, logical: [390, 844], encoded: [b.readUInt32BE(16), b.readUInt32BE(20)] }); save();
  };
  const tap = async (page, selector) => { const button = await page.$(selector); assert.ok(button, selector); await button.tap(); };
  const enter = async actor => {
    await cli.reLaunch('/' + route + (actor.name === 'customer' ? '?leadId=' + actor.leadId : '?followup=1'));
    await wait(async () => { const p = await cli.currentPage(); if (p?.path !== route) return; const d = await p.data(); return !d.loading && !d.fatal && !d.followupListLoading; }, 'original role entry');
    // The previously stopped root-menu gesture investigation is not repeated.
    await evaluate(`function(){return getCurrentPages().at(-1).selectFollowup({currentTarget:{dataset:{id:'${actor.bid}'}}});}`);
    return wait(async () => { const p = await cli.currentPage(), d = await p.data(); return d.followupContext?.bindingId === actor.bid && !d.followupLoading ? p : null; }, 'authorized private destination');
  };
  const original = async (page, actor) => {
    await tap(page, `button[data-record="${actor.record.id}"]`);
    const data = await wait(async () => { const d = await page.data(); return d.followupOriginal?.id === actor.record.id && Object.keys(d.followupOriginalPaths || {}).length ? d : null; }, 'authenticated photo download');
    const image = await page.$('.followup-original-layer .message-photo'); assert.ok(image);
    const current = await evaluate(`async function(){const p=getCurrentPages().at(-1),files=Object.values(p.data.followupOriginalPaths);return Promise.all(files.map(file=>new Promise(resolve=>wx.getImageInfo({src:file,success:r=>resolve({width:r.width,height:r.height}),fail:e=>resolve({error:e.errMsg})}))));}`);
    assert.ok(current.length && current.every(i => i.width > 0 && i.height > 0));
    return { data, images: current };
  };
  try {
    const listed = (await cli.call('project_list')).projects.filter(p => path.resolve(p.projectPath).toLowerCase() === project.toLowerCase()); assert.ok(listed.length);
    const pwsh = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
    const placement = JSON.parse(cp.execFileSync(pwsh, ['-NoProfile', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { encoding: 'utf8', windowsHide: true }));
    const windows = placement.Windows.filter(w => w.Title === 'miniprogram'); assert.equal(windows.length, 1);
    const b = windows[0].Minimized ? windows[0].NormalBounds : windows[0].Bounds, x = (b.Left + b.Right) / 2, y = (b.Top + b.Bottom) / 2;
    assert.ok(placement.Screens.some(s => !s.Primary && x >= s.Bounds.X && x < s.Bounds.X + s.Bounds.Width && y >= s.Bounds.Y && y < s.Bounds.Y + s.Bounds.Height)); evidence.placement = placement;
    evidence.status = await cli.call('check_wechatide_status', { skillVersion: '0.3.11' }); assert.equal(evidence.status.loginExpired, false);
    await cli.call('simulator_refresh', { project }); await pause(1800);
    try { evidence.systemInfo = await cli.systemInfo(); } catch (e) { evidence.initialRuntimeFailure = String(e); await cli.call('simulator_refresh', { project }); await pause(1800); evidence.systemInfo = await cli.systemInfo(); }
    assert.equal(evidence.systemInfo.windowWidth, 390); assert.equal(evidence.systemInfo.windowHeight, 844); assert.equal(evidence.systemInfo.SDKVersion, '3.17.2');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await evaluate(`function(){const app=getApp();if(Object.keys(app).some(k=>/^__qa/.test(k)))throw Error('Native controller already present');const p=getCurrentPages().at(-1);const s=app.__qaReportPhotos={global:{...app.globalData},route:p.route,options:p.options||{},hydrate:app.hydrateStoredSession,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,request:wx.request,download:wx.downloadFile,memory:new Map()};wx.getStorageSync=function(k){return s.memory.has(k)?s.memory.get(k):String(k).startsWith('assistant-')?undefined:s.get.call(wx,k);};wx.setStorageSync=function(k,v){s.memory.set(k,v);};wx.removeStorageSync=function(k){s.memory.delete(k);};app.hydrateStoredSession=async function(){};}`); installed = true;
    for (const actor of actors) {
      const ticket = '/identity/' + crypto.randomUUID(); sessions.set(ticket, actor);
      await evaluate(`async function(){const app=getApp(),s=app.__qaReportPhotos,v=await new Promise((resolve,reject)=>s.request.call(wx,{url:'http://127.0.0.1:${server.address().port}${ticket}',success:r=>resolve(r.data),fail:reject}));const mode=v.aid?'staff':'customer',context={mode,enterpriseId:'1454',enterpriseName:'微云',...(v.aid?{staffId:v.aid,staffRole:v.role}:{})};s.port=v.port;app.globalData.token=v.token;app.globalData.userInfo={...context,id:v.uid,_id:v.uid,role:v.aid?'staff':'user',nickname:'合成测试·照片报告',phone:'synthetic'};app.globalData.bootstrap={current:{mode,role:v.role,context,capabilities:v.aid?['account','construction','assistant.followup.self']:['customer.service','account']},badges:{status:'ok',counts:{}}};app.globalData.sessionHydrated=true;app.globalData.sessionRecovery=null;app.globalData.sessionHydrating=false;app.globalData.sessionHydrationPromise=Promise.resolve();app.globalData.customerTab='xiaok';s.memory.set('token',v.token);s.memory.set('userInfo',app.globalData.userInfo);const redirect=o=>{const t=String(o.url),i=t.indexOf('/api/'),suffix=i<0?'':t.slice(i);if(!suffix.startsWith('/api/miniprogram/assistant/'))throw Error('Synthetic photos deny unrelated API');return{...o,url:'http://127.0.0.1:'+s.port+suffix};};wx.request=function(o){try{return s.request.call(wx,redirect(o));}catch(e){o.fail&&o.fail({errMsg:String(e)});return{abort(){}};}};wx.downloadFile=function(o){try{return s.download.call(wx,redirect(o));}catch(e){o.fail&&o.fail({errMsg:String(e)});return{abort(){}};}};return true;}`);
      assert.equal(sessions.size, 0);
      let page;
      for (const report of actor.reports) {
        page = await enter(actor); await tap(page, `.followup-card-action[data-report="${report.reportId}"]`);
        await wait(async () => { const d = await page.data(); return d.followupDetail?.reportId === report.reportId && d.followupDetail.ready; }, 'saved report detail');
        const photo = await original(page, actor); await capture(actor.name + '-' + report.kind + '-original');
        evidence.checks.push({ actor: actor.name, kind: report.kind, reportId: report.reportId, recordId: actor.record.id, originalMediaId: actor.record.mediaId, renderedImages: photo.images, passed: true }); save();
      }
      if (actor.name === 'customer') {
        failDetail = true; await evaluate('function(){return getCurrentPages().at(-1).followups.sync();}');
        const failed = await page.data(); assert.equal(failed.followupOriginal, null); assert.deepEqual(failed.followupOriginalPaths, {}); assert.ok(failed.followupError);
        await evaluate('function(){return getCurrentPages().at(-1).followups.sync();}'); await original(page, actor);
        evidence.checks.push({ reportRevalidation503: true, privateFilesCleared: true, sameOriginalRecovered: true, passed: true });
      }
      if (actor.name === 'boss') {
        await withdraw(); await evaluate('function(){return getCurrentPages().at(-1).followups.sync();}');
        const revoked = await page.data(); assert.equal(revoked.followupDetail.available, true);
        assert.ok(!revoked.followupDetail.projects.some(p => p.id === actor.projectId));
        assert.equal(revoked.followupOriginal, null); assert.deepEqual(revoked.followupOriginalPaths, {});
        assert.equal(await page.$('.followup-original-layer'), null); await capture('boss-partial-withdrawal');
        evidence.checks.push({ partialWithdrawal: true, otherProjectReadable: true, privateOriginalAndFilesCleared: true, passed: true });
      }
    }
    for (const actor of actors) assert.ok(evidence.requests.some(r => r.actor === actor.name && r.sha256 === actor.record.normalizedHash));
    evidence.passed = true;
  } catch (e) { evidence.passed = false; evidence.error = e.stack || String(e); }
  finally {
    try {
      if (installed) {
        const old = await evaluate(`function(){const app=getApp(),s=app.__qaReportPhotos;if(!s)return null;const p=getCurrentPages().at(-1);if(p.followupMedia)p.followupMedia.clear();if(p.followups)p.followups.hide();const old={route:s.route,options:s.options};wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;wx.request=s.request;wx.downloadFile=s.download;app.hydrateStoredSession=s.hydrate;for(const k of Object.keys(app.globalData))delete app.globalData[k];Object.assign(app.globalData,s.global);delete app.__qaReportPhotos;return old;}`);
        if (old) await cli.reLaunch('/' + old.route + '?' + new URLSearchParams(old.options));
      }
      evidence.cleanup = true;
    } catch (e) { evidence.cleanupError = String(e); evidence.passed = false; }
    if (server.listening) await new Promise(resolve => server.close(resolve)); save();
  }
  return evidence;
};
