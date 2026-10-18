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

test('issue conflicts preserve the draft, refresh revisions, and require a new explicit send', async () => {
  const store = new Map(), posts = [], page = {}; let revision = 3;
  global.wx = { getFileSystemManager: () => ({ unlink() {} }) };
  const client = new SiteClient({ emit: patch => Object.assign(page, patch), identity: () => ({ key: '1:2', token: 'fixture' }),
    storage: { get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) },
    request: async (url,method,body,options) => {
      if (method === 'POST') {
        posts.push({ body: structuredClone(body), key: options.headers['Idempotency-Key'] });
        if (posts.length === 1) { revision = 4; throw { statusCode: 409, error: 'version_conflict' }; }
        return { data: { recordId: null, runId: null, intent: 'issue' } };
      }
      return { data: { write: true, items: [], nextCursor: null, versions: { records: {}, issues: { 123: revision } } } };
    } });
  await client.show('3'); page.versions = [{ version: 2 }]; await client.load();
  assert.deepEqual(page.versions, [{ version: 2 }], 'an in-flight chat read must not replace record history with command revisions');
  client.input('回复事项123：待核对底盒位置'); await client.send();
  assert.equal(posts.length, 1); assert.equal(posts[0].body.versions.issues['123'], 3);
  assert.equal(client.state.pending, null); assert.equal(client.state.draft, '回复事项123：待核对底盒位置');
  assert.equal(client.sourceVersions.issues['123'], 4); assert.match(client.state.error, /已被更新/);
  assert.deepEqual(page.versions, [{ version: 2 }]);
  await client.send(); assert.equal(posts.length, 2); assert.equal(posts[1].body.versions.issues['123'], 4);
  assert.notEqual(posts[1].key, posts[0].key); assert.equal(client.state.draft, '');
});

test('shared drawing originals use the project grant URL and revocation clears cached bytes on the next read', async () => {
  const store = new Map(), downloads = [], removed = []; let revoked = false;
  global.wx = { getFileSystemManager: () => ({ unlink: value => removed.push(value.filePath) }) };
  const client = new SiteClient({ emit() {}, identity: () => ({ key: '1:2', token: 'fixture' }),
    storage: { get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) },
    request: async () => ({ data: { write: true, items: [{ message: { id: '10', content: { blocks: [{ text: '查书房图纸' }] } }, record: null,
      response: { text: revoked ? '关联资料已变化，请重新查询。' : '客户提供点位图原件', media: revoked ? [] : [{ id: 'shared-7-8' }] } }], nextCursor: null } }),
    download: async url => { downloads.push(url); return { tempFilePath: '/synthetic-drawing.png' }; } });
  await client.show('3'); assert.deepEqual(downloads, ['/miniprogram/construction/projects/3/chat/materials/7/media/8']);
  assert.equal(client.state.mediaPaths['shared-7-8'], '/synthetic-drawing.png');
  revoked = true; await client.load(); assert.deepEqual(client.state.mediaPaths, {});
  assert.ok(removed.includes('/synthetic-drawing.png')); assert.equal(downloads.length, 1);
  client.hide(); assert.equal(client.sourceVersions, null);
});

test('material hash conflicts retain the original text and require explicit resend with the refreshed hash', async () => {
  const store = new Map(), writes = []; let hash = 'a'.repeat(64);
  const client = new SiteClient({ emit() {}, identity: () => ({ key: '1:2', token: 'fixture' }),
    storage: { get: k => store.get(k), set: (k,v) => store.set(k,v), remove: k => store.delete(k) },
    request: async (url,method,body) => {
      if (method === 'POST') { writes.push(structuredClone(body)); if (writes.length === 1) { hash = 'b'.repeat(64); throw { statusCode: 409, code: 'version_conflict' }; }
        return { data: { recordId: null, runId: null } }; }
      return { data: { write: true, items: [], nextCursor: null, versions: { records: {}, issues: { 12: 3 }, materials: { 9: hash } } } };
    } });
  await client.show('3'); client.input('回复事项12：采用当前图纸核对位置'); await client.send();
  assert.equal(writes.length, 1); assert.equal(writes[0].versions.materials['9'], 'a'.repeat(64));
  assert.equal(client.state.draft, '回复事项12：采用当前图纸核对位置'); assert.equal(client.state.pending, null);
  await client.send(); assert.equal(writes.length, 2); assert.equal(writes[1].versions.materials['9'], 'b'.repeat(64));
});
