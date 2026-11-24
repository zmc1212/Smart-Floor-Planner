const test = require('node:test');
const assert = require('node:assert/strict');
const { manageWechatSubscription } = require('../packages/assistant/chat/wechat-subscription');

function fixture() {
  const state = { published: true, reports: true,
    channel: { id:'mine', status:'connected', match:true, verified:true, version:4, daily:true, weekly:false } };
  const actions = [], writes = [], feedback = [];
  const page = { _alive:true, _shown:true, _boardScope:{projectId:'21'}, data:{followupContext:{bindingId:'17'}},
    followups:{ epoch:1, current:() => true, headers:async()=>({'X-Assistant-Entry':'fixture-entry'}), client:{
      async read(path, body, headers, method) {
        assert.equal(path,'/followups/17/wechat?projectId=21'); assert.equal(headers['X-Assistant-Entry'],'fixture-entry');
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

test('report entry reopens personal preferences and changes only the selected period',async()=>{
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

test('leaving the project during selection prevents a stale subscription write',async()=>{
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
