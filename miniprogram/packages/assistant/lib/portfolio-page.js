const { PortfolioController, initial, studioDefaults } = require('./portfolio');
const { goToLogin } = require('../../../utils/session');
const { copyDesignerWechatId } = require('../../../utils/designerContact');
const { loadStudioFont } = require('./studio-font');
function identity() { return getApp().globalData.token || wx.getStorageSync('token') || ''; }
function originalChat(page, id) {
  const chat = page.route === 'packages/assistant/chat/chat' ? page
    : page.route === 'pages/index/index' ? page.selectComponent?.('#xiaok-chat') : null;
  return chat && String(chat.data?.conversation?.id || chat.options?.conversationId) === id ? chat : null;
}
function contactToast(title, icon = 'none') { wx.showToast({ title, icon }); }
function page(kind) {
  return {
    data: { ...initial(), studioSheetVisible: false, studioSheetOpen: false, contactSheetVisible: false, contactSheetOpen: false,
      studioDraft: studioDefaults(), studioDraftCount: 0,
      studioSheetBodyHeight: 285, navigationTop: 47, navigationHeight: 44, navigationRight: 100, navigationBottom: 91 },
    onLoad(options) {
      this._options = options || {}; this._alive = true;
      this._fontReady = loadStudioFont().then(loaded => { this._studioFontLoaded = loaded; });
      this.controller = new PortfolioController({ identity, emit: patch => {
        if (!this._alive) return;
        this.setData(patch);
        if (patch.unavailable) { this.dismissStudioFilters(); this.dismissPublicContact(); }
        if (patch.sharePath && wx.showShareMenu) wx.showShareMenu({ menus: ['shareAppMessage'] });
        else if (patch.sharePath === '' && wx.hideShareMenu) wx.hideShareMenu();
      } });
      this.measureNavigation();
    },
    async onShow() {
      this._shown = true;
      const hydration = getApp().globalData.sessionHydrationPromise;
      if (hydration) await hydration;
      if (this._fontReady) await this._fontReady;
      if (this._alive && this._shown) {
        await this.controller.show(this._options, kind);
        if (this._alive && this._shown && !this.data.loading && !this.data.unavailable && !this.data.error && this.controller.restoreScrollTop) {
          wx.pageScrollTo({ scrollTop: this.controller.restoreScrollTop, duration: 0 });
        }
      }
    },
    onHide() { this._shown = false; this.dismissStudioFilters(); this.dismissPublicContact(); this.controller.hide(); },
    onUnload() { this.dismissStudioFilters(); this.dismissPublicContact(); this._alive = false; this.controller.hide(); },
    onResize() { this.measureNavigation(); if (this.data.studioSheetVisible) this.measureStudioSheet(); },
    onPageScroll(event) { this.controller?.recordScroll(event.scrollTop); },
    measureNavigation() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      let capsule; try { capsule = wx.getMenuButtonBoundingClientRect(); } catch (_) { /* Safe default below. */ }
      const navigationTop = Math.max(info.statusBarHeight || 44, (capsule?.top || 50) - 6), navigationHeight = Math.max(44, capsule?.height || 32);
      this.setData({ navigationTop, navigationHeight, navigationBottom: navigationTop + navigationHeight, navigationRight: capsule ? info.windowWidth - capsule.left + 8 : 100 });
    },
    retry() { return this.controller.load(); },
    retryImages() { this.controller.set({ imageError: '' }); return this.controller.loadImages(); },
    moreWorks() { return this.controller.more(); },
    setFilter(event) {
      const result = this.controller.setStudioFilters({ ...this.data.studioFilters, style: event.currentTarget.dataset.key });
      this.alignStudioCatalog(); return result;
    },
    clearFilter() { const result = this.controller.setStudioFilters(studioDefaults()); this.alignStudioCatalog(); return result; },
    toggleStudioTour() {
      const result = this.controller.setStudioFilters({ ...this.data.studioFilters, tourOnly: !this.data.studioFilters.tourOnly });
      this.alignStudioCatalog(); return result;
    },
    setSpace(event) { this.controller.setSpace(event.currentTarget.dataset.space); },
    alignStudioCatalog() {
      if (!this._alive || !this._shown || this.data.loading || this.data.unavailable) return;
      const epoch = this.controller.epoch;
      const query = wx.createSelectorQuery().in(this);
      query.select('#studio-catalog').boundingClientRect(); query.selectViewport().scrollOffset();
      query.exec(result => {
        if (!this._alive || !this._shown || this.controller.epoch !== epoch || !result[0] || !result[1]) return;
        wx.pageScrollTo({ scrollTop: Math.max(0, result[0].top + result[1].scrollTop - this.data.navigationBottom), duration: 0 });
      });
    },
    measureStudioSheet() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(), scale = info.windowWidth / 390;
      const rows = [Math.ceil(this.data.styleOptions.length / 2), Math.ceil(this.data.layoutOptions.length / 3), 1];
      const contentHeight = 111 + rows.reduce((height, count) => height + Math.max(49, count * 44), 0);
      this.setData({ studioSheetBodyHeight: Math.max(88, Math.min(contentHeight * scale, 420 * scale, info.windowHeight - this.data.navigationBottom - 218 * scale)) });
    },
    showStudioFilters() {
      if (!this._alive || !this._shown || this.data.loading || this.data.unavailable || !this.data.designer) return;
      clearTimeout(this._studioSheetTimer);
      const preview = this.controller.previewStudioFilters(this.data.studioFilters);
      this.measureStudioSheet();
      this.setData({ studioSheetVisible: true, studioSheetOpen: false, studioDraft: preview.filters, studioDraftCount: preview.count });
      this._studioSheetTimer = setTimeout(() => {
        if (this._alive && this._shown && this.data.studioSheetVisible) this.setData({ studioSheetOpen: true });
      }, 20);
    },
    selectStudioDraft(event) {
      const { group, key } = event.currentTarget.dataset;
      if (!this.data.studioSheetVisible || !['style', 'layout', 'tourOnly'].includes(group)) return;
      const preview = this.controller.previewStudioFilters({ ...this.data.studioDraft, [group]: group === 'tourOnly' ? key === true || key === 'true' : key });
      this.setData({ studioDraft: preview.filters, studioDraftCount: preview.count });
    },
    resetStudioDraft() {
      const preview = this.controller.previewStudioFilters(studioDefaults());
      this.setData({ studioDraft: preview.filters, studioDraftCount: preview.count });
    },
    closeStudioFilters() {
      clearTimeout(this._studioSheetTimer); this.setData({ studioSheetOpen: false });
      this._studioSheetTimer = setTimeout(() => { if (this._alive) this.setData({ studioSheetVisible: false }); }, 260);
    },
    dismissStudioFilters() {
      clearTimeout(this._studioSheetTimer);
      if (this.data.studioSheetVisible) this.setData({ studioSheetVisible: false, studioSheetOpen: false });
    },
    applyStudioFilters() {
      if (!this._alive || !this._shown || !this.data.studioSheetVisible || this.data.loading || this.data.unavailable) return;
      const result = this.controller.setStudioFilters(this.data.studioDraft);
      this.closeStudioFilters(); this.alignStudioCatalog(); return result;
    },
    noop() {},
    openStudioTour() {
      if (this.data.loading || this.data.unavailable) return;
      this.openTourFor(this.data.featuredWork);
    },
    openTour() {
      this.openTourFor(this.data.work);
    },
    openTourFor(work) {
      if (!work || !work.tours.length) return;
      if (work.tours.length === 1) { this.navigateTour(0, work); return; }
      wx.showActionSheet({ itemList: work.tours.map(tour => tour.title || tour.provider), success: result => this.navigateTour(result.tapIndex, work) });
    },
    navigateTour(index, work = this.data.work) {
      if (!work || !Number.isInteger(index) || index < 0 || index >= work.tours.length) return;
      wx.navigateTo({ url: `/packages/assistant/tour-view/tour-view?conversationId=${encodeURIComponent(this.data.conversationId)}&workId=${work.id}&versionId=${work.versionId}&index=${index}` });
    },
    login() { goToLogin(); },
    back() {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else this.continueChat();
    },
    continueChat() {
      const id = this.data.conversationId;
      if (!id || this.data.needsLogin) { wx.switchTab({ url: '/pages/index/index' }); return; }
      const pages = getCurrentPages();
      const index = pages.findIndex(p => originalChat(p, id));
      if (index >= 0 && index < pages.length - 1) wx.navigateBack({ delta: pages.length - 1 - index });
      else wx.redirectTo({ url: '/packages/assistant/chat/chat?conversationId=' + encodeURIComponent(id) + (this._prompt ? '&prompt=' + encodeURIComponent(this._prompt) : '') });
    },
    openWork(event) {
      if (this.data.loading || this.data.unavailable) return;
      const work = (this.data.designer?.works || this.data.works).find(w => w.id === String(event.currentTarget.dataset.id));
      if (!work) return;
      wx.navigateTo({ url: `/packages/assistant/work/work?conversationId=${encodeURIComponent(this.data.conversationId)}&workId=${work.id}&versionId=${work.versionId}` });
    },
    openDesigner() {
      const work = this.data.work, id = this.data.conversationId;
      if (this.data.loading || this.data.unavailable || !work?.authorId || !id) return;
      const pages = getCurrentPages();
      const index = pages.findIndex(p => p.route === 'packages/assistant/designer/designer'
        && String(p.data?.designer?.id || p.options?.authorId) === String(work.authorId)
        && String(p.data?.conversationId || p.options?.conversationId) === id);
      if (index >= 0 && index < pages.length - 1) wx.navigateBack({ delta: pages.length - 1 - index });
      else wx.navigateTo({ url: `/packages/assistant/designer/designer?conversationId=${encodeURIComponent(id)}&authorId=${work.authorId}&sourceWorkId=${work.id}` });
    },
    openPublicContact() {
      if (!this._alive || !this._shown || this.data.loading || this.data.unavailable || (!this.data.work && !this.data.featuredWork)) return;
      if (!this.data.contactSheetOpen) {
        clearTimeout(this._contactSheetTimer);
        this.setData({ contactSheetVisible: true });
        this._contactSheetTimer = setTimeout(() => {
          if (this._alive && this._shown) this.setData({ contactSheetOpen: true });
        }, 20);
      }
      return this.controller.refreshContact({ qr: true });
    },
    closePublicContact() {
      clearTimeout(this._contactSheetTimer);
      this.controller.closeContact(); this.setData({ contactSheetOpen: false });
      this._contactSheetTimer = setTimeout(() => { if (this._alive) this.setData({ contactSheetVisible: false }); }, 260);
    },
    dismissPublicContact() {
      clearTimeout(this._contactSheetTimer);
      if (this.data.contactSheetVisible) this.setData({ contactSheetVisible: false, contactSheetOpen: false });
    },
    copyPublicWechat() {
      return this.controller.refreshContact({ apply: async contact => {
        if (!contact.wechatId) { contactToast('工作微信已更新'); return; }
        try { await copyDesignerWechatId(contact.wechatId, { withSearchHint: true }); }
        catch { contactToast('复制失败，请重试'); }
      } });
    },
    callPublicPhone() {
      return this.controller.refreshContact({ apply: contact => {
        if (!contact.phone) { contactToast('工作电话已更新'); return; }
        wx.makePhoneCall({ phoneNumber: contact.phone, fail: error => {
          if (!/cancel/i.test(error.errMsg || '')) contactToast('拨号未启动，请重试');
        } });
      } });
    },
    previewContactQr() {
      return this.controller.refreshContact({ qr: true, apply: (_contact, filePath) => {
        if (filePath) wx.previewImage({ current: filePath, urls: [filePath] });
        else contactToast('二维码已更新');
      } });
    },
    saveContactQr() {
      return this.controller.refreshContact({ qr: true, apply: (_contact, filePath) => {
        if (!filePath) { contactToast('二维码已更新'); return; }
        return new Promise(resolve => wx.saveImageToPhotosAlbum({ filePath,
          success: () => { contactToast('二维码已保存', 'success'); resolve(); },
          fail: () => { contactToast('保存失败，请检查相册权限后重试'); resolve(); },
        }));
      } });
    },
    async contact() {
      if (await this.controller.write('contact')) {
        if (this.data.contactSheetVisible) this.closePublicContact();
        this.continueChat();
      }
    },
    preference(event) { return this.controller.write(event.currentTarget.dataset.sentiment); },
    retryWrite() {
      if (this.data.pendingAction === 'contact') return this.contact();
      return this.data.pendingAction && this.controller.write(this.data.pendingAction);
    },
    previewPlans() {
      const drawing = this.data.work?.planDrawings?.find(item => this.data.images['i' + item.assetId]);
      if (drawing) return this.preview({ currentTarget: { dataset: { id: drawing.assetId, kind: 'plan' } } });
      this.controller.set({ imageError: '图纸暂未加载，点此重试。' });
    },
    async preview(event) {
      if (this.data.unavailable || !this.data.work) return;
      // Recheck rights/version immediately before exposing the full-size viewer.
      try {
        await this.controller.client.read(`/conversations/${this.data.conversationId}/portfolio/works/${this.data.work.id}`, { versionId: this.data.work.versionId });
        if (!this._alive || !this._shown || this.controller.session !== identity()) return;
        const current = this.data.images['i' + event.currentTarget.dataset.id];
        const shown = event.currentTarget.dataset.kind === 'plan' ? this.data.work.planDrawings : [...this.data.work.renders, ...this.data.work.photos];
        if (current && shown.some(item => item.assetId === String(event.currentTarget.dataset.id))) wx.previewImage({ current, urls: shown.map(i => this.data.images['i' + i.assetId]).filter(Boolean) });
      } catch (error) { this.controller.fail(error, this.controller.epoch); }
    },
    pickTopic(event) {
      const text = event.currentTarget.dataset.text;
      this._prompt = text;
      const pages = getCurrentPages();
      const chat = pages.map(p => originalChat(p, this.data.conversationId)).find(Boolean);
      if (chat?.controller && !chat.data.draft && !chat.data.pendingSend) chat.controller.input(text);
      this.continueChat();
    },
    onShareAppMessage() { return { title: this.data.shareTitle || '设计师的设计室 · 家客来', path: this.data.sharePath || '/pages/index/index',
      imageUrl: '/packages/assistant/assets/designer-studio-book.png' }; },
  };
}
module.exports = { page };
