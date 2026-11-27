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
const autoplayDenied = () => Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
const capturedAt = '2026-11-20T03:08:00.000Z';
const cover = binding => ({
  ok: true, status: 200, headers: new Headers({ 'Content-Type': 'image/jpeg', 'X-Camera-Captured-At': capturedAt }),
  blob: async () => binding,
});

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
  closest(tag) { return this.tag === tag ? this : null; }
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
  const elements = Object.fromEntries([...html.matchAll(/<([a-z-]+)[^>]*\bid="([^"]+)"[^>]*>/g)].map(([markup, tag, id]) =>
    [id, Object.assign(new Element(tag), { hidden: /\bhidden\b/.test(markup), disabled: /\bdisabled\b/.test(markup) })]));
  const buttons = ['up', 'left', 'stop', 'right', 'down'].map(direction => Object.assign(new Element('button'), { dataset: { direction } }));
  const local = options.local ?? storage(), session = options.session ?? storage(), calls = [], timers = new Map(), timeouts = new Map();
  const state = { project: { id: '12', name: '测试工地' }, canCapture: true, canControl: true, canViewSnapshots: true,
    items: [{ binding_id: '9', name: '测试摄像头A', ptz_enabled: true }, { binding_id: '10', name: '测试摄像头B', ptz_enabled: true }] };
  let handler = options.handler;
  const defaults = (route, body) => {
    if (route === 'exchange') return { csrf: 'test-csrf' };
    if (route === 'state') return options.state ?? { ...state, liveOnly: Boolean(options.liveOnly) };
    if (route === 'snapshots') return { items: [snapshot('1')] };
    if (route === 'recordings/query') return { items: [recording(body.bindingId + '1', body.bindingId), recording(body.bindingId + '2', body.bindingId)], source: 'cloud' };
    if (route === 'live') return { hls: '/camera-media/test/hls.m3u8' };
    return {};
  };
  const documentListeners = {}, mat = new Element(), coverAssets = new Map();
  let assetCount = 0;
  const objectUrls = {
    createObjectURL(blob) { const url = 'blob:cover-' + ++assetCount; coverAssets.set(url, blob); return url; },
    revokeObjectURL(url) { coverAssets.delete(url); },
  };
  const document = { hidden: Boolean(options.hidden), getElementById: id => elements[id], createElement: tag => new Element(tag), querySelector: selector => selector === '.video-mat' ? mat : new Element(), querySelectorAll: () => buttons, addEventListener(name, callback) { documentListeners[name] = callback; } };
  // Provide a supported MSE path so a start attempts playback.
  class Hls {
    static Events = { ERROR: 'error' };
    static isSupported() { return true; }
    constructor() {}
    on() {}
    loadSource(url) { this.url = url; }
    attachMedia(video) { video.src = this.url; }
    destroy() {}
  }
  if (options.mediaPlay) elements.video.play = options.mediaPlay;
  const window = { addEventListener() {}, Hls: options.Hls ?? Hls, mpegts: options.mpegts };
  vm.runInNewContext(source, { document, window, location: { hash: options.hash ?? '#entry=test-entry', pathname: '/construction-camera' }, history: { replaceState() {} }, Element,
    localStorage: local, sessionStorage: session, crypto: { randomUUID }, URL: objectUrls, URLSearchParams, console,
    setInterval(fn) { const id = timers.size + 1; timers.set(id, fn); return id; }, clearInterval: id => timers.delete(id),
    setTimeout(fn) { const id = Symbol(); timeouts.set(id, fn); return id; }, clearTimeout: id => timeouts.delete(id),
    fetch: async (url, init) => {
      const route = url.replace('/api/construction-camera/', ''), body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ route, body, headers: init.headers });
      return await handler?.(route, body, init) ?? (route.startsWith('cover/') ? { ok: true, status: 204 } : ok(defaults(route, body)));
    },
  });
  await flush();
  return { elements, calls, local, session, buttons, state, timeouts, mat, document, documentListeners, coverAssets, setHandler: next => { handler = next; }, heartbeat: async () => { await [...timers.values()][0]?.(); await flush(); } };
}

async function ownerPreview(options = {}) {
  const players = [];
  class Hls {
    static Events = { ERROR: 'error' };
    static isSupported() { return true; }
    constructor() { players.push(this); }
    on(name, handler) { this[name] = handler; }
    loadSource(url) { this.url = url; }
    attachMedia() {}
    destroy() { this.destroyed = true; }
  }
  return { ...await fixture({ hash: '#ownerLive=1454.'+'a'.repeat(48)+'.'+'b'.repeat(43), Hls, ...options }), players };
}

test('automatic live playback recovers from a FLV decoder error on the same authorized stream', async () => {
  const handlers = new Map();
  let flvDestroyed = 0;
  const attached = [];
  class Hls {
    static Events = { ERROR: 'error' };
    static isSupported() { return true; }
    on() {}
    loadSource(url) { attached.push(url); }
    attachMedia() {}
    destroy() {}
  }
  const f = await fixture({ Hls, mpegts: {
    Events: { ERROR: 'error' },
    getFeatureList: () => ({ mseLivePlayback: true }),
    createPlayer: () => ({
      on: (name, handle) => handlers.set(name, handle),
      attachMediaElement() {},
      load() {},
      destroy() { flvDestroyed++; },
    }),
  } });
  f.elements.mode.value = 'auto';
  await f.elements['live-overlay-play'].onclick();
  handlers.get('error')();
  await flush();
  assert.deepEqual(attached, ['/camera-media/test/hls.m3u8']);
  assert.equal(flvDestroyed, 1);
  assert.equal(f.elements.mode.value, 'auto');
  assert.equal(f.calls.filter(c => c.route === 'live').length, 1);
  assert.equal(f.calls.filter(c => c.route === 'stop').length, 0);
  handlers.get('error')();
  await flush();
  assert.equal(attached.length, 1);
  assert.equal(f.calls.filter(c => c.route === 'stop').length, 0);
  await f.elements.stop.onclick();
  f.elements.mode.value = 'flv';
  await f.elements['live-overlay-play'].onclick();
  handlers.get('error')();
  await flush();
  assert.equal(attached.length, 1);
  assert.equal(f.calls.filter(c => c.route === 'stop').length, 2);
});

test('owner preview blocks repeat starts until actual playback progress and keeps the viewing receipt', async () => {
  const receipt = deferred();
  const f = await ownerPreview({ handler: () => receipt.promise }), { play, video, status } = f.elements;
  assert.equal(play.disabled, true);
  await play.onclick();
  assert.equal(f.players.length, 1);
  assert.match(status.textContent, /正在连接直播/);

  Object.assign(video, { videoWidth: 640, played: { length: 1, start: () => 0 }, currentTime: 0 });
  await video.listeners.timeupdate();
  assert.equal(play.disabled, true);
  assert.equal(f.calls.length, 0);

  video.currentTime = 0.5;
  const reporting = video.listeners.timeupdate();
  assert.equal(play.disabled, false);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].route, /\/played$/);
  receipt.resolve(ok({ played: true }));
  await reporting;
  assert.match(status.textContent, /已观看当前机位/);
  assert.equal(f.elements['live-audio'].hidden, true);
  assert.equal(f.timeouts.size, 0);
});

test('owner preview can retry after a media failure or a connection that never produces a frame', async () => {
  const f = await ownerPreview(), { play, status } = f.elements;
  f.players[0].error(null, { fatal: true });
  assert.equal(f.players[0].destroyed, true);
  assert.equal(play.disabled, false);
  assert.match(status.textContent, /请重试/);

  await play.onclick();
  assert.equal(play.disabled, true);
  f.players[0].error(null, { fatal: true });
  assert.equal(play.disabled, true);
  assert.equal(f.players[1].destroyed, undefined);
  [...f.timeouts.values()][0]();
  assert.equal(f.players[1].destroyed, true);
  assert.equal(play.disabled, false);
  assert.match(status.textContent, /请重试/);
});

test('owner preview resumes a platform pause so live viewing stays pinned', async () => {
  const f = await ownerPreview(), { video } = f.elements;
  assert.equal(video.paused, false);
  video.paused = true;
  video.listeners.pause();
  await flush();
  assert.equal(video.paused, false);
});

test('fullscreen button fills the viewport when the host lacks fullscreen and can exit', async () => {
  const f = await ownerPreview(), { 'live-fullscreen': open, 'exit-fullscreen': close } = f.elements;
  assert.equal(open.disabled, false);
  assert.equal(close.hidden, true);
  open.onclick();
  assert.equal(close.hidden, false);
  close.onclick();
  assert.equal(close.hidden, true);
});

test('live view has no native controls while playback keeps them', async () => {
  assert.doesNotMatch(html, /<video id="video"[^>]*\bcontrols\b/);
  const f = await fixture(), { video } = f.elements;
  await f.elements['playback-tab'].onclick();
  assert.equal(video.controls, true);
  await f.elements['return-live'].onclick();
  assert.equal(video.controls, false);
});

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
  assert.ok(!f.calls.some(c=>c.route==='playback'));
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
  const f = await fixture({ local: storage(new Map(), true) }), e = f.elements;
  assert.equal(e['live-overlay-play'].hidden, false);
  await e['live-overlay-play'].onclick();
  assert.equal(e.video.paused, false);
  await e['playback-tab'].onclick();
  assert.equal(e['play-recording'].disabled, false);
  assert.equal(e.recording.value, 'cloud:91');
});

test('the private player starts on demand and restores the ready controls after stop, switch and return', async () => {
  const f = await fixture(), e = f.elements;
  const start = e['live-overlay-play'], full = e['live-fullscreen'], exit = e['exit-fullscreen'];
  const liveCalls = () => f.calls.filter(c => c.route === 'live').length;
  assert.equal(liveCalls(), 0);
  assert.equal(start.hidden, false);
  assert.equal(e.stop.hidden, true);
  assert.equal(full.disabled, true);

  await start.onclick();
  assert.equal(liveCalls(), 1);
  assert.equal(e.video.muted, true);
  assert.equal(e.video.autoplay, true);
  assert.match(e.status.textContent, /正在接收现场画面/);
  assert.equal(start.hidden, true);
  assert.equal(e.stop.disabled, false);
  assert.equal(e.stop.hidden, false);
  assert.equal(full.disabled, false);
  full.onclick();
  assert.equal(full.hidden, true);
  assert.equal(exit.hidden, false);
  exit.onclick();
  assert.equal(full.hidden, false);
  assert.equal(exit.hidden, true);

  await e.stop.onclick();
  assert.equal(start.hidden, false);
  assert.equal(e.stop.hidden, true);
  assert.equal(full.disabled, true);
  e.camera.value = '10';
  await e.camera.onchange();
  assert.equal(liveCalls(), 1);
  await start.onclick();
  assert.equal(liveCalls(), 2);
  await e['playback-tab'].onclick();
  assert.equal(e['live-actions'].hidden, true);
  assert.equal(start.hidden, true);
  assert.equal(e.video.autoplay, false);
  await e['return-live'].onclick();
  assert.equal(start.hidden, false);
  assert.equal(liveCalls(), 2);
  await start.onclick();
  assert.equal(liveCalls(), 3);
  assert.match(e.status.textContent, /正在接收现场画面/);
});

test('private AAC live overrides FLV selection and the speaker resets to muted on reentry', async () => {
  let flvAttempts = 0;
  const hls = '/camera-media/2/hls.m3u8';
  const f = await fixture({
    handler: route => route === 'live' ? ok({ flv: '/camera-media/2/live.flv', hls, preferredFormat: 'hls' }) : undefined,
    mpegts: { getFeatureList: () => ({ mseLivePlayback: true }), createPlayer: () => { flvAttempts++; } },
  });
  const { 'live-overlay-play': start, 'live-audio': audio, video, stop, mode } = f.elements;
  mode.value = 'flv';
  assert.equal(audio.hidden, true);
  await start.onclick();
  assert.equal(flvAttempts, 0);
  assert.equal(video.src, hls);
  assert.equal(video.muted, true);
  assert.equal(audio.hidden, true);
  Object.assign(video, { currentTime: 1, videoWidth: 640, readyState: 2 });
  video.listeners.timeupdate();
  assert.equal(audio.hidden, false);
  assert.equal(audio['aria-label'], '打开声音');
  audio.onclick();
  assert.equal(video.muted, false);
  assert.equal(audio['aria-pressed'], 'true');
  assert.equal(audio['aria-label'], '关闭声音');
  audio.onclick();
  assert.equal(video.muted, true);
  audio.onclick();
  await stop.onclick();
  assert.equal(audio.hidden, true);
  assert.equal(video.muted, true);
  await start.onclick();
  assert.equal(audio['aria-pressed'], 'false');
  assert.equal(video.muted, true);
});

test('slow capture history and cover do not delay a private live start', async () => {
  const pendingHistory = deferred(), pendingCover = deferred();
  const f = await fixture({ handler: route => route === 'snapshots' ? pendingHistory.promise : route === 'cover/9' ? pendingCover.promise : undefined });
  await f.elements['live-overlay-play'].onclick();
  assert.deepEqual(f.calls.map(c => c.route), ['exchange', 'state', 'snapshots', 'cover/9', 'live']);
  assert.match(f.elements.status.textContent, /正在接收现场画面/);
  pendingHistory.resolve(ok({ items: [] }));
  pendingCover.resolve(cover('9'));
  await flush();
});

test('live waits for a foreground WebView and a manual stop stays stopped', async () => {
  const f = await fixture({ hidden: true }), e = f.elements;
  f.documentListeners.visibilitychange();
  assert.equal(e['live-overlay-play'].hidden, true);
  assert.equal(f.calls.filter(c => c.route === 'live').length, 0);
  f.document.hidden = false;
  f.documentListeners.visibilitychange();
  await flush();
  assert.equal(e['live-overlay-play'].hidden, false);
  assert.equal(f.calls.filter(c => c.route === 'live').length, 0);

  await e['live-overlay-play'].onclick();
  await e.stop.onclick();
  f.documentListeners.visibilitychange();
  e.video.listeners.canplay();
  f.documentListeners.WeixinJSBridgeReady({});
  await flush();
  assert.equal(f.calls.filter(c => c.route === 'live').length, 1);
  assert.equal(e.video.paused, true);
  assert.equal(e['live-overlay-play'].hidden, false);
});

for (const retry of ['画面', '中央播放按钮']) {
  test(`a trusted ${retry} tap plays the attached source within the gesture`, async () => {
    let inGesture = false;
    const f = await fixture({ mediaPlay() {
      if (!inGesture) return Promise.reject(autoplayDenied());
      return Element.prototype.play.call(this);
    } });
    const { 'live-overlay-play': start, stop, video, status } = f.elements;
    await start.onclick();
    assert.match(status.textContent, /画面中央的播放按钮/);
    assert.equal(start.hidden, false);
    assert.equal(stop.disabled, false);

    const src = video.src;
    inGesture = true;
    const attempt = retry === '画面' ? f.mat.listeners.click({ target: video }) : start.onclick();
    inGesture = false;
    await attempt;
    assert.equal(video.src, src);
    assert.equal(video.paused, false);
    assert.equal(start.hidden, true);
    assert.deepEqual(f.calls.filter(c => c.route === 'stop' || c.route === 'live').map(c => c.route), ['live']);
    assert.match(status.textContent, /正在接收现场画面/);
  });
}

for (const ready of ['canplay', 'WeixinJSBridgeReady']) {
  test(`a muted start blocked before ${ready} retries on the existing source`, async () => {
    let playable = false;
    const f = await fixture({ mediaPlay() {
      if (!playable) return Promise.reject(autoplayDenied());
      return Element.prototype.play.call(this);
    } });
    await f.elements['live-overlay-play'].onclick();
    playable = true;
    if (ready === 'canplay') f.elements.video.listeners.canplay();
    else f.documentListeners.WeixinJSBridgeReady({});
    await flush();
    assert.deepEqual(f.calls.filter(c => c.route === 'stop' || c.route === 'live').map(c => c.route), ['live']);
    assert.match(f.elements.status.textContent, /正在接收现场画面/);
  });
}

test('native autoplay can complete a prepared live stream after the initial play call was blocked', async () => {
  const f = await fixture({ mediaPlay: () => Promise.reject(autoplayDenied()) });
  const { video, status } = f.elements;
  await f.elements['live-overlay-play'].onclick();
  Object.assign(video, { paused: false, currentTime: 1, videoWidth: 640, readyState: 2 });
  video.listeners.playing();
  video.listeners.timeupdate();
  assert.equal(f.calls.filter(c => c.route === 'live').length, 1);
  assert.equal(f.elements['live-fullscreen'].disabled, false);
  assert.match(status.textContent, /正在播放 · 测试摄像头A/);
});

test('an authorized cover remains through a blocked start until video advances and returns after stop', async () => {
  let inGesture = false;
  const f = await fixture({
    handler: route => route === 'cover/9' ? cover('9') : undefined,
    mediaPlay() { return inGesture ? Element.prototype.play.call(this) : Promise.reject(autoplayDenied()); },
  });
  const { video, 'live-overlay-play': start, stop, status } = f.elements;
  const image = f.elements['live-cover'], time = f.elements['live-cover-time'];
  assert.equal(image.hidden, true);
  image.onload();
  assert.equal(image.hidden, false);
  assert.equal(time.datetime, capturedAt);
  assert.match(time.textContent, /抓拍于.*11:08/);
  await start.onclick();
  assert.match(status.textContent, /画面中央的播放按钮/);
  assert.equal(image.hidden, false);

  inGesture = true;
  const starting = start.onclick();
  inGesture = false;
  await starting;
  assert.equal(image.hidden, false);
  Object.assign(video, { currentTime: 1, videoWidth: 640, readyState: 2 });
  video.listeners.timeupdate();
  assert.equal(image.hidden, true);
  assert.equal(time.hidden, true);
  assert.match(status.textContent, /正在播放/);
  await stop.onclick();
  assert.equal(image.hidden, false);
  assert.equal(f.calls.filter(c => c.route === 'live').length, 1);
});

test('switching cameras and losing access discard old and late cover data', async () => {
  const pending = deferred();
  const f = await fixture({ handler: route => route === 'cover/9' ? pending.promise : route === 'cover/10' ? cover('10') : undefined });
  const image = f.elements['live-cover'];
  f.elements.camera.value = '10';
  await f.elements.camera.onchange();
  await flush();
  image.onload();
  const currentUrl = image.src;
  assert.equal(f.coverAssets.get(currentUrl), '10');
  pending.resolve(cover('9'));
  await flush();
  assert.equal(image.src, currentUrl);
  f.setHandler(route => route === 'heartbeat' ? denied() : undefined);
  await f.heartbeat();
  assert.equal(image.hidden, true);
  assert.equal(image.src, undefined);
  assert.equal(f.coverAssets.size, 0);
});

test('live-only family sessions and playback do not fetch or show a retained cover', async () => {
  const family = await fixture({ liveOnly: true });
  assert.equal(family.calls.some(c => c.route.startsWith('cover/')), false);
  assert.equal(family.elements['live-cover'].hidden, true);
  const f = await fixture({ handler: route => route === 'cover/9' ? cover('9') : undefined });
  f.elements['live-cover'].onload();
  await f.elements['playback-tab'].onclick();
  assert.equal(f.elements['live-cover'].hidden, true);
  assert.equal(f.coverAssets.size, 0);
  assert.equal(f.calls.filter(c => c.route.startsWith('cover/')).length, 1);
});

test('a late native autoplay event cannot restart the stream after access is revoked', async () => {
  const f = await fixture({ mediaPlay: () => Promise.reject(autoplayDenied()) });
  await f.elements['live-overlay-play'].onclick();
  f.setHandler(route => route === 'heartbeat' ? denied() : undefined);
  await f.heartbeat();
  f.elements.video.listeners.playing();
  f.mat.listeners.click({ target: f.elements.video });
  assert.equal(f.elements['live-overlay-play'].hidden, true);
  assert.equal(f.elements['live-actions'].hidden, true);
  f.documentListeners.WeixinJSBridgeReady({});
  await flush();
  assert.equal(f.calls.filter(c => c.route === 'live').length, 1);
  assert.equal(f.elements.video.autoplay, false);
  assert.equal(f.elements['live-fullscreen'].disabled, true);
  assert.match(f.elements.status.textContent, /权限已变化/);
});

test('a live stream with no picture progress after 3s suggests compatible playback', async () => {
  const pendingPlay = deferred();
  const f = await fixture({ mediaPlay: () => pendingPlay.promise }), e = f.elements;
  const starting = e['live-overlay-play'].onclick();
  await flush();
  assert.equal(e.status.textContent, '正在连接摄像头…');
  const timers = [...f.timeouts.values()];
  assert.equal(timers.length, 1);
  timers[0]();
  assert.match(e.status.textContent, /切换兼容播放/);
  await e.stop.onclick();
  pendingPlay.resolve();
  await starting;
  assert.equal(e.status.textContent, '播放已停止');

  const g = await fixture();
  await g.elements['live-overlay-play'].onclick();
  g.elements.video.currentTime = 1;
  [...g.timeouts.values()][0]();
  assert.equal(g.elements.status.textContent, '正在接收现场画面…');
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
