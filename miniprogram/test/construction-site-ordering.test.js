const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SiteClient } = require('../packages/construction/chat/site-client');
test('a late read cannot replace the result of a newer read in the same project/identity', async () => {
  let finish, calls = 0;
  const client = new SiteClient({ emit() {}, identity: () => ({ key: '1:2', token: 'same' }), storage: { get() {}, set() {}, remove() {} },
    request: async () => { if (++calls === 2) return new Promise(resolve => { finish = resolve; }); return { data: { project: { name: calls === 3 ? '新名称' : '最初名称' }, items: [], rooms: [] } }; } });
  await client.show('22'); const old = client.load(); await client.load(); finish({ data: { project: { name: '过期资料' }, items: [], rooms: [] } }); await old;
  assert.equal(client.state.project.name, '新名称');
});
