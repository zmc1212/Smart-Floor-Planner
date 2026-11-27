const { ownerLiveMedia } = require('../../../utils/owner-live-media');

function postReceipt(url) {
  return new Promise((resolve, reject) => wx.request({
    url, method: 'POST', data: {}, timeout: 8000, header: { 'content-type': 'application/json' },
    success(response) {
      if (response.statusCode === 200 && response.data?.data?.played === true) resolve();
      else reject({ statusCode: response.statusCode });
    },
    fail: reject,
  }));
}

class InlineLivePreview {
  constructor({ identity, read, refresh, emit, baseUrls, receipt = postReceipt }) {
    Object.assign(this, { identity, read, refresh, emit, baseUrls, receipt });
    this.epoch = 0;
  }

  valid(preview) { return !!preview && this.active === preview && preview.viewer === this.identity(); }

  show(preview, phase, message = '') {
    this.emit({ id: preview.id, epoch: preview.epoch, src: phase === 'failed' ? '' : preview.src || '', phase, message });
  }

  clear() {
    if (!this.active) return;
    clearTimeout(this.active.firstFrame);
    this.active = null;
    this.emit(null);
  }

  reconcile(cards) {
    if (!this.active) return;
    const { id, versionId, revision } = this.active;
    if (!Object.values(cards).some(c => c.id === id && c.canDecide && c.available && c.versionId === versionId && c.revision === revision)) this.clear();
  }

  async open(cid, receipt) {
    this.clear();
    const { id, versionId, revision } = receipt;
    const preview = this.active = { id, versionId, revision, viewer: this.identity(), epoch: ++this.epoch };
    this.show(preview, 'connecting', '正在连接直播…');
    try {
      const data = await this.read(`/miniprogram/assistant/public-live/${cid}/${id}/webview`, 'POST', { versionId, expectedRevision: revision });
      if (!this.valid(preview)) return;
      const media = ownerLiveMedia(data.url, this.baseUrls);
      if (!media || data.versionId !== versionId || data.revision !== revision) throw new Error('invalid preview');
      Object.assign(preview, { src: media.src, playedUrl: media.played });
      preview.firstFrame = setTimeout(() => this.failed(preview), 22000);
      this.show(preview, 'connecting', '正在连接直播…');
    } catch {
      this.failed(preview);
    }
  }

  failed(preview) {
    if (!this.valid(preview) || preview.failed) return;
    clearTimeout(preview.firstFrame);
    preview.failed = true;
    this.show(preview, 'failed', '直播暂时无法播放，请重试。');
  }

  error({ epoch }) { if (this.active?.epoch === epoch) this.failed(this.active); }

  async advance({ epoch, currentTime }) {
    const preview = this.active;
    if (!this.valid(preview) || preview.epoch !== epoch || !preview.playedUrl || preview.failed || !Number.isFinite(currentTime) || currentTime <= 0) return;
    if (preview.firstTime === undefined) {
      clearTimeout(preview.firstFrame);
      preview.firstTime = currentTime;
      this.show(preview, 'playing');
      return;
    }
    if (preview.confirmed || preview.reporting || currentTime - preview.firstTime < .25 || Date.now() < (preview.retryAfter || 0)) return;
    preview.reporting = true;
    try {
      await this.receipt(preview.playedUrl);
      if (this.valid(preview)) { preview.confirmed = true; await this.refresh(); }
    } catch (error) {
      if ([401, 403, 404].includes(error?.statusCode)) this.failed(preview);
      else preview.retryAfter = Date.now() + 1000;
    } finally {
      preview.reporting = false;
    }
  }
}

module.exports = { InlineLivePreview };
