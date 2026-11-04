const api = require('../../../utils/api.js');
const { canAccessRoute } = require('../../../utils/identity-navigation.js');
Page({
  data: { src: '', loading: true, error: '' },
  onLoad(query) {
    this._projectId = /^[1-9]\d*$/.test(query.projectId || '') ? query.projectId : '';
    this._ownerPreview = query.conversationId !== undefined;
    if (this._ownerPreview) this._scope = [query.conversationId, query.liveId, query.versionId, query.revision];
  },
  onShow() { this._visible = true; this.open(); },
  onHide() { this._visible = false; this._generation = (this._generation || 0) + 1; this.setData({ src: '' }); },
  onUnload() { this._visible = false; this._generation = (this._generation || 0) + 1; },
  async open() {
    const g = this._generation = (this._generation || 0) + 1;
    this.setData({ src: '', loading: true, error: '' });
    try {
      const app = getApp(); if (app.hydrateStoredSession) await app.hydrateStoredSession();
      const current = app.globalData || {}, token = current.token || wx.getStorageSync('token');
      if (!token) throw new Error('forbidden');
      let result;
      if (this._ownerPreview) {
        if (!this._scope.every(value => /^[1-9]\d{0,18}$/.test(value || ''))) throw new Error('invalid scope');
        const [cid, lid, versionId, revision] = this._scope;
        result = await api.request('/miniprogram/assistant/public-live/' + cid + '/' + lid + '/webview', 'POST', { versionId, expectedRevision: Number(revision) }, { suppressUnauthorized: true });
        if (result.data?.versionId !== versionId || result.data?.revision !== Number(revision)) throw new Error('invalid version');
      } else {
        if (!this._projectId || !canAccessRoute('/packages/construction/camera/camera', current.bootstrap || current.userInfo)) throw new Error('forbidden');
        result = await api.request('/miniprogram/construction/video/projects/' + this._projectId + '/entry', 'POST', {});
      }
      if (!this._visible || g !== this._generation || token !== (getApp().globalData.token || wx.getStorageSync('token'))) return;
      const url = result.data && result.data.url;
      if (this._ownerPreview) {
        const match = /^(https:\/\/[A-Za-z0-9.-]+(?::\d+)?|http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?)?\/api\/public\/construction-live\/([1-9]\d*)\/([a-f0-9]{48})\/media\/([A-Za-z0-9_-]{43})\/hls\.m3u8$/.exec(url || '');
        if (!match) throw new Error('invalid entry');
        const origin = match[1] || api.getBaseUrls()[0].replace(/\/api$/, '');
        this.setData({ src: origin + '/construction-camera#ownerLive=' + match.slice(2).join('.') });
        return;
      }
      if (typeof url !== 'string' || !/^https?:\/\/[^/]+\/construction-camera#entry=[1-9]\d*\.[A-Za-z0-9_-]{43}$/.test(url)) throw new Error('invalid entry');
      this.setData({ src: url });
    } catch { if (this._visible && g === this._generation) this.setData({ error: '暂时无法进入工地视频，请确认身份和工地权限后重试。' }); }
    finally { if (this._visible && g === this._generation) this.setData({ loading: false }); }
  },
  onWebError() { this.setData({ src: '', error: '视频页面暂时无法打开，请稍后重新进入。' }); },
});
