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
    assert.equal(JSON.parse(await runtime.handler.call(receiver, { action: 'create_requirement_draft' })).ok, false);
    global.fetch = async () => { throw Error('offline'); };
    const result = JSON.parse(await runtime.handler.call(receiver, { action: 'create_requirement_draft' }));
    assert.equal(result.ok, false); assert.equal(result.error, 'tool_unavailable');
  } finally { global.fetch = previous; }
});

test('only recognized evidence errors may reach the model for recovery', async () => {
  const previous = global.fetch;
  const receiver = { super: { handlerProps: { invocation: { workspace_id: 42 } } } };
  try {
    for (const error of ['requirements_stale', 'database-password-sensitive']) {
      global.fetch = async () => ({ok:false,status:403,json:async()=>({error})});
      const result = JSON.parse(await runtime.handler.call(receiver, {action:'create_requirement_draft'}));
      assert.equal(result.ok, false);
      assert.equal(result.error, error === 'requirements_stale' ? error : 'tool_rejected_or_unavailable');
    }
  } finally { global.fetch = previous; }
});
