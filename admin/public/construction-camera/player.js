/* mpegts.js 1.8.2 playback baseline; no camera/WVP credentials or source URLs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), video = $('video');
  let csrf = '', state = null, player = null, intent = 0, active = false, heartbeat = null, controlBusy = false, captureBusy = false, stopPending = Promise.resolve();
  const messages = { camera_entry_expired: '入口已过期，请返回工地重新进入。', camera_session_expired: '访问已失效，请返回工地重新进入。', camera_project_unavailable: '工地已停用或你的访问权限已变化。', camera_binding_unavailable: '摄像头已解绑，请返回工地重新进入。', camera_service_unavailable: '摄像头服务暂不可用，请稍后重试。', camera_operation_failed: '摄像头离线或操作未完成，请稍后重试。', camera_not_configured: '企业尚未配置视频服务。', camera_forbidden: '当前身份没有此操作权限。', camera_capture_busy: '正在抓拍，请稍后再试。', camera_control_busy: '云台正在使用或核对停止状态，请稍后再试。', camera_command_expired: '这次控制已失效，请重新轻点方向。', camera_ptz_unavailable: '这台摄像头暂未开放云台控制。' };
  const message = error => messages[error.code] || '操作暂未完成，请稍后重试。';
  function status(value, error = false) { $('status').textContent = value; $('status').dataset.error = String(error); }
  async function api(path, data, headers = {}) {
    const response = await fetch('/api/construction-camera/' + path, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'x-camera-csrf': csrf, ...headers }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const json = await response.json();
    if (!response.ok || !json.success) { const e = new Error(); e.code = json.error; e.status = response.status; throw e; }
    return json.data;
  }
  const selected = () => state?.items.find(c => String(c.binding_id) === $('camera').value);
  function destroy() { active = false; if (player) { player.destroy(); player = null; } video.pause(); video.removeAttribute('src'); video.load(); $('stop').disabled = true; }
  async function stop(quiet = false) { intent++; destroy(); if (csrf) { stopPending = api('stop', {}).catch(() => {}); await stopPending; } if (!quiet) status('播放已停止'); }
  function capabilities() { const c = selected(); $('play').disabled = !c; $('capture').hidden = !state?.canCapture; $('capture').disabled = !c || captureBusy; $('ptz').hidden = !state?.canControl || !c?.ptz_enabled; }
  async function loadHistory() {
    try {
      const result = await api('snapshots'); $('history').replaceChildren();
      $('history-status').textContent = result.items.length ? '抓拍仅保存在当前工地，可再次查看。' : '还没有抓拍记录。';
      for (const item of result.items) {
        const button = document.createElement('button'), caption = document.createElement('span'); button.type = 'button';
        const when = new Date(item.captured_at || item.created_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
        caption.textContent = item.name + ' · ' + when + (item.state === 'pending' ? ' · 处理中' : item.state === 'failed' ? ' · 抓拍失败，可重新抓拍' : '');
        if (item.state === 'ready') { const img = document.createElement('img'); img.src = '/api/construction-camera/snapshots/' + item.id; img.alt = item.name + '抓拍'; img.loading = 'lazy'; button.append(img); button.onclick = () => { $('preview-image').src = img.src; $('preview').showModal(); }; }
        else button.disabled = true;
        button.append(caption); $('history').append(button);
      }
    } catch (e) { $('history-status').textContent = message(e); }
  }
  async function play() {
    const c = selected(); if (!c) return;
    const generation = ++intent; destroy(); $('play').disabled = true; status('正在连接摄像头…');
    try {
      await stopPending; if (generation !== intent) return;
      const live = await api('live', { bindingId: String(c.binding_id) }); if (generation !== intent) return;
      const mode = $('mode').value, flv = window.mpegts?.getFeatureList().mseLivePlayback;
      if (mode !== 'hls' && flv) {
        player = window.mpegts.createPlayer({ type: 'flv', isLive: true, url: live.flv }, { enableWorker: false, enableStashBuffer: false, liveBufferLatencyChasing: true });
        player.on(window.mpegts.Events.ERROR, () => { if (generation === intent) { void stop(true); status('播放中断，可重新播放或切换兼容播放。', true); } });
        player.attachMediaElement(video); player.load(); await player.play();
      } else if (mode !== 'flv' && window.Hls?.isSupported()) {
        player = new window.Hls({ enableWorker: false, backBufferLength: 15, liveSyncDurationCount: 2 });
        const hls = player;
        hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal && generation === intent) { void stop(true); status('播放中断，可重新播放或切换播放方式。', true); } });
        hls.loadSource(live.hls); hls.attachMedia(video); await video.play();
      } else if (mode !== 'flv' && video.canPlayType('application/vnd.apple.mpegurl')) { video.src = live.hls; await video.play(); }
      else throw Object.assign(new Error(), { code: 'unsupported' });
      if (generation !== intent) return;
      active = true; $('stop').disabled = false; status('正在播放 · ' + c.name);
    } catch (e) { if (generation === intent) { console.warn('Camera playback failed', e.name, e.message); await stop(true); status(e.code === 'unsupported' ? '当前环境不支持所选方式，请切换播放设置。' : message(e), true); } }
    finally { if (generation === intent || !active) capabilities(); }
  }
  async function capture() {
    const c = selected(); if (!c || captureBusy) return; captureBusy = true; capabilities();
    const storageKey = 'camera-capture:' + state.project.id + ':' + c.binding_id;
    try {
      let requestKey = sessionStorage.getItem(storageKey); if (!requestKey) { requestKey = crypto.randomUUID(); sessionStorage.setItem(storageKey, requestKey); }
      const result = await api('snapshots', { bindingId: String(c.binding_id) }, { 'Idempotency-Key': requestKey });
      if (result.state !== 'pending') sessionStorage.removeItem(storageKey);
      status(result.state === 'ready' ? '抓拍已保存到当前工地' : result.state === 'failed' ? '上次抓拍失败，可以重新抓拍。' : '抓拍处理中，再次点击可核对同一次操作。');
      await loadHistory();
    } catch (e) { if (e.status >= 400 && e.status < 500 && e.status !== 429) sessionStorage.removeItem(storageKey); status(message(e) + ' 可再次点击核对抓拍记录。', true); }
    finally { captureBusy = false; capabilities(); }
  }
  async function control(command) {
    const c = selected(); if (!c || (controlBusy && command !== 'stop')) return;
    controlBusy = true; document.querySelectorAll('[data-direction]').forEach(b => { b.disabled = b.dataset.direction !== 'stop'; });
    try { await api('ptz', { bindingId: String(c.binding_id), command, sequence: Date.now() }); status(command === 'stop' ? '停止指令已发送' : '方向调整指令已发送，并已发送停止指令'); }
    catch (e) { status(message(e), true); }
    finally { controlBusy = false; document.querySelectorAll('[data-direction]').forEach(b => { b.disabled = false; }); }
  }
  async function init() {
    const entry = new URLSearchParams(location.hash.slice(1)).get('entry'); history.replaceState(null, '', location.pathname);
    try {
      if (entry) { const result = await api('exchange', { entry }); csrf = result.csrf; sessionStorage.setItem('camera-csrf', csrf); }
      else csrf = sessionStorage.getItem('camera-csrf') || '';
      if (!csrf) throw Object.assign(new Error(), { code: 'camera_entry_expired' });
      state = await api('state'); $('project').textContent = state.project.name; $('camera').replaceChildren();
      for (const c of state.items) { const option = document.createElement('option'); option.value = c.binding_id; option.textContent = c.name; $('camera').append(option); }
      $('camera').disabled = !state.items.length; $('refresh').disabled = false; capabilities();
      status(state.items.length ? '请选择摄像头，点击开始播放。' : '当前工地尚未绑定摄像头。'); await loadHistory();
      heartbeat = setInterval(async () => { if (document.hidden) return; try { await api('heartbeat', {}); } catch (e) { clearInterval(heartbeat); await stop(true); $('play').disabled = true; $('capture').disabled = true; $('ptz').hidden = true; status(message(e), true); } }, 20000);
    } catch (e) { status(message(e), true); $('history-status').textContent = '访问不可用'; }
  }
  $('play').onclick = play; $('stop').onclick = () => stop(); $('capture').onclick = capture; $('refresh').onclick = loadHistory;
  $('camera').onchange = async () => { await stop(true); capabilities(); status('已切换摄像头，请点击开始播放。'); };
  $('mode').onchange = () => stop(); $('close-preview').onclick = () => $('preview').close();
  document.querySelectorAll('[data-direction]').forEach(b => { b.onclick = () => control(b.dataset.direction); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void stop(true); });
  window.addEventListener('pagehide', () => { intent++; destroy(); if (csrf) fetch('/api/construction-camera/stop', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', 'x-camera-csrf': csrf }, body: '{}' }).catch(() => {}); });
  video.addEventListener('error', () => { if (active) { console.warn('Camera media error',video.error?.code,video.error?.message); void stop(true); status('画面已中断，请重新播放。', true); } });
  void init();
})();
