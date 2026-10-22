import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const load=createRequire(import.meta.url);

/** Reuses verified Stable CDP/SDK and read-only window inspection. Never focuses
 * a window or sends desktop input. Test transport only accepts the
 * exact synthetic consultation and restores all session/storage functions. */
export async function run(ctx){
  const {root,output,conversationId,enterpriseId,token}=ctx,route='packages/assistant/chat/chat';
  const toolRoot=ctx.toolRoot||root,projectRoot=ctx.projectRoot||root,apiOrigin=ctx.apiOrigin||'http://localhost:3006';
  const origin=new URL(apiOrigin);assert.equal(origin.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));assert.equal(origin.origin,apiOrigin);
  const sdk=load(path.join(toolRoot,'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator'));
  const {connect}=load(path.join(toolRoot,'tmp/wechat-devtools-version-test/cdp.cjs'));
  const pwsh='C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
  const report={started:new Date().toISOString(),conversationId,checks:[],captures:[]};let mp,installed=false,failure;
  const save=()=>fs.writeFileSync(path.join(output,'native.json'),JSON.stringify(report,null,2));
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  async function step(name,work){try{const result=await work();report.checks.push({name,passed:true,result});return result;}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}finally{save();}}
  async function waitFor(read,label){for(let i=0;i<240;i++){const r=await read();if(r)return r;await delay(500);}throw Error('Timed out: '+label);}
  async function compile(){
    const projectPath=path.win32.normalize(path.join(projectRoot,'miniprogram'));
    let inventory;
    try{inventory=await(await fetch('http://127.0.0.1:9431/json/list',{signal:AbortSignal.timeout(3000)})).json();}catch{
      throw Error('Stable DevTools CDP compilation is unavailable; desktop focus/input fallback is disabled');
    }
    const targets=inventory.filter(t=>{try{const u=new URL(t.url);return u.protocol==='file:'&&u.pathname.endsWith('/electron-project.html')&&path.win32.normalize(u.searchParams.get('projectpath')||'')===projectPath;}catch{return false;}});
    assert.equal(targets.length,1);const target=new URL(targets[0].url);assert.equal(target.searchParams.get('appVersion'),'2.02.2608080');assert.equal(target.searchParams.get('autoPort'),'9420');
    const c=await connect(targets[0].url);try{assert.equal(c.target.id,targets[0].id);const point=await c.evaluate(`(()=>{const b=[...document.querySelectorAll('[title="编译"]')].filter(e=>e.getBoundingClientRect().width>0);if(b.length!==1)throw Error('Compile action not unique');const r=b[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});await delay(6000);
      report.target={id:targets[0].id,projectPath,version:target.searchParams.get('appVersion'),port:9420,compile:'cdp_exact_project'};return 'ws://127.0.0.1:9420';
    }finally{c.close();}
  }
  async function open(){await mp.redirectTo('/'+route+'?conversationId='+conversationId);return waitFor(async()=>{const p=await mp.currentPage();if(p.path!==route)return null;const d=await p.data();return !d.loading&&!d.fatal&&d.canSend?p:null;},'C01 live reentry');}
  async function capture(name){const page=await mp.currentPage(),stack=await mp.evaluate(()=>getCurrentPages().map(p=>p.route));assert.equal(page.path,route);assert.equal(stack.at(-1),route);await(await page.$('.conversation-scroll')).scrollTo(0,100000);await delay(500);
    const geometry={};for(const selector of ['.brand-home','.composer-input','.send-button']){const e=await page.$(selector);assert.ok(e);geometry[selector]={...await e.offset(),...await e.size(),fontSize:await e.style('font-size')};}
    const capsule=await mp.evaluate(()=>wx.getMenuButtonBoundingClientRect());assert.ok(geometry['.brand-home'].left+geometry['.brand-home'].width<capsule.left);
    assert.ok(geometry['.send-button'].top+geometry['.send-button'].height<=844);const file=path.join(output,name+'.png');await mp.screenshot({path:file});const b=fs.readFileSync(file);assert.equal(b.subarray(1,4).toString(),'PNG');
    const item={name,file,route,stack,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)],geometry,capsule};report.captures.push(item);save();return item;
  }
  async function say(text,label){const page=await open(),prior=(await page.data('run'))?.id;const started=Date.now();await(await page.$('.composer-input')).input(text);await waitFor(async()=>await page.data('draft')===text,'real C01 input');await(await page.$('.send-button')).tap();
    const run=await waitFor(async()=>{const d=await page.data();if(d.error&&!d.busy&&!d.pendingSend)throw Error(d.error);return d.run?.id&&d.run.id!==prior?d.run:null;},'actual persisted run');
    const firstFeedbackMs=Date.now()-started,result=await ctx.audit(run.id,label,started);await waitFor(async()=>{const d=await page.data();return !d.generating&&!d.busy&&d.messages.some(m=>m.id===result.outputMessageId&&m.available);},'actual model answer');await mp.callWxMethod('hideKeyboard');
    const reopened=await open();assert.ok((await reopened.data('messages')).some(m=>m.id===result.outputMessageId&&m.available));return {runId:run.id,firstFeedbackMs,result,capture:await capture('native-'+label)};
  }
  try{
    await step('secondary monitor and sole controller',async()=>{const info=JSON.parse(cp.execFileSync(pwsh,['-NoProfile','-File',path.join(toolRoot,'tmp/wechat-devtools-version-test/window.ps1'),'-Action','Inspect','-IncludeHidden'],{encoding:'utf8',windowsHide:true}));assert.equal(info.ProjectWindows,1);assert.equal(info.OnSecondary,true);const count=cp.execFileSync(pwsh,['-NoProfile','-Command','@(Get-NetTCPConnection -LocalPort 9420 -State Established -ErrorAction SilentlyContinue).Count'],{encoding:'utf8',windowsHide:true}).trim();assert.equal(Number(count),0);return info;});
    await step('fresh compilation, SDK, live data and positive queries',async()=>{let endpoint=await compile();mp=await sdk.connect({wsEndpoint:endpoint});let info;try{info=await mp.systemInfo();await(await mp.currentPage()).data();}catch{await mp.disconnect();endpoint=await compile();mp=await sdk.connect({wsEndpoint:endpoint});info=await mp.systemInfo();}assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);assert.equal(info.SDKVersion,'3.17.2');assert.ok((await(await mp.currentPage()).$$('view')).length);return {endpoint,SDKVersion:info.SDKVersion,logical:[390,844]};});
    await step('synthetic-only session and HTTP transport',async()=>{const result=await mp.evaluate(ctx=>{const app=getApp();if(app.__qaHistory||app.__qaShared||app.__qaMaterials||app.__qaC05)throw Error('Another test is active');const s={request:wx.request,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,token:app.globalData.token,bootstrap:app.globalData.bootstrap,hydrate:app.hydrateStoredSession,memory:new Map(),runs:new Set(),requests:[]};app.__qaHistory=s;app.hydrateStoredSession=async()=>{};
      wx.getStorageSync=k=>s.memory.has(k)?s.memory.get(k):k==='assistant-pending-v1'?undefined:s.get.call(wx,k);wx.setStorageSync=(k,v)=>s.memory.set(k,v);wx.removeStorageSync=k=>s.memory.delete(k);s.memory.set('token',ctx.token);app.globalData.token=ctx.token;app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{enterpriseId:ctx.enterpriseId}}};
      wx.request=function(o){const raw=String(o.url),i=raw.indexOf('/api/'),p=i<0?'':raw.slice(i),base='/api/miniprogram/assistant',conversation=base+'/conversations/'+ctx.conversationId;const allowed=p===conversation||p.startsWith(conversation+'/')||p===base+'/conversations'||p===base+'/entry-context'&&String(o.data?.conversationId)===ctx.conversationId||p.startsWith(base+'/runs/')&&s.runs.has(p.slice((base+'/runs/').length));
        if(!allowed){o.fail?.({errMsg:'Synthetic-only transport refused request'});return{abort(){}};}const row={path:p,status:null};s.requests.push(row);const success=o.success;return s.request.call(wx,{...o,url:ctx.apiOrigin+p,success(r){row.status=r.statusCode;if(p===conversation+'/messages'&&o.method==='POST'&&r.data?.data?.runId)s.runs.add(String(r.data.data.runId));success?.(r);}});};return{installed:true,credentialsPersisted:false};},{conversationId,enterpriseId,token,apiOrigin});installed=true;return result;});
    if(ctx.exercise){await step('capacity corrections, independent saves, history reentry and withdrawal through native C01',()=>ctx.exercise({step,say,open,capture,waitFor,mp}));}else{
    await step('early original after 45 seeded messages: actual input, recall, feedback and reentry',()=>say(ctx.question,'early-original'));
    await step('real memory correction remains saved after historical recall',()=>say(ctx.correction,'correction'));
    await step('current correction and early conditional boundary survive reentry',()=>say(ctx.correctedQuestion,'current-correction'));
    await step('saved memory retains actual current original',async()=>{const memory=await ctx.verifyMemory();assert.ok(memory.facts.some(f=>f.status==='current'&&/晚上.*电脑/.test(f.value)));return {version:memory.version,facts:memory.facts.filter(f=>f.status==='current').map(f=>({field:f.field,sourceMessageId:f.sourceMessageId}))};});
    await step('source withdrawal hides derived prose on real C01 reentry',async()=>{
      const before=await open(),items=await before.data('messages'),ids=items.filter(m=>m.authorKind==='assistant'&&m.available).map(m=>m.id);
      await ctx.withdrawOriginal();const page=await open();
      await waitFor(async()=>{const rows=await page.data('messages');return rows.some(m=>ids.includes(m.id)&&!m.available);},'source-unavailable original feedback');
      return {capture:await capture('native-withdrawal'),unavailable:(await page.data('messages')).filter(m=>ids.includes(m.id)&&!m.available).map(m=>m.id)};
    });
    }
    report.passed=true;return report;
  }catch(error){failure=error;throw error;}finally{
    let cleanupFailure;
    try{
      if(mp&&installed){
        report.transport=await mp.evaluate(()=>{const app=getApp(),s=app.__qaHistory;if(!s)return{restored:false,missingSession:true,requests:[]};wx.request=s.request;wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;app.globalData.token=s.token;app.globalData.bootstrap=s.bootstrap;app.hydrateStoredSession=s.hydrate;delete app.__qaHistory;return {restored:true,requests:s.requests};});
        if(!report.transport.restored)throw Error('Synthetic session was lost; this native window is invalid');
        try{await mp.reLaunch('/pages/index/index');}catch{}
      }
    }catch(error){cleanupFailure=error;report.cleanupError=error.message;report.passed=false;}
    finally{
      try{if(mp)await mp.disconnect();}catch(error){cleanupFailure||=error;report.cleanupError||=error.message;report.passed=false;}
      report.finished=new Date().toISOString();save();
    }
    if(cleanupFailure&&!failure)throw cleanupFailure;
  }
}
