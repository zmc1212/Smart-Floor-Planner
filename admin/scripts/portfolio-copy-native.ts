/* Serial native continuation of the live copy fixture. The parent controller
 * retains the isolated acceptance lock; this helper owns the sole SDK handle. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { loadEnvConfig } from '@next/env';
import { sql } from 'drizzle-orm';
import { withPlatformTransaction } from '@/db/transaction';
import { one } from '@/db/repositories/assistant-repository';
import { closePostgresPool } from '@/lib/postgresql';
import { ConversationService } from '@/lib/assistant/core/conversation';
import { PortfolioService } from '@/lib/portfolio/service';
import { PortfolioCatalog } from '@/lib/portfolio/catalog';
import { SignJWT } from 'jose';
import type { ActorContext } from '@/lib/assistant/contracts';
import { wechatideNativeClient } from './wechatide-native-client';
type Data = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- Existing official SDK payloads.
declare const wx: Data; declare function getApp(): Data;
const root=path.resolve(process.cwd(),'..');loadEnvConfig(process.cwd(),true);
process.env.DATABASE_URL=JSON.parse(fs.readFileSync(path.join(root,'tmp/xiaok-vector/connection.private.json'),'utf8').replace(/^\uFEFF/,'')).DATABASE_URL;
const ledger=process.argv[2];assert.match(ledger,/^trial-d3-copy-live-[0-9TZ-]+\.json$/);
const parent=JSON.parse(fs.readFileSync(path.join(root,'tmp/agent-contract',ledger),'utf8'));
assert.equal(parent.calls.length,4);assert.ok(parent.calls.every((call:Data)=>call.status==='succeeded'));assert.equal(parent.cleaned,false);
const attempt=process.argv[3];assert.match(attempt||'',/^0[2-9]$/);
const directory=path.join(parent.fixture ? path.join(root,'tmp',ledger.slice(6,-5)) : '', 'native-published-'+attempt);fs.mkdirSync(directory);
const project=path.join(root,'miniprogram'),mp=wechatideNativeClient(project,directory),delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const report:Data={parentLedger:ledger,checks:[],captures:[],modelCalls:0,installed:false,restored:false,passed:false};let userId='',installed=false;
const save=()=>fs.writeFileSync(path.join(directory,'evidence.json'),JSON.stringify(report,null,2));
const files=['admin/scripts/portfolio-copy-native.ts','admin/scripts/wechatide-native-client.ts','admin/src/lib/portfolio/service.ts','admin/src/lib/portfolio/copy-service.ts','miniprogram/packages/assistant/lib/portfolio-page.js','miniprogram/packages/assistant/lib/portfolio.js','miniprogram/packages/assistant/designer/designer.wxml','miniprogram/packages/assistant/work/work.wxml','miniprogram/project.config.json','miniprogram/project.private.config.json'];
const binding=()=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')]));
async function waitPage(route:string,predicate:(data:Data)=>boolean){for(let n=0;n<25;n++){const page=await mp.currentPage();if(page?.path===route){const data=await page.data();if(!data.loading&&predicate(data))return{page,data};}await delay(700);}throw Error('Native state did not settle: '+route);}
async function capture(name:string,route:string){assert.equal((await mp.currentPage())?.path,route);const file=path.join(directory,name+'.png');await mp.screenshot({path:file});report.captures.push({route,file,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});save();}
async function main(){report.before=binding();save();try{
  const status=await fetch('http://127.0.0.1:3188/status').then(r=>r.json());assert.equal(status.runId,ledger.slice(6,-5));assert.equal(status.busy,false);assert.equal(status.calls,4);
  const windowState=await promisify(cp.execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'admin/scripts/wechatide-window-state.ps1')],{windowsHide:true,timeout:10000});
  const windows=JSON.parse(windowState.stdout.replace(/^\uFEFF/,'')),target=windows.Windows.filter((w:Data)=>w.Title==='WeChat Web Devtools');assert.equal(target.length,1);
  const b=target[0].Bounds,x=(b.Left+b.Right)/2,y=(b.Top+b.Bottom)/2;assert.ok(windows.Screens.some((s:Data)=>!s.Primary&&x>=s.Bounds.X&&x<s.Bounds.X+s.Bounds.Width&&y>=s.Bounds.Y&&y<s.Bounds.Y+s.Bounds.Height));report.window=windows;
  for(let attempt=0;attempt<2;attempt++){await mp.call('simulator_refresh',{project});await delay(6000);try{const system=await mp.systemInfo(),page=await mp.currentPage();assert.equal(system.windowWidth,390);assert.equal(system.windowHeight,844);assert.ok(page&&Object.keys(await page.data()).length);report.system=system;break;}catch(error){if(attempt)throw error;report.initialFrozen=String(error);}}
  const eid=parent.fixture.enterpriseId,wid=parent.fixture.works[0].id,service=new PortfolioService({enterpriseId:eid,adminId:parent.fixture.adminId}),detail=await service.execute('detail',{workId:wid});
  const version=String((detail.work as Data).published_version_id),content=(detail.head as Data).content;assert.ok(version&&version!=='null');
  userId=String((await withPlatformTransaction(tx=>one(tx,sql`insert into app.users(nickname,context_version) values(${'SYNTHETIC-D3-COPY-NATIVE-'+randomUUID()},1) returning id`)))!.id);report.userId=userId;
  await withPlatformTransaction(tx=>tx.execute(sql`insert into app.wechat_identities(user_id,openid) values(${userId},${'synthetic-copy-native-'+randomUUID()})`));
  const actor:ActorContext={enterpriseId:eid,principal:{kind:'user',userId},contextVersion:1,capabilities:['assistant.chat.self']};
  const conversation=await new ConversationService(actor).create(randomUUID()),cid=String(conversation.id),share=await new PortfolioCatalog(actor,cid).share(wid,version);
  // Load the configured secret before signing: static imports in a standalone
  // TSX driver run before loadEnvConfig, whereas the actual Next server does not.
  assert.ok(process.env.JWT_SECRET);
  const token=await new SignJWT({sub:userId,id:userId,contextVersion:1,mode:'customer',role:'user',enterpriseId:eid,source:'wechat'})
    .setProtectedHeader({alg:'HS256'}).setAudience('miniprogram').setSubject(userId).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(process.env.JWT_SECRET));
  report.identity={enterpriseId:eid,workId:wid,versionId:version,conversationId:cid};report.expected={title:content.title,description:content.description};save();
  installed=true;
  await mp.evaluate((config:Data)=>{const app=getApp();if(Object.keys(app).some(key=>/^__qa(?:ReviewNative|Shared|Materials|C05|Synthesis|History|D2|D3)/.test(key)))throw Error('Native controller busy');
    const state:Data={request:wx.request,download:wx.downloadFile,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,token:app.globalData.token,bootstrap:app.globalData.bootstrap,hydrate:app.hydrateStoredSession,memory:new Map()};app.__qaD3=state;
    app.hydrateStoredSession=async()=>{};app.globalData.token=config.token;app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{enterpriseId:config.enterpriseId}}};state.memory.set('token',config.token);
    wx.getStorageSync=(key:string)=>key.startsWith('assistant-')?state.memory.get(key):state.memory.has(key)?state.memory.get(key):state.get.call(wx,key);wx.setStorageSync=(key:string,value:unknown)=>state.memory.set(key,value);wx.removeStorageSync=(key:string)=>state.memory.delete(key);
    state.target=(raw:string)=>{const index=raw.indexOf('/api/miniprogram/assistant/');return index<0?null:'http://127.0.0.1:3112'+raw.slice(index);};
    wx.request=(options:Data)=>{const url=state.target(String(options.url));if(!url){options.fail?.({errMsg:'Synthetic-only transport'});return{abort(){}};}return state.request.call(wx,{...options,url});};
    wx.downloadFile=(options:Data)=>{const url=state.target(String(options.url));if(!url){options.fail?.({errMsg:'Synthetic-only media'});return{abort(){}};}return state.download.call(wx,{...options,url});};
  },{token,enterpriseId:eid});report.installed=true;
  let entryConversation='';
  for(let entry=0;entry<2;entry++){
    await mp.redirectTo(share.path);const studio=await waitPage('packages/assistant/designer/designer',d=>d.featuredWork?.id===wid&&Object.keys(d.images||{}).length>0);
    assert.equal(studio.data.featuredWork.title,content.title);
    // Signing a share does not make the seed consultation the recipient's
    // content-entry conversation. Verify the actual entry owner, then reentry.
    if(!entry){entryConversation=String(studio.data.conversationId);await new ConversationService(actor).detail(entryConversation);report.identity.entryConversationId=entryConversation;}
    else assert.equal(String(studio.data.conversationId),entryConversation);
    if(!entry)await capture('d01-generated-copy','packages/assistant/designer/designer');
    await (await studio.page.$('.studio-window'))!.tap();const work=await waitPage('packages/assistant/work/work',d=>d.work?.id===wid&&Object.keys(d.images||{}).length>0);
    assert.equal(work.data.work.title,content.title);assert.equal(work.data.work.description,content.description);await capture(entry?'d02-reentry':'d02-generated-copy','packages/assistant/work/work');
    report.checks.push({name:entry?'same consultation and exact reviewed text survive native reentry':'published actual model copy is visible through signed native entry',passed:true});save();
  }
  await service.execute('withdraw',{workId:wid,expectedVersion:(detail.work as Data).version},randomUUID());
  await mp.redirectTo('/packages/assistant/work/work?conversationId='+entryConversation+'&workId='+wid+'&versionId='+version);
  const unavailable=await waitPage('packages/assistant/work/work',d=>d.unavailable);assert.equal(Object.keys(unavailable.data.images||{}).length,0);
  report.checks.push({name:'withdrawn publication no longer exposes text/private assets',passed:true});await capture('d02-withdrawn','packages/assistant/work/work');report.passed=true;
}catch(error){report.error=String((error as Error).stack||error);process.exitCode=1;}finally{
  const errors:string[]=[];
  try{if(installed)report.restored=await mp.evaluate(()=>{const app=getApp(),state=app.__qaD3;if(!state)return false;wx.request=state.request;wx.downloadFile=state.download;wx.getStorageSync=state.get;wx.setStorageSync=state.set;wx.removeStorageSync=state.remove;app.globalData.token=state.token;app.globalData.bootstrap=state.bootstrap;app.hydrateStoredSession=state.hydrate;delete app.__qaD3;return true;});}catch(error){errors.push(String(error));}
  try{if(installed)await mp.reLaunch('/pages/index/index');await mp.disconnect();}catch(error){errors.push(String(error));}
  try{if(userId)await withPlatformTransaction(tx=>tx.execute(sql`update app.users set context_version=context_version+1 where id=${userId}`));}catch(error){errors.push(String(error));}
  report.after=binding();report.drift=Object.keys(report.before).filter(file=>report.before[file]!==report.after[file]);report.cleanupErrors=errors;if(errors.length||report.drift.length){report.passed=false;process.exitCode=1;}save();await closePostgresPool();console.log(JSON.stringify({directory,passed:report.passed,checks:report.checks,restored:report.restored,drift:report.drift,error:report.error||null,userId}));
}}
void main();
