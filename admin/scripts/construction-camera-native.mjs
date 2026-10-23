// Authorized Stable workflow, canonical project window, shared acceptance lock.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {lockAssistantAcceptance} from './assistant-acceptance-safety.mjs';
const root=path.resolve('..'),output=path.join(root,'tmp/cloud-camera'),load=createRequire(import.meta.url);
const fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.private.json'),'utf8'));
const database=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));
const sdk=load(path.join(root,'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator'));
const {connect}=load(path.join(root,'tmp/wechat-devtools-version-test/cdp.cjs'));
const pwsh='C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const route='packages/construction/camera/camera',projects='packages/construction/projects/projects';
let mp,release,installed=false,windowTitlePattern;const report={started:new Date().toISOString(),checks:[]};
const verified=JSON.parse(fs.readFileSync(path.join(output,'verification.json'),'utf8'));
const boundFiles=[...new Set([...Object.keys(verified.before),
 'admin/scripts/construction-camera-native.mjs','admin/scripts/assistant-acceptance-safety.mjs',
 'tmp/wechat-devtools-version-test/window.ps1','tmp/wechat-devtools-version-test/cdp.cjs',
 'miniprogram/project.config.json','miniprogram/project.private.config.json',
 'tmp/cloud-camera/fixture.private.json','admin/.env.local'])].sort();
const bind=()=>Object.fromEntries(boundFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
report.before=bind();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function step(name,work){try{const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result;}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}}
async function wait(read,label){for(let i=0;i<60;i++){const result=await read();if(result)return result;await delay(500);}throw Error('Timed out: '+label);}
async function cameraButton(p){console.log('Native phase: waiting for camera control');const b=await wait(async()=>p.$('.camera-entry'),'visible camera button');console.log('Native phase: camera control found');return b;}
async function compile(){
 const expected=path.win32.normalize(path.join(root,'miniprogram'));
 const targets=(await(await fetch('http://127.0.0.1:9431/json/list')).json()).filter(t=>{try{const u=new URL(t.url);return u.protocol==='file:'&&u.pathname.endsWith('/electron-project.html')&&path.win32.normalize(u.searchParams.get('projectpath')||'')===expected;}catch{return false;}});
 assert.equal(targets.length,1);const url=new URL(targets[0].url);assert.equal(url.searchParams.get('appVersion'),'2.02.2608080');assert.equal(url.searchParams.get('autoPort'),'9420');
 const c=await connect(targets[0].url);try{const point=await c.evaluate(`(()=>{const b=[...document.querySelectorAll('[title="编译"]')].filter(e=>e.getBoundingClientRect().width>0);if(b.length!==1)throw Error('Compile action not unique');const r=b[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});await delay(6000);}finally{c.close();}
}
async function cameraState(){const state=await mp.evaluate(()=>{const pages=getCurrentPages(),p=pages[pages.length-1];return{route:p.route,src:p.data.src||'',loading:!!p.data.loading,error:p.data.error||'',handler:typeof p.open,show:typeof p.onShow,keys:Object.keys(p.data),busy:!!p.data.busy,pending:!!p.data.pending,status:p.data.detail?.project?.status||''};});report.lastNativeState={...state,src:!!state.src};return state;}
async function capture(name,target){
 assert.equal((await mp.evaluate(()=>getCurrentPages().map(p=>p.route))).at(-1),target);
 await delay(2500);
 const file=path.join(output,name+'.png');
 // The verified project is restored on the secondary monitor before SDK
 // capture; a minimized project can leave App.captureScreenshot unresponsive.
 await mp.screenshot({path:file});
 assert.equal((await mp.evaluate(()=>getCurrentPages().map(p=>p.route))).at(-1),target);
 const b=fs.readFileSync(file);return {route:target,kind:'simulator',logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)]};
}
try{
 release=await lockAssistantAcceptance(database.DATABASE_URL,{waitForLock:process.argv.includes('--wait')});
 await step('one verified secondary-monitor project and idle controller',async()=>{
   const expected=path.win32.normalize(path.join(root,'miniprogram'));
   const targets=(await(await fetch('http://127.0.0.1:9431/json/list')).json()).filter(t=>{try{return new URL(t.url).pathname.endsWith('/electron-project.html');}catch{return false;}});
   assert.equal(targets.length,1);const project=new URL(targets[0].url);assert.equal(path.win32.normalize(project.searchParams.get('projectpath')||''),expected);assert.equal(project.searchParams.get('appVersion'),'2.02.2608080');
   assert.equal(Number(cp.execFileSync(pwsh,['-NoProfile','-Command','@(Get-NetTCPConnection -LocalPort 9420 -State Established -ErrorAction SilentlyContinue).Count'],{encoding:'utf8',windowsHide:true}).trim()),0);
   const title=project.searchParams.get('projectname');
   assert.equal(typeof title,'string');windowTitlePattern='^'+title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';
   const args=['-NoProfile','-File',path.join(root,'tmp/wechat-devtools-version-test/window.ps1'),'-IncludeHidden','-TitlePattern',windowTitlePattern];
   let info=JSON.parse(cp.execFileSync(pwsh,[...args,'-Action','Inspect'],{encoding:'utf8',windowsHide:true}));
   info=JSON.parse(cp.execFileSync(pwsh,[...args,'-Action','Place'],{encoding:'utf8',windowsHide:true}));
   assert.equal(info.ProjectWindows,1);assert.equal(info.OnSecondary,true);
   const visible=await connect(targets[0].url);let bounds;
   try{bounds=await visible.evaluate('({x:window.screenX,y:window.screenY,w:window.outerWidth,h:window.outerHeight})');}finally{visible.close();}
   assert.ok(bounds.w>250&&bounds.h>300,'Verified project must be restored before capture');
   assert.ok(Math.abs(bounds.x-info.Bounds.Left)<=8&&Math.abs(bounds.y-info.Bounds.Top)<=8,'Native window must match the verified CDP project');
   return {windows:1,secondary:true,project:expected,handle:info.Handle,bounds:info.Bounds,title};
 });
 await step('fresh compile and live Stable baseline',async()=>{await compile();mp=await sdk.connect({wsEndpoint:'ws://127.0.0.1:9420'});let info;try{info=await mp.systemInfo();await(await mp.currentPage()).data();}catch{await mp.disconnect();await compile();mp=await sdk.connect({wsEndpoint:'ws://127.0.0.1:9420'});info=await mp.systemInfo();await(await mp.currentPage()).data();}assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);assert.equal(info.SDKVersion,'3.17.2');return {logical:[390,844],SDKVersion:info.SDKVersion};});
 await mp.evaluate(f=>{const app=getApp();if(app.__qaCamera||app.__qaShared||app.__qaC05||app.__qaMaterials)throw Error('Other controller active');const saved={request:wx.request,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,token:app.globalData.token,bootstrap:app.globalData.bootstrap,hydrate:app.hydrateStoredSession,memory:new Map(),requests:[],rejectEntry:false};app.__qaCamera=saved;app.hydrateStoredSession=async()=>{};
   app.globalData.token=f.miniToken;app.globalData.bootstrap={current:{mode:'staff',role:'enterprise_admin',capabilities:['construction.projects'],context:{enterpriseId:f.enterpriseId,staffId:f.ownerId,staffRole:'enterprise_admin'}}};saved.memory.set('token',f.miniToken);
   wx.getStorageSync=k=>saved.memory.has(k)?saved.memory.get(k):String(k).startsWith('construction:')?undefined:saved.get.call(wx,k);wx.setStorageSync=(k,v)=>saved.memory.set(k,v);wx.removeStorageSync=k=>saved.memory.delete(k);
   wx.request=o=>{const raw=String(o.url),i=raw.indexOf('/api/'),p=i<0?'':raw.slice(i),base='/api/miniprogram/construction';const allowed=p===base+'/projects'||p===base+'/projects/'+f.projectId||p===base+'/video/projects/'+f.projectId+'/entry';if(!allowed){o.fail?.({errMsg:'Synthetic-only transport rejected request'});return{abort(){}};}const record={path:p,status:null};saved.requests.push(record);if(saved.rejectEntry&&p.endsWith('/entry')){o.success?.({statusCode:403,data:{success:false,error:'camera_forbidden'}});return{abort(){}};}const success=o.success;return saved.request.call(wx,{...o,url:'http://localhost:3018'+p,success(r){record.status=r.statusCode;success?.(r);}});};
 },fixture);installed=true;
 await step('native project control opens actual authorized WebView entry',async()=>{
   await mp.reLaunch('/'+projects);
   const p=await wait(async()=>{const p=await mp.currentPage(),d=await p.data();return p.path===projects&&!d.loading&&d.items?.some(x=>String(x.id)===fixture.projectId)?p:null;},'project list');
   const item=await p.$('[data-id="'+fixture.projectId+'"]');assert.ok(item);console.log('Native phase: project control');await item.tap();
   await wait(async()=>{const d=await p.data();return d.detail&&!d.loading;},'project detail');console.log('Native phase: detail ready');
   await capture('native-project-entry',projects);await(await cameraButton(p)).tap();console.log('Native phase: camera tapped');
   return wait(async()=>{const d=await cameraState();if(d.error)throw Error(d.error);return d.route===route&&d.src&&!d.loading?{route:d.route,entryIssued:true}:null;},'camera webview');
 });
 await step('WebView route screenshot and fresh entry on reentry',async()=>{const first=(await cameraState()).src;const shot=await capture('native-camera',route);await mp.navigateBack();await wait(async()=>(await mp.currentPage()).path===projects,'back');const p=await mp.currentPage();await wait(async()=>!(await p.data()).loading,'project reload');await(await cameraButton(p)).tap();await wait(async()=>{const d=await cameraState();return d.route===route&&d.src&&!d.loading;},'fresh entry');assert.notEqual((await cameraState()).src,first);return shot;});
 await step('denied entry clears media and visible retry restores real authorization',async()=>{await mp.evaluate(()=>{getApp().__qaCamera.rejectEntry=true;});await mp.redirectTo('/'+route+'?projectId='+fixture.projectId);const p=await wait(async()=>{const p=await mp.currentPage(),d=await p.data();return p.path===route&&!d.loading&&d.error&&!d.src?p:null;},'entry denied');const shot=await capture('native-camera-error',route);await mp.evaluate(()=>{getApp().__qaCamera.rejectEntry=false;});await(await p.$('button')).tap();await wait(async()=>!!await p.data('src'),'retry real entry');return shot;});
 report.passed=true;
}catch(e){report.error=e.message;console.error(e.message);console.log(JSON.stringify(report.lastNativeState||{}));if(mp){try{const state=await cameraState();if(state.route===route)report.failedCapture=await capture('native-camera-unavailable',route);}catch{}}process.exitCode=1;}
finally{
 if(mp&&installed){try{report.transport=await mp.evaluate(()=>{const a=getApp(),s=a.__qaCamera;if(!s)return[];wx.request=s.request;wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;appRestore();function appRestore(){a.globalData.token=s.token;a.globalData.bootstrap=s.bootstrap;a.hydrateStoredSession=s.hydrate;}delete a.__qaCamera;return s.requests;});await mp.reLaunch('/pages/index/index');}catch(e){report.cleanupError=e.message;}}
 if(mp)await mp.disconnect();if(release)await release();
 report.after=bind();report.drift=boundFiles.filter(file=>report.before[file]!==report.after[file]);
 if(report.drift.length){report.passed=false;report.error='Native source/configuration drift';process.exitCode=1;}
 report.finished=new Date().toISOString();const json=JSON.stringify(report,null,2);fs.writeFileSync(path.join(output,'native.json'),json);fs.writeFileSync(path.join(output,'native-'+report.started.replace(/[:.]/g,'-')+'.json'),json);
}
