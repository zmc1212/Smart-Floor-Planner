import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);

/** Stable existing project/window only. Real element input, actual model/HTTP and in-memory transport journal. */
export async function run(ctx) {
  const { root, output, customer } = ctx, route = 'packages/assistant/chat/chat';
  const sdk = load(path.join(root,'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator'));
  const { connect } = load(path.join(root,'tmp/wechat-devtools-version-test/cdp.cjs'));
  const pwsh = 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  const report = { started: new Date().toISOString(), checks: [], passed: false }; let mp, installed = false;
  const save = () => fs.writeFileSync(path.join(output,'native.json'),JSON.stringify(report,null,2));
  const delay = ms => new Promise(r => setTimeout(r,ms));
  async function wait(read,label) { for(let i=0;i<240;i++){const v=await read();if(v)return v;await delay(500);}throw Error('Timed out: '+label); }
  async function step(name,work) { try { const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result; }
    catch(e){report.checks.push({name,passed:false,error:e.message});throw e;} finally{save();} }
  async function compile() {
    const targets=(await(await fetch('http://127.0.0.1:9431/json/list')).json()).filter(t=>t.url.includes('electron-project.html')); assert.equal(targets.length,1);
    const target=new URL(targets[0].url); assert.equal(path.win32.normalize(target.searchParams.get('projectpath')),path.win32.normalize(path.join(root,'miniprogram')));assert.equal(target.searchParams.get('appVersion'),'2.02.2608080');
    const c=await connect('electron-project.html');try{const point=await c.evaluate(`(()=>{const b=[...document.querySelectorAll('[title="编译"]')].filter(e=>e.getBoundingClientRect().width>0);if(b.length!==1)throw Error('Compile action not unique');const r=b[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});await delay(6000);return 'ws://127.0.0.1:'+target.searchParams.get('autoPort');
    }finally{c.close();}
  }
  async function open() { await mp.redirectTo('/'+route+'?conversationId='+customer.cid);return wait(async()=>{const p=await mp.currentPage();assert.equal(p.path,route);const d=await p.data();return !d.loading&&!d.fatal&&d.canSend&&d.conversation?.id===customer.cid?p:null;},'exact original consultation'); }
  async function capture(name) {
    const p=await mp.currentPage(),stack=await mp.evaluate(()=>getCurrentPages().map(p=>p.route));assert.equal(p.path,route);assert.equal(stack.at(-1),route);
    await(await p.$('.conversation-scroll')).scrollTo(0,100000);await delay(400);const target=path.join(output,name+'.png');await mp.screenshot({path:target});const b=fs.readFileSync(target);assert.equal(b.subarray(1,4).toString(),'PNG');
    return {route,stack,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)],target};
  }
  async function say(question,name) {
    const p=await mp.currentPage();assert.equal(p.path,route);const before=(await p.data('run'))?.id,started=Date.now();
    const input=await p.$('.composer-input');assert.ok(input);await input.input(question);await wait(async()=>(await p.data('draft'))===question,'native actual text input');
    await(await p.$('.send-button')).tap();const feedbackMs=Date.now()-started;
    const run=await wait(async()=>{const d=await p.data();if(d.error&&!d.busy&&!d.pendingSend)throw Error(d.error);return d.run?.id&&d.run.id!==before?d.run:null;},'real persisted run');
    const audited=await ctx.audit(run.id,name,started);
    await wait(async()=>{const d=await p.data();return !d.generating&&!d.busy&&!d.pendingSend&&d.messages.find(m=>m.id===audited.outputMessageId);},'native actual synthesis render');
    await mp.callWxMethod('hideKeyboard');return {runId:run.id,outputMessageId:audited.outputMessageId,feedbackMs,capture:await capture('native-'+name)};
  }
  try {
    await step('unique verified Stable project remains on the secondary monitor',async()=>{
      const info=JSON.parse(cp.execFileSync(pwsh,['-NoProfile','-File',path.join(root,'tmp/wechat-devtools-version-test/window.ps1'),'-Action','Inspect','-IncludeHidden'],{encoding:'utf8',windowsHide:true}));assert.equal(info.ProjectWindows,1);assert.equal(info.OnSecondary,true);
      const count=cp.execFileSync(pwsh,['-NoProfile','-Command','@(Get-NetTCPConnection -LocalPort 9420 -State Established -ErrorAction SilentlyContinue).Count'],{encoding:'utf8',windowsHide:true}).trim();assert.equal(Number(count),0);return info;
    });
    await step('fresh compilation then live SDK, viewport, nonempty page data and positive element queries',async()=>{
      let endpoint=await compile();mp=await sdk.connect({wsEndpoint:endpoint});let info;
      try{info=await mp.systemInfo();assert.ok(await(await mp.currentPage()).data());}catch{await mp.disconnect();endpoint=await compile();mp=await sdk.connect({wsEndpoint:endpoint});info=await mp.systemInfo();}
      assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);assert.equal(info.SDKVersion,'3.17.2');assert.ok((await(await mp.currentPage()).$$('view')).length);return{endpoint,SDKVersion:info.SDKVersion,logical:[390,844]};
    });
    await step('install synthetic-only real HTTP and in-memory session without saving credentials',async()=>{
      const value=await mp.evaluate(c=>{
        const app=getApp();if(app.__qaShared||app.__qaMaterials||app.__qaC05||app.__qaSynthesis)throw Error('Another controller is active');
        const s={request:wx.request,downloadFile:wx.downloadFile,uploadFile:wx.uploadFile,getStorageSync:wx.getStorageSync,setStorageSync:wx.setStorageSync,removeStorageSync:wx.removeStorageSync,token:app.globalData.token,bootstrap:app.globalData.bootstrap,hydrate:app.hydrateStoredSession,memory:new Map(),requests:[],runs:new Set(),citations:new Set()};app.__qaSynthesis=s;
        app.hydrateStoredSession=async()=>{};app.globalData.token=c.token;app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{enterpriseId:c.enterpriseId}}};s.memory.set('token',c.token);
        wx.getStorageSync=k=>s.memory.has(k)?s.memory.get(k):k==='assistant-pending-v1'?undefined:s.getStorageSync.call(wx,k);wx.setStorageSync=(k,v)=>s.memory.set(k,v);wx.removeStorageSync=k=>s.memory.delete(k);
        for(const method of ['request','downloadFile','uploadFile'])wx[method]=function(o){const raw=String(o.url),i=raw.indexOf('/api/'),p=i<0?'':raw.slice(i),base='/api/miniprogram/assistant',cid=base+'/conversations/'+c.cid;
          const allowed=p===cid||p.startsWith(cid+'/')||p.startsWith(cid+'?')||p===base+'/conversations'||p===base+'/entry-context'&&String(o.data?.conversationId)===c.cid||p.startsWith(base+'/runs/')&&s.runs.has(p.slice((base+'/runs/').length))||p.startsWith(base+'/citations/')&&s.citations.has(p.slice((base+'/citations/').length));
          if(!allowed){o.fail?.({errMsg:'Synthetic-only transport refused request'});return{abort(){}};}
          const row={path:p,verb:o.method||'GET',status:null};s.requests.push(row);const success=o.success;
          return s[method].call(wx,{...o,url:'http://localhost:3006'+p,success(r){row.status=r.statusCode;if(p===cid+'/messages'&&o.method==='POST'&&r.data?.data?.runId)s.runs.add(String(r.data.data.runId));for(const m of r.data?.data?.items||[])for(const ref of m.citations||[])s.citations.add(String(ref.id));success?.(r);}});
        };return{installed:true,credentialsPersisted:false};
      },customer);installed=true;return value;
    });
    await step('enter original C01 route and identify the persisted customer consultation',async()=>{const p=await open();return{route:p.path,conversationId:(await p.data('conversation')).id};});
    const first=await step('PPT6/15/23 native input returns real knowledge and site-material synthesis',()=>say(ctx.question,'office'));
    await step('approved citation chip opens the real current knowledge source sheet',async()=>{
      const p=await mp.currentPage(),chips=await p.$$('.citation-chip');assert.ok(chips.length);await chips[chips.length-1].tap();
      await wait(async()=>{const d=await p.data();if(d.citationError||d.fatal)throw Error(d.citationError||d.fatal);return d.sheet&&d.citation?.available&&!d.citationLoading;},'real authorized citation projection');
      const d=await p.data(),result={title:d.citation.title,quote:d.citation.quote,version:d.citation.version,capture:await capture('native-citation')};
      await(await p.$('.sheet-head .icon-button')).tap();await wait(async()=>!(await p.data('sheet')),'citation close');return result;
    });
    await step('source-linked explanation survives navigation and persisted native reentry',async()=>{const p=await open();assert.ok((await p.data('messages')).find(m=>m.id===first.outputMessageId&&m.available));return{outputMessageId:first.outputMessageId};});
    await step('PPT6/15 native follow-up uses the existing subject and fresh real knowledge',()=>say(ctx.followup,'followup'));
    await step(ctx.withdrawLabel||'withdrawn site evidence invalidates the dependent explanation on actual native reentry',async()=>{
      await ctx.withdraw();const p=await open();await wait(async()=>(await p.data('messages')).find(m=>m.id===first.outputMessageId&&m.available===false),'source unavailable feedback');
      return{outputMessageId:first.outputMessageId,capture:await capture('native-withdrawn')};
    });
    report.passed=true;return report;
  } finally {
    if(mp&&installed){report.transport=await mp.evaluate(()=>{const app=getApp(),s=app.__qaSynthesis;if(!s)return{active:false};wx.request=s.request;wx.downloadFile=s.downloadFile;wx.uploadFile=s.uploadFile;wx.getStorageSync=s.getStorageSync;wx.setStorageSync=s.setStorageSync;wx.removeStorageSync=s.removeStorageSync;app.globalData.token=s.token;app.globalData.bootstrap=s.bootstrap;app.hydrateStoredSession=s.hydrate;delete app.__qaSynthesis;return{active:false,requests:s.requests};});try{await mp.reLaunch('/pages/index/index');}catch{}}
    if(mp)await mp.disconnect();report.finished=new Date().toISOString();save();
  }
}
