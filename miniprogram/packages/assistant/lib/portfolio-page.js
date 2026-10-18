const { PortfolioController, initial } = require('./portfolio');
const { goToLogin } = require('../../../utils/session');
function identity() { return getApp().globalData.token || wx.getStorageSync('token') || ''; }
function page(kind) {
  return {
    data: { ...initial(), navigationTop: 47, navigationHeight: 44, navigationRight: 100 },
    onLoad(options) {
      this._options = options || {}; this._alive = true;
      this.controller = new PortfolioController({ identity, emit: patch => {
        if (!this._alive) return;
        this.setData(patch);
        if (patch.sharePath && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
        else if (patch.sharePath === '' && wx.hideShareMenu) wx.hideShareMenu();
      } });
      this.measureNavigation();
    },
    async onShow() {
      this._shown = true;
      const hydration = getApp().globalData.sessionHydrationPromise;
      if (hydration) await hydration;
      if (this._alive && this._shown) return this.controller.show(this._options, kind);
    },
    onHide() { this._shown = false; this.controller.hide(); },
    onUnload() { this._alive = false; this.controller.hide(); },
    onResize() { this.measureNavigation(); },
    measureNavigation() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      let capsule; try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { /* Safe default below. */ }
      this.setData({ navigationTop: Math.max(info.statusBarHeight || 44, (capsule?.top || 50) - 6), navigationHeight: Math.max(44, capsule?.height || 32), navigationRight: capsule ? info.windowWidth - capsule.left + 8 : 100 });
    },
    retry() { return this.controller.load(); },
    retryImages() { this.controller.set({ imageError: '' }); return this.controller.loadImages(); },
    moreWorks() { return this.controller.more(); },
    login() { goToLogin(); },
    back() {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else this.continueChat();
    },
    continueChat() {
      const id = this.data.conversationId;
      if (!id || this.data.needsLogin) { wx.switchTab({ url: '/pages/index/index' }); return; }
      const pages = getCurrentPages();
      const index = pages.findIndex(p => p.route === 'packages/assistant/chat/chat' && String(p.data?.conversation?.id || p.options?.conversationId) === id);
      if (index >= 0 && index < pages.length - 1) wx.navigateBack({ delta: pages.length - 1 - index });
      else wx.redirectTo({ url: '/packages/assistant/chat/chat?conversationId=' + encodeURIComponent(id) + (this._prompt ? '&prompt=' + encodeURIComponent(this._prompt) : '') });
    },
    openWork(event) {
      const work = this.data.works.find(w => w.id === String(event.currentTarget.dataset.id));
      if (!work) return;
      wx.navigateTo({ url: `/packages/assistant/work/work?conversationId=${encodeURIComponent(this.data.conversationId)}&workId=${work.id}&versionId=${work.versionId}` });
    },
    async contact() { if (await this.controller.write('contact')) this.continueChat(); },
    preference(event) { return this.controller.write(event.currentTarget.dataset.sentiment); },
    retryWrite() { return this.data.pendingAction && this.controller.write(this.data.pendingAction); },
    async preview(event) {
      if (this.data.unavailable || !this.data.work) return;
      // Recheck rights/version immediately before exposing the full-size viewer.
      try {
        await this.controller.client.read(`/conversations/${this.data.conversationId}/portfolio/works/${this.data.work.id}`, { versionId: this.data.work.versionId });
        if (!this._alive || !this._shown || this.controller.session !== identity()) return;
        const current = this.data.images['i' + event.currentTarget.dataset.id];
        if (current) wx.previewImage({ current, urls: this.data.work.images.map(i => this.data.images['i' + i.assetId]).filter(Boolean) });
      } catch (error) { this.controller.fail(error, this.controller.epoch); }
    },
    pickTopic(event) {
      const text = event.currentTarget.dataset.text;
      this._prompt = text;
      const pages = getCurrentPages();
      const chat = pages.find(p => p.route === 'packages/assistant/chat/chat' && String(p.data?.conversation?.id) === this.data.conversationId);
      if (chat?.controller && !chat.data.draft && !chat.data.pendingSend) chat.controller.input(text);
      this.continueChat();
    },
    onShareAppMessage() { return { title: this.data.shareTitle || '设计师的设计室 · 家客来', path: this.data.sharePath || '/pages/index/index',
      imageUrl: '/packages/assistant/assets/designer-studio-book.png' }; },
  };
}
module.exports = { page };
