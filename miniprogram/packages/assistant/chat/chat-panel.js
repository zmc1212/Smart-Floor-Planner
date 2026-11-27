const createChat = require('./chat-definition');
const nativePreview = require('../../../utils/native-preview');
const definition = createChat();
const lifecycle = new Set(['data', 'onLoad', 'onShow', 'onHide', 'onUnload', 'onResize', 'onShareAppMessage']);
const methods = Object.fromEntries(Object.entries(definition).filter(([key]) => !lifecycle.has(key)));

// Official asynchronous subpackage component: retain one controller while the
// customer changes logical Tabs on the main-package host page.
Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    active: { type: Boolean, value: false, observer() { this.syncVisibility(); this.notifyEntryReady(); } },
    staffTab: { type: Boolean, value: false },
    promotionCode: { type: String, value: '' },
  },
  data: { ...definition.data, embedded: true, chatEntryVisible: true },
  observers: { loading() { this.notifyEntryReady(); } },
  lifetimes: {
    attached() {
      this._hostVisible = true;
      definition.onLoad.call(this, this.data.promotionCode ? { promotionCode: this.data.promotionCode } : {});
      this._attached = true;
      this.syncVisibility();
    },
    ready() { this._layoutReady = true; this.notifyEntryReady(); },
    detached() { this._attached = false; definition.onUnload.call(this); },
  },
  pageLifetimes: {
    show() {
      this._hostVisible = true;
      if (nativePreview.shownAfterPreview(nativePreview.currentPage())) return;
      this.syncVisibility();
    },
    hide() {
      if (nativePreview.hiddenByPreview(nativePreview.currentPage())) return;
      this._hostVisible = false; this.syncVisibility();
    },
    resize() { definition.onResize.call(this); },
  },
  methods: {
    ...methods,
    notifyEntryReady() {
      if (!this._layoutReady || this._entryReady || (this.data.active && this.data.loading)) return;
      this._entryReady = true;
      wx.nextTick(() => { if (this._attached) this.triggerEvent('entryready'); });
    },
    syncVisibility() {
      if (!this._attached) return;
      const visible = this.data.active && this._hostVisible;
      if (visible === this._panelVisible) return;
      this._panelVisible = visible;
      if (visible) definition.onShow.call(this);
      else definition.onHide.call(this);
    },
  },
});
