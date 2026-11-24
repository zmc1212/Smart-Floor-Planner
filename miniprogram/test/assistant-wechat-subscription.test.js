const test = require('node:test');
const assert = require('node:assert/strict');
const { manageWechatSubscription } = require('../packages/assistant/chat/wechat-subscription');

function fixture() {
  const state = { published: true, reports: true,
    channel: { id:'mine', status:'connected', scope:'role', match:true, verified:true, version:4, daily:true, weekly:false } };
  const actions = [], writes = [], feedback = [];
  const page = { _alive:true, _shown:true, _boardScope:{projectId:'21'}, data:{followupContext:{bindingId:'17',audience:'customer'}},
    followups:{ epoch:1, current:() => true, headers:async()=>({'X-Assistant-Entry':'fixture-entry'}), client:{
      async read(path, body, headers, method) {
        assert.equal(path,'/followups/17/wechat?scope=role'); assert.equal(headers['X-Assistant-Entry'],'fixture-entry');
        if (method==='POST') {
          writes.push(body); assert.equal(body.id,state.channel.id);
          state.channel={...state.channel,...body,version:state.channel.version+1};
        }
        return { ...state, channel:{...state.channel} };
      },
    } } };
  global.wx = { showActionSheet(o){actions.push(o.itemList);o.success({tapIndex:1});},
    showToast(o){feedback.push(o.title);}, showModal(o){feedback.push(o.content);o.success({confirm:false});} };
  return {page,state,writes,actions,feedback};
}

test('report entry reopens role preferences and changes only the selected period',async()=>{
  const {page,state,writes,actions,feedback}=fixture();
  try {
    await manageWechatSubscription.call(page);
    assert.deepEqual(writes[0],{action:'preferences',id:'mine',version:4,daily:true,weekly:true});
    await manageWechatSubscription.call(page);
    assert.deepEqual(writes[1],{action:'preferences',id:'mine',version:5,daily:true,weekly:false});
    assert.equal(actions[1][1],'关闭微信周报');assert.equal(state.channel.daily,true);
    assert.deepEqual(feedback,['微信订阅已保存','微信订阅已保存']);
  }finally{delete global.wx;}
});

test('leaving the report scope during preferences prevents a stale subscription write',async()=>{
  const {page,writes}=fixture();
  global.wx.showActionSheet=o=>{page._boardScope={projectId:'22'};o.success({tapIndex:1});};
  try{await manageWechatSubscription.call(page);assert.deepEqual(writes,[]);}finally{delete global.wx;}
});

test('the recipient can disconnect their own account while reports are disabled',async()=>{
  const {page,state,writes}=fixture();state.reports=false;
  global.wx.showModal=o=>o.success({confirm:true});
  try {
    await manageWechatSubscription.call(page);
    assert.deepEqual(writes,[{action:'disconnect',id:'mine'}]);
  } finally {delete global.wx;}
});

function roleFixture({audience = 'boss', channel = { id:'mine', status:'connected', scope:'project', match:true, verified:true, version:4, daily:true, weekly:false }} = {}) {
  const state = { published:true, reports:true, audience, channel };
  const actions = [], writes = [], feedback = [], modalContents = [];
  const page = { _alive:true, _shown:true, _boardScope:{projectId:'21'},
    data:{followupContext:{bindingId:'17', audience, projects:[{id:'21',name:'旧工地'},{id:'22',name:'另一工地'}]}},
    followups:{ epoch:1, current:() => true, headers:async()=>({'X-Assistant-Entry':'fixture-entry'}), client:{
      async read(path, body, headers, method) {
        assert.equal(path,'/followups/17/wechat?scope=role');
        assert.equal(headers['X-Assistant-Entry'],'fixture-entry');
        if (method==='POST') {
          writes.push(body); assert.equal(body.id,state.channel.id);
          if (body.action==='upgrade') state.channel={...state.channel,scope:'role',daily:false,weekly:false,version:state.channel.version+1};
          else state.channel={...state.channel,...body,version:state.channel.version+1};
        }
        return { ...state, channel:{...state.channel} };
      },
    } } };
  const tapIndexes = [0, 0];
  global.wx = {
    showActionSheet(o){actions.push(o.itemList);o.success({tapIndex:tapIndexes.shift() ?? 0});},
    showToast(o){feedback.push(o.title);},
    showModal(o){modalContents.push(o.content);o.success({confirm:true});},
  };
  return {page,state,writes,actions,feedback,modalContents};
}

test('role entry uses the role scope and offers an explicit upgrade for an old project binding',async()=>{
  const {page,state,writes,actions,feedback,modalContents}=roleFixture();
  try {
    await manageWechatSubscription.call(page);
    assert.equal(actions.length,2);
    assert.equal(actions[0][0],'升级为本人角色范围');
    assert.equal(actions[1][0],'接收微信日报');
    assert.deepEqual(writes[0],{action:'upgrade',id:'mine',version:4});
    assert.deepEqual(writes[1],{action:'preferences',id:'mine',version:5,daily:true,weekly:false});
    assert.equal(state.channel.id,'mine');
    assert.equal(state.channel.scope,'role');
    assert.deepEqual(feedback,['微信订阅已保存']);
    assert.match(modalContents[0],/同一个微信 ClawBot/);
    assert.match(modalContents[0],/本企业下你当前有权限的全部工地/);
  } finally {delete global.wx;}
});

test('customer role entry explains separate authorized home sites when upgrading an old project binding',async()=>{
  const {page,writes,actions,modalContents}=roleFixture({audience:'customer'});
  try {
    await manageWechatSubscription.call(page);
    assert.equal(actions[0][0],'升级为本人角色范围');
    assert.deepEqual(writes[0],{action:'upgrade',id:'mine',version:4});
    assert.match(modalContents[0],/本企业中你仍有权限的各自家工地/);
    assert.match(modalContents[0],/不合并为每期汇总/);
  } finally {delete global.wx;}
});

test('role start explains the personal company scope and keeps ClawBot private chat independent from the Mini Program',async()=>{
  const state = {published:true,reports:true,audience:'worker',channel:null};
  const actions = [], writes = [], modalContents = [];
  const page = { _alive:true, _shown:true, _boardScope:{projectId:'21'},
    data:{followupContext:{bindingId:'17',audience:'worker',projects:[{id:'21',name:'不应选择'}]}},
    followups:{epoch:1,current:()=>true,headers:async()=>({}),client:{
      async read(path,body,headers,method){
        assert.equal(path,'/followups/17/wechat?scope=role');
        if(method==='POST') writes.push(body);
        return {...state};
      },
    }},
  };
  global.wx = {
    showActionSheet(o){actions.push(o.itemList);o.success({tapIndex:0});},
    showModal(o){modalContents.push(o.content);o.success({confirm:false});},
  };
  try {
    await manageWechatSubscription.call(page);
    assert.equal(actions.length,0);
    assert.deepEqual(writes,[]);
    assert.match(modalContents[0],/本人微信/);
    assert.match(modalContents[0],/本企业中你当前角色有权限的工地/);
    assert.match(modalContents[0],/ClawBot 私聊/);
    assert.match(modalContents[0],/小程序相互独立/);
  } finally {delete global.wx;}
});

test('role entry drops a pending write when the report page is reentered',async()=>{
  let resolveRead;
  const readReady = new Promise(resolve=>{resolveRead=resolve;});
  const writes = [];
  const page = { _alive:true, _shown:true, _boardScope:{projectId:'21'},
    data:{followupContext:{bindingId:'17',audience:'boss'}},
    followups:{epoch:1,current:()=>true,headers:async()=>({}),client:{
      async read(path,body,headers,method){
        assert.equal(path,'/followups/17/wechat?scope=role');
        await readReady;
        if(method==='POST') writes.push(body);
        return {published:true,reports:true,audience:'boss',channel:{id:'mine',status:'connected',scope:'role',match:true,verified:true,version:1,daily:false,weekly:false}};
      },
    }},
  };
  global.wx = {showActionSheet(){throw new Error('stale role entry must not open preferences');}};
  const run = manageWechatSubscription.call(page);
  await new Promise(resolve=>setImmediate(resolve));
  page._boardScope = {projectId:'22'};
  resolveRead();
  try { await run; assert.deepEqual(writes,[]); } finally {delete global.wx;}
});
