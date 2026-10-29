const createChat = require('./chat-definition');
const definition = createChat();
const lifecycle = new Set(['data', 'onLoad', 'onShow', 'onHide', 'onUnload', 'onResize', 'onShareAppMessage']);
const methods = Object.fromEntries(Object.entries(definition).filter(([key]) => !lifecycle.has(key)));

// Official asynchronous subpackage component: retain one controller while the
// customer changes logical Tabs on the main-package host page.
Component({
  options: { styleIsolation: 'isolated' },
  properties: {
    active: { type: Boolean, value: false, observer() { this.syncVisibility(); } },
  },
  data: { ...definition.data, embedded: true },
  lifetimes: {
    attached() {
      this._hostVisible = true;
      definition.onLoad.call(this, {});
      this._attached = true;
      this.syncVisibility();
    },
    detached() { definition.onUnload.call(this); },
  },
  pageLifetimes: {
    show() { this._hostVisible = true; this.syncVisibility(); },
    hide() { this._hostVisible = false; this.syncVisibility(); },
    resize() { definition.onResize.call(this); },
  },
  methods: {
    ...methods,
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
