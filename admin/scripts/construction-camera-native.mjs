// Authorized Stable workflow, canonical project window, shared acceptance lock.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {wechatideNativeClient} from './wechatide-native-client.ts';
import {lockAssistantAcceptance} from './assistant-acceptance-safety.mjs';
const root=path.resolve('..'),output=process.env.CAMERA_TEST_OUTPUT?path.resolve(process.env.CAMERA_TEST_OUTPUT):path.join(root,'tmp/cloud-camera');
const fixture=JSON.parse(fs.readFileSync(path.join(output,'fixture.private.json'),'utf8'));
const database=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,''));
const project=path.join(root,'miniprogram'),nativeClient=wechatideNativeClient(project,output);
const pwsh='C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
const route='packages/construction/camera/camera',projects='packages/construction/projects/projects';
let mp,release,installed=false,windowTitlePattern;const report={started:new Date().toISOString(),checks:[]};
const verified=JSON.parse(fs.readFileSync(path.join(output,'verification.json'),'utf8'));
const boundFiles=[...new Set([...Object.keys(verified.before),
 'admin/scripts/construction-camera-native.mjs','admin/scripts/assistant-acceptance-safety.mjs',
 'tmp/wechat-devtools-version-test/window.ps1','admin/scripts/wechatide-native-client.ts','admin/scripts/wechatide-window-state.ps1',
 'miniprogram/project.config.json','miniprogram/project.private.config.json',
 path.relative(root,path.join(output,'fixture.private.json')).replaceAll('\\','/'),'admin/.env.local'])].sort();
const bind=()=>Object.fromEntries(boundFiles.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
report.before=bind();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function step(name,work){try{const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result;}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}}
async function wait(read,label){for(let i=0;i<60;i++){const result=await read();if(result)return result;await delay(500);}throw Error('Timed out: '+label);}
async function cameraButton(p){console.log('Native phase: waiting for camera control');const b=await wait(async()=>p.$('.camera-entry'),'visible camera button');console.log('Native phase: camera control found');return b;}
async function compile(){
 await nativeClient.call('simulator_refresh',{project});await delay(6000);
}
function currentClient(){
 const originalPage=nativeClient.currentPage;
 return {...nativeClient,currentPage:async()=>{const p=await originalPage();if(!p)return p;const read=p.data;return {...p,data:async key=>{const data=await read();return key===undefined?data:data[key];}};},navigateBack:()=>nativeClient.call('automation_navigate',{project,action:'navigateBack'})};
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
   const status=await nativeClient.call('check_wechatide_status',{skillVersion:'0.3.11'});
   assert.ok(['equal','agent_ahead'].includes(status.versionRelation));assert.equal(status.loginExpired,false);assert.equal(status.cliTokenRequired,false);
   const raw=cp.execFileSync(pwsh,['-NoProfile','-File',path.join(root,'admin/scripts/wechatide-window-state.ps1')],{encoding:'utf8',windowsHide:true});
   const state=JSON.parse(raw.replace(/^\uFEFF/,'').trim()),windows=state.Windows.filter(w=>['WeChat Web Devtools','miniprogram'].includes(w.Title));assert.equal(windows.length,1);
   const title=windows[0].Title;windowTitlePattern='^'+title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';
   const info=JSON.parse(cp.execFileSync(pwsh,['-NoProfile','-File',path.join(root,'tmp/wechat-devtools-version-test/window.ps1'),'-IncludeHidden','-TitlePattern',windowTitlePattern,'-Action','Place'],{encoding:'utf8',windowsHide:true}));
   assert.equal(info.ProjectWindows,1);assert.equal(info.OnSecondary,true);
   // The Windows launcher reports generic2.02.0. The installed application
   // manifest is the actual Stable build, read through its own ASAR-aware Node.
   const version=cp.execFileSync('D:/微信开发工具/微信web开发者工具/微信开发者工具.exe',['-e',"process.stdout.write(require('D:/微信开发工具/微信web开发者工具/resources/app.asar/package.json').version)"],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:10000}).trim();assert.equal(version,'2.02.2608080');
   return {project,windows:1,secondary:true,version,registeredAuthorization:true,versionRelation:status.versionRelation};
 });
 await step('fresh compile and live Stable baseline',async()=>{await compile();mp=currentClient();const info=await mp.systemInfo();await(await mp.currentPage()).data();assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);assert.equal(info.SDKVersion,'3.17.2');return {logical:[390,844],SDKVersion:info.SDKVersion,freshCompile:true};});
 await mp.evaluate(f=>{const app=getApp();if(app.__qaCamera||app.__qaShared||app.__qaC05||app.__qaMaterials)throw Error('Other controller active');const saved={request:wx.request,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,token:app.globalData.token,bootstrap:app.globalData.bootstrap,hydrate:app.hydrateStoredSession,memory:new Map(),requests:[],rejectEntry:false};app.__qaCamera=saved;app.hydrateStoredSession=async()=>{};
   app.globalData.token=f.miniToken;app.globalData.bootstrap={current:{mode:'staff',role:'enterprise_admin',capabilities:['construction.projects'],context:{enterpriseId:f.enterpriseId,staffId:f.ownerId,staffRole:'enterprise_admin'}}};saved.memory.set('token',f.miniToken);
   wx.getStorageSync=k=>saved.memory.has(k)?saved.memory.get(k):String(k).startsWith('construction:')?undefined:saved.get.call(wx,k);wx.setStorageSync=(k,v)=>saved.memory.set(k,v);wx.removeStorageSync=k=>saved.memory.delete(k);
   wx.request=o=>{const raw=String(o.url),i=raw.indexOf('/api/'),p=i<0?'':raw.slice(i),base='/api/miniprogram/construction';const allowed=p===base+'/projects'||p===base+'/projects/'+f.projectId||p===base+'/video/projects/'+f.projectId+'/entry';if(!allowed){o.fail?.({errMsg:'Synthetic-only transport rejected request'});return{abort(){}};}const record={path:p,status:null};saved.requests.push(record);if(saved.rejectEntry&&p.endsWith('/entry')){o.success?.({statusCode:403,data:{success:false,error:'camera_forbidden'}});return{abort(){}};}const success=o.success;return saved.request.call(wx,{...o,url:'http://localhost:3018'+p,success(r){record.status=r.statusCode;success?.(r);}});};
 },fixture);installed=true;
 await step('native project control opens actual authorized WebView entry',async()=>{
   // Registered Stable navigation uses redirectTo for the existing subpackage;
   // reLaunch remains the normal main-package cleanup below.
   await mp.redirectTo('/'+projects);
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
