const api = require('../../../utils/api.js');
const { canAccessRoute } = require('../../../utils/identity-navigation.js');
Page({
  data: { src: '', loading: true, error: '' },
  onLoad(query) { this._projectId = /^[1-9]\d*$/.test(query.projectId || '') ? query.projectId : ''; },
  onShow() { this._visible = true; this.open(); },
  onHide() { this._visible = false; this._generation = (this._generation || 0) + 1; this.setData({ src: '' }); },
  onUnload() { this._visible = false; this._generation = (this._generation || 0) + 1; },
  async open() {
    const g = this._generation = (this._generation || 0) + 1;
    this.setData({ src: '', loading: true, error: '' });
    try {
      const app = getApp(); if (app.hydrateStoredSession) await app.hydrateStoredSession();
      const current = app.globalData || {}, token = current.token || wx.getStorageSync('token');
      if (!this._projectId || !token || !canAccessRoute('/packages/construction/projects/projects', current.bootstrap || current.userInfo)) throw new Error('forbidden');
      const result = await api.request('/miniprogram/construction/video/projects/' + this._projectId + '/entry', 'POST', {});
      if (!this._visible || g !== this._generation || token !== (getApp().globalData.token || wx.getStorageSync('token'))) return;
      const url = result.data && result.data.url;
      if (typeof url !== 'string' || !/^https?:\/\/[^/]+\/construction-camera#entry=[1-9]\d*\.[A-Za-z0-9_-]{43}$/.test(url)) throw new Error('invalid entry');
      this.setData({ src: url });
    } catch { if (this._visible && g === this._generation) this.setData({ error: '暂时无法进入工地视频，请确认身份和工地权限后重试。' }); }
    finally { if (this._visible && g === this._generation) this.setData({ loading: false }); }
  },
  onWebError() { this.setData({ src: '', error: '视频页面暂时无法打开，请稍后重新进入。' }); },
});
