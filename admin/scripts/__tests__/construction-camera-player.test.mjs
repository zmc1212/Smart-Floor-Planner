import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = fs.readFileSync(new URL('../../public/construction-camera/player.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../../public/construction-camera/index.html', import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const ok = data => ({ ok: true, status: 200, json: async () => ({ success: true, data }) });
const denied = () => ({ ok: false, status: 404, json: async () => ({ success: false, error: 'camera_project_unavailable' }) });

// Execute the shipped browser controller against its real element IDs. Requests,
// timers and completion order are controlled; no camera/provider writes occur.
class Element {
  constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.classList = { toggle() {} }; this.disabled = false; this.hidden = false; this.textContent = ''; }
  get value() { return this._value ?? (this.tag === 'select' ? this.children[0]?.value ?? '' : ''); }
  set value(value) { this._value = String(value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this._value = undefined; }
  setAttribute(key, value) { this[key] = value; }
  removeAttribute(key) { delete this[key]; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  pause() { this.paused = true; }
  load() {}
  async play() { this.paused = false; }
}
function storage(values = new Map(), blocked = false) {
  return { values, getItem(key) { if (blocked) throw Error('storage blocked'); return values.get(key) ?? null; }, setItem(key, value) { if (blocked) throw Error('storage blocked'); values.set(key, String(value)); }, removeItem(key) { values.delete(key); } };
}
function recording(id, binding) {
  return { id, source: 'cloud', name: '测试摄像头' + binding, started_at: '2026-11-05T01:00:00Z', ended_at: '2026-11-05T01:10:00Z' };
}
function snapshot(id) { return { id, state: 'ready', name: '测试抓拍' + id, captured_at: '2026-11-05T01:00:00Z' }; }
async function fixture(options = {}) {
  const elements = Object.fromEntries([...html.matchAll(/<([a-z-]+)[^>]*\bid="([^"]+)"/g)].map(([, tag, id]) => [id, new Element(tag)]));
  const buttons = ['up', 'left', 'stop', 'right', 'down'].map(direction => Object.assign(new Element('button'), { dataset: { direction } }));
  const local = options.local ?? storage(), session = options.session ?? storage(), calls = [], timers = new Map();
  const state = { project: { id: '12', name: '测试工地' }, canCapture: true, canControl: true, canViewSnapshots: true,
    items: [{ binding_id: '9', name: '测试摄像头A', ptz_enabled: true }, { binding_id: '10', name: '测试摄像头B', ptz_enabled: true }] };
  let handler = options.handler;
  const defaults = (route, body) => {
    if (route === 'exchange') return { csrf: 'test-csrf' };
    if (route === 'state') return options.state ?? state;
    if (route === 'snapshots') return { items: [snapshot('1')] };
    if (route === 'recordings/query') return { items: [recording(body.bindingId + '1', body.bindingId), recording(body.bindingId + '2', body.bindingId)], source: 'cloud' };
    return {};
  };
  const document = { hidden: false, getElementById: id => elements[id], createElement: tag => new Element(tag), querySelector: () => new Element(), querySelectorAll: () => buttons, addEventListener() {} };
  const window = { addEventListener() {} };
  vm.runInNewContext(source, { document, window, location: { hash: '#entry=test-entry', pathname: '/construction-camera' }, history: { replaceState() {} },
    localStorage: local, sessionStorage: session, crypto: { randomUUID }, URLSearchParams, console,
    setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
    fetch: async (url, init) => { const route = url.replace('/api/construction-camera/', ''), body = init.body ? JSON.parse(init.body) : undefined; calls.push({ route, body, headers: init.headers }); return await handler?.(route, body, init) ?? ok(defaults(route, body)); },
  });
  await flush();
  return { elements, calls, local, session, buttons, state, setHandler: next => { handler = next; }, heartbeat: async () => { await [...timers.values()][0]?.(); await flush(); } };
}

test('camera/date/selected unplayed segment survive reentry without starting playback', async () => {
  const f = await fixture(), e = f.elements;
  e.camera.value = '10'; await e.camera.onchange();
  await e['playback-tab'].onclick();
  e['recording-date'].value = '2026-11-04'; await e['recording-date'].onchange();
  e.recording.value = 'cloud:102'; await e.recording.onchange();
  const next = await fixture({ local: f.local });
  assert.equal(next.elements.camera.value, '10');
  assert.equal(next.elements['recording-date'].value, '2026-11-04');
  assert.equal(next.elements.recording.value, 'cloud:102');
  assert.equal(next.calls.filter(c => ['live', 'playback'].includes(c.route)).length, 0);
  assert.equal(next.elements.video.src, undefined);
});

test('visible recording rows select the original authorized segment without autoplay and clear on revocation', async () => {
  const f=await fixture(),e=f.elements;await e['playback-tab'].onclick();
  assert.equal(e['recording-list'].children.length,2);
  e['recording-list'].children[1].onclick();await flush();assert.equal(e.recording.value,'cloud:92');
  assert.ok(!f.calls.some(c=>c.route==='playback'||c.route==='live'));
  f.setHandler(route=>route==='heartbeat'?denied():undefined);await f.heartbeat();
  assert.equal(e['recording-list'].children.length,0);assert.equal(e['history-jump'].hidden,true);assert.equal(e['ptz-toggle'].hidden,true);
});

test('camera-specific dates and selections do not bleed into another camera', async () => {
  const f = await fixture(), e = f.elements;
  await e['playback-tab'].onclick();
  e['recording-date'].value = '2026-11-03'; await e['recording-date'].onchange();
  e.recording.value = 'cloud:92'; await e.recording.onchange();
  e.camera.value = '10'; await e.camera.onchange();
  e['recording-date'].value = '2026-11-04'; await e['recording-date'].onchange();
  e.camera.value = '9'; await e.camera.onchange();
  assert.equal(e['recording-date'].value, '2026-11-03');
  assert.equal(e.recording.value, 'cloud:92');
});

test('expired saved camera/segment only restore selections present in authorized results', async () => {
  const local = storage(new Map([['camera-camera:12', '999'], ['camera-view:12', 'playback'], ['camera-recording:12:9', 'cloud:999']]));
  const f = await fixture({ local });
  assert.equal(f.elements.camera.value, '9');
  assert.equal(f.elements.recording.value, 'cloud:91');
  assert.equal(f.calls.filter(c => c.route === 'playback').length, 0);
});

test('blocked preference storage leaves authorized live and playback controls usable', async () => {
  const f = await fixture({ local: storage(new Map(), true) });
  assert.match(f.elements.status.textContent, /请选择摄像头/);
  await f.elements['playback-tab'].onclick();
  assert.equal(f.elements['play-recording'].disabled, false);
  assert.equal(f.elements.recording.value, 'cloud:91');
});

test('revocation immediately clears history/preview and rejects a late successful history response', async () => {
  const f = await fixture(), pending = deferred(), e = f.elements;
  e.history.children[0].onclick(); assert.equal(e.preview.open, true);
  f.setHandler(route => route === 'snapshots' ? pending.promise : route === 'heartbeat' ? denied() : undefined);
  const refresh = e.refresh.onclick();
  await f.heartbeat();
  assert.equal(e.history.children.length, 0);
  assert.equal(e.preview.open, false);
  assert.equal(e['preview-image'].src, undefined);
  assert.equal(e.refresh.disabled, true);
  pending.resolve(ok({ items: [snapshot('2')] })); await refresh;
  assert.equal(e.history.children.length, 0);
  assert.match(e.status.textContent, /访问权限已变化/);
});

test('latest history refresh wins while transient failure preserves existing rows for retry', async () => {
  const f = await fixture(), old = deferred(), e = f.elements;
  f.setHandler(route => route === 'snapshots' ? old.promise : undefined);
  const first = e.refresh.onclick();
  f.setHandler(route => route === 'snapshots' ? ok({ items: [snapshot('3')] }) : undefined);
  await e.refresh.onclick(); old.resolve(ok({ items: [snapshot('2')] })); await first;
  assert.match(e.history.children[0].children[0].src, /\/3$/);
  f.setHandler(route => { if (route === 'snapshots') throw Error('offline'); });
  await e.refresh.onclick(); assert.match(e.history.children[0].children[0].src, /\/3$/);
  f.setHandler(() => undefined); await e.refresh.onclick();
  assert.match(e.history.children[0].children[0].src, /\/1$/);
});

test('history access denial terminates the view without waiting for heartbeat', async () => {
  const f = await fixture();
  f.setHandler(route => route === 'snapshots' ? denied() : undefined);
  await f.elements.refresh.onclick();
  assert.equal(f.elements.history.children.length, 0);
  assert.equal(f.elements.play.disabled, true);
  assert.equal(f.elements.capture.disabled, true);
  assert.equal(f.elements.ptz.hidden, true);
});

test('late snapshot and PTZ completions cannot overwrite a revoked view', async () => {
  for (const action of ['capture', 'ptz']) {
    const f = await fixture(), pending = deferred(), e = f.elements;
    f.setHandler((route, body) => route === 'heartbeat' ? denied() : (action === 'capture' ? route === 'snapshots' && body : route === 'ptz') ? pending.promise : undefined);
    const operation = action === 'capture' ? e.capture.onclick() : f.buttons[0].onclick();
    await f.heartbeat(); pending.resolve(ok({ state: action === 'capture' ? 'ready' : 'pulse_sent' })); await operation;
    assert.match(e.status.textContent, /访问权限已变化/);
    assert.equal(e.history.children.length, 0);
    assert.equal(e.ptz.hidden, true);
    assert.equal(e.capture.disabled, true);
  }
});

test('a denied STOP is not replayed and cannot replace the access error with a stopped receipt', async () => {
  const f = await fixture();
  f.setHandler(route => route === 'stop' ? denied() : undefined);
  await f.elements.stop.onclick(); await flush();
  assert.equal(f.calls.filter(c => c.route === 'stop').length, 1);
  assert.match(f.elements.status.textContent, /访问权限已变化/);
  assert.equal(f.elements.history.children.length, 0);
});

test('unknown capture results reuse the same request key until a confirmed result', async () => {
  const f = await fixture();
  f.setHandler((route, body) => { if (route === 'snapshots' && body) throw Error('connection lost after write'); });
  await f.elements.capture.onclick();
  f.setHandler((route, body) => route === 'snapshots' && body ? ok({ state: 'ready' }) : undefined);
  await f.elements.capture.onclick();
  const writes = f.calls.filter(c => c.route === 'snapshots' && c.body);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].headers['Idempotency-Key'], writes[1].headers['Idempotency-Key']);
  assert.match(f.elements.status.textContent, /抓拍已保存/);
});

test('changing date disables stale playback immediately while STOP is pending', async () => {
  const f=await fixture(), e=f.elements, stopping=deferred();
  await e['playback-tab'].onclick(); assert.equal(e['play-recording'].disabled,false);
  f.setHandler(route=>route==='stop'?stopping.promise:route==='recordings/query'?ok({items:[],source:'cloud'}):undefined);
  e['recording-date'].value='2020-01-01';const changing=e['recording-date'].onchange();
  assert.equal(e['play-recording'].disabled,true);
  stopping.resolve(ok({stopped:true}));await changing;
  assert.equal(e['play-recording'].disabled,true);
  assert.match(e['recording-status'].textContent,/暂无可回放/);
});

test('a late date-change STOP cannot query over a newer return-to-live action', async () => {
  const f=await fixture(),e=f.elements,stopping=deferred();await e['playback-tab'].onclick();
  f.setHandler(route=>route==='stop'?stopping.promise:undefined);
  e['recording-date'].value='2020-01-01';const changing=e['recording-date'].onchange();
  await flush();const stops=f.calls.filter(c=>c.route==='stop').length;
  f.setHandler(()=>undefined);const returning=e['return-live'].onclick();await flush();
  assert.equal(f.calls.filter(c=>c.route==='stop').length,stops,'new STOP must not overtake an unresolved STOP');
  const queries=f.calls.filter(c=>c.route==='recordings/query').length;
  stopping.resolve(ok({stopped:true}));await Promise.all([changing,returning]);
  assert.equal(f.calls.filter(c=>c.route==='recordings/query').length,queries);
  assert.equal(e['playback-panel'].hidden,true);
});
