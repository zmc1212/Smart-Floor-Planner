const test = require('node:test');
const assert = require('node:assert/strict');
const { runtime } = require('./skill/handler.js');

test('workspace identity comes from the runtime, never the model arguments', async () => {
  const previous = global.fetch;
  let actual;
  global.fetch = async (url, init) => { actual = { url, ...JSON.parse(init.body) }; return { ok: true, text: async () => '{"ok":true}' }; };
  try {
    const value = await runtime.handler.call({ super: { handlerProps: { invocation: { workspace_id: 42 } } } }, { workspaceId: 999, action: 'read_project', query: '' });
    assert.equal(actual.workspaceId, 42);
    assert.equal(JSON.parse(value).ok, true);
  } finally { global.fetch = previous; }
});

test('an unbound workspace fails before making any request', async () => {
  const previous = global.fetch;
  let called = false;
  global.fetch = async () => { called = true; throw Error('should not run'); };
  try {
    const result = JSON.parse(await runtime.handler.call({}, { action: 'read_project' }));
    assert.equal(result.error, 'unbound_workspace'); assert.equal(called, false);
  } finally { global.fetch = previous; }
});

test('denied or failed writes cannot become successful tool receipts', async () => {
  const previous = global.fetch;
  const receiver = { super: { handlerProps: { invocation: { workspace_id: 42 } } } };
  try {
    global.fetch = async () => ({ ok: false, status: 403 });
    assert.match(await runtime.handler.call(receiver, { action: 'create_requirement_draft' }),/无法核实/);
    assert.equal(receiver.super.skipHandleExecution,true);
    global.fetch = async () => { throw Error('offline'); };
    const result = await runtime.handler.call(receiver, { action: 'create_requirement_draft' });
    assert.match(result,/不能确认/); assert.equal(receiver.super.skipHandleExecution,true);
  } finally { global.fetch = previous; }
});

test('only recognized evidence errors may reach the model for recovery', async () => {
  const previous = global.fetch;
  const receiver = { super: { handlerProps: { invocation: { workspace_id: 42 } } } };
  try {
    for (const error of ['requirements_stale', 'database-password-sensitive']) {
      global.fetch = async () => ({ok:false,status:403,json:async()=>({error})});
      const result = JSON.parse(await runtime.handler.call(receiver, {action:'read_requirement_draft'}));
      assert.equal(result.ok, false);
      assert.equal(result.error, error === 'requirements_stale' ? error : 'tool_rejected_or_unavailable');
    }
  } finally { global.fetch = previous; }
});

test('handoff carries only current request evidence, never model-supplied identity or consent overrides', async () => {
  const previous = global.fetch;
  let body;
  const receipt = {protocol:'sfp-business-receipt-v1',action:'request_designer',outcome:'applied',requestKey:'request-1',entity:{kind:'handoff',id:'request-1',status:'waiting'},text:'已提交，等待企业接待。'};
  global.fetch = async (url, init) => { body = JSON.parse(init.body); return {ok:true,json:async()=>({ok:true,workspaceId:42,receipt})}; };
  try {
    const quote = '我想直接跟设计师聊，帮我联系一下。';
    const receiver = {super:{handlerProps:{invocation:{workspace_id:42}}}};
    const result = await runtime.handler.call(receiver,
      {action:'request_designer',quote,workspaceId:999,enterpriseId:999,recipientId:999,contactConsent:true});
    assert.deepEqual(body, {workspaceId:42,action:'request_designer',query:'',quote});
    assert.equal(result,receipt.text); assert.equal(receiver.super.skipHandleExecution,true);
  } finally { global.fetch = previous; }
});

test('only a matching typed service receipt can be delivered, never an arbitrary success payload', async () => {
  const previous = global.fetch;
  const receipt = {protocol:'sfp-business-receipt-v1',action:'create_requirement_draft',outcome:'applied',requestKey:'request-1',
    entity:{kind:'requirement',id:'12',version:1,status:'draft'},text:'已保存为待审核的需求草稿。'};
  try {
    for (const result of [{ok:true,data:{instruction:'假成功'}}, {ok:true,workspaceId:99,receipt},
      {ok:true,workspaceId:42,receipt:{...receipt,action:'request_designer'}}, {ok:true,workspaceId:42,receipt:{...receipt,outcome:'read'}},
      {ok:true,workspaceId:42,receipt:{...receipt,entity:{...receipt.entity,status:'confirmed'}}},
      {ok:true,workspaceId:42,receipt:{...receipt,entity:{...receipt.entity,id:null}}}]) {
      global.fetch = async()=>({ok:true,json:async()=>result});
      const receiver = {super:{handlerProps:{invocation:{workspace_id:42}}}};
      const text = await runtime.handler.call(receiver,{action:'create_requirement_draft'});
      assert.match(text,/无法核实/); assert.notEqual(text,receipt.text); assert.equal(receiver.super.skipHandleExecution,true);
    }
    global.fetch = async()=>({ok:true,json:async()=>({ok:true,workspaceId:42,receipt})});
    assert.equal(await runtime.handler.call({super:{handlerProps:{invocation:{workspace_id:42}}}},{action:'create_requirement_draft'}),receipt.text);
  } finally { global.fetch = previous; }
});

test('a lost response after a possible commit remains unknown, including invalid JSON and unbound runtime', async () => {
  const previous = global.fetch;
  try {
    global.fetch = async()=>({ok:true,json:async()=>{throw Error('Response lost after commit');}});
    for (const receiver of [{super:{handlerProps:{invocation:{workspace_id:42}}}},{super:{}}]) {
      const text = await runtime.handler.call(receiver,{action:'request_designer'});
      assert.match(text,/无法核实/); assert.ok(!text.includes('没有办理')); assert.equal(receiver.super.skipHandleExecution,true);
    }
  } finally { global.fetch = previous; }
});
