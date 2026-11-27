const api = require('../../../utils/api.js');
const { canAccessRoute } = require('../../../utils/identity-navigation.js');
const { ownerLiveMedia } = require('../../../utils/owner-live-media.js');
const sessionToken = () => getApp().globalData.token || wx.getStorageSync('token');
Page({
  data: { src: '', loading: true, error: '' },
  onLoad(query) {
    this._projectId = /^[1-9]\d*$/.test(query.projectId || '') ? query.projectId : '';
    this._staff = query.staff === '1';
    this._ownerPreview = query.conversationId !== undefined;
    if (this._ownerPreview) this._scope = [query.conversationId, query.liveId, query.versionId, query.revision];
  },
  onShow() {
    this._visible = true;
    // A fresh owner preview invalidates the previous viewing receipt. Keep the
    // mounted WebView and its still-valid session when returning to this page.
    const preview = this._preview;
    if (preview && preview.token === sessionToken() && Date.now() < preview.expiresAt) {
      if (!this.data.src) this.setData({ src: preview.src, loading: false });
      return;
    }
    return this.open();
  },
  onHide() {
    this._visible = false;
    if (this._ownerPreview) return;
    this._generation = (this._generation || 0) + 1;
    this.setData({ src: '' });
  },
  onUnload() { this._visible = false; this._preview = null; this._generation = (this._generation || 0) + 1; },
  async open() {
    if (this._previewOpening) return;
    if (this._ownerPreview) {
      this._preview = null;
      this._previewOpening = true;
    }
    const g = this._generation = (this._generation || 0) + 1;
    const currentAttempt = () => g === this._generation && (this._ownerPreview || this._visible);
    this.setData({ src: '', loading: true, error: '' });
    try {
      const app = getApp(); if (app.hydrateStoredSession) await app.hydrateStoredSession();
      if (!currentAttempt()) return;
      const current = app.globalData || {}, token = sessionToken();
      if (!token) throw new Error('forbidden');
      let result;
      if (this._ownerPreview) {
        if (!this._scope.every(value => /^[1-9]\d{0,18}$/.test(value || ''))) throw new Error('invalid scope');
        const [cid, lid, versionId, revision] = this._scope;
        result = await api.request('/miniprogram/assistant/public-live/' + cid + '/' + lid + '/webview', 'POST', { versionId, expectedRevision: Number(revision) }, { suppressUnauthorized: true });
        if (result.data?.versionId !== versionId || result.data?.revision !== Number(revision)) throw new Error('invalid version');
      } else {
        if (!this._projectId || !canAccessRoute('/packages/construction/camera/camera', current.bootstrap || current.userInfo)) throw new Error('forbidden');
        const endpoint = this._staff ? 'staff-video' : 'video';
        result = await api.request(`/miniprogram/construction/${endpoint}/projects/${this._projectId}/entry`, 'POST', {});
      }
      if (!currentAttempt()) return;
      if (token !== sessionToken()) throw new Error('identity changed');
      const url = result.data && result.data.url;
      if (this._ownerPreview) {
        const media = ownerLiveMedia(url, api.getBaseUrls);
        if (!media) throw new Error('invalid entry');
        const src = media.webview;
        this._preview = { src, token, expiresAt: Date.now() + Number(result.data.expiresInSeconds) * 1000 };
        if (this._visible) this.setData({ src });
        return;
      }
      if (typeof url !== 'string' || !/^https?:\/\/[^/]+\/construction-camera#entry=[1-9]\d*\.[A-Za-z0-9_-]{43}$/.test(url)) throw new Error('invalid entry');
      this.setData({ src: url });
    } catch { if (currentAttempt()) this.setData({ error: '暂时无法进入工地视频，请确认身份和工地权限后重试。' }); }
    finally { this._previewOpening = false; if (currentAttempt()) this.setData({ loading: false }); }
  },
  onWebError() { this._preview = null; this.setData({ src: '', error: '视频页面暂时无法打开，请稍后重新进入。' }); },
});
