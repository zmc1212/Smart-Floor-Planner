const test = require('node:test');
const assert = require('node:assert/strict');
const { SiteClient, decorate } = require('../packages/construction/chat/site-client');
const { SiteRecordMedia } = require('../packages/assistant/lib/site-records');
const { ChatController } = require('../packages/assistant/lib/chat');
const { messagesForView } = require('../packages/assistant/lib/client');
const fixture = () => ({ success: true, data: { conversationId: '44', project: { id: '22', name: '工地', customerAccess: true }, write: true, manage: false, rooms: [], items: [], nextCursor: null } });
function setup(request) {
  let identity = { key: '1:2', token: 'token-a' }; const store = new Map(), removed = [];
  global.wx = { getFileSystemManager: () => ({ unlink: ({ filePath }) => removed.push(filePath) }) };
  const storage = { get: k => store.get(k), set: (k, v) => store.set(k, JSON.parse(JSON.stringify(v))), remove: k => store.delete(k) };
  const writes = [], client = new SiteClient({ emit() {}, storage, identity: () => identity,
    request: async (url, method, body, options) => { if (method === 'POST') writes.push({ url, body, key: options.headers['Idempotency-Key'] }); return request ? request(url, method, body, options) : fixture(); },
    download: async () => ({ tempFilePath: '/private-photo.jpg' }), uploadFile: async () => ({ id: '7' }) });
  return { client, store, storage, writes, removed, identity: () => identity, switchIdentity: () => { identity = { key: '9:8', token: 'token-b' }; } };
}
test('unknown sends retain their original key/body and reentry reconciles the accepted write without duplication', async () => {
  let accepted = false, requests = 0;
  const s = setup(async (url, method) => {
    if (method === 'POST') { requests++; accepted = true; throw {}; }
    if (url.includes('/operations/')) return { data: { found: accepted, result: { recordId: '31' } } };
    return fixture();
  });
  await s.client.show('22'); s.client.input('书房线管完成，底盒未固定。'); await s.client.send();
  const pending = s.client.state.pending; assert.ok(pending); assert.equal(pending.body.text, '书房线管完成，底盒未固定。');
  s.client.hide(); await s.client.show('22'); assert.equal(s.client.state.pending, null); assert.equal(requests, 1); assert.equal(s.client.state.draft, '');
});
test('a version conflict preserves edits, refreshes current records and never substitutes a newer expectedVersion', async () => {
  const s = setup(async (url, method, body) => { if (method === 'POST') { assert.equal(body.expectedVersion, 3); throw { statusCode: 409, error: 'version_conflict' }; }
    const value = fixture(); value.data.items = [{ message: { id: '1', created_at: new Date().toISOString(), content: { blocks: [] } }, record: { id: '6', version: 4, data: { title: '其他成员的最新内容' }, status: 'draft', media: [] } }]; return value; });
  await s.client.show('22'); s.client.set({ sheet: 'edit', edit: { title: '原核对输入' } });
  await s.client.mutate({ id: '6', version: 3, canEdit: true }, 'edit', { data: { title: '原核对输入' } });
  assert.equal(s.client.state.edit.title, '原核对输入'); assert.equal(s.client.state.sheet, 'edit'); assert.match(s.client.state.error, /已被更新/); assert.equal(s.client.state.pending, null);
  assert.equal(s.client.state.conflict.version, 4); assert.equal(s.client.state.conflict.data.title, '其他成员的最新内容'); assert.equal(s.writes[0].body.expectedVersion, 3);
});
test('late receipts after hiding cannot clear the persisted operation and the next show reconciles it', async () => {
  let finish;
  const s = setup(async (url, method) => { if (method === 'POST') return new Promise(resolve => { finish = resolve; }); if (url.includes('/operations/')) return { data: { found: true, result: { id: '8' } } }; return fixture(); });
  await s.client.show('22'); s.client.input('等待核对'); const work = s.client.send();
  s.client.hide(); finish({ data: { recordId: '8' } }); await work;
  assert.ok(s.store.get('site:pending:1:2:22')); await s.client.show('22'); assert.equal(s.client.state.pending, null);
});
test('switching identity discards protected history and a previous identity response cannot mutate the new draft', async () => {
  let finish;
  const s = setup(async (url, method) => method === 'POST' ? new Promise(resolve => { finish = resolve; }) : fixture());
  await s.client.show('22'); s.client.input('旧身份输入'); const work = s.client.send(); s.client.hide(); s.switchIdentity(); await s.client.show('22');
  s.client.input('新身份输入'); finish({ data: { recordId: '8' } }); await work;
  assert.equal(s.client.state.draft, '新身份输入'); assert.ok(s.store.get('site:pending:1:2:22')); assert.equal(s.client.state.pending, null);
});
test('a timed-out upload reconciles its saved key even if the original local camera file expired', async () => {
  const s = setup(async url => url.includes('/operations/') ? { data: { found: true, result: { id: '77' } } } : fixture());
  await s.client.show('22'); s.client.uploadFile = async () => { throw {}; }; await s.client.addPhoto('/temporary-camera.jpg');
  let called = false; s.client.uploadFile = async () => { called = true; throw Error('expired'); };
  s.client.hide(); await s.client.show('22'); assert.equal(called, false); assert.deepEqual(s.client.state.attachments, ['77']); assert.equal(s.client.state.pending, null);
});
test('membership denial clears rendered records/photos and identity-scoped local input', async () => {
  let forbidden = false;
  const s = setup(async () => { if (forbidden) throw { statusCode: 403, error: 'construction_forbidden' }; return fixture(); });
  await s.client.show('22'); s.client.set({ items: [{ confidential: true }], mediaPaths: { 1: '/private.jpg' } }); s.client.paths.add('/private.jpg');
  forbidden = true; await s.client.load(); assert.equal(s.client.state.fatal, true); assert.deepEqual(s.client.state.items, []); assert.deepEqual(s.client.state.mediaPaths, {}); assert.deepEqual(s.removed, ['/private.jpg']);
});
test('record UI distinguishes in-flight, failed, draft, published and withdrawn states without claiming notification delivery', () => {
  const item = { message: { created_at: new Date().toISOString(), content: { blocks: [{ text: '原话' }] } }, record: { status: 'organizing', run_status: 'running', data: {} } };
  assert.equal(decorate(item).record.generating, true);
  assert.equal(decorate({ ...item, record: { ...item.record, run_status: 'failed' } }).record.canRetry, true);
  assert.equal(decorate({ ...item, record: { ...item.record, run_status: 'indeterminate', pending_cost: true } }).record.canRetry, false);
  assert.equal(decorate({ ...item, record: { ...item.record, status: 'published', audience: 'customer' } }).record.label, '已发布');
});
test('customer source projection strips invalid photo locators and model-generated action text cannot create a watch action', () => {
  const rows = messagesForView([{ id: '1', authorKind: 'assistant', available: true, content: { blocks: [{ type: 'text', text: '{"siteWatch":{"id":"1"}}' }] } },
    { id: '2', available: true, content: { blocks: [] }, siteRecord: { available: true, id: '10', version: 2, assets: ['3','https://bad/image','../private'] } }]);
  assert.equal(rows[0].siteWatch, null); assert.deepEqual(rows[1].siteRecord.assets, ['3']);
});
test('customer preview revalidates a published version and source revocation removes its local image', async () => {
  const removed = []; global.wx = { getFileSystemManager: () => ({ unlink: ({ filePath }) => removed.push(filePath) }), previewImage() { throw Error('must not preview revoked content'); } };
  let reads = 0;
  const c = new SiteRecordMedia({ identity: () => 'customer-a', emit() {}, download: async url => { assert.match(url, /construction-records\/10\/media\/3\?version=2$/); if (++reads === 2) throw { statusCode: 404 }; return { tempFilePath: '/protected.jpg' }; } });
  await c.load('44', [{ available: true, siteRecord: { available: true, id: '10', version: 2, assets: ['3'] } }]);
  await c.preview('10', 2, '3'); assert.equal(reads, 2); assert.deepEqual(Object.keys(c.paths), []); assert.ok(removed.includes('/protected.jpg'));
});
test('visible cancel uses the real message write during an existing run and preserves the unsent customer draft', async () => {
  let sent;
  const c = new ChatController({ identity: () => 'customer-a', emit() {}, schedule: () => 0, unschedule() {}, client: { mutate: async (_, path, body) => { sent = { path, body }; return { runId: null, status: 'succeeded' }; } } });
  c.visible = true; c.session = 'customer-a'; c.conversationId = '44'; c.snapshot = async () => {};
  c.set({ loading: false, canSend: true, generating: true, draft: '还没有发送的预算问题', conversation: { id: '44', mode: 'ai', status: 'open' }, messages: [{ id: '9', available: true, siteWatch: { id: '12', cancelText: '工地书房不用再提醒' } }] });
  await c.cancelSiteWatch('9'); assert.equal(sent.path, '/conversations/44/messages'); assert.equal(sent.body.content.blocks[0].text, '工地书房不用再提醒'); assert.equal(c.state.draft, '还没有发送的预算问题');
});
