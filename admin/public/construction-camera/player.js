/* mpegts.js 1.8.2 playback baseline; no camera/WVP credentials or source URLs. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), video = $('video');
  let csrf = '', state = null, player = null, intent = 0, active = false, heartbeat = null, controlBusy = false, captureBusy = false, stopPending = Promise.resolve();
  let viewMode='live',recordings=[],recordingQuery=0,queryBusy=false,viewChange=0,earlier=null;
  const messages = { camera_entry_expired: '入口已过期，请返回工地重新进入。', camera_session_expired: '访问已失效，请返回工地重新进入。', camera_project_unavailable: '工地已停用或你的访问权限已变化。', camera_binding_unavailable: '摄像头已解绑，请返回工地重新进入。', camera_service_unavailable: '摄像头服务暂不可用，请稍后重试。', camera_operation_failed: '摄像头离线或操作未完成，请稍后重试。', camera_not_configured: '企业尚未配置视频服务。', camera_forbidden: '当前身份没有此操作权限。', camera_capture_busy: '正在抓拍，请稍后再试。', camera_control_busy: '云台正在使用或核对停止状态，请稍后再试。', camera_command_expired: '这次控制已失效，请重新轻点方向。', camera_ptz_unavailable: '这台摄像头暂未开放云台控制。' };
  const message = error => messages[error.code] || '操作暂未完成，请稍后重试。';
  Object.assign(messages,{camera_recording_unavailable:'录像已过期或暂不可用，请刷新片段列表。',camera_invalid_date:'请选择有效的录像日期。',camera_recording_not_configured:'工地尚未配置云端录像服务。',camera_recording_conflict:'摄像头已有其他录像设置，请联系负责人核对。',camera_sd_clock_unavailable:'暂时无法核对设备时间或SD卡，请联系管理员检查设备连接。',camera_playback_busy:'正在核对上一次回放停止状态，请稍后重试。',camera_recording_busy:'正在核对云端录制停止状态，请稍后重新查询。',camera_sd_query_too_large:'当前区间片段较多，暂时无法完整读取，请稍后重试。',camera_invalid_retention:'保留天数超出当前存储节点支持范围。'});
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
  const recordingKey=r=>(r.source||'cloud')+':'+r.id;
  const selectedRecording=()=>recordings.find(r=>recordingKey(r)===$('recording').value);
  function capabilities() { const c = selected(); $('play').disabled = !c; $('capture').hidden = viewMode!=='live'||!state?.canCapture; $('capture').disabled = !c || captureBusy; $('ptz').hidden = viewMode!=='live'||!state?.canControl || !c?.ptz_enabled; $('play-recording').disabled=queryBusy||!selectedRecording();$('query-recordings').disabled=queryBusy||!state; }
  const preference=name=>'camera-'+name+':'+state.project.id;
  async function loadRecordings(append=false){
    if(!state)return;if(!active)status('选择日期和录像片段后开始回放。');const g=++recordingQuery;queryBusy=true;if(!append){recordings=[];earlier=null;}capabilities();$('recording').disabled=true;$('recording-status').textContent='正在读取录像片段…';
    try{
      const day=$('recording-date').value;localStorage.setItem(preference('date'),day);
      const result=await api('recordings/query',{date:day,bindingId:$('camera').value,...(append&&earlier?{before:earlier}:{})});if(g!==recordingQuery)return;
      recordings=append?[...result.items,...recordings]:result.items;earlier=result.nextBefore||null;$('query-recordings').textContent=earlier?'查询更早片段':'重新查询';$('recording').replaceChildren();
      for(const record of recordings){const option=document.createElement('option');option.value=recordingKey(record);
        const format=value=>new Date(value).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
        option.textContent=record.name+' · '+format(record.started_at)+' — '+format(record.ended_at);$('recording').append(option);}
      const previous=localStorage.getItem(preference('recording'));if(recordings.some(r=>recordingKey(r)===previous))$('recording').value=previous;
      if(!recordings.length){const option=document.createElement('option');option.textContent='当前日期暂无可回放录像';$('recording').append(option);}
      $('recording').disabled=!recordings.length;
      $('recording-status').textContent=recordings.length?'共 '+recordings.length+' 段'+(result.source==='sd'?'SD':'云端')+'录像；仅在时间连续时自动播放下一段。':'当前日期暂无可回放录像。启用前、未封口或中断期间的画面可能不可回放。';
      if(result.source==='sd')$('recording-status').textContent+=' SD每次查询至多一小时，只显示本工地绑定并完成时间核对后的区间；卡内画面可能被覆盖。'+(earlier?'可继续查询更早片段。':'');
      const notice={camera_storage_low:'持续录像因存储空间不足暂停，已有片段仍可回放。',camera_storage_unavailable:'暂时无法核对存储状态，持续录像已暂停，已有片段仍可回放。'}[result.recordingNotice];
      if(notice)$('recording-status').textContent+=' '+notice;
    }catch(e){if(g===recordingQuery){if(!append){$('recording').replaceChildren();const option=document.createElement('option');option.textContent='读取失败，请重新查询';$('recording').append(option);}$('recording-status').textContent=message(e)+(append?' 已保留当前片段，可重试读取更早区间。':'');}}
    finally{if(g===recordingQuery){queryBusy=false;$('recording').disabled=!recordings.length;capabilities();}}
  }
  async function setView(mode){
    if(!state)return;const change=++viewChange;await stop(true);if(change!==viewChange||!state)return;viewMode=mode;localStorage.setItem(preference('view'),mode);
    const playback=mode==='playback';$('live-actions').hidden=playback;$('live-settings').hidden=playback;$('playback-panel').hidden=!playback;
    for(const name of ['live','playback']){$(name+'-tab').classList.toggle('secondary',name!==mode);$(name+'-tab').setAttribute('aria-pressed',String(name===mode));}
    document.querySelector('.eyebrow').textContent=playback?'云工地 · 录像回放':'云工地 · 实时画面';
    capabilities();status(playback?'选择日期和录像片段后开始回放。':'请选择摄像头，点击开始播放。');
    if(playback)await loadRecordings();
  }
  async function playRecording(){
    const record=selectedRecording();if(!record)return;const generation=++intent;destroy();$('play-recording').disabled=true;status('正在读取录像…');
    try{await stopPending;if(generation!==intent)return;const result=await api('playback',{recordingId:String(record.id),source:record.source||'cloud'});if(generation!==intent)return;
      localStorage.setItem(preference('recording'),recordingKey(record));if(result.source==='sd')await attachStream(result,generation,false);else{video.src=result.url;await video.play();}if(generation!==intent)return;
      active=true;status('正在回放 · '+record.name);
    }catch(e){if(generation===intent){await stop(true);status(message(e),true);}}
    finally{capabilities();}
  }
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
  async function attachStream(stream,generation,live) {
      const mode = $('mode').value, flv = window.mpegts?.getFeatureList().mseLivePlayback;
      if (mode !== 'hls' && flv) {
        player = window.mpegts.createPlayer({ type: 'flv', isLive: live, url: stream.flv }, { enableWorker: false, enableStashBuffer: false, liveBufferLatencyChasing: live });
        player.on(window.mpegts.Events.ERROR, () => { if (generation === intent) { void stop(true); status('播放中断，可重新播放或切换兼容播放。', true); } });
        player.attachMediaElement(video); player.load(); await player.play();
      } else if (mode !== 'flv' && window.Hls?.isSupported()) {
        player = new window.Hls({ enableWorker: false, backBufferLength: 15, liveSyncDurationCount: 2 });
        const hls = player;
        hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal && generation === intent) { void stop(true); status('播放中断，可重新播放或切换播放方式。', true); } });
        hls.loadSource(stream.hls); hls.attachMedia(video); await video.play();
      } else if (mode !== 'flv' && video.canPlayType('application/vnd.apple.mpegurl')) { video.src = stream.hls; await video.play(); }
      else throw Object.assign(new Error(), { code: 'unsupported' });
  }
  async function play() {
    const c = selected(); if (!c) return;
    const generation = ++intent; destroy(); $('play').disabled = true; status('正在连接摄像头…');
    try {
      await stopPending; if (generation !== intent) return;
      const live = await api('live', { bindingId: String(c.binding_id) }); if (generation !== intent) return;
      await attachStream(live,generation,true);
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
      $('recording-date').value=localStorage.getItem(preference('date'))||new Date(Date.now()+28800000).toISOString().slice(0,10);
      status(state.items.length ? '请选择摄像头，点击开始播放。' : '当前工地尚未绑定摄像头。'); await loadHistory();
      heartbeat = setInterval(async () => { if (document.hidden) return; try { await api('heartbeat', {}); } catch (e) { clearInterval(heartbeat); await stop(true);recordingQuery++;recordings=[];state=null;capabilities();$('play').disabled = true; $('capture').disabled = true; $('ptz').hidden = true; status(message(e), true); } }, 20000);
      if(localStorage.getItem(preference('view'))==='playback')await setView('playback');
    } catch (e) { status(message(e), true); $('history-status').textContent = '访问不可用'; }
  }
  $('play').onclick = play; $('stop').onclick = () => stop(); $('capture').onclick = capture; $('refresh').onclick = loadHistory;
  $('camera').onchange = async () => {recordingQuery++;await stop(true);if(viewMode==='playback')await loadRecordings();else{capabilities();status('已切换摄像头，请点击开始播放。');} };
  $('mode').onchange = () => stop(); $('close-preview').onclick = () => $('preview').close();
  $('live-tab').onclick=()=>setView('live');$('playback-tab').onclick=()=>setView('playback');$('return-live').onclick=()=>setView('live');
  $('query-recordings').onclick=async()=>{await stop(true);await loadRecordings(!!earlier);};$('recording-date').onchange=async()=>{recordingQuery++;await stop(true);await loadRecordings();};
  $('recording').onchange=async()=>{await stop(true);capabilities();};$('play-recording').onclick=playRecording;
  video.addEventListener('ended',()=>{if(viewMode!=='playback')return;const record=selectedRecording(),index=recordings.indexOf(record),next=recordings[index+1];
    if(record&&next&&Math.abs(new Date(next.started_at).getTime()-new Date(record.ended_at).getTime())<=1000){$('recording').value=recordingKey(next);void playRecording();}
    else{void stop(true);status(next?'当前片段已结束，后续片段时间不连续，请手动选择。':'当天录像片段已播放结束。');}});
  document.querySelectorAll('[data-direction]').forEach(b => { b.onclick = () => control(b.dataset.direction); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void stop(true); });
  window.addEventListener('pagehide', () => { intent++; destroy(); if (csrf) fetch('/api/construction-camera/stop', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json', 'x-camera-csrf': csrf }, body: '{}' }).catch(() => {}); });
  video.addEventListener('error', () => { if (active) { console.warn('Camera media error',video.error?.code,video.error?.message); void stop(true); status('画面已中断，请重新播放。', true); } });
  void init();
})();
