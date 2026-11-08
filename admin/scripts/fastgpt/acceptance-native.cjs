/* eslint-disable @typescript-eslint/no-require-imports -- Existing Stable DevTools CLI controller. */
const fs=require('fs'),path=require('path'),http=require('http'),cp=require('child_process'),assert=require('assert/strict'),crypto=require('crypto');
module.exports=async({root,output,actor,questions,stage,assistantHttp,onQueued,onTurnReviewed,onSwitch,onStageCorrection,expectedCitationPages,expectedWebDomains,onSourceRevoked,onSourceRestored,initialCitation,initialCitations,savedMessages,priorFailedRunId})=>{
 const project=path.join(root,'miniprogram'),route='packages/assistant/chat/chat',cli=require(path.join(root,'admin/scripts/wechatide-native-client.ts')).wechatideNativeClient(project,output);
 const evidence={scope:questions.length?'Approved unified C01, original private stage feeds and one persistent knowledge conversation; real native inputs, writes and reentry, no per-Agent conversations':'Stage saved-body engineering regression, original private feeds/reentry/withdrawal and actual HTTP503 recovery; no knowledge model trial',checks:[],captures:[],requests:[]};
 const save=()=>fs.writeFileSync(path.join(output,'native.json'),JSON.stringify(evidence,null,2));
 const evaluate=async fn=>(await cli.call('automation_evaluate',{project,fnSource:fn})).result.result;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(fn,label,ms=150000)=>{const until=Date.now()+ms;while(Date.now()<until){const result=await fn();if(result)return result;if(evidence.queueError)throw Error(evidence.queueError);await pause(400);}throw Error('Native timeout: '+label);};
 const bootstrap='/identity/'+crypto.randomUUID();let used=false,installed=false,failOnce=false;
 const server=http.createServer(async(req,res)=>{
  try{
   if(req.url===bootstrap&&!used){used=true;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({...actor,port:server.address().port}));return;}
   if(req.headers.authorization!=='Bearer '+actor.token||!String(req.url).startsWith('/api/miniprogram/assistant/')){res.writeHead(403);res.end();return;}
   if(failOnce&&req.method==='GET'&&req.url.includes('/messages')){failOnce=false;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,code:'assistant_unavailable'}));evidence.requests.push({method:req.method,path:req.url,status:503,controlledFailure:true});save();return;}
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=Buffer.concat(chunks);
   const response=await assistantHttp(new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:bytes})}),req.url.split('?')[0].slice('/api/miniprogram/assistant/'.length).split('/'));
   const data=Buffer.from(await response.arrayBuffer());evidence.requests.push({method:req.method,path:req.url,status:response.status});save();res.writeHead(response.status,Object.fromEntries(response.headers));res.end(data);
   if(req.method==='POST'&&/\/conversations\/[^/]+\/messages$/.test(req.url)&&response.ok){
    const packet=JSON.parse(data.toString()),body=JSON.parse(bytes.toString()),result=packet.data||packet;
    const question=body.content?.blocks?.filter(b=>b.type==='text').map(b=>b.text).join('\n');
    try{await onQueued(question,String(result.runId),req.url.match(/\/conversations\/([^/]+)\//)[1]);}catch(error){evidence.queueError=String(error);save();}
   }
  }catch(error){evidence.serverError=String(error);save();if(!res.writableEnded){res.writeHead(503);res.end();}}
 });
 const capture=async name=>{assert.equal((await cli.pageStack()).at(-1).path,route);const file=path.join(output,name+'.png');await cli.screenshot({path:file});const b=fs.readFileSync(file);evidence.captures.push({file,route,logical:[390,844],encoded:[b.readUInt32BE(16),b.readUInt32BE(20)]});save();};
 // A transient infrastructure 503 (quote-bounded03) shows the citation sheet's
 // error state; retry the same tap with an unchanged availability assertion.
 const openCitation=async(page,citationId,label)=>{
  for(let attempt=0;attempt<3;attempt++){
   if(attempt){await evaluate('function(){getCurrentPages().at(-1).closeSheet();}');await pause(900);}
   const chip=await page.$('.citation-chip[data-id="'+citationId+'"]');assert.ok(chip,'citation chip '+citationId);
   await chip.tap();
   try{return await wait(async()=>{const v=await page.data();return v.sheet==='citation'&&!v.citationLoading&&v.citation?.available?v.citation:null;},label,50000);}
   catch(error){const d=await page.data();if(attempt===2)throw error;
    evidence.checks.push({citationRetry:attempt+1,citationId,transientState:{sheet:d.sheet,citationError:d.citationError,pageError:d.error}});save();}
  }
 };
 const enter=async bid=>{
  await cli.reLaunch('/'+route+'?followup=1');
  await wait(async()=>{const p=await cli.currentPage(),d=await p.data();return p.path===route&&!d.loading&&!d.fatal&&!d.followupListLoading?p:null;},'private entry');
  await evaluate(`function(){return getCurrentPages().at(-1).selectFollowup({currentTarget:{dataset:{id:'${bid}'}}});}`);
  return wait(async()=>{const p=await cli.currentPage(),d=await p.data();return d.followupContext?.bindingId===bid&&!d.followupLoading&&!d.loading?p:null;},'same private conversation');
 };
 const enterChat=async(cid=actor.cid)=>{
  await cli.reLaunch('/'+route+'?conversationId='+cid);
  return wait(async()=>{const p=await cli.currentPage(),d=await p.data();return p.path===route&&!d.loading&&!d.fatal&&d.conversation?.id===cid?p:null;},'original knowledge conversation');
 };
 try{
  const placement=JSON.parse(cp.execFileSync('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe',['-NoProfile','-File',path.join(root,'admin/scripts/wechatide-window-state.ps1')],{encoding:'utf8',windowsHide:true}));
  const windows=placement.Windows.filter(w=>w.Title==='miniprogram');assert.equal(windows.length,1);const b=windows[0].Minimized?windows[0].NormalBounds:windows[0].Bounds,x=(b.Left+b.Right)/2,y=(b.Top+b.Bottom)/2;
  assert.ok(placement.Screens.some(s=>!s.Primary&&x>=s.Bounds.X&&x<s.Bounds.X+s.Bounds.Width&&y>=s.Bounds.Y&&y<s.Bounds.Y+s.Bounds.Height));evidence.placement=placement;
  const listed=(await cli.call('project_list')).projects.filter(p=>path.resolve(p.projectPath).toLowerCase()===project.toLowerCase());assert.ok(listed.length);
  await cli.call('simulator_refresh',{project});await pause(6000);try{evidence.systemInfo=await cli.systemInfo();}catch(error){evidence.firstRuntimeError=String(error);await cli.call('simulator_refresh',{project});await pause(10000);evidence.systemInfo=await cli.systemInfo();}
  assert.equal(evidence.systemInfo.windowWidth,390);assert.equal(evidence.systemInfo.windowHeight,844);assert.equal(evidence.systemInfo.SDKVersion,'3.17.2');
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  await evaluate(`function(){const app=getApp();if(Object.keys(app).some(k=>/^__qa/.test(k)))throw Error('Controller busy');const p=getCurrentPages().at(-1);const s=app.__qaFastGPT={global:{...app.globalData},route:p.route,options:p.options||{},hydrate:app.hydrateStoredSession,get:wx.getStorageSync,set:wx.setStorageSync,remove:wx.removeStorageSync,request:wx.request,download:wx.downloadFile,memory:new Map()};wx.getStorageSync=function(k){return s.memory.has(k)?s.memory.get(k):String(k).startsWith('assistant-')?undefined:s.get.call(wx,k);};wx.setStorageSync=function(k,v){s.memory.set(k,v);};wx.removeStorageSync=function(k){s.memory.delete(k);};app.hydrateStoredSession=async function(){};}`);installed=true;
  await evaluate(`async function(){const app=getApp(),s=app.__qaFastGPT,v=await new Promise((resolve,reject)=>s.request.call(wx,{url:'http://127.0.0.1:${server.address().port}${bootstrap}',success:r=>resolve(r.data),fail:reject}));const context={mode:'customer',enterpriseId:'1454',enterpriseName:'微云'};s.port=v.port;app.globalData.token=v.token;app.globalData.userInfo={...context,id:v.uid,_id:v.uid,role:'user',nickname:'合成测试·FastGPT',phone:'synthetic'};app.globalData.bootstrap={current:{mode:'customer',role:'user',context,capabilities:['customer.service','account']},badges:{status:'ok',counts:{}}};app.globalData.sessionHydrated=true;app.globalData.sessionRecovery=null;app.globalData.sessionHydrating=false;app.globalData.sessionHydrationPromise=Promise.resolve();app.globalData.customerTab='xiaok';s.memory.set('token',v.token);s.memory.set('userInfo',app.globalData.userInfo);wx.request=function(o){const i=String(o.url).indexOf('/api/'),suffix=String(o.url).slice(i);if(i<0||!suffix.startsWith('/api/miniprogram/assistant/')){o.fail&&o.fail({errMsg:'Synthetic test denies unrelated API'});return{abort(){}};}return s.request.call(wx,{...o,url:'http://127.0.0.1:'+s.port+suffix});};return true;}`);
  for(const item of stage){let page=await enter(item.bindingId);
   const read=async()=>{const d=await page.data();return d.followupReports?.find(r=>r.reportId===item.reportId&&r.ready&&r.available&&r.projects?.[0]?.stageNote);};
   const card=await wait(read,'saved inline stage advice');assert.ok(await page.$('.followup-stage'));
   const expected=item.body.flatMap(p=>(p.standards||[]).map(s=>s.text)).join('\n');assert.equal(card.projects[0].stageNote,expected);
   await capture('stage-'+item.projectId);page=await enter(item.bindingId);assert.equal((await wait(read,'same stage advice after reentry')).projects[0].stageNote,expected);
   evidence.checks.push({stageReportId:item.reportId,originalConversation:item.conversationId,inlineSavedAdvice:true,persistedReentry:true,passed:true});save();}
  let page=await enterChat();
  if(savedMessages){if(!questions.length)evidence.scope='Original persisted native RAG replies: real reentry/citation taps, source withdrawal/restoration and HTTP503 recovery, without generating another answer';
   const checkSaved=async()=>{const d=await page.data();for(const original of savedMessages){const m=d.messages.find(m=>m.id===original.id);assert.ok(m?.available);assert.equal(m.content.blocks.filter(b=>b.type==='text').map(b=>b.text).join(''),original.text);}};
   await checkSaved();page=await enterChat();await checkSaved();await capture('knowledge-saved-readback');evidence.checks.push({persistedReentry:true,sameConversation:actor.cid,exactSavedProse:true,messageIds:savedMessages.map(m=>m.id),noModelReplay:true,passed:true});save();}
  for(const retained of initialCitations||(initialCitation?[initialCitation]:[])){const c=await openCitation(page,retained.id,'retained original citation');if(retained.page)assert.ok(c.title.includes('第'+retained.page+'页'));if(retained.domain)assert.ok(new URL(c.sourceUrl).hostname.endsWith(retained.domain));assert.ok(c.quote.length>4);await capture('retained-original-citation-'+retained.id.replaceAll(':','_'));await evaluate('function(){getCurrentPages().at(-1).closeSheet();}');evidence.checks.push({reusedOriginalCitation:retained.id,actualTap:true,noModelReplay:true,passed:true});save();}
  const savedTurns=[];
  for(let i=0;i<questions.length;i++){
   await wait(async()=>{const d=await page.data();return d.canSend&&!d.loading&&!d.busy&&!d.fatal&&!d.generating&&!d.pendingSend&&!d.pendingAction&&!d.readOnly&&!d.contextLoading&&!d.contextBusy&&!d.contextPending&&!d.speechBusy&&!d.reportQuestion?.busy&&!d.reportQuestion?.pending;},'enabled composer '+i);
   const before=await page.data(),count=(before.messages||[]).filter(m=>m.authorKind==='assistant'||m.role==='assistant').length;
   const resend=priorFailedRunId&&i===0;
   if(resend){
    assert.equal(before.run?.id,priorFailedRunId);assert.equal(before.run?.status,'failed');
    // A failed turn stays un-retryable while its usage reservation reconciles.
    assert.equal(before.retryable,false);
    await capture('knowledge-original-failed');
   }
   const input=await page.$('.composer-input'),send=await page.$('.send-button');assert.ok(input&&send);await input.input(questions[i]);
   await wait(async()=>{const d=await page.data();return d.draft===questions[i]&&!d.contextLoading;},'visible native draft '+i);
   if(i===0)await capture('knowledge-input');await send.tap();
   await wait(async()=>{const d=await page.data();return !d.busy&&!d.generating&&!d.pendingSend&&!d.uncertainRun&&(d.messages||[]).some(m=>(m.content?.blocks||[]).some(b=>b.text===questions[i]))&&(d.messages||[]).filter(m=>m.authorKind==='assistant'||m.role==='assistant').length>count;},'real knowledge answer '+i);
    if(onTurnReviewed)await onTurnReviewed();
   savedTurns.push((await page.data()).messages.filter(m=>m.authorKind==='assistant'||m.role==='assistant').at(-1));
   await capture('knowledge-turn-'+(i+1));evidence.checks.push({question:questions[i],sameConversation:actor.cid,
    ...(resend?{resentAfter:priorFailedRunId,originalRetryUnavailable:true}:{}),realInputAndSend:true,passed:true});save();
   if((!expectedWebDomains&&i===3)||expectedWebDomains?.[i]||expectedCitationPages?.[i]){
    const d=await page.data(),answer=d.messages.filter(m=>m.authorKind==='assistant'||m.role==='assistant').at(-1);
    const official=answer?.citations?.find(c=>c.available&&String(c.sourceUrl||c.sourceLocation||'').includes('nipponpaint.com.cn'));
    const citationId=official?.id||answer?.citations?.find(c=>c.available)?.id;assert.ok(citationId,'Saved official answer must have a native citation entry');
    const citation=await openCitation(page,citationId,'original official citation');
    if(expectedCitationPages?.[i]){assert.ok(citation.title.includes('第'+expectedCitationPages[i]+'页'));assert.equal(citation.isDraft,false);assert.ok(Number.isInteger(citation.locator.start));}
    else assert.ok(new URL(citation.sourceUrl).hostname.endsWith(expectedWebDomains?.[i]||'nipponpaint.com.cn'));assert.ok(citation.quote.length>4);await capture('knowledge-citation-'+(i+1));
    await evaluate('function(){getCurrentPages().at(-1).closeSheet();}');
    evidence.checks.push({officialCitation:{id:citation.id,sourceUrl:citation.sourceUrl,title:citation.title,sourceLocation:citation.sourceLocation,quote:citation.quote},actualTap:true,passed:true});save();
   }
  }
  if(questions.length){page=await enterChat();const d=await page.data();
   for(const turn of savedTurns){const message=d.messages.find(m=>m.id===turn.id);assert.ok(message?.available);assert.deepEqual(message.content,turn.content);}
   await capture('knowledge-reentry');evidence.checks.push({persistedReentry:true,sameConversation:actor.cid,exactSavedReplies:savedTurns.map(m=>m.id),passed:true});}
  if(onSourceRevoked){const affected=await onSourceRevoked();page=await enterChat();const d=await page.data();
   for(const id of affected.messageIds){const m=d.messages.find(m=>m.id===id);assert.ok(m);assert.equal(m.available,false);assert.ok(m.content.blocks.some(b=>b.type==='notice'&&b.code==='source_unavailable'));}
   await capture('knowledge-source-revoked');evidence.checks.push({sourceRevoked:true,savedMessagesUnavailable:affected.messageIds,passed:true});save();
   if(onSourceRestored){await onSourceRestored();page=await enterChat();const restored=await page.data();for(const id of affected.messageIds)assert.equal(restored.messages.find(m=>m.id===id)?.available,true);await capture('knowledge-source-restored');evidence.checks.push({sourceAuthorizationRestored:true,publishedSourcesRetained:true,passed:true});save();}
  }
  if(onSwitch){const next=await onSwitch();page=await enterChat(next.conversationId);assert.ok((await page.data()).messages.some(m=>m.id===next.messageId));await capture('knowledge-other-project');
   page=await enterChat();assert.ok(!(await page.data()).messages.some(m=>m.id===next.messageId));await capture('knowledge-original-project');evidence.checks.push({projectSwitch:true,separateOriginalProjectConversations:true,noOtherProjectMessage:true,passed:true});}
  failOnce=true;await cli.reLaunch('/'+route+'?conversationId='+actor.cid);await wait(async()=>{const d=await(await cli.currentPage()).data();return evidence.requests.some(r=>r.controlledFailure)&&(d.error||!d.loading&&d.conversation?.id===actor.cid);},'actual messages HTTP503');
  const failureFeedback=(await(await cli.currentPage()).data()).error||'automatic_read_recovery';page=await enterChat();await capture('knowledge-recovered');evidence.checks.push({actual503:true,failureFeedback,recoveredSameConversation:true,passed:true});
  if(onStageCorrection){const old=await onStageCorrection();await cli.reLaunch('/'+route+'?followup=1');page=await wait(async()=>{const p=await cli.currentPage(),d=await p.data();return p.path===route&&!d.loading&&!d.followupListLoading&&!d.followupLoading?p:null;},'revoked project after reentry');const d=await page.data();assert.ok(!d.followupBindings?.some(b=>b.bindingId===old.bindingId));assert.notEqual(d.followupContext?.bindingId,old.bindingId);assert.ok(!d.followupReports?.some(r=>r.reportId===old.reportId&&r.available));await capture('stage-withdrawn');evidence.checks.push({projectAccessRevoked:true,oldPrivateEntryRemoved:true,oldAdviceCleared:true,passed:true});}
  evidence.passed=true;
 }catch(error){evidence.passed=false;evidence.error=error.stack||String(error);try{const d=await(await cli.currentPage()).data();evidence.failureState=Object.fromEntries(['draft','loading','busy','fatal','error','canSend','readOnly','contextLoading','contextBusy','contextPending','contextError','speechBusy','generating','pendingSend','pendingAction','uncertainRun','locationNotice','portfolioNotice'].map(k=>[k,d[k]]));await capture('failure-state');}catch(stateError){evidence.failureStateError=String(stateError);}}
 finally{
  try{if(installed){const previous=await evaluate(`function(){const app=getApp(),s=app.__qaFastGPT;if(!s)return null;const p=getCurrentPages().at(-1);if(p.followupMedia)p.followupMedia.clear();const previous={route:s.route,options:s.options};wx.getStorageSync=s.get;wx.setStorageSync=s.set;wx.removeStorageSync=s.remove;wx.request=s.request;wx.downloadFile=s.download;app.hydrateStoredSession=s.hydrate;for(const k of Object.keys(app.globalData))delete app.globalData[k];Object.assign(app.globalData,s.global);delete app.__qaFastGPT;return previous;}`);if(previous)await cli.reLaunch('/'+previous.route+'?'+new URLSearchParams(previous.options));}evidence.cleanup=true;}catch(error){evidence.cleanupError=String(error);evidence.passed=false;}
  if(server.listening)await new Promise(resolve=>server.close(resolve));save();
 }
 return evidence;
};
