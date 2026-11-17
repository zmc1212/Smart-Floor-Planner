(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const video = $('application-video');
  const ticket = new URLSearchParams(location.hash.slice(1)).get('access');
  history.replaceState(null, '', location.pathname);

  const api = '/api/construction-camera/live-authorization';
  const cannotOpen = '直播申请已更新或不可查看，请返回工地。';
  let application, media, hls, coverUrl, coverId, pending;
  let busy = false;
  let loading = false;
  let playbackError = '';
  let feedback = '';
  let retry = '';

  async function request(path, options = {}) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 28000);
    try {
      const response = await fetch(api + path, {
        ...options, cache: 'no-store', credentials: 'omit', signal: abort.signal,
        headers: { Authorization: 'Bearer ' + ticket, ...options.headers },
      });
      if (response.ok && options.image) return response.blob();
      const reply = await response.json();
      if (!response.ok || !reply.success || !reply.data)
        throw Object.assign(new Error(reply.code), { status: response.status, code: reply.code });
      return reply.data;
    } finally {
      clearTimeout(timer);
    }
  }

  function render() {
    const decide = application?.canDecide === true;
    $('application-header').hidden = !application;
    $('application-preview').hidden = !decide;
    $('application-decision').hidden = !decide;
    $('application-progress').hidden = !application || decide;
    $('application-note').hidden = !application || !['pending_owner', 'owner_approved', 'published'].includes(application.status);
    if (application) {
      $('project-name').textContent = application.projectName;
      $('camera-alias').textContent = application.alias;
      $('application-status').textContent = application.statusLabel;
      $('progress-status').textContent = application.statusLabel;
      $('progress-reason').textContent = application.reason;
      $('progress-reason').hidden = !application.reason;
      $('withdraw-application').hidden = !application.canWithdraw;
      $('withdraw-application').textContent = application.status === 'published' ? '停止公开直播' : '撤回直播申请';
    }
    video.hidden = !media;
    $('application-cover').hidden = !!media || !coverUrl;
    const lock = busy || loading || !!pending || retry === 'reload';
    const play = $('play-application');
    play.hidden = !!media;
    play.disabled = lock;
    play.textContent = playbackError ? '重新播放' : '播放直播';
    $('playback-status').textContent = playbackError || (application?.playbackReady
      ? '已观看当前机位' : media ? '正在连接直播…' : '');
    $('approve-application').disabled = lock || !application?.playbackReady;
    for (const id of ['decline-application', 'later-application', 'withdraw-application', 'confirm-withdraw'])
      $(id).disabled = lock;
    $('application-feedback').textContent = feedback;
    $('retry-application').hidden = !retry;
    $('retry-application').disabled = busy || loading;
    $('retry-application').textContent = pending ? '核对同次操作' : '重新读取';
  }

  function stopPlayback() {
    clearTimeout(media?.connectionTimer);
    clearTimeout(media?.expiryTimer);
    media = null;
    hls?.destroy();
    hls = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  async function syncCover() {
    const nextId = application?.canDecide ? application.cover?.id : undefined;
    if (nextId === coverId) return;
    coverId = nextId;
    if (coverUrl) URL.revokeObjectURL(coverUrl);
    coverUrl = '';
    $('application-cover').removeAttribute('src');
    if (!nextId) return;
    try {
      const image = await request('/cover/' + nextId, { image: true });
      if (coverId !== nextId) return;
      coverUrl = URL.createObjectURL(image);
      $('application-cover').src = coverUrl;
      render();
    } catch {
      // The current version remains playable without a scheduled cover.
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try {
      const next = await request('');
      if (application?.revision !== next.revision || !next.canDecide) stopPlayback();
      application = next;
      retry = '';
      void syncCover();
    } catch (error) {
      if ([401, 403, 404, 409].includes(error.status)) {
        application = null;
        stopPlayback();
        void syncCover();
        retry = '';
        feedback = cannotOpen;
      } else {
        retry = 'reload';
        feedback = '直播申请暂时无法读取，请重试。';
      }
    } finally {
      loading = false;
      render();
    }
  }

  function playbackFailed(attempt, message = '直播暂时无法播放，请重试。') {
    if (media !== attempt) return;
    stopPlayback();
    playbackError = message;
    render();
  }

  async function startPlayback(result) {
    const url = new URL(result.url, location.origin);
    const path = /^(\/api\/public\/construction-live\/[1-9]\d*\/[a-f0-9]{48}\/media\/[A-Za-z0-9_-]{43})\/hls\.m3u8$/;
    const match = path.exec(url.pathname);
    if (url.origin !== location.origin || !match || url.search || url.hash ||
        result.revision !== application.revision || result.versionId !== application.versionId || !(result.expiresInSeconds > 0))
      throw Error('Invalid live preview');
    stopPlayback();
    const attempt = media = { playedUrl: match[1] + '/played', reporting: false, retryAfter: 0 };
    attempt.connectionTimer = setTimeout(() => playbackFailed(attempt), 25000);
    attempt.expiryTimer = setTimeout(() => {
      if (media !== attempt) return;
      application.playbackReady = false;
      playbackFailed(attempt, '预览已过期，请重新播放。');
    }, result.expiresInSeconds * 1000);
    render();
    try {
      if (window.Hls?.isSupported()) {
        hls = new window.Hls({ enableWorker: false, backBufferLength: 15, liveSyncDurationCount: 1 });
        hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) playbackFailed(attempt); });
        hls.loadSource(url.href);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url.href;
      } else {
        throw Error('HLS player unavailable');
      }
      await video.play();
    } catch {
      playbackFailed(attempt);
    }
  }

  video.addEventListener('error', () => { if (media && video.error) playbackFailed(media); });
  video.addEventListener('timeupdate', async () => {
    const attempt = media;
    if (!attempt || document.hidden || video.paused || !video.videoWidth || !video.played.length ||
        video.currentTime - video.played.start(0) < 0.25) return;
    if (video.getVideoPlaybackQuality && video.getVideoPlaybackQuality().totalVideoFrames === 0) return;
    clearTimeout(attempt.connectionTimer);
    if (attempt.reporting || application.playbackReady || Date.now() < attempt.retryAfter) return;
    attempt.reporting = true;
    try {
      const response = await fetch(attempt.playedUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store', credentials: 'omit',
      });
      if (!response.ok || (await response.json()).data?.played !== true) throw Error('Playback receipt pending');
      if (media === attempt) {
        application.playbackReady = true;
        render();
      }
    } catch {
      attempt.retryAfter = Date.now() + 1000;
    } finally {
      attempt.reporting = false;
    }
  });

  function returnToSite() {
    feedback = '已保留申请，可从顶部返回。';
    if (window.wx?.miniProgram?.navigateBack) {
      window.wx.miniProgram.navigateBack({ delta: 1 });
    } else if (window.WeixinJSBridge?.invoke) {
      // Equivalent to the permission-free miniProgram navigation in WeChat's JS SDK.
      window.WeixinJSBridge.invoke('invokeMiniProgramAPI', {
        name: 'navigateBack', arg: { delta: 1 }, verifySignType: 'sha1',
      }, () => {});
    }
  }

  const outcomes = {
    approve: ['owner_approved', '已同意，待企业审核'],
    later: ['pending_owner', '待你决定'],
    decline: ['declined', '暂不公开'],
    withdraw: ['withdrawn', '已撤回直播申请'],
  };

  async function perform(operation) {
    const { action, expectedRevision, key } = operation;
    busy = true;
    feedback = '';
    if (action === 'preview') {
      application.playbackReady = false;
      playbackError = '正在连接直播…';
    } else if (action === 'approve') feedback = '正在提交审核…';
    render();
    try {
      const result = await request('/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ expectedRevision }),
      });
      if (result.revision !== expectedRevision + 1) throw Error('Decision receipt not confirmed');
      if (action === 'preview') {
        application.revision = result.revision;
        playbackError = '';
        // video.play() may stay pending through connection. The player owns
        // that lifecycle so the two non-approval decisions remain available.
        void startPlayback(result.media).catch(() => {
          stopPlayback();
          playbackError = '直播暂时无法播放，请重试。';
          render();
        });
        return;
      }
      const [status, label] = outcomes[action];
      if (result.status !== status) throw Error('Decision receipt not confirmed');
      const wasPublished = application.status === 'published';
      application = { ...application, revision: result.revision, status,
        statusLabel: action === 'withdraw' && wasPublished ? '直播已停止公开' : label,
        playbackReady: false, canDecide: action === 'later', canWithdraw: action === 'approve' || action === 'later' };
      pending = null;
      stopPlayback();
      $('withdraw-confirmation').hidden = true;
      feedback = result.stopped === false ? '公开权限已撤回，媒体清理待确认。' : '';
      render();
      await refresh();
      if (action === 'later') returnToSite();
    } catch (error) {
      if (action === 'preview') {
        stopPlayback();
        playbackError = '直播暂时无法播放，请重试。';
        await refresh();
      } else if (error.status >= 400 && error.status < 500) {
        pending = null;
        feedback = error.code === 'public_live_preview_required' ? '请重新播放当前机位后提交。' : '直播申请状态已变化，正在重新读取。';
        await refresh();
        if (application && error.code === 'public_live_preview_required') {
          stopPlayback();
          application.playbackReady = false;
        }
      } else {
        pending = operation;
        retry = 'decision';
        feedback = '操作结果尚未确认，请核对同次操作。';
      }
    } finally {
      busy = false;
      render();
    }
  }

  function act(action) {
    if (!application || busy || loading || pending || retry) return;
    if (action === 'withdraw' ? !application.canWithdraw : !application.canDecide) return;
    if (action === 'approve' && !application.playbackReady) return;
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const key = 'live-web.' + Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
    void perform({ action, expectedRevision: application.revision, key });
  }

  $('play-application').onclick = () => act('preview');
  $('approve-application').onclick = () => act('approve');
  $('decline-application').onclick = () => act('decline');
  $('later-application').onclick = () => act('later');
  $('withdraw-application').onclick = () => { $('withdraw-confirmation').hidden = false; };
  $('cancel-withdraw').onclick = () => { $('withdraw-confirmation').hidden = true; };
  $('confirm-withdraw').onclick = () => act('withdraw');
  $('retry-application').onclick = () => {
    if (busy || loading) return;
    if (pending) void perform(pending);
    else { feedback = ''; void refresh(); }
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && ticket && !busy && !pending) void refresh();
  });
  window.addEventListener('pagehide', stopPlayback);
  if (ticket) void refresh();
  else { feedback = cannotOpen; render(); }
})();
