const { PublicSitesController, initial } = require('./public-sites-model');
function identity() { return getApp().globalData.token || wx.getStorageSync('token') || ''; }
function page(detail) {
  return {
    data: { ...initial(), navTop: 47, navHeight: 44, navRight: 100 },
    onLoad(options) {
      this.options = options || {}; this.alive = true;
      this.controller = new PublicSitesController({ identity, emit: p => { if (this.alive) this.setData(p); } });
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      let cap; try { cap = wx.getMenuButtonBoundingClientRect(); } catch (_) { /* Native fallback. */ }
      this.setData({ navTop: Math.max(info.statusBarHeight || 24, (cap?.top || 47) - 6), navHeight: 44,
        navRight: Math.max(96, info.windowWidth - (cap?.left || info.windowWidth - 96) + 10) });
    },
    async onShow() {
      this.shown = true;
      const app = getApp(); if (app.globalData.sessionHydrationPromise) await app.globalData.sessionHydrationPromise;
      if (!this.alive || !this.shown) return;
      await this.controller.show(this.options, detail);
      if (this.alive && this.shown) this.timer = setInterval(() => { if (!this.data.loading) this.controller.load(); }, 15000);
    },
    onHide() { this.shown = false; clearInterval(this.timer); this.controller.hide(); },
    onUnload() { this.alive = false; clearInterval(this.timer); this.controller.hide(); },
    refresh() { return this.controller.load(); },
    back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) }); },
    chooseArea(e) { return this.controller.area(Number(e.detail.value)); },
    input(e) { this.controller.set({ draft: e.detail.value }); },
    changeTab(e) { this.controller.set({ tab: e.currentTarget.dataset.tab }); },
    preview(e) { return this.controller.media.preview(e.currentTarget.dataset.key); },
    openSite(e) {
      const item = this.data.items.find(i => i.id === String(e.currentTarget.dataset.id)); if (!item) return;
      const values = { enterpriseId: this.options.enterpriseId, siteId: item.id, versionId: item.versionId,
        ...(this.options.conversationId ? { conversationId: this.options.conversationId } : {}) };
      wx.navigateTo({ url: '/packages/construction/public-site/public-site?' + Object.entries(values).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&') });
    },
    consult() { wx.navigateTo({ url: this.controller.privateChat(this.data.site) }); },
    designer() { wx.navigateTo({ url: this.controller.privateChat(this.data.site, true) }); },
    voice() { wx.showToast({ title: '语音暂不可用，可以打字或发图', icon: 'none' }); },
    onShareAppMessage() { return { title: detail && this.data.site ? this.data.site.name + ' · 云工地围观' : '看看公开工地 · 家客来',
      path: detail && this.data.site ? '/packages/construction/public-site/public-site?enterpriseId='+this.options.enterpriseId+'&siteId='+this.data.site.id+'&versionId='+this.data.site.versionId
        : '/packages/construction/public-sites/public-sites?enterpriseId='+this.options.enterpriseId }; },
  };
}
module.exports = { page };
