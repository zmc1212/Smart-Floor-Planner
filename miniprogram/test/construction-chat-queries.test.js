const test = require('node:test');
const assert = require('node:assert/strict');
const { SiteClient, decorate } = require('../packages/construction/chat/site-client');

test('shared query reentry renders original text, response and protected photos without record actions', async () => {
  const source = { message: { id: '8', created_at: '2026-10-17', content: { blocks: [{ text: '书房底盒待核对，帮我找资料' }] } },
    record: null, response: { text: '记录4 · 版本2；缺项：点位图', intent: 'query', media: [{ id: '9' }] } };
  const row = decorate(source); assert.equal(row.record.id, ''); assert.equal(row.record.canEdit, undefined); assert.match(row.response.text, /缺项/);
  const store = new Map(); global.wx = { getFileSystemManager: () => ({ unlink() {} }) };
  let stale = false, posts = 0;
  const client = new SiteClient({ emit() {}, identity: () => ({ key: '1:2', token: 'fixture' }),
    storage: { get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) },
    request: async (url,method) => { if (method === 'POST') { posts++; return { data: { runId: null, recordId: null, intent: 'query' } }; }
      return { data: { write: true, items: [{ ...source, response: { ...source.response, text: stale ? '关联资料已变化，请重新查询。' : source.response.text } }], nextCursor: null } }; },
    download: async () => ({ tempFilePath: '/synthetic-query.jpg' }) });
  await client.show('3'); client.input('查书房资料'); await client.send();
  assert.equal(posts, 1); assert.equal(client.state.success, '原话和回复已保存。'); assert.equal(client.state.draft, '');
  client.hide(); stale = true; await client.show('3'); assert.match(client.state.items[0].response.text, /已变化/); assert.equal(client.state.items[0].record.id, '');
});

test('a lost query receipt reuses the same operation key and never resends on reentry', async () => {
  const store = new Map(); let posts = 0;
  global.wx = { getFileSystemManager: () => ({ unlink() {} }) };
  const client = new SiteClient({ emit() {}, identity: () => ({ key: '1:2', token: 'fixture' }),
    storage: { get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) },
    request: async (url,method) => { if (method === 'POST') { posts++; throw {}; }
      return { data: url.includes('/operations/') ? { found: true, result: { recordId: null, runId: null, intent: 'query' } } : { write: true, items: [], nextCursor: null } }; } });
  await client.show('3'); client.input('查书房资料'); await client.send(); assert.ok(client.state.pending);
  client.hide(); await client.show('3'); assert.equal(posts, 1); assert.equal(client.state.pending, null); assert.equal(client.state.draft, '');
});
