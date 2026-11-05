/* eslint-disable @typescript-eslint/no-require-imports -- Loaded by the isolated tsx acceptance driver. */
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const cp = require('node:child_process'), crypto = require('node:crypto'), assert = require('node:assert/strict');

module.exports = async ({ root, output, actor, assistantHttp }) => {
  const project = path.join(root, 'miniprogram'), chatRoute = 'packages/assistant/chat/chat';

  const cli = require(path.join(root, 'admin/scripts/wechatide-native-client.ts')).wechatideNativeClient(project, output);
  const evidence = { scope: 'Unchanged approved C01 answer/source sheet; actual configured-model replies and authenticated stored webpage quote reentry, existing source handler; no root-gesture/optical claim', checks: [], requests: [], captures: [] };
  const save = () => fs.writeFileSync(path.join(output, 'native.json'), JSON.stringify(evidence, null, 2));
  const evaluate = async source => (await cli.call('automation_evaluate', { project, fnSource: source })).result.result;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (fn, label) => { const end = Date.now() + 40000; while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(400); } throw Error('Native timeout: ' + label); };

  const ticket = '/bootstrap-' + crypto.randomUUID(); let installed = false, used = false;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === ticket && !used) { used = true; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ uid: actor.uid, token: actor.token, port: server.address().port })); return; }
      if (req.headers.authorization !== 'Bearer ' + actor.token || !String(req.url).startsWith('/api/miniprogram/assistant/')) { res.writeHead(403); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const request = new Request('http://localhost' + req.url, { method: req.method, headers: req.headers,
        ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
      const response = await assistantHttp(request, req.url.split('?')[0].slice('/api/miniprogram/assistant/'.length).split('/'));
      const bytes = Buffer.from(await response.arrayBuffer());
      evidence.requests.push({ path: req.url, status: response.status, method: req.method,
        ...(req.url.includes('/images/') && response.ok ? { bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') } : {}) });
      save(); res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(bytes);
    } catch (e) { evidence.serverError = String(e); save(); res.writeHead(503); res.end(); }
  });
  const capture = async (name, route) => {
    assert.equal((await cli.pageStack()).at(-1).path, route); await pause(250);
    const file = path.join(output, name + '.png'); await cli.screenshot({ path: file });
    const bytes = fs.readFileSync(file); evidence.captures.push({ file, route, logical: [390, 844], encoded: [bytes.readUInt32BE(16), bytes.readUInt32BE(20)] }); save();
  };
  const enterChat = async () => {
    await cli.reLaunch('/' + chatRoute + '?conversationId=' + actor.cid);
    return wait(async () => { const p = await cli.currentPage(), d = await p.data(); return p.path === chatRoute && !d.loading && !d.fatal && d.conversation?.id === actor.cid && d.messages.some(m => (m.citations || []).some(c => c.id === actor.citation.id)) ? p : null; }, 'persisted cited public answer');
  };

  try {
    const listed = (await cli.call('project_list')).projects.filter(p => path.resolve(p.projectPath).toLowerCase() === project.toLowerCase()); assert.ok(listed.length);
    const pwsh = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
    const placement = JSON.parse(cp.execFileSync(pwsh, ['-NoProfile', '-File', path.join(root, 'admin/scripts/wechatide-window-state.ps1')], { encoding: 'utf8', windowsHide: true }));
    const windows = placement.Windows.filter(w => w.Title === 'miniprogram'); assert.equal(windows.length, 1);
    const bounds = windows[0].Minimized ? windows[0].NormalBounds : windows[0].Bounds, x = (bounds.Left + bounds.Right) / 2, y = (bounds.Top + bounds.Bottom) / 2;
    assert.ok(placement.Screens.some(s => !s.Primary && x >= s.Bounds.X && x < s.Bounds.X + s.Bounds.Width && y >= s.Bounds.Y && y < s.Bounds.Y + s.Bounds.Height)); evidence.placement = placement;
    evidence.status = await cli.call('check_wechatide_status', { skillVersion: '0.3.11' }); assert.equal(evidence.status.loginExpired, false);
    await cli.call('simulator_refresh', { project }); await pause(1800);
    try { evidence.systemInfo = await cli.systemInfo(); }
    catch (e) { evidence.initialRuntimeFailure = String(e); await cli.call('simulator_refresh', { project }); await pause(1800); evidence.systemInfo = await cli.systemInfo(); }
    assert.equal(evidence.systemInfo.windowWidth, 390); assert.equal(evidence.systemInfo.windowHeight, 844); assert.equal(evidence.systemInfo.SDKVersion, '3.17.2');
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    await evaluate(`function(){const app=getApp();if(Object.keys(app).some(k=>/^__qa/.test(k)))throw Error('Native controller already present');const p=getCurrentPages().at(-1);const s=app.__qaPublicProtocol={global:{...app.globalData},route:p.route,options:p.options||{},hydrate:app.hydrateStoredSession,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,request:wx.request,download:wx.downloadFile,memory:new Map()};wx.getStorageSync=function(k){return s.memory.has(k)?s.memory.get(k):String(k).startsWith('assistant-')?undefined:s.get.call(wx,k);};wx.setStorageSync=function(k,v){s.memory.set(k,v);};wx.removeStorageSync=function(k){s.memory.delete(k);};app.hydrateStoredSession=async function(){};}`); installed = true;
    await evaluate(`async function(){const app=getApp(),s=app.__qaPublicProtocol,v=await new Promise((resolve,reject)=>s.request.call(wx,{url:'http://127.0.0.1:${server.address().port}${ticket}',success:r=>resolve(r.data),fail:reject}));const context={mode:'customer',enterpriseId:'1454',enterpriseName:'微云'};s.port=v.port;app.globalData.token=v.token;app.globalData.userInfo={...context,id:v.uid,_id:v.uid,role:'user',nickname:'合成测试·公开来源',phone:'synthetic'};app.globalData.bootstrap={current:{mode:'customer',role:'user',context,capabilities:['customer.service','account']},badges:{status:'ok',counts:{}}};app.globalData.sessionHydrated=true;app.globalData.sessionRecovery=null;app.globalData.sessionHydrating=false;app.globalData.sessionHydrationPromise=Promise.resolve();app.globalData.customerTab='xiaok';s.memory.set('token',v.token);s.memory.set('userInfo',app.globalData.userInfo);const redirect=o=>{const t=String(o.url),i=t.indexOf('/api/'),suffix=i<0?'':t.slice(i);if(!suffix.startsWith('/api/miniprogram/assistant/'))throw Error('Synthetic public-source acceptance denies unrelated API');return{...o,url:'http://127.0.0.1:'+s.port+suffix};};wx.request=function(o){try{return s.request.call(wx,redirect(o));}catch(e){o.fail&&o.fail({errMsg:String(e)});return{abort(){}};}};wx.downloadFile=function(o){try{return s.download.call(wx,redirect(o));}catch(e){o.fail&&o.fail({errMsg:String(e)});return{abort(){}};}};return true;}`);
    await enterChat(); await capture('chat-public-answer', chatRoute);
    const readSource = async () => {
      await evaluate(`function(){return getCurrentPages().at(-1).openCitation({currentTarget:{dataset:{id:'${actor.citation.id}'}}});}`);
      return wait(async () => { const p=await cli.currentPage(),d=await p.data();return d.citation?.id===actor.citation.id&&!d.citationLoading&&d.citation.available?d.citation:null; },'authenticated original source');
    };
    let source=await readSource();assert.equal(source.quote,actor.citation.quote);assert.equal(source.sourceUrl,actor.citation.sourceUrl);
    assert.equal(source.version,actor.citation.version);await capture('public-original-source',chatRoute);
    evidence.checks.push({actualPublicAnswer:true,originalQuoteAndUrl:true,sourceHash:source.version,passed:true});save();
    await enterChat();source=await readSource();assert.equal(source.quote,actor.citation.quote);assert.equal(source.version,actor.citation.version);
    await capture('public-source-reentry',chatRoute);evidence.checks.push({persistedReentry:true,sameStoredOriginal:true,passed:true});evidence.passed=true;
  } catch (e) { evidence.passed = false; evidence.error = e.stack || String(e); }
  finally {
    try {
      if (installed) {
        const old = await evaluate(`function(){const app=getApp(),s=app.__qaPublicProtocol;if(!s)return null;const p=getCurrentPages().at(-1);if(p.designerCardMedia)p.designerCardMedia.clear();if(p.controller&&p.controller.hide)p.controller.hide();const old={route:s.route,options:s.options};wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;wx.request=s.request;wx.downloadFile=s.download;app.hydrateStoredSession=s.hydrate;for(const k of Object.keys(app.globalData))delete app.globalData[k];Object.assign(app.globalData,s.global);delete app.__qaPublicProtocol;return old;}`);
        if (old) await cli.reLaunch('/' + old.route + '?' + new URLSearchParams(old.options));
      }
      evidence.cleanup = true;
    } catch (e) { evidence.cleanupError = String(e); evidence.passed = false; }
    if (server.listening) await new Promise(resolve => server.close(resolve)); save();
  }
  return evidence;
};
