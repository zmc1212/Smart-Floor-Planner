const test = require('node:test');
const assert = require('node:assert/strict');
const { SiteClient } = require('../packages/construction/chat/site-client');
const { SiteCapture } = require('../packages/construction/chat/site-capture');
const copy = v => JSON.parse(JSON.stringify(v));
const tick = () => new Promise(r => setImmediate(r));
async function drained(c) { for (let n = 0; n < 100 && c.flushing; n++) await tick(); assert.ok(!c.flushing); }
async function fixture() {
  const f = { storage: new Map(), originals: new Map(), calls: [], uploads: [], receipts: new Map(), denied: false, offline: false, loseSend: false, loseUpload: false, quota: false };
  let session = { key: '1454:123', token: 'fixture' };
  global.wx = { getFileSystemManager: () => ({ unlink() {} }) };
  const storage = { get: k => f.storage.get(k), set(k, v) { if (f.quota) throw Error('quota'); f.storage.set(k, copy(v)); }, remove: k => f.storage.delete(k) };
  f.site = new SiteClient({ emit() {}, storage, identity: () => session, download: async () => ({ tempFilePath: '/download' }),
    uploadFile: async (_url, path, id) => { f.uploads.push({ path, id }); if (f.offline || f.loseUpload) { f.loseUpload = false; throw {}; } assert.ok(f.originals.has(path)); return { id: '41' }; },
    request: async (url, method, body, options) => {
      if (f.denied) throw { statusCode: 403 };
      if (f.expired) throw { statusCode: 401 };
      if (f.offline) throw {};
      if (url.includes('/operations/')) return { data: { found: f.receipts.has(url.split('/').at(-1)), result: f.receipts.get(url.split('/').at(-1)) } };
      if (method === 'POST') {
        const key = options.headers['Idempotency-Key']; f.calls.push({ url, body: copy(body), key });
        const receipt = { status: 'received', requestKey: key, recordId: '51', messageId: '61', mediaIds: body.mediaIds, speechId: body.recording ? '71' : null };
        f.receipts.set(key, receipt); if (f.loseSend) { f.loseSend = false; throw {}; } return { data: receipt };
      }
      return { data: { conversationId: '31', project: { id: '21', name: '测试专用工地' }, write: true, manage: false, rooms: [{ id: '11', name: '卫生间' }],
        quickWorks: [{ id: 'wiring', label: '穿线' }], items: [], nextCursor: null } };
    } });
  f.view = {};
  f.capture = new SiteCapture({ site: f.site, emit: p => Object.assign(f.view, p), files: {
    async save(source) { if (f.fileFailure) throw Error('disk'); const path = '/durable/' + (f.originals.size + 1); f.originals.set(path, source); return path; },
    async read(path) { assert.ok(f.originals.has(path)); return 'UklGRg=='; },
    async remove(path) { f.originals.delete(path); },
  } });
  await f.site.show('21'); f.capture.show();
  f.switchIdentity = () => { session = { key: '1454:999', token: 'other' }; };
  return f;
}
test('offline photos are durable before enqueue; reentry uploads originals with the same keys', async () => {
  const f = await fixture(); f.offline = true;
  await f.capture.addFile('/temporary/photo', 'photo'); f.capture.input('客厅补了一段线管。');
  assert.equal(f.capture.submit(), true); await drained(f.capture);
  assert.equal(f.view.captureQueue[0].received, false); assert.equal(f.view.captureQueue[0].uncertain, false);
  const saved = copy(f.capture.value.queue[0]); assert.ok(f.originals.has(saved.photos[0].path)); assert.equal(f.calls.length, 0);
  f.capture.hide(); f.site.hide(); await f.site.show('21'); f.capture.show();
  assert.equal(f.view.captureQueue[0].key, saved.key); f.offline = false; await f.capture.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].key, saved.key); assert.equal(f.uploads[0].id, saved.photos[0].uploadKey);
  assert.equal(f.view.captureQueue[0].received, true);
});
test('lost send receipt is reconciled after reentry without posting twice or waiting for AI', async () => {
  const f = await fixture(); f.loseSend = true;
  f.capture.input('窗户没到，靠窗那排砖先不贴。'); f.capture.submit(); await drained(f.capture);
  assert.equal(f.view.captureQueue[0].uncertain, true); const key = f.calls[0].key;
  f.capture.hide(); f.site.hide(); await f.site.show('21'); f.capture.show(); await f.capture.flush();
  assert.equal(f.calls.length, 1); assert.equal(f.view.captureQueue[0].receipt.requestKey, key); assert.equal(f.view.captureQueue[0].received, true);
});
test('lost photo response retains its upload key and a single record body', async () => {
  const f = await fixture(); f.loseUpload = true;
  await f.capture.addFile('/photo', 'photo'); f.capture.submit(); await drained(f.capture);
  assert.equal(f.calls.length, 0); await f.capture.flush();
  assert.equal(f.uploads.length, 2); assert.equal(f.uploads[0].id, f.uploads[1].id); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body.mediaIds, ['41']);
});
test('local quota failure retains visible input and never claims a queued or received record', async () => {
  const f = await fixture(); f.quota = true;
  assert.equal(f.capture.input('刚补了一处线管'), false); assert.equal(f.view.captureText, '刚补了一处线管');
  assert.equal(f.capture.submit(), false); assert.equal(f.view.captureQueue.length, 0); assert.equal(f.calls.length, 0);
  f.quota = false; f.capture.submit(); await drained(f.capture); assert.equal(f.calls[0].body.text, '刚补了一处线管');
});
test('a failed original-file copy cannot be presented as retained on phone', async () => {
  const f = await fixture(); f.fileFailure = true; await f.capture.addFile('/photo', 'photo');
  assert.equal(f.view.capturePhotos.length, 0); assert.equal(f.capture.submit(), false); assert.match(f.view.captureError, /未能/);
});
test('raw voice can be sent with photos without a transcription dependency or storing base64 in metadata', async () => {
  const f = await fixture(); await f.capture.addFile('/raw.wav', 'voice', 3200); await f.capture.addFile('/photo', 'photo');
  const saved = f.storage.get(f.capture.storageKey); assert.ok(saved.draft.voice.path); assert.ok(!JSON.stringify(saved).includes('UklGRg'));
  f.capture.submit(); await drained(f.capture);
  assert.equal(f.calls[0].body.recording, 'UklGRg=='); assert.deepEqual(f.calls[0].body.mediaIds, ['41']); assert.equal(f.view.captureQueue[0].received, true);
});
test('quick choices persist and one tap submits exactly the explicit work, room and progress', async () => {
  const f = await fixture(); f.capture.choose({ workId: 'wiring', roomId: '11', location: null, progress: 'partial' });
  f.capture.hide(); f.capture.show(); assert.equal(f.view.quickChoice.progress, 'partial');
  f.capture.submit(true); await drained(f.capture); assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].body.capture, { kind: 'quick', workId: 'wiring', roomId: '11', location: null, progress: 'partial' });
  assert.equal(f.view.captureQueue[0].displayText, '卫生间 · 穿线 · 做了一部分');
});
test('membership denial prevents queued writes; revocation removes owned originals and local content', async () => {
  const f = await fixture(); await f.capture.addFile('/photo', 'photo'); f.offline = true; f.capture.submit(); await drained(f.capture);
  f.offline = false; f.denied = true; await f.capture.flush(); assert.equal(f.calls.length, 0); assert.equal(f.site.state.fatal, true);
  assert.equal(f.site.state.write, false);
  await f.capture.revoke(); assert.equal(f.originals.size, 0); assert.equal(f.view.captureQueue.length, 0);
});
test('another identity cannot see or flush the previous staff member’s local queue', async () => {
  const f = await fixture(); f.offline = true; f.capture.input('本人未上传内容'); f.capture.submit(); await drained(f.capture);
  f.capture.hide(); f.site.hide(); f.switchIdentity(); f.offline = false; await f.site.show('21'); f.capture.show();
  assert.equal(f.view.captureQueue.length, 0); await f.capture.flush(); assert.equal(f.calls.length, 0);
});
test('server readback removes the local duplicate and only then disposes its originals', async () => {
  const f = await fixture(); await f.capture.addFile('/photo', 'photo'); f.capture.submit(); await drained(f.capture);
  const id = f.calls[0].key; assert.equal(f.originals.size, 1);
  await f.capture.accepted([{ message: { client_message_id: id }, record: { captured: true } }]);
  assert.equal(f.view.captureQueue.length, 0); assert.equal(f.originals.size, 0);
});

test('a reconnect arriving during an offline check schedules one fresh authorized flush', async () => {
  const f = await fixture(); f.offline = true; f.capture.input('卫生间今天穿线。'); f.capture.submit(); await drained(f.capture);
  let release, first = true; const gate = new Promise(resolve => { release = resolve; }), load = f.site.load.bind(f.site);
  f.site.load = async (...args) => { if (first) { first = false; await gate; f.site.set({ write: false }); return; } return load(...args); };
  const pending = f.capture.flush(); f.offline = false; await f.capture.flush(); release(); await pending; await drained(f.capture);
  assert.equal(f.calls.length, 1); assert.equal(f.view.captureQueue[0].received, true);
});

test('an expired login prevents writes but retains local originals for the same identity to sign in again', async () => {
  const f = await fixture(); f.offline = true; await f.capture.addFile('/photo', 'photo'); f.capture.submit(); await drained(f.capture);
  f.offline = false; f.expired = true; await f.capture.flush(); assert.equal(f.site.state.fatalStatus, 401); assert.equal(f.site.state.write, false); assert.equal(f.calls.length, 0);
  f.capture.hide(); f.site.hide(); assert.equal(f.originals.size, 1); assert.equal(f.storage.get(f.capture.storageKey).queue.length, 1);
  f.expired = false; await f.site.show('21'); f.capture.show(); await f.capture.flush(); assert.equal(f.calls.length, 1); assert.equal(f.view.captureQueue[0].received, true);
});
