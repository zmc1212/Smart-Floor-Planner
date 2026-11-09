const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient, entryInput, messagesForView } = require('../packages/assistant/lib/client');
const { PublicChatController } = require('../packages/assistant/lib/public-sites');
const { PublicSitesController } = require('../packages/construction/public-sites/public-sites-model');
const { PublicMedia } = require('../utils/public-site-client');
const discoveryReply = { id: '61', discovery: { sites: true, works: false } };

test('ordinary replies never open discovery and a later topic leaves the list attached to the original reply', async () => {
  const calls = [];
  const controller = new PublicChatController({ emit() {}, identity: () => 'a', media: noMedia(), detailMedia: noMedia(),
    client: { pending: new Map(), async read(path, query) { calls.push([path, query]); return { items: [material()] }; } } });
  const ordinary = { id: '62' };
  await controller.load('11', '1', [ordinary]);
  assert.deepEqual(calls, []);
  await controller.load('11', '1', [discoveryReply]);
  await controller.load('11', '1', [discoveryReply, ordinary]);
  assert.deepEqual(calls, Array(2).fill(['/conversations/11/public-sites/recommendations', { replyId: '61' }]));
  assert.equal(controller.state.publicReplyId, '61');
  await controller.load('11', '1', [ordinary]);
  assert.equal(controller.state.publicReplyId, '');
  assert.deepEqual(controller.state.publicItems, []);
});
const material = () => ({id:'21',versionId:'31',revision:1,status:'pending_owner',name:'春和苑',cityCode:'420500',district:'伍家岗区',stageName:'水电',photos:[],excerpts:[{role:'业主（匿名）',text:'预留洗碗机',date:'2026-10-17'}],excerptCount:1,canDecide:true,updatedAt:'2026-10-17'});
const noMedia = () => ({clear(){},async load(){}});

test('chat browsing reads the full public catalog in the server-resolved region without changing consultations', async () => {
  const reads = [];
  const c = new PublicChatController({ emit(){}, identity:()=> 'a', media:noMedia(), detailMedia:noMedia(),
    client:new AssistantClient(async()=>({success:true,data:{items:[material()],region:{cityCode:'420500',district:'伍家岗区'}}})),
    catalog:{async read(eid,path,params){reads.push({eid,path,params});return {items:[material(),{...material(),id:'22'}]};}} });
  await c.browse('11','1',[discoveryReply],'','61');
  assert.equal(c.cid,'11'); assert.equal(c.state.publicBrowsing,true); assert.equal(c.state.publicItems.length,2);
  assert.deepEqual(reads,[{eid:'1',path:'sites',params:{cityCode:'420500',district:'伍家岗区'}}]);
  assert.equal(c.state.publicLoading,false);
  c.catalog.read=async()=>({items:[]}); await c.load('11','1',[discoveryReply]);
  assert.match(c.state.publicNotice,/暂时没有授权公开/);
  c.catalog.read=async()=>{throw {statusCode:503};}; await c.load('11','1',[discoveryReply]);
  assert.deepEqual(c.state.publicItems,[]); assert.match(c.state.publicError,/重新读取/);
  c.catalog.read=async()=>({items:[material()]}); await c.load('11','1',[discoveryReply]);
  assert.equal(c.state.publicError,''); assert.equal(c.state.publicItems.length,1);
});

test('denied location falls back to public service areas and a hidden browsing response is discarded', async () => {
  let finish;
  const c = new PublicChatController({ emit(){}, identity:()=> 'a', media:noMedia(), detailMedia:noMedia(),
    client:new AssistantClient(async()=>({success:true,data:{items:[],needRegion:true}})),
    catalog:{async read(eid,path,params){assert.deepEqual(params,{});return {items:[material()]};}} });
  await c.browse('11','1',[discoveryReply],'定位未授权，可以告诉我房屋所在城市。','61');
  assert.match(c.state.publicNotice,/定位未授权/);
  c.catalog.read=()=>new Promise(resolve=>{finish=resolve;});
  const pending=c.load('11','1',[discoveryReply]); while(!finish) await new Promise(resolve=>setImmediate(resolve));
  c.clear();finish({items:[material()]});await pending;
  assert.equal(c.state.publicBrowsing,false);assert.deepEqual(c.state.publicItems,[]);
});

test('public detail is read in the chat sheet and stale versions or closed sheets cannot restore it', async () => {
  const reads=[],media=[];let finish;
  const c=new PublicChatController({emit(){},identity:()=> 'a',media:noMedia(),detailMedia:{clear(){},async load(wanted){media.push(wanted);}},
    catalog:{async read(eid,path,params){reads.push({eid,path,params});return {...material(),photos:[{id:'41'}]};}} });
  assert.equal(await c.openDetail('11','1','21','31'),true);
  assert.deepEqual(reads,[{eid:'1',path:'sites/21',params:{versionId:'31'}}]);
  assert.equal(media[0][0].path,'/public/construction/1/sites/21/media/41?versionId=31');
  c.catalog.read=()=>new Promise(resolve=>{finish=resolve;});
  const pending=c.readDetail();c.closeDetail();finish(material());assert.equal(await pending,false);
  assert.equal(c.state.publicDetail,null);assert.equal(c.state.publicDetailLoading,false);
  c.catalog.read=async()=>{throw {statusCode:404,code:'public_site_unavailable'};};
  c.set({publicItems:[material()]});assert.equal(await c.openDetail('11','1','21','31'),false);
  assert.deepEqual(c.state.publicItems,[]);assert.match(c.state.publicDetailError,/撤回或更新/);
});

test('nearby entry and detail stay in the current chat and preserve an unfinished draft', async () => {
  const oldApp=global.getApp,oldWx=global.wx;global.getApp=()=>({globalData:{token:'a'}});
  global.wx={navigateTo(){throw Error('Public browsing must stay in the chat');}};
  try {
    const page=require('../packages/assistant/chat/chat-definition')();let finish;const calls=[];
    Object.assign(page,{_alive:true,_shown:true,controller:{conversationId:'11'},data:{enterpriseId:'1',messages:[discoveryReply],draft:'原来的装修问题',canSend:true},
      syncLocation:()=>new Promise(resolve=>{finish=resolve;}),scrollBottom(){},openSheet(sheet){this.data.sheet=sheet;},
      publicSites:{async browse(...args){calls.push(args);},async openDetail(...args){calls.push(args);}}});
    const event={currentTarget:{dataset:{message:'61'}}};
    const pending=page.browseSites(event);await page.browseSites(event);finish({notice:'定位未授权'});await pending;
    assert.deepEqual(calls,[['11','1',[discoveryReply],'定位未授权','61']]);
    await page.openPublicSite({currentTarget:{dataset:{id:'21',version:'31'}}});
    assert.equal(page.data.sheet,'publicSite');assert.deepEqual(calls[1],['11','1','21','31']);
    assert.equal(page.data.draft,'原来的装修问题');assert.equal(page.controller.conversationId,'11');
    const stale=page.browseSites(event);page.controller.conversationId='12';finish({});await stale;assert.equal(calls.length,2);
  }finally{global.getApp=oldApp;global.wx=oldWx;}
});

test('asking about a displayed public version attaches it once to the original chat and keeps the draft', async () => {
  const page=require('../packages/assistant/chat/chat-definition')();let finish;const calls=[];
  Object.assign(page,{_alive:true,_shown:true,data:{publicDetail:material(),enterpriseId:'1',canSend:true,draft:'水电怎么做？'},
    controller:{conversationId:'11',async refresh(){calls.push('refresh');}},closeSheet(){calls.push('close');},scrollBottom(){},
    publicSites:{attach(...args){calls.push(args);return new Promise(resolve=>{finish=resolve;});}}});
  const pending=page.askPublicSite();await page.askPublicSite();assert.equal(calls.length,1);
  finish(true);await pending;assert.deepEqual(calls,[['11','1','21','31'],'close','refresh']);
  assert.equal(page.data.draft,'水电怎么做？');
  page.data.readOnly=true;await page.askPublicSite();assert.equal(calls.length,3);
});

test('public browsing is anonymous, keeps the visitor consultation and never carries a project/owner identity', async()=>{
  const calls=[];const c=new PublicSitesController({emit(){},identity:()=>'',media:noMedia(),client:{async read(eid,path,params){calls.push({eid,path,params});return path==='areas'?{items:[{cityCode:'420500',district:'伍家岗区',label:'伍家岗区'}]}:{items:[material()]};}}});
  await c.show({enterpriseId:'1',conversationId:'11'});assert.equal(c.state.items.length,1);assert.equal(calls[1].path,'sites');
  const url=c.privateChat(c.state.items[0],true);assert.match(url,/conversationId=11/);assert.match(url,/publicSiteId=21/);assert.match(url,/findDesigner=1/);assert.doesNotMatch(url,/leadId|projectId|ownerId/);
  assert.deepEqual(entryInput({conversationId:'11',publicEnterpriseId:'1',publicSiteId:'21'}),{conversationId:'11'});
  assert.deepEqual(entryInput({publicEnterpriseId:'1',publicSiteId:'21'}),{publicEnterpriseId:'1'});
  c.hide();assert.equal(c.state.items.length,0);
});

test('the public-paper designer action resumes the same consultation and exact public version before handoff', async()=>{
  const oldApp=global.getApp,oldWx=global.wx;const calls=[];let url;
  global.getApp=()=>({globalData:{token:'a'}});global.wx={navigateTo(input){url=input.url;}};
  try{
    const makePage=require('../packages/assistant/chat/chat-definition');const page=makePage();
    Object.assign(page,{_alive:true,_shown:true,controller:{conversationId:'11'},data:{sheet:'publicSite',publicDetail:material(),enterpriseId:'1',draft:'保留我的装修问题'}});
    page.publicLiveDesigner();assert.ok(url);
    const options=Object.fromEntries(new URL('https://mini.test'+url).searchParams);
    assert.deepEqual(options,{conversationId:'11',publicEnterpriseId:'1',publicSiteId:'21',publicVersionId:'31',findDesigner:'1'});
    assert.deepEqual(entryInput(options),{conversationId:'11'});assert.doesNotMatch(url,/leadId|projectId|ownerId/);
    assert.equal(page.data.draft,'保留我的装修问题');
    const resumed=makePage();Object.assign(resumed,{_alive:true,_options:options,data:{enterpriseId:'1',draft:'保留我的装修问题'},
      liveConsent:{},location:{},plans:{},floorplans:{async show(){}},speechController:{async show(){}},followups:{async show(){}},
      controller:{conversationId:'11',async show(input){assert.deepEqual(entryInput(input),{conversationId:'11'});},async refresh(){calls.push('refresh');},async handoff(){calls.push('handoff');}},
      publicSites:{async attach(...args){calls.push(args);return true;}},async syncLocation(){}});
    await resumed.onShow();assert.deepEqual(calls,[['11','1','21','31'],'refresh','handoff']);
    assert.equal(resumed.data.draft,'保留我的装修问题');assert.equal(resumed._options.findDesigner,undefined);
    calls.length=0;resumed._options={...options,publicSiteId:'21',publicVersionId:'31',findDesigner:'1'};
    resumed.publicSites.attach=async(...args)=>{calls.push(args);return false;};
    await resumed.onShow();assert.deepEqual(calls,[['11','1','21','31']]);assert.equal(resumed._options.findDesigner,'1');
  }finally{global.getApp=oldApp;global.wx=oldWx;}
});

test('the public-paper designer action rejects hidden, unavailable or incomplete detail and retains anonymous entry',()=>{
  const previous=global.wx;const urls=[];global.wx={navigateTo:input=>urls.push(input.url)};
  try{
    const makePage=require('../packages/assistant/chat/chat-definition');
    const ready=()=>Object.assign(makePage(),{_alive:true,_shown:true,controller:{conversationId:'11'},data:{sheet:'publicSite',publicDetail:material(),enterpriseId:'1'}});
    for(const change of [p=>p._shown=false,p=>p._alive=false,p=>p.data.sheet='',p=>p.data.publicDetail=null,p=>p.data.publicDetailLoading=true,p=>p.data.publicDetailError='已撤回',p=>p.data.readOnly=true,p=>p.data.publicPending=true,p=>p.data.publicDetail.versionId='',p=>p.controller.conversationId='bad']){
      const page=ready();change(page);page.publicLiveDesigner();
    }
    assert.deepEqual(urls,[]);
    const guest=ready();guest.controller.conversationId='';guest.publicLiveDesigner();
    const options=Object.fromEntries(new URL('https://mini.test'+urls[0]).searchParams);
    assert.deepEqual(entryInput(options),{publicEnterpriseId:'1'});assert.equal(options.publicSiteId,'21');assert.equal(options.publicVersionId,'31');assert.equal(options.findDesigner,'1');
  }finally{global.wx=previous;}
});

test('withdrawal removes detail and a late response cannot restore it after hiding', async()=>{
  let resolve;const c=new PublicSitesController({emit(){},identity:()=>'',media:noMedia(),client:{read(){return new Promise(r=>{resolve=r;});}}});
  const loading=c.show({enterpriseId:'1',siteId:'21',versionId:'31'},true);c.hide();resolve(material());await loading;assert.equal(c.state.site,null);
  c.client.read=async()=>{throw {statusCode:404,code:'public_site_unavailable'};};await c.show({enterpriseId:'1',siteId:'21',versionId:'31'},true);assert.equal(c.state.unavailable,true);assert.equal(c.state.site,null);
});

test('owner approval requires a full expanded preview and uses its new revision', async()=>{
  const events=messagesForView([{id:'1',seq:'1',publicConsent:material()},{id:'2',seq:'2',publicConsent:material()}]);
  assert.equal(events.filter(m=>m.publicConsent).length,1);assert.equal(events.find(m=>m.publicConsent).id,'2');
  const writes=[];const client=new AssistantClient(async(path,method,body)=>{
    if(method==='GET')return {success:true,data:{items:[]}};
    writes.push({path,body});return {success:true,data:{id:'21',versionId:'31',revision:body.expectedRevision+1,status:path.endsWith('/preview')?'pending_owner':'owner_approved',...(path.endsWith('/preview')?{material:{...material(),revision:body.expectedRevision+1}}:{})}};
  });
  const c=new PublicChatController({emit(){},identity:()=> 'a',client,media:noMedia()});await c.load('11','1',[{publicConsent:material()}]);
  assert.equal(await c.decide('21_31','approve'),false);assert.equal(writes.length,0);
  assert.equal(await c.decide('21_31','preview'),true);assert.equal(c.state.publicExpanded,'21_31');assert.ok(c.state.publicCards['21_31'].full);
  c.later();assert.equal(await c.decide('21_31','approve'),false);
  await c.decide('21_31','preview');assert.equal(await c.decide('21_31','approve'),true);assert.equal(writes.at(-1).body.expectedRevision,3);assert.equal(c.state.publicCards['21_31'].canDecide,false);
  client.request=async()=>{throw {statusCode:401};};await c.decide('21_31','withdraw');assert.deepEqual(c.state.publicCards,{});assert.equal(c.state.publicExpanded,'');
});

test('an unknown owner decision survives page recreation with its original action, version, revision and key', async()=>{
  const previous=global.wx,storage=new Map([['token','a']]);global.wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v))};
  try{let key;const first=new AssistantClient(async(path,method,body,opts)=>{if(method==='GET')return {success:true,data:{items:[]}};key=opts.headers['Idempotency-Key'];throw {statusCode:503};});
    const c=new PublicChatController({emit(){},identity:()=> 'a',client:first,media:noMedia()});await c.load('11','1',[{publicConsent:material()}]);await c.decide('21_31','decline');assert.ok(c.state.publicPending);assert.equal(await c.decide('21_31','preview'),false);
    const second=new AssistantClient(async(path,method,body,opts)=>{if(method==='GET')return {success:true,data:{items:[]}};assert.match(path,/\/decline$/);assert.equal(opts.headers['Idempotency-Key'],key);assert.deepEqual(body,{versionId:'31',expectedRevision:1});return {success:true,data:{id:'21',versionId:'31',revision:2,status:'declined'}};});
    const reopened=new PublicChatController({emit(){},identity:()=> 'a',client:second,media:noMedia()});await reopened.load('11','1',[{publicConsent:{...material(),revision:8}}]);assert.ok(reopened.state.publicPending);assert.equal(await reopened.retry(),true);assert.equal(second.pending.size,0);
    storage.set('token','b');assert.equal(new AssistantClient().pending.size,0);
  }finally{global.wx=previous;}
});

test('hiding or switching identity discards a later successful owner receipt', async()=>{
  let token='a',finish;const client=new AssistantClient(async(path,method)=>method==='GET'?{success:true,data:{items:[]}}:new Promise(r=>{finish=r;}));
  const c=new PublicChatController({emit(){},identity:()=>token,client,media:noMedia()});await c.load('11','1',[{publicConsent:material()}]);const pending=c.decide('21_31','preview');c.clear();token='b';finish({success:true,data:{id:'21',versionId:'31',revision:2,status:'pending_owner',material:material()}});assert.equal(await pending,false);assert.deepEqual(c.state.publicCards,{});
});

test('photo preview rechecks permission and deletes cached bytes on withdrawal', async()=>{
  const previous=global.wx,deleted=[],shown=[];global.wx={getFileSystemManager:()=>({unlink:({filePath})=>deleted.push(filePath)}),previewImage:value=>shown.push(value)};
  try{let revoked=false,latest;const m=new PublicMedia({identity:()=>'',emit:p=>{latest=p;},download:async()=>{if(revoked)throw {statusCode:404};return {tempFilePath:'/tmp/public.jpg'};}});
    await m.load([{key:'21_31_41',path:'/public/construction/1/sites/21/media/41?versionId=31'}]);revoked=true;await m.preview('21_31_41');assert.equal(shown.length,0);assert.ok(deleted.includes('/tmp/public.jpg'));assert.equal(latest.publicMediaRevoked,true);assert.deepEqual(m.paths,{});
  }finally{global.wx=previous;}
});
