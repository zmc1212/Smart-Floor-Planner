const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MediaController } = require('../packages/assistant/lib/media');
const { AssistantClient } = require('../packages/assistant/lib/client');

test('unknown upload retries retain the same bytes, room and key', async () => {
  const requests = []; let reads = 0;
  global.wx = { getFileSystemManager: () => ({ readFile: o => { reads++; o.success({ data: 'YWJj' }); }, unlink() {} }) };
  const client = new AssistantClient(async (url, method, body, options) => {
    if (method === 'GET') return { success: true, data: { items: [] } };
    requests.push({ body: structuredClone(body), key: options.headers['Idempotency-Key'] });
    if (requests.length === 1) throw { statusCode: 503 };
    return { success: true, data: { id: '1', conversationId: '2' } };
  });
  const controller = new MediaController({ identity: () => 'token', emit() {}, client });
  await controller.load('2');
  assert.equal(await controller.upload('first.png', 'floorplan', '书房'), false);
  assert.equal(await controller.upload('different.png', 'image', '厨房'), true);
  assert.equal(reads, 1); assert.deepEqual(requests[0], requests[1]); controller.dispose();
});
test('stale identity never opens a downloaded private image', async () => {
  let token = 'first', resolve, opened = 0; const removed = [];
  global.wx = { previewImage() { opened++; }, getFileSystemManager: () => ({ unlink: o => removed.push(o.filePath) }) };
  const controller = new MediaController({ identity: () => token, emit() {}, download: () => new Promise(r => { resolve = r; }),
    client: { read: async () => ({ items: [{ id: '8' }] }), pending: new Map() } });
  await controller.load('2'); const promise = controller.preview('8'); token = 'second'; resolve({ tempFilePath: 'private.jpg' }); await promise;
  assert.equal(opened, 0); assert.deepEqual(removed, ['private.jpg']); controller.dispose();
});
test('formal room selection uses server provenance and retries the original snapshot request', async () => {
  const writes=[];
  const client=new AssistantClient(async(url,method,body,options)=>{
    if(method==='GET')return {success:true,data:{items:[]}};
    writes.push({body:structuredClone(body),key:options.headers['Idempotency-Key']});
    if(writes.length===1)throw {statusCode:503};
    return {success:true,data:{id:'8',conversationId:'2'}};
  });
  const controller=new MediaController({identity:()=> 'token',emit(){},client});await controller.load('2');
  assert.equal(await controller.attachFormal({id:'4',leadId:'3',layoutHash:'hash'},'study'),false);
  assert.equal(await controller.attachFormal(),true);
  assert.deepEqual(writes[0],writes[1]);assert.equal(writes[1].body.roomId,'study');controller.dispose();
});
test('failed list clears prior media and staff cannot upload or remove', async () => {
  const patches = [];
  const controller = new MediaController({ identity: () => 'token', emit: p => patches.push(p),
    client: { read: async () => { throw { statusCode: 403 }; }, pending: new Map() } });
  await controller.load('3', true);
  assert.ok(patches.some(p => Array.isArray(p.mediaItems) && !p.mediaItems.length));
  assert.equal(await controller.upload('file', 'image', ''), false);
  assert.equal(await controller.remove('9'), undefined); controller.dispose();
});

test('staff polling revalidates access without discarding unchanged thumbnails; removal and errors clear private files', async () => {
  const state = {}, removed = []; let items = [{ id: '8' }], failure;
  global.wx = { getFileSystemManager: () => ({ unlink: o => removed.push(o.filePath) }) };
  const controller = new MediaController({ identity: () => 'staff', emit: patch => Object.assign(state, patch),
    client: { pending: new Map(), read: async () => { if (failure) throw failure; return { items }; } },
    download: async () => ({ tempFilePath: 'private.jpg' }) });
  try {
    await controller.load('3', true); await controller.thumbnail('8');
    await controller.refresh();
    assert.deepEqual(state.mediaPaths, { 8: 'private.jpg' }); assert.deepEqual(removed, []);
    assert.equal(state.mediaLoading, false);
    items = []; await controller.refresh();
    assert.deepEqual(state.mediaPaths, {}); assert.deepEqual(removed, ['private.jpg']);
    items = [{ id: '9' }]; await controller.refresh(); await controller.thumbnail('9');
    failure = { statusCode: 403 }; await controller.refresh();
    assert.deepEqual(state.mediaPaths, {}); assert.deepEqual(state.mediaItems, []);
    assert.deepEqual(removed, ['private.jpg', 'private.jpg']);
  } finally { controller.dispose(); delete global.wx; }
});

test('a removed source invalidates an in-flight thumbnail before it can return a private path', async () => {
  let items = [{ id: '8' }], finish; const removed = [], state = {};
  global.wx = { getFileSystemManager: () => ({ unlink: o => removed.push(o.filePath) }) };
  const controller = new MediaController({ identity: () => 'staff', emit: patch => Object.assign(state, patch),
    client: { pending: new Map(), read: async () => ({ items }) },
    download: () => new Promise(resolve => { finish = resolve; }) });
  try {
    await controller.load('3', true); const pending = controller.thumbnail('8');
    items = []; await controller.refresh(); finish({ tempFilePath: 'late-private.jpg' });
    assert.equal(await pending, ''); assert.deepEqual(state.mediaPaths, {});
    assert.deepEqual(removed, ['late-private.jpg']);
  } finally { controller.dispose(); delete global.wx; }
});
