const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AssistantClient, messagesForView } = require('../packages/assistant/lib/client');
const { PlanChatController } = require('../packages/assistant/lib/plans');
const material = () => ({id:'21',issueId:'9',mediaId:'31',revision:1,number:2,title:'书房插座调整',roomName:'书房',difference:'双人桌新增一组插座',costDeltaCents:50000,scheduleDeltaDays:2,status:'pending_customer'});
const noMedia = () => ({clear(){},async load(){}});

test('formal approval requires full current-version details and loaded original, with exact persisted effects',async()=>{
  const calls=[];const client=new AssistantClient(async(path,method,body)=>{
    calls.push({path,body});const preview=path.endsWith('/preview');return {success:true,data:{id:'21',revision:body.expectedRevision+1,status:preview?'pending_customer':'approved',...(preview?{material:{...material(),revision:body.expectedRevision+1}}:{})}};
  });
  const c=new PlanChatController({emit(){},identity:()=> 'a',client,media:noMedia()});await c.load('11',[{planDecision:material()}]);
  assert.equal(await c.decide('21','approve'),false);assert.equal(calls.length,0);
  assert.equal(await c.decide('21','preview'),true);assert.equal(c.state.planExpanded,'21');assert.equal(await c.decide('21','approve'),false);
  c.set({planPaths:{[c.state.planCards['21'].key]:'authorized.png'}});assert.equal(await c.decide('21','approve'),true);
  assert.equal(calls.at(-1).body.expectedRevision,2);assert.equal(c.state.planCards['21'].status,'approved');assert.equal(c.state.planCards['21'].canDecide,false);
  assert.equal(c.state.planCards['21'].costLabel,'+500.00元');assert.equal(c.state.planCards['21'].scheduleLabel,'+2天');
});
test('malformed or mismatched plan receipts retain original action/version/key across page recreation',async()=>{
  const prior=global.wx,store=new Map([['token','session-a']]);global.wx={getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,JSON.parse(JSON.stringify(v)))};
  try{
    let saved;const client=new AssistantClient(async(path,method,body,o)=>{saved={path,body,key:o.headers['Idempotency-Key']};return {success:true,data:{id:'99',revision:8,status:'approved'}};});
    await assert.rejects(client.mutate('plan-decision:11:21','/conversations/11/plans/21/approve',{expectedRevision:7}));assert.ok(client.pending.size);
    const reopened=new AssistantClient(async(path,method,body,o)=>{assert.equal(path,saved.path);assert.deepEqual(body,saved.body);assert.equal(o.headers['Idempotency-Key'],saved.key);return {success:true,data:{id:'21',revision:8,status:'approved'}};});
    await reopened.mutate('plan-decision:11:21','/conversations/11/plans/21/decline',{expectedRevision:100});assert.equal(reopened.pending.size,0);
    store.set('token','session-b');assert.equal(new AssistantClient().pending.size,0);
  }finally{global.wx=prior;}
});
test('preview receipts need matching full immutable material, including explicit impact values',async()=>{
  for(const patch of [{id:'99'},{revision:9},{costDeltaCents:null},{scheduleDeltaDays:undefined},{mediaId:''},{difference:undefined},{number:0}]){
    const c=new AssistantClient(async()=>({success:true,data:{id:'21',revision:2,status:'pending_customer',material:{...material(),revision:2,...patch}}}));
    await assert.rejects(c.mutate('plan-decision:11:21','/conversations/11/plans/21/preview',{expectedRevision:1}));assert.ok(c.pending.has('plan-decision:11:21'));
  }
});
test('defer and requested-change states persist while source revocation clears cards and cached media',async()=>{
  let clears=0;const client=new AssistantClient(async(path,method,body)=>({success:true,data:{id:'21',revision:body.expectedRevision+1,status:path.endsWith('/defer')?'deferred':'changes_requested'}}));
  const c=new PlanChatController({emit(){},identity:()=> 'a',client,media:{clear(){clears++;},async load(){}}});await c.load('11',[{planDecision:material()}]);
  const good=client.request;client.request=async()=>{throw {statusCode:409,code:'version_conflict'};};
  assert.equal(await c.decide('21','request-changes','右移插座，保留说明'),false);assert.equal(c.reason('21'),'右移插座，保留说明');client.request=good;
  assert.equal(await c.decide('21','defer'),true);assert.equal(c.state.planCards['21'].status,'deferred');assert.equal(c.state.planCards['21'].canDecide,true);
  assert.equal(await c.decide('21','request-changes','右移插座'),true);assert.equal(c.state.planCards['21'].status,'changes_requested');
  client.request=async()=>{throw {statusCode:404,code:'plan_unavailable'};};assert.equal(await c.decide('21','details'),false);assert.deepEqual(c.state.planCards,{});assert.ok(clears>0);
});
test('late plan response cannot overwrite a different identity or resurrect replaced version details',async()=>{
  let resolve,token='a';const client=new AssistantClient(()=>new Promise(r=>{resolve=r;}));
  const c=new PlanChatController({emit(){},identity:()=>token,client,media:noMedia()});await c.load('11',[{planDecision:material()}]);
  const work=c.decide('21','preview');token='b';c.clear();resolve({success:true,data:{id:'21',revision:2,status:'pending_customer',material:{...material(),revision:2}}});
  assert.equal(await work,false);assert.deepEqual(c.state.planCards,{});
  const d=new PlanChatController({emit(){},identity:()=>token,media:noMedia()});await d.load('11',[{planDecision:material()}]);d.set({planCards:{'21':{...d.state.planCards['21'],full:material()}}});
  await d.load('11',[{planDecision:{...material(),revision:2}}]);assert.equal(d.state.planCards['21'].full,null);assert.equal(d.state.planExpanded,'');
});
test('only one available server-projected exact version exposes a decision card',()=>{
  const rows=messagesForView([{id:'1',seq:'1',planDecision:material()},{id:'2',seq:'2',planDecision:material()},{id:'3',seq:'3',available:false,planDecision:material()}]);
  assert.deepEqual(rows.filter(r=>r.planDecision).map(r=>r.id),['2']);
});
