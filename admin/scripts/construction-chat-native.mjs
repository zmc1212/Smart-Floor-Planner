// Uses verified Stable DevTools helpers; isolated retake checks use the official refresh CLI.
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const load = createRequire(import.meta.url);
export async function run(ctx){
 const {root,output,projectId,identities}=ctx,route='packages/construction/chat/chat',apiOrigin=ctx.apiOrigin||'http://localhost:3006';
 const origin=new URL(apiOrigin);assert.equal(origin.protocol,'http:');assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const sdk=load(path.join(root,'tmp/wechat-automator-smoke-20261017/sdk-latest/node_modules/miniprogram-automator'));
 const pwsh='C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe';
 const windowScript=path.join(root,'tmp/wechat-devtools-version-test/window.ps1');
 const report={started:new Date().toISOString(),projectId,apiOrigin,checks:[]};let mp,installed=false;
 const save=()=>fs.writeFileSync(path.join(output,'native.json'),JSON.stringify(report,null,2));
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 async function step(name,work){try{const result=await work();report.checks.push({name,passed:true,result});console.log(name+': PASS');return result;}catch(e){report.checks.push({name,passed:false,error:e.message});throw e;}finally{save();}}
 async function waitFor(read,label){for(let i=0;i<180;i++){const value=await read();if(value)return value;await delay(500);}throw Error('Timed out: '+label);}
 let compileCount=0;
 async function compile(){
  const projectPath=path.join(root,'miniprogram');
  if(!ctx.refreshWithCli){
   const {connect}=load(path.join(root,'tmp/wechat-devtools-version-test/cdp.cjs'));
   const targets=(await(await fetch('http://127.0.0.1:9431/json/list')).json()).filter(t=>{
    try{const u=new URL(t.url);return u.protocol==='file:'&&u.pathname.endsWith('/electron-project.html')
     &&path.win32.normalize(u.searchParams.get('projectpath')||'')===path.win32.normalize(projectPath);}catch{return false;}
   });assert.equal(targets.length,1,'Exactly one CDP target must match this Mini Program project');
   const target=new URL(targets[0].url);assert.equal(target.searchParams.get('appVersion'),'2.02.2608080');assert.equal(target.searchParams.get('autoPort'),'9420');
   const c=await connect(targets[0].url);try{assert.equal(c.target.id,targets[0].id);const point=await c.evaluate(`(()=>{const b=[...document.querySelectorAll('[title="编译"]')].filter(e=>e.getBoundingClientRect().width>0);if(b.length!==1)throw Error('Compile action not unique');const r=b[0].getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    for(const type of ['mousePressed','mouseReleased'])await c.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});await delay(6000);return 'ws://127.0.0.1:'+target.searchParams.get('autoPort');
   }finally{c.close();}
  }
  const launch=JSON.parse(fs.readFileSync(path.join(output,'window-launch.json'),'utf8'));
  assert.equal(path.win32.normalize(launch.projectPath),path.win32.normalize(projectPath));
  assert.equal(launch.autoPort,9420);
  const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  const command=`& ${quote('D:\\微信开发工具\\微信web开发者工具\\wechatide.cmd')} -c Codex simulator_refresh --project ${quote(projectPath)}; exit $LASTEXITCODE`;
  const result=cp.spawnSync(pwsh,['-NoProfile','-Command',command],{encoding:'utf8',windowsHide:true,timeout:30000});
  const receipt=(result.stdout||'')+(result.stderr||'');
  fs.writeFileSync(path.join(output,'compile-'+(++compileCount)+'.log'),receipt);
  assert.equal(result.status,0,receipt);
  const parsed=JSON.parse((result.stdout||'').slice((result.stdout||'').indexOf('{')));
  assert.equal(parsed.ok,true,'Official simulator_refresh must acknowledge the request');
  assert.equal(parsed.tool,'simulator_refresh');
  assert.notEqual(parsed.result?.success,false,receipt);
  // The CLI only acknowledges refresh; systemInfo, page data and elements below
  // independently establish that the fresh runtime actually became usable.
  await delay(6000);return 'ws://127.0.0.1:9420';
 }
 async function current(){const p=await mp.currentPage();assert.equal(p.path,route);return p;}
 async function open(){await mp.redirectTo('/'+route+'?projectId='+projectId);return waitFor(async()=>{const p=await mp.currentPage();if(p.path!==route)return null;const d=await p.data();report.lastOpen={route:p.path,loading:d.loading,fatal:d.fatal,error:d.error,write:d.write,projectId:d.project?.id};save();if(!d.loading&&d.fatal){if(ctx.expectedInitialRevocation)return p;throw Error('Shared project reentry rejected: '+d.error);}return !d.loading&&d.project?.id===projectId&&d.write&&!d.fatal?p:null;},'shared project reentry');}
 async function identity(i){await mp.evaluate(s=>{const app=getApp();app.globalData.token=s.token;app.globalData.bootstrap={current:{mode:'staff',role:s.role,capabilities:['construction.projects'],context:{enterpriseId:s.enterpriseId,staffId:s.adminId,staffRole:s.role}}};app.__qaShared.memory.set('token',s.token);},identities[i]);return open();}
 async function send(text,drop=false){
  const p=await current();
  await waitFor(async()=>{const d=await p.data();return d.write&&!d.loading&&!d.busy&&!d.pending&&!d.fatal;},'interactive composer before input');
  const before=new Set((await p.data('items')).map(i=>i.message.id));
  if(drop)await mp.evaluate(()=>{getApp().__qaShared.dropNext=true;});
  const input=await p.$('.composer-input');assert.ok(input);await input.input(text);await waitFor(async()=>await p.data('draft')===text,'composer input');
  await(await p.$('.send')).tap();
  if(drop){await waitFor(async()=>{const d=await p.data();return d.pending&&!d.busy&&d.error;},'lost receipt preserved');await(await p.$('.feedback button')).tap();}
  const item=await waitFor(async()=>{const d=await(await current()).data();if(!d.busy&&!d.pending&&d.error)throw Error('Native send rejected: '+d.error);return !d.busy&&!d.pending&&d.items.find(i=>!before.has(i.message.id)&&i.text===text);},'persisted original and response');
  if(item.record?.id)await waitFor(async()=>{const d=await(await current()).data();return d.items.find(i=>i.record?.id===item.record.id&&i.record.status==='draft');},'real Worker draft');
  await mp.callWxMethod('hideKeyboard');return item;
 }
 async function capture(name){const p=await current(),stack=await mp.evaluate(()=>getCurrentPages().map(p=>p.route));assert.equal(stack.at(-1),route);await delay(400);const target=path.join(output,name+'.png');await mp.screenshot({path:target});const b=fs.readFileSync(target);assert.equal(b.subarray(1,4).toString(),'PNG');return {route:p.path,stack,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)],target};}
 try{
  await step('unique project on secondary monitor and no controller contention',async()=>{const info=JSON.parse(cp.execFileSync(pwsh,['-NoProfile','-File',windowScript,'-Action','Inspect','-IncludeHidden'],{encoding:'utf8',windowsHide:true}));assert.equal(info.ProjectWindows,1);assert.equal(info.OnSecondary,true);const count=cp.execFileSync(pwsh,['-NoProfile','-Command','@(Get-NetTCPConnection -LocalPort 9420 -State Established -ErrorAction SilentlyContinue).Count'],{encoding:'utf8',windowsHide:true}).trim();assert.equal(Number(count),0);return info;});
  await step('fresh compile and live Stable SDK data/elements baseline',async()=>{let endpoint=await compile();mp=await sdk.connect({wsEndpoint:endpoint});let info;try{info=await mp.systemInfo();await(await mp.currentPage()).data();}catch{await mp.disconnect();endpoint=await compile();mp=await sdk.connect({wsEndpoint:endpoint});info=await mp.systemInfo();}assert.equal(info.windowWidth,390);assert.equal(info.windowHeight,844);assert.equal(info.SDKVersion,'3.17.2');assert.ok((await(await mp.currentPage()).$$('view')).length);return {endpoint,SDKVersion:info.SDKVersion,logical:[390,844]};});
  await step('synthetic-only real HTTP transport and in-memory session journal',async()=>{const result=await mp.evaluate((pid,cid,origin,recordPreview,projectManagement,managementBrief)=>{const app=getApp();if(app.__qaShared||app.__qaMaterials||app.__qaC05)throw Error('Another test is active');const s={request:wx.request,downloadFile:wx.downloadFile,uploadFile:wx.uploadFile,chooseMedia:wx.chooseMedia,previewImage:wx.previewImage,getStorageSync:wx.getStorageSync,setStorageSync:wx.setStorageSync,removeStorageSync:wx.removeStorageSync,token:app.globalData.token,bootstrap:app.globalData.bootstrap,hydrate:app.hydrateStoredSession,memory:new Map(),requests:[],runIds:new Set(),dropNext:false};app.__qaShared=s;app.hydrateStoredSession=async()=>{};
   wx.getStorageSync=k=>s.memory.has(k)?s.memory.get(k):String(k).startsWith('site:')||k==='assistant-pending-v1'?undefined:s.getStorageSync.call(wx,k);wx.setStorageSync=(k,v)=>s.memory.set(k,v);wx.removeStorageSync=k=>s.memory.delete(k);
   if(cid)wx.chooseMedia=o=>{if(!s.photoPath)throw Error('No synthetic photo was selected');o.success?.({tempFiles:[{tempFilePath:s.photoPath,size:s.photoSize}]});};
   if(cid||recordPreview)wx.previewImage=o=>{s.previewed=o.urls;o.success?.({});};
   for(const method of ['request','downloadFile','uploadFile'])wx[method]=function(o){const raw=String(o.url),i=raw.indexOf('/api/'),p=i<0?'':raw.slice(i),projects='/api/miniprogram/construction/projects',base=projects+'/'+pid+'/chat',assistant='/api/miniprogram/assistant',allowedProject=projectManagement&&((!o.method||o.method==='GET')&&(p===projects||p===projects+'/'+pid)||o.method==='POST'&&p===projects+'/'+pid+'/progress'),allowedBrief=managementBrief&&(!o.method||o.method==='GET')&&p==='/api/miniprogram/construction/brief',allowedCustomer=cid&&(p.startsWith(assistant+'/conversations/'+cid+'/')||p===assistant+'/conversations/'+cid||p===assistant+'/conversations'||p===assistant+'/entry-context'&&String(o.data?.conversationId)===cid||p.startsWith(assistant+'/runs/')&&s.runIds.has(p.slice((assistant+'/runs/').length)));if(!(p===base||p.startsWith(base+'?')||p.startsWith(base+'/')||allowedCustomer||allowedProject||allowedBrief)){o.fail?.({errMsg:'Synthetic-only transport refused request'});return{abort(){}};}const row={path:p,target:origin+p,verb:o.method||(method==='uploadFile'?'POST':'GET'),status:null};s.requests.push(row);const success=o.success;return s[method].call(wx,{...o,url:origin+p,success(r){row.status=r.statusCode;if(cid&&p===assistant+'/conversations/'+cid+'/messages'&&o.method==='POST'&&r.data?.data?.runId)s.runIds.add(String(r.data.data.runId));if((s.dropNext&&p.endsWith('/messages')||s.dropSpeechNext&&p.endsWith('/speech'))&&o.method==='POST'&&r.statusCode>=200&&r.statusCode<300){s.dropNext=false;s.dropSpeechNext=false;row.simulatedLostReceipt=true;o.fail?.({errMsg:'Synthetic response-loss injection'});return;}success?.(r);}});};return {installed:true,apiOrigin:origin,previewApiCaptured:!!recordPreview,credentialsPersisted:false,projectManagement:!!projectManagement};},projectId,ctx.customer?.conversationId||'',apiOrigin,!!ctx.recordPreview,!!ctx.projectManagement,!!ctx.managementBrief);installed=true;return result;});
  if(ctx.verifyWorkerHttp)await step('signed worker HTTP read through simulator before page reentry',async()=>{
   const result=await mp.evaluate((pid,token,origin)=>new Promise(resolve=>wx.request({url:origin+'/api/miniprogram/construction/projects/'+pid+'/chat?limit=30',method:'GET',header:{Authorization:'Bearer '+token},timeout:10000,
    success:r=>resolve({status:r.statusCode,projectId:r.data?.data?.project?.id,error:r.statusCode>=400?JSON.stringify(r.data).slice(0,2000):null}),fail:e=>resolve({error:e.errMsg})})),projectId,identities[2].token,apiOrigin);
   report.workerHttp=result;save();assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.projectId,projectId);return result;
  });
  await identity(2);
  if(ctx.exercise){
   await step('scoped native S04 scenario through the existing controls',()=>ctx.exercise({mp,step,send,identity,open,capture,current,waitFor}));
   report.passed=true;return report;
  }
  const first=await step('PPT22 native original report and actual configured Worker draft',async()=>{const row=await send('书房线管今天铺好了，底盒还没固定，等设计师核对位置。');assert.ok(row.record.id);return {messageId:row.message.id,recordId:row.record.id};});
  await step('record-history sheet remains independent of command revision snapshots',async()=>{const p=await current();await(await p.$('.record-links .text-button')).tap();const versions=await waitFor(async()=>{const d=await p.data();return d.sheet==='versions'&&!d.versionsLoading&&Array.isArray(d.versions)&&d.versions.length?d.versions:null;},'original record versions');assert.ok(versions.every(v=>Number.isInteger(v.version)));assert.ok((await p.$$('.version-row')).length);await(await p.$('.sheet-heading .text-button')).tap();await waitFor(async()=>!(await p.data('sheet')),'history sheet close');return {recordId:first.recordId,versions:versions.map(v=>v.version)};});
  await step('repeat configured report path on independent original',async()=>{const row=await send('书房线管今天已经铺好，底盒尚未固定，需要设计师核对位置。');assert.ok(row.record.id);return {messageId:row.message.id,recordId:row.record.id};});
  await step('PPT23 query shows original versions and missing drawings without a draft',async()=>{const row=await send('书房底盒待核对，帮我找对应图纸和需求');assert.equal(row.record.id,'');assert.match(row.response.text,/缺项.*点位图/);assert.match(row.response.text,new RegExp('记录'+first.recordId));return {messageId:row.message.id,capture:await capture('native-materials')};});
  const issueId=await step('open same issue with lost HTTP receipt recovered through real button',async()=>{const row=await send('跟进记录'+first.recordId+'：底盒位置待核对',true);assert.ok(row.response.issue.issueId);assert.equal(row.response.issue.revision,1);return row.response.issue.issueId;});
  await step('native self-claim and persisted same-project reentry',async()=>{const row=await send('接手事项'+issueId);assert.equal(row.response.issue.revision,2);await open();const d=await(await current()).data();const original=d.items.find(i=>i.record.id===first.recordId);assert.equal(original.issue.issueId,issueId);assert.equal(original.issue.revision,2);return {issueId,revision:2};});
  await step('manager transfers to actual designer through the same composer',async()=>{await identity(0);const row=await send('转交事项'+issueId+'给合成设计师');assert.equal(row.response.issue.revision,3);assert.equal(row.response.issue.ownerName,'合成设计师');return {issueId,revision:3};});
  await step('designer reply returns to original record and remains awaiting review',async()=>{await identity(1);const row=await send('回复事项'+issueId+'：现场尺寸已复核，底盒先不固定，等有效点位图核对。');assert.equal(row.response.issue.revision,4);assert.equal(row.response.issue.status,'awaiting_review');await open();const query=await send('事项'+issueId+'在等谁？');assert.match(query.response.text,/已有处理回复/);assert.match(query.response.text,/不等于已解决/);return {issueId,revision:4,capture:await capture('native-reply-reentry')};});
  if(ctx.afterReply)await ctx.afterReply({mp,step,send,identity,open,capture,current,waitFor,issueId});
  if(!ctx.skipCancel)await step('author cancels with reason without publishing or resolving construction',async()=>{await identity(2);const before=await ctx.verify(),expected=before.events.length+1;const row=await send('取消事项'+issueId+'：本次跟进请求撤回，现场另行核对');assert.equal(row.response.issue.status,'cancelled');assert.equal(row.response.issue.revision,expected);const {data,events}=await ctx.verify();assert.equal(events.length,expected);const original=data.items.find(i=>i.record?.id===first.recordId);assert.equal(original.record.status,'draft');assert.equal(original.record.audience,'internal');return {issueId,revision:expected,events:events.map(e=>({id:e.id,type:e.type,revision:e.aggregate_version})),capture:await capture('native-cancelled')};});
  await step('membership removal clears native history and media on reentry',async()=>{await identity(1);await ctx.revoke();await mp.redirectTo('/'+route+'?projectId='+projectId);await waitFor(async()=>{const d=await(await current()).data();return d.fatal&&!d.items.length&&!Object.keys(d.mediaPaths).length;},'live permission denial');return {cleared:true};});
  report.passed=true;return report;
 }finally{
  if(mp&&installed){report.transport=await mp.evaluate(()=>{const app=getApp(),s=app.__qaShared;if(!s)return {active:false};const requests=s.requests.map(r=>({...r}));wx.request=s.request;wx.downloadFile=s.downloadFile;wx.uploadFile=s.uploadFile;wx.chooseMedia=s.chooseMedia;wx.previewImage=s.previewImage;wx.getStorageSync=s.getStorageSync;wx.setStorageSync=s.setStorageSync;wx.removeStorageSync=s.removeStorageSync;app.globalData.token=s.token;app.globalData.bootstrap=s.bootstrap;app.hydrateStoredSession=s.hydrate;delete app.__qaShared;return {active:false,requests};});try{await mp.reLaunch('/pages/index/index');}catch{} }
  if(mp)await mp.disconnect();report.finished=new Date().toISOString();save();
 }
};
