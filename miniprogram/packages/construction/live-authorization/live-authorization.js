const api = require('../../../utils/api');
const { validId } = require('../../../utils/owner-live-authorization');

const session = () => getApp().globalData.token || wx.getStorageSync('token');
const entry = /^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?(\/construction-camera\/live-authorization#access=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;

Page({
  data: { src: '', loading: true, error: '', retryable: false },
  onLoad(query) {
    this.scope = [query.projectId, query.liveId, query.versionId];
  },
  onShow() {
    const current = this.access;
    if (current?.token === session() && Date.now() < current.expiresAt && this.data.src) return;
    return this.open();
  },
  onUnload() {
    this.generation = (this.generation || 0) + 1;
    this.access = null;
  },
  async open() {
    const g = this.generation = (this.generation || 0) + 1;
    this.access = null;
    if (!this.scope?.every(validId)) {
      this.setData({ src: '', loading: false, error: '直播申请已更新或不可查看，请返回工地。', retryable: false });
      return;
    }
    this.setData({ src: '', loading: true, error: '', retryable: false });
    const app = getApp();
    try {
      await app.hydrateStoredSession?.();
      if (this.generation !== g) return;
      const token = session();
      if (!token) {
        this.setData({ loading: false, error: '请登录后从工地打开直播申请。' });
        return;
      }
      const [projectId, liveId, versionId] = this.scope;
      const path = '/miniprogram/construction/owner-sites/' + projectId + '/public-live/entry';
      const response = await api.request(path, 'POST', { liveId, versionId }, { suppressUnauthorized: true });
      if (this.generation !== g || session() !== token) return;
      const match = entry.exec(response.data?.url || '');
      const ttl = response.data?.expiresInSeconds;
      if (!match || !Number.isSafeInteger(ttl) || ttl <= 0) throw Error('Invalid live authorization entry');
      const origin = match[1] || api.getBaseUrls()[0].replace(/\/api\/?$/, '');
      this.access = { token, expiresAt: Date.now() + ttl * 1000 };
      this.setData({ src: origin + match[2], loading: false });
    } catch (error) {
      if (this.generation !== g) return;
      const unavailable = [401, 403, 404, 409].includes(error.statusCode);
      this.setData({ loading: false, retryable: !unavailable,
        error: unavailable ? '直播申请已更新或不可查看，请返回工地。' : '直播申请暂时无法读取，请重试。' });
    }
  },
  onWebError() {
    this.access = null;
    this.setData({ src: '', loading: false, retryable: true, error: '直播申请暂时无法打开，请重试。' });
  },
});
