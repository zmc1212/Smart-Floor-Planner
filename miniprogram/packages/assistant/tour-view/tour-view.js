const { AssistantClient, errorCopy } = require('../lib/client');
const { PortfolioImages } = require('../lib/portfolio');
const { tourInput, selectTour } = require('../lib/tour');
const { goToLogin } = require('../../../utils/session');

const initial = () => ({ loading: true, error: '', needsLogin: false, unavailable: false, noTour: false,
  workTitle: '', tourTitle: '', provider: '', url: '', webError: false, coverPath: '', copied: false });

Page({
  data: initial(),
  onLoad(options) {
    this._alive = true;
    this.input = tourInput(options);
    this.client = new AssistantClient();
    this.images = new PortfolioImages(this.client);
    if (!this.input) { this.setData({ ...initial(), loading: false, error: '当前 3D 空间入口不完整，请返回作品重新打开。' }); return; }
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ viewportWidth: info.windowWidth || 390 });
  },
  async onShow() {
    this._shown = true;
    if (!this.input || this._loaded || this._reading) return;
    const app = getApp();
    if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
    if (this._alive && this._shown) return this.load();
  },
  onHide() { this._shown = false; },
  onUnload() {
    this._alive = false; this._shown = false;
    if (this.images) this.images.clear();
  },
  async load() {
    if (this._reading) return;
    this._reading = true;
    this.setData({ ...initial(), viewportWidth: this.data.viewportWidth });
    try {
      const input = this.input;
      const work = await this.client.read(`/conversations/${input.conversationId}/portfolio/works/${input.workId}`, { versionId: input.versionId });
      if (!this._alive || !this._shown) return;
      if (String(work.id) !== input.workId || String(work.versionId) !== input.versionId) throw { code: 'portfolio_not_found', statusCode: 404 };
      const tour = selectTour(work, input.index);
      this.tour = tour;
      if (!tour) {
        this._loaded = true;
        this.setData({ loading: false, noTour: true, workTitle: String(work.title || '') });
        return;
      }
      this._loaded = true;
      this.setData({ loading: false, workTitle: String(work.title || ''), tourTitle: tour.title, provider: tour.provider, url: tour.url });
      if (/^[1-9]\d{0,18}$/.test(String(work.coverAssetId))) {
        try {
          const coverPath = await this.images.load(input.conversationId, work, work.coverAssetId);
          if (this._alive && this._shown) this.setData({ coverPath });
        } catch (_) { /* The fallback remains usable without the cover. */ }
      }
    } catch (error) {
      if (this._alive && this._shown) this.setData({ loading: false, error: errorCopy(error), needsLogin: error.statusCode === 401,
        unavailable: [401, 403, 404].includes(error.statusCode) || ['portfolio_not_found', 'assistant_resource_not_found'].includes(error.code) });
    } finally { this._reading = false; }
  },
  onError() {
    if (this._alive && this.data.url) this.setData({ url: '', webError: true });
  },
  retryWeb() {
    if (this.tour && this.tour.url && this._alive) this.setData({ url: this.tour.url, webError: false, copied: false });
  },
  retryRead() { this._loaded = false; return this.load(); },
  copy() {
    const url = this.tour && this.tour.url;
    if (!url) return;
    wx.setClipboardData({ data: url, success: () => {
      if (!this._alive) return;
      this.setData({ copied: true });
      wx.showToast({ title: '链接已复制，请在浏览器打开', icon: 'none' });
    } });
  },
  login() { goToLogin(); },
  back() {
    if (getCurrentPages().length > 1) { wx.navigateBack(); return; }
    if (this.input) {
      wx.redirectTo({ url: `/packages/assistant/work/work?conversationId=${encodeURIComponent(this.input.conversationId)}&workId=${this.input.workId}&versionId=${this.input.versionId}` });
      return;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },
});
