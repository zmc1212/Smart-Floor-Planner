const { displayName } = require('./family-view');

const initialCameraLive = { liveSrc: '', livePhase: 'idle', liveMessage: '', liveEpoch: 0 };
const mediaUrl = /^(?:https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)\/camera-media\/native\/(n1\.[1-9]\d{0,18}\.[A-Za-z0-9_-]{43})\/[1-9]\d*\/hls\.m3u8$/;

function normalizeCameraList(items) {
  return (Array.isArray(items) ? items : []).map(camera => ({
    bindingId: String(camera?.binding_id || ''),
    name: displayName(camera?.name, '工地摄像头'),
  })).filter(camera => /^(?:[1-9]\d{0,18}|test-pattern)$/.test(camera.bindingId));
}

function privateCameraLiveMethods(api, token, {
  endpoint = 'video', current, selection, recheck, reset, firstFrameTimeoutMs = 22000, retryPlaybackError = false,
}) {
  const request = (projectId, action, payload) => api.request(
    `/miniprogram/construction/${endpoint}/projects/${projectId}/native-live/${action}`,
    'POST', payload, { suppressUnauthorized: true, timeout: action === 'start' ? 30000 : 10000 },
  );
  const stop = session => {
    if (session && token() === session.token) {
      // When disconnected, the server lease expires independently.
      void request(session.projectId, 'stop', { ticket: session.ticket }).catch(() => {});
    }
  };

  return {
    clearPrivateLive(patch = {}) {
      this._liveEpoch = (this._liveEpoch || 0) + 1;
      clearTimeout(this._liveRenew);
      clearTimeout(this._liveFirstFrame);
      const session = this._liveSession;
      this._liveSession = null;
      this.setData({ ...initialCameraLive, liveEpoch: this._liveEpoch, ...patch });
      stop(session);
    },

    async startPrivateLive(retried = false) {
      const selected = selection(this);
      const viewer = token();
      if (!current(this) || !viewer || !selected?.projectId || !selected.bindingId ||
          this._liveSession || this.data.livePhase === 'connecting') return;
      const { projectId, bindingId } = selected;
      const epoch = this._liveEpoch = (this._liveEpoch || 0) + 1;
      const valid = () => current(this) && epoch === this._liveEpoch && viewer === token();
      this.setData({ livePhase: 'connecting', liveMessage: '正在连接直播…', liveEpoch: epoch });
      try {
        const { data } = await request(projectId, 'start', { bindingId });
        const session = { projectId, ticket: data?.ticket, token: viewer, retried: retried === true };
        const match = typeof data?.url === 'string' && mediaUrl.exec(data.url);
        if (!match || match[1] !== session.ticket) {
          if (typeof session.ticket === 'string') stop(session);
          throw new Error('invalid live address');
        }
        if (!valid()) { stop(session); return; }
        this._liveSession = session;
        this.setData({ liveSrc: data.url });
        this._liveFirstFrame = setTimeout(() => {
          if (this._liveSession === session && this.data.livePhase === 'connecting') this.failPrivateLive();
        }, firstFrameTimeoutMs);
        this.schedulePrivateLiveRenewal(session);
      } catch (error) {
        if (valid()) this.failPrivateLive(error);
      }
    },

    schedulePrivateLiveRenewal(session) {
      this._liveRenew = setTimeout(async () => {
        if (this._liveSession !== session) return;
        if (token() !== session.token || !current(this)) {
          this.clearPrivateLive();
          reset?.(this);
          return;
        }
        try {
          await request(session.projectId, 'heartbeat', { ticket: session.ticket });
          if (this._liveSession === session) this.schedulePrivateLiveRenewal(session);
        } catch (error) {
          if (this._liveSession === session) this.failPrivateLive(error);
        }
      }, 20000);
    },

    failPrivateLive(error, checkAccess = false) {
      const denied = [401, 403, 404].includes(error?.statusCode) && error?.error !== 'camera_not_found';
      this.clearPrivateLive({ livePhase: 'failed', liveMessage: denied ? '直播权限或会话已失效。' : '暂时无法连接直播，请重试。' });
      if (current(this) && (denied || checkAccess)) recheck?.(this);
    },

    onPrivateLiveAdvance(event) {
      if (event.detail.epoch !== this._liveEpoch || !this._liveSession || this.data.livePhase !== 'connecting' || !current(this)) return;
      clearTimeout(this._liveFirstFrame);
      this.setData({ livePhase: 'playing', liveMessage: '' });
    },

    onPrivateLiveError(event) {
      const session = this._liveSession;
      if (event.detail.epoch !== this._liveEpoch || !session || !current(this)) return;
      if (retryPlaybackError && !session.retried) {
        this.clearPrivateLive();
        return this.startPrivateLive(true);
      }
      this.failPrivateLive(null, true);
    },

    stopPrivateLive() { this.clearPrivateLive({ livePhase: 'stopped' }); },
  };
}

module.exports = { initialCameraLive, normalizeCameraList, privateCameraLiveMethods };
