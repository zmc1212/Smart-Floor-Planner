/* eslint-disable @typescript-eslint/no-require-imports -- Same verified Stable CLI runner. */
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),http=require('node:http'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {liveTargetSelectors,revealNativeLiveTarget}=require('./public-live-native-target.cjs');
const diagnoseOwnerMedia=require('./public-live-native-media.cjs');
module.exports=async ctx=>{
  const {root,output,fixture:f,token}=ctx,project=path.join(root,'miniprogram'),route='packages/assistant/chat/chat',player='packages/construction/public-live/public-live',detail='packages/construction/public-site/public-site';
  const report={checks:[],captures:[],scope:'Approved C05 live decision, C03 actual public entry/player, persisted reentry, 503 retry and stop; no real camera or model calls'};
  const delay=ms=>new Promise(r=>setTimeout(r,ms)),tickets=new Map();let cli,installed=false;
  const server=http.createServer((req,res)=>{const value=tickets.get(req.url);if(value){tickets.delete(req.url);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}else{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:'public_live_unavailable'}));}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const save=()=>fs.writeFileSync(path.join(output,'native.json'),JSON.stringify(report,null,2)+'\n');
  const wait=async(fn,label,count=60)=>{for(let i=0;i<count;i++){const x=await fn();if(x)return x;await delay(400);}throw Error(label+' did not settle');};
  const step=async(name,fn)=>{try{await ctx.assertHeld();const data=await fn();await ctx.assertHeld();report.checks.push({name,passed:true,data});console.log('native '+name+': PASS');return data;}catch(e){report.checks.push({name,passed:false,error:e.stack,cliFailure:e.toJSON?.()});throw e;}finally{save();}};
  const page=target=>wait(async()=>{const p=await cli.currentPage();return p?.path===target?p:null;},'exact route '+target);
  const tap=async(p,selector)=>{const el=await p.$(selector);assert.ok(el,selector);await el.tap();};
  const capture=async(name,target)=>{assert.equal((await cli.pageStack()).at(-1).path,target);await delay(400);const file=path.join(output,name+'.png');assert.ok(!fs.existsSync(file));await cli.screenshot({path:file});const b=fs.readFileSync(file);report.captures.push({file,route:target,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)]});save();};
  const ownerReady=p=>wait(async()=>{const d=await p.data();const card=Object.values(d.liveCards||{}).find(c=>c.id===f.liveId&&c.versionId===f.versionId);return !d.loading&&!d.fatal&&card?{d,card}:null;},'current original live consent');
  const host=(file,args=[])=>{
    const pwsh='C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',quote=s=>"'"+s.replaceAll("'","''")+"'";
    const command="[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Import-Module -Name "+quote(path.join(path.dirname(pwsh),'Microsoft.PowerShell.Commands.Utility.dll'))+" -ErrorAction Stop; & "+quote(file)+args.map(x=>' '+(/^[\-][A-Za-z]+$/.test(x)?x:quote(x))).join('');
    return JSON.parse(cp.execFileSync(pwsh,['-NoProfile','-EncodedCommand',Buffer.from(command,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true}));
  };
  try{
    cli=ctx.client;
    // Stable forwards functionDeclaration directly to App.callFunction. The
    // controlled compile diagnostic supports direct defined-object results;
    // it does not establish an array/undefined or envelope workaround.
    cli.evaluateSource=async source=>{
      return (await cli.call('automation_evaluate',{project,fnSource:source})).result.result;
    };
    cli.evaluate=fn=>cli.evaluateSource(fn.toString());
    await step('one verified Stable project, idle queue and source-bound compiled runtime',async()=>{
      await ctx.assertHeld();report.status=await cli.call('check_wechatide_status',{skillVersion:'0.3.11'});assert.equal(report.status.loginExpired,false);assert.ok(['equal','agent_ahead'].includes(report.status.versionRelation));
      const projects=(await cli.call('project_list')).projects.filter(p=>path.resolve(p.projectPath).toLowerCase()===project.toLowerCase());assert.ok(projects.length);assert.ok(projects.every(p=>p.appId==='wxa7728432f59779d1'));
      report.placement=host(path.join(root,'tmp/wechat-devtools-version-test/window.ps1'),['-Action','Inspect','-IncludeHidden']);
      report.savedPlacement=host(path.join(root,'tmp/v1-02-conversation-list-visual/inspect-window.ps1'));
      assert.equal(report.placement.Handle,947063424);assert.equal(report.placement.ProjectWindows,1);assert.equal(report.savedPlacement.Handle,947063424);assert.equal(report.savedPlacement.ForegroundBefore,report.savedPlacement.ForegroundAfter);
      if(!report.placement.OnSecondary&&!(report.savedPlacement.Minimized&&report.savedPlacement.SavedOnSecondary)){
        // Standing Stable workflow: same verified project/lock, SWP_NOACTIVATE,
        // never -Foreground, no physical input or unrelated-window control.
        report.windowRestoration=host(path.join(root,'tmp/wechat-devtools-version-test/window.ps1'),['-Action','Place','-IncludeHidden']);
        report.savedPlacementAfter=host(path.join(root,'tmp/v1-02-conversation-list-visual/inspect-window.ps1'));
        assert.equal(report.windowRestoration.Handle,947063424);assert.equal(report.windowRestoration.OnSecondary,true);assert.equal(report.savedPlacement.ForegroundBefore,report.savedPlacementAfter.ForegroundAfter);
      }
      if(ctx.compileReuse)report.compileReuse=ctx.compileReuse;
      else await cli.call('simulator_refresh',{project});
      // Use the tool's bounded automator-readiness wait, not a fixed delay or
      // a successful refresh receipt as proof of compilation/readiness.
      await cli.call('automation_page_action',{project,action:'getData',wait:0});
      report.system=await cli.evaluate(()=>{const w=wx.getWindowInfo(),a=wx.getAppBaseInfo();return {windowWidth:w.windowWidth,windowHeight:w.windowHeight,SDKVersion:a.SDKVersion};});
      assert.equal(report.system.windowWidth,390);assert.equal(report.system.windowHeight,844);assert.equal(report.system.SDKVersion,'3.17.2');
      assert.deepEqual((await cli.evaluate(()=>({controllers:Object.keys(getApp()).filter(k=>/^__qa/.test(k))}))).controllers,[]);return {sameProject:true,argsFiles:0,physicalWechat:false};
    });
    await step('memory-only synthetic identity and real isolated HTTP transport',async()=>{
      // A response timeout may follow execution. Finally must reconcile this
      // attempt even when no successful installation receipt is delivered.
      installed=true;
      await cli.evaluate(()=>{
        const app=getApp();const s={request:wx.request,download:wx.downloadFile,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,modal:wx.showModal,hydrate:app.hydrateStoredSession,saved:{...app.globalData},memory:new Map(),requests:[],failNextLive:false};
        if(Object.keys(app).some(k=>/^__qa/.test(k)))throw Error('Controller occupied');app.__qaPublicLive=s;app.hydrateStoredSession=async()=>{};
        wx.getStorageSync=k=>s.memory.has(k)?s.memory.get(k):String(k).startsWith('assistant-')||String(k).startsWith('public-live:')?undefined:s.get.call(wx,k);
        wx.setStorageSync=(k,v)=>s.memory.set(k,v);wx.removeStorageSync=k=>s.memory.delete(k);
        wx.request=options=>{
          const raw=String(options.url),at=raw.indexOf('/api/'),suffix=at<0?'':raw.slice(at),method=options.method||'GET';
          const allowed=/^\/api\/(public\/construction(?:-live)?\/|miniprogram\/(?:assistant\/(?:public-live|entry-context|conversations|catalog)|bootstrap)|branding\/)/.test(suffix)
            && (method==='GET'||/\/assistant\/(?:public-live\/|entry-context)/.test(suffix)||(method==='POST'&&suffix===s.expectedPublicSession));
          if(!allowed){options.fail?.({errMsg:'Denied unrelated synthetic test API'});return {abort(){}};}
          const item={path:suffix,method};s.requests.push(item);const fault=s.failNextLive&&method==='GET'&&/^\/api\/public\/construction-live\/\d+\/[a-f0-9]{48}$/.test(suffix);if(fault)s.failNextLive=false;
          return s.request.call(wx,{...options,url:'http://127.0.0.1:'+(fault?s.port:3019)+suffix,success(r){item.status=r.statusCode;if(/\/assistant\/public-live\/\d+\/\d+\/session$/.test(suffix)&&r.data?.data?.url)s.lastOwnerSessionUrl=r.data.data.url;options.success?.(r);},fail(e){item.status='network_failure';options.fail?.(e);}});
        };
        wx.downloadFile=options=>{const raw=String(options.url),at=raw.indexOf('/api/'),suffix=at<0?'':raw.slice(at);if(!/^\/api\/public\/construction\//.test(suffix)){options.fail?.({errMsg:'Denied unrelated media'});return {abort(){}};}return s.download.call(wx,{...options,url:'http://127.0.0.1:3019'+suffix});};
        wx.showModal=options=>{if(options.title==='停止公开直播'){s.stopConfirmation={title:options.title,content:options.content};options.success?.({confirm:true,cancel:false});options.complete?.({confirm:true,cancel:false});return;}return s.modal.call(wx,options);};
        return {installed:true};
      });
      const ticket='/session/'+randomUUID();tickets.set(ticket,{token,uid:f.users.owner,eid:f.eid,cid:f.cid,key:f.key,port:server.address().port});
      const fn=()=>{const app=getApp(),s=app.__qaPublicLive;s.identityReady=false;s.request.call(wx,{url:'__TICKET__',success:r=>{const v=r.data;s.port=v.port;s.expectedPublicSession='/api/public/construction-live/'+v.eid+'/'+v.key+'/session';s.memory.set('token',v.token);app.globalData.token=v.token;app.globalData.userInfo={id:v.uid,_id:v.uid,mode:'customer',role:'user',nickname:'合成公开直播业主',phone:'synthetic'};app.globalData.bootstrap={current:{mode:'customer',role:'user',context:{mode:'customer',enterpriseId:v.eid,enterpriseName:'微云'},capabilities:['customer.service','account']},badges:{status:'ok',counts:{}}};app.globalData.sessionHydrated=true;app.globalData.sessionHydrationPromise=Promise.resolve();s.identityReady=true;},fail:e=>{s.identityError=String(e.errMsg||'identity_load_failed');}});return {requested:true};};
      await cli.evaluateSource(fn.toString().replace('__TICKET__','http://127.0.0.1:'+server.address().port+ticket));
      await wait(async()=>{const state=await cli.evaluate(()=>({ready:getApp().__qaPublicLive.identityReady,error:getApp().__qaPublicLive.identityError}));if(state.error)throw Error(state.error);return state.ready;},'one-use memory identity');
      return {tokensPersisted:false,serviceAnswersMocked:false};
    });
    if(ctx.diagnoseOwnerMedia){
      report.scope='Fixed owner HLS/MP4/segment diagnostic only; no approval, publication or complete native business acceptance';
      report.mediaDiagnostic=await step('current owner HLS event and same-origin MP4 comparison',()=>diagnoseOwnerMedia({cli,project,fixture:f,output,controlVideoUrl:ctx.controlVideoUrl,page,ownerReady,wait,capture}));
      report.passed=true;return report;
    }
    await step('owner opens full 16:9 preview, explicitly approves and reenters the original chat',async()=>{
      await cli.reLaunch('/'+route+'?conversationId='+f.cid);let p=await page(route),r=await ownerReady(p);assert.equal(r.card.status,'pending_owner');
      report.ownerActionTarget=await revealNativeLiveTarget(cli,project,f.liveId,r.card.messageId,'action',wait);
      await tap(p,liveTargetSelectors(r.card.messageId,'action')[0]);await wait(async()=>{const d=await p.data();return d.liveExpanded===f.liveId&&!d.liveBusy?d:null;},'complete live scope');
      r=await ownerReady(p);report.ownerScopeTarget=await revealNativeLiveTarget(cli,project,f.liveId,r.card.messageId,'scope',wait);
      await wait(async()=>{const d=await p.data();if(d.liveError&&!d.livePreviewUrl)throw Error('Current owner preview is not ready: '+d.liveError);return d.livePreviewReady&&!!d.livePreviewUrl;},'actual current-version owner preview progress');
      await capture('owner-full-scope',route);
      const hostFile=path.join(output,'owner-full-host.png');
      try{report.ownerHost=host(path.join(root,'tmp/v1-02-human-takeover/host-passive.ps1'),['-OutputPath',hostFile]);}
      catch(e){report.ownerHost={captured:false,error:e.message,scope:'Optional optical evidence; no focus/capture retry'};}
      const target=report.ownerScopeTarget.observations.at(-1).measurement,metrics=[target.start,null,target.end];
      assert.ok(metrics[0]?.width>200);assert.ok(Math.abs(metrics[0].width/metrics[0].height-16/9)<0.03);assert.ok(metrics[2]?.height>=44);report.ownerBounds=metrics;
      await tap(p,liveTargetSelectors(r.card.messageId,'action')[0]);await wait(async()=>{const d=await p.data();return Object.values(d.liveCards||{}).some(c=>c.id===f.liveId&&c.status==='owner_approved');},'persisted owner approval');
      await cli.reLaunch('/'+route+'?conversationId='+f.cid);p=await page(route);r=await ownerReady(p);assert.equal(r.card.status,'owner_approved');await capture('owner-reentry',route);return {originalConversation:f.cid,status:r.card.status,actualTaps:true};
    });
    if(ctx.ownerOnly){report.scope='Owner HLS preview, approval and original chat reentry only';report.passed=true;return report;}
    await step('real manager review then anonymous detail entry, actual video playback and pause',async()=>{
      await ctx.publish();
      await cli.evaluate(()=>{const app=getApp(),s=app.__qaPublicLive;s.ownerIdentity={token:app.globalData.token,userInfo:app.globalData.userInfo,bootstrap:app.globalData.bootstrap};s.memory.set('token','');s.memory.set('userInfo',null);app.globalData.token='';app.globalData.userInfo=null;app.globalData.bootstrap=null;return {anonymous:true};});
      await cli.reLaunch('/'+detail+'?enterpriseId='+f.eid+'&siteId='+f.photoId+'&versionId='+f.photoVersionId);let p=await page(detail);
      await wait(async()=>{const d=await p.data();return d.site?.id===f.photoId&&d.liveEntry?.key===f.key;},'real public detail and independent live entry');await capture('public-detail',detail);
      await tap(p,'.public-live-row button');p=await page(player);await wait(async()=>{const d=await p.data();if(d.state==='failed')throw Error('Native player connection failed: '+d.error);return d.state==='playing';},'actual native video play',90);await capture('public-playing',player);
      await cli.evaluate(()=>{wx.createSelectorQuery().select('.live-video-frame').boundingClientRect().select('.live-video-tools button').boundingClientRect().exec(rects=>{getApp().__qaPublicLive.playerMetrics=rects;});return {requested:true};});
      report.playerBounds=await wait(()=>cli.evaluate(()=>getApp().__qaPublicLive.playerMetrics||null),'player element bounds');
      assert.ok(Math.abs(report.playerBounds[0].width/report.playerBounds[0].height-16/9)<0.03);assert.ok(report.playerBounds[1].height>=44);
      await tap(p,'.live-video-tools button');await wait(async()=>(await p.data()).state==='paused','visible pause');await capture('public-paused',player);
      await tap(p,'.live-video-tools button');await wait(async()=>(await p.data()).state==='playing','current live resume');return {nativePlayed:true,serverAudio:'verified by service04 real decoding',paused:true};
    });
    await step('real HTTP503 clears media and the visible retry returns to current live',async()=>{
      await cli.evaluate(()=>{getApp().__qaPublicLive.failNextLive=true;return {armed:true};});
      await cli.reLaunch('/'+player+'?enterpriseId='+f.eid+'&key='+f.key);const p=await page(player);
      await wait(async()=>{const d=await p.data();return d.state==='failed'&&!d.src;},'real503 connection failure feedback');await capture('public-503',player);
      await tap(p,'.live-state-layer button');await wait(async()=>(await p.data()).state==='playing','same-scope actual retry');await capture('public-recovered',player);return {realHttp503:true,srcCleared:true,retried:true};
    });
    await step('owner stops through the real original card; old session and link fail, photos remain',async()=>{
      let p=await page(player);const oldSrc=(await p.data()).src;
      await cli.evaluate(()=>{const app=getApp(),s=app.__qaPublicLive;Object.assign(app.globalData,s.ownerIdentity);s.memory.set('token',s.ownerIdentity.token);s.memory.set('userInfo',s.ownerIdentity.userInfo);return {ownerRestored:true};});
      await cli.reLaunch('/'+route+'?conversationId='+f.cid);p=await page(route);const owner=await ownerReady(p);report.ownerStopTarget=await revealNativeLiveTarget(cli,project,f.liveId,owner.card.messageId,'stop',wait);await tap(p,liveTargetSelectors(owner.card.messageId,'stop')[0]);
      await wait(async()=>{const d=await p.data();return Object.values(d.liveCards||{}).some(c=>c.id===f.liveId&&c.status==='withdrawn');},'actual stopped receipt');await capture('owner-stopped',route);
      assert.equal((await fetch(oldSrc)).status,404);
      await cli.reLaunch('/'+player+'?enterpriseId='+f.eid+'&key='+f.key);p=await page(player);await wait(async()=>{const d=await p.data();return d.state==='stopped'&&!d.src;},'old-link persisted denial');await capture('public-stopped',player);
      await ctx.assertPhoto();return {oldSession:404,oldLinkStopped:true,photoStillPublished:true,confirmation:await cli.evaluate(()=>getApp().__qaPublicLive.stopConfirmation)};
    });
    report.passed=true;return report;
  }catch(e){report.passed=false;report.error=e.stack;report.cliFailure=e.toJSON?.();try{await ctx.assertHeld();const target=(await cli.currentPage())?.path;if(target)await capture('failure',target);}catch(x){report.captureError=x.message;}throw e;}
  finally{
    try{if(cli&&installed){report.restored=await cli.evaluate(()=>{const app=getApp(),s=app.__qaPublicLive;if(!s)return {restored:true,absent:true};for(const p of getCurrentPages()){p.liveConsent?.clear();p.publicSites?.clear();p.controller?.hide();p.clear?.();}wx.request=s.request;wx.downloadFile=s.download;wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;wx.showModal=s.modal;app.hydrateStoredSession=s.hydrate;for(const k of Object.keys(app.globalData))if(!(k in s.saved))delete app.globalData[k];Object.assign(app.globalData,s.saved);delete app.__qaPublicLive;return {restored:true,requests:s.requests};});await cli.reLaunch('/pages/index/index');}}
    catch(e){report.cleanupError=e.stack;report.passed=false;throw e;}
    finally{await new Promise(r=>server.close(r));save();}
  }
};
