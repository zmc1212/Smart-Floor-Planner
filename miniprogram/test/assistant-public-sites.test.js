const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient, entryInput, messagesForView } = require('../packages/assistant/lib/client');
const { PublicChatController } = require('../packages/assistant/lib/public-sites');
const { PublicSitesController } = require('../packages/construction/public-sites/public-sites-model');
const { PublicMedia } = require('../utils/public-site-client');
const material = () => ({id:'21',versionId:'31',revision:1,status:'pending_owner',name:'春和苑',cityCode:'420500',district:'伍家岗区',stageName:'水电',photos:[],excerpts:[{role:'业主（匿名）',text:'预留洗碗机',date:'2026-10-17'}],excerptCount:1,canDecide:true,updatedAt:'2026-10-17'});
const noMedia = () => ({clear(){},async load(){}});

test('public browsing is anonymous, keeps the visitor consultation and never carries a project/owner identity', async()=>{
  const calls=[];const c=new PublicSitesController({emit(){},identity:()=>'',media:noMedia(),client:{async read(eid,path,params){calls.push({eid,path,params});return path==='areas'?{items:[{cityCode:'420500',district:'伍家岗区',label:'伍家岗区'}]}:{items:[material()]};}}});
  await c.show({enterpriseId:'1',conversationId:'11'});assert.equal(c.state.items.length,1);assert.equal(calls[1].path,'sites');
  const url=c.privateChat(c.state.items[0],true);assert.match(url,/conversationId=11/);assert.match(url,/publicSiteId=21/);assert.match(url,/findDesigner=1/);assert.doesNotMatch(url,/leadId|projectId|ownerId/);
  assert.deepEqual(entryInput({conversationId:'11',publicEnterpriseId:'1',publicSiteId:'21'}),{conversationId:'11'});
  assert.deepEqual(entryInput({publicEnterpriseId:'1',publicSiteId:'21'}),{publicEnterpriseId:'1'});
  c.hide();assert.equal(c.state.items.length,0);
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
