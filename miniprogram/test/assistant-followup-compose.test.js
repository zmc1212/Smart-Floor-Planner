const {test}=require('node:test'),assert=require('node:assert/strict');
const {reportQuestionMethods,ReportQuestionController}=require('../packages/assistant/lib/report-context');
const {AssistantClient}=require('../utils/assistant-client');

function fixture(projects=[{id:'2',name:'合成工地'}]){
 let identity='owner',intercept;const calls=[],sent=[],receipts=new Map();
 const chat={visible:true,session:identity,epoch:1,state:{draft:'我家水电刚开始，插座点位还没定，先确认什么？',conversation:{id:'901',mode:'ai',status:'open',reportContext:{version:0,selected:null}}},set(p){Object.assign(this.state,p);},async snapshot(){},fail(){}};
 const client=new AssistantClient(async(url,method,body,options)=>{const c={url,method,body,key:options.headers['Idempotency-Key']};calls.push(c);if(intercept)await intercept(c);
  if(!receipts.has(c.key))receipts.set(c.key,{conversationId:'901',version:body.expectedVersion+1,invalidated:false,selected:{...body.selection,kind:'stage',projectName:'合成工地',periodStart:'2026-11-02T00:00:00Z'}});
  if(c.lose)throw {statusCode:503};return {success:true,data:receipts.get(c.key)};});
 const q=new ReportQuestionController({client,identity:()=>identity,emit(){},headers:async()=>({}),openTopic(){}});q.bind(chat,'/followups/81/conversation');
 const f={chat,state:chat.state,canSend(){return chat.visible&&identity===chat.session&&!!chat.state.conversation.reportContext.selected;},async send(){sent.push(chat.state.draft);}};
 let current=true,closed=0;const reports=[{reportId:'22',revision:2,available:true,ready:true,kind:'stage',projects},{reportId:'20',revision:1,available:true,ready:true,projects}];
 const page={...reportQuestionMethods,reportQuestions:q,followupChatController:f,data:{followupActive:true,followupContext:{bindingId:'81',audience:'customer'},followupReports:reports},
  followups:{epoch:1,current:()=>current,closeReport(){closed++;},set(p){Object.assign(page.data,p);}}};
 return {page,q,f,chat,calls,sent,reports,closed:()=>closed,hide(){current=false;chat.visible=false;},identity(v){identity=v;},intercept(fn){intercept=fn;}};
}
test('first user send selects the newest eligible exact report, preserves draft and sends only after its receipt',async()=>{
 const f=fixture();await f.page.sendFollowup();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body.selection,{bindingId:'81',reportId:'22',revision:2,projectId:'2'});
 assert.deepEqual(f.sent,[f.chat.state.draft]);assert.equal(f.closed(),1);assert.equal(f.q.state.selected.reportId,'22');
 f.reports.unshift({...f.reports[0],reportId:'23'});await f.page.sendFollowup();assert.equal(f.calls.length,1);assert.equal(f.q.state.selected.reportId,'22');assert.equal(f.sent.length,2);
});
test('unknown selection does not send or allocate another selection; original key/body recovers before an explicit send',async()=>{
 const f=fixture();let first=true;f.intercept(c=>{if(first){first=false;c.lose=true;}});
 await f.page.sendFollowup();assert.equal(f.q.state.pending,true);assert.equal(f.sent.length,0);await f.page.sendFollowup();assert.equal(f.calls.length,1);
 await f.q.recover();assert.equal(f.calls[1].key,f.calls[0].key);assert.deepEqual(f.calls[1].body,f.calls[0].body);assert.equal(f.sent.length,0);
 await f.page.sendFollowup();assert.equal(f.sent.length,1);
});
test('permission/error or missing ready report leaves the original draft and does not send',async()=>{
 for(const statusCode of [403,409,429]){const f=fixture(),draft=f.chat.state.draft;f.intercept(()=>{throw {statusCode};});await f.page.sendFollowup();assert.equal(f.sent.length,0);assert.equal(f.chat.state.draft,draft);assert.ok(f.q.state.error);}
 const f=fixture();f.reports.splice(0);await f.page.sendFollowup();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);assert.ok(f.page.data.followupError);
});
test('multi-project choice cancellation, identity/hide or a changed selection fences late chooser callbacks',async()=>{
 const previous=global.wx;try{for(const action of ['cancel','identity','hide','version']){const f=fixture([{id:'2',name:'工地甲'},{id:'3',name:'工地乙'}]);let choice;global.wx={showActionSheet:o=>{choice=o;}};
  const pending=f.page.sendFollowup();assert.deepEqual(choice.itemList,['工地甲','工地乙']);
  if(action==='cancel')choice.fail();else{if(action==='identity')f.identity('other');if(action==='hide')f.hide();if(action==='version')f.q.state.version++;choice.success({tapIndex:1});}
  await pending;assert.equal(f.calls.length,0,action);assert.equal(f.sent.length,0,action);
 }}finally{global.wx=previous;}
});
test('multi-project chosen context is explicit, while draft edits and route changes prevent automatic sending',async()=>{
 const previous=global.wx;try{for(const action of ['choose','draft','hide']){const f=fixture([{id:'2',name:'工地甲'},{id:'3',name:'工地乙'}]);global.wx={showActionSheet:o=>o.success({tapIndex:1})};
  f.intercept(()=>{if(action==='draft')f.chat.state.draft='改成另一个问题';if(action==='hide')f.hide();});await f.page.sendFollowup();
  assert.equal(f.calls[0].body.selection.projectId,'3');assert.equal(f.sent.length,action==='choose'?1:0);
 }}finally{global.wx=previous;}
});
test('competing presses share one selection; existing pending send delegates without changing its context',async()=>{
 const f=fixture();let finish,start;const started=new Promise(r=>{start=r;});f.intercept(async()=>{start();await new Promise(r=>{finish=r;});});
 const pending=f.page.sendFollowup();await started;await f.page.sendFollowup();assert.equal(f.calls.length,1);finish();await pending;assert.equal(f.sent.length,1);
 const g=fixture();g.f.state.pendingSend=true;await g.page.sendFollowup();assert.equal(g.calls.length,0);assert.equal(g.sent.length,1);
});
test('unsent private draft survives a new controller only after an authorized read, is session-scoped and clears on successful send',async()=>{
 const previous=global.wx,store=new Map();global.wx={getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v)};
 const {FollowupChat}=require('../packages/assistant/lib/followup-chat'),{ChatController}=require('../packages/assistant/lib/chat');let identity='owner',denied=false;
 class Controller extends ChatController{constructor(args){super({...args,schedule:()=>0,unschedule(){}});}}
 class Media{dispose(){}}
 const context={bindingId:'81',conversationId:'901',audience:'customer'};
 const make=()=>new FollowupChat({Controller,Media,identity:()=>identity,headers:async()=>({}),emit(){},client:{pending:new Map(),async read(p){if(denied)throw {statusCode:403,code:'assistant_capability_forbidden'};return p.endsWith('/messages')?{items:[]}: {id:'901',mode:'ai',status:'open',reportContext:{version:0,selected:null}};}}});
 let a,b,c;try{
  a=make();await a.open(context);a.input('还没发出的插座问题');a.dispose();b=make();await b.open(context);assert.equal(b.state.draft,'还没发出的插座问题');
  b.chat.set({draft:''});b.dispose();c=make();await c.open(context);assert.equal(c.state.draft,'');c.input('本人私聊草稿');c.dispose();
  identity='other';b=make();await b.open(context);assert.equal(b.state.draft,'');b.dispose();
  identity='owner';denied=true;b=make();await b.open(context);assert.equal(b.state.draft,'');assert.equal(b.state.fatal,true);
 }finally{a?.dispose();b?.dispose();c?.dispose();global.wx=previous;}
});
test('local draft retention is bounded and expired entries cannot rehydrate private text',()=>{
 const previous=global.wx,store=new Map();global.wx={getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v)};
 try{const {FollowupChat}=require('../packages/assistant/lib/followup-chat'),c=new FollowupChat({identity:()=> 'owner'});c.session='owner';c.bid='81';
  for(let i=1;i<=21;i++){c.cid=String(i);c.drafts('draft'+i);}const saved=store.get('assistant-followup-drafts-v1');assert.equal(saved.items.length,20);
  c.cid='1';assert.equal(c.drafts(),undefined);c.cid='21';saved.items.at(-1).at=Date.now()-604800001;assert.equal(c.drafts(),undefined);
 }finally{global.wx=previous;}
});
