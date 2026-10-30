const test = require('node:test');
const assert = require('node:assert/strict');
const { SiteClient, decorate } = require('../packages/construction/chat/site-client');

test('knowledge reentry keeps original text and source actions separate from editable construction records',()=>{
  const item=decorate({message:{id:'10',content:{blocks:[{text:'管根要怎么处理？'}]},created_at:'2026-10-31'},record:null,
    response:{text:'先核对管根，再按原资料处理。',citations:[{id:'11',title:'精艺 · 原PDF第30页',available:true}],media:[],status:'succeeded'}});
  assert.equal(item.record.id,'');assert.equal(item.record.canEdit,undefined);
  assert.equal(item.response.citations[0].id,'11');assert.equal(item.text,'管根要怎么处理？');
});

test('hide and fatal permission refresh clear a previously opened knowledge source',()=>{
  global.wx={getFileSystemManager:()=>({unlink(){}})};
  const client=new SiteClient({emit(){},identity:()=>({key:'1454:worker',token:'fixture'}),storage:{get(){},set(){},remove(){}}});
  client.set({citation:{quote:'内部已发布原文'},citationLoading:true,citationError:'旧错误'});client.hide();
  assert.equal(client.state.citation,null);assert.equal(client.state.citationLoading,false);
  client.set({citation:{quote:'内部已发布原文'}});client.set({fatal:true});assert.equal(client.state.citation,null);
});

test('a successful project refresh revalidates an open source and removes a withdrawn quote',async()=>{
  global.wx={getFileSystemManager:()=>({unlink(){}})};
  let sourceReads=0;
  const client=new SiteClient({emit(){},identity:()=>({key:'1454:worker',token:'fixture'}),storage:{get(){},set(){},remove(){}},
    request:async url=>url.includes('/citations/')?(sourceReads++,{data:{id:'11',available:false,reason:'source_unavailable'}}):{data:{write:true,items:[],nextCursor:null}},download:async()=>({})});
  await client.show('237');client.set({citation:{id:'11',available:true,quote:'已撤回原文'}});await client.load();
  assert.equal(sourceReads,1);assert.equal(client.state.citation.available,false);assert.equal(client.state.citation.quote,undefined);assert.equal(client.state.fatal,false);
});

test('a late source response cannot restore content after project access was revoked',async()=>{
  global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:844,statusBarHeight:44}),getMenuButtonBoundingClientRect:()=>({top:48,height:32,left:290})};
  let definition;global.Page=p=>{definition=p;};
  require('../packages/construction/chat/chat');
  delete global.Page;
  let complete;
  const page={...definition,data:{...definition.data},setData(p){Object.assign(this.data,p);},openSheet(sheet,p){this.setData({...p,sheet});}};
  page.client={epoch:1,current:()=>true,set:p=>page.setData(p),request:()=>new Promise(resolve=>{complete=resolve;}),base:'/fixture'};
  const pending=page.openCitation({currentTarget:{dataset:{id:'11'}}});
  page.data.fatal=true;page.data.citation=null;
  complete({data:{available:true,quote:'已经撤权的旧响应'}});await pending;
  assert.equal(page.data.citation,null);
});
