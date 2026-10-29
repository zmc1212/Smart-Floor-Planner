// The customer-only navigation and its artwork stay in the asynchronously
// loaded assistant package. The main-package professional navigation is shared.
Component({
  properties: { items: Array, selected: Number, floating: Boolean, keyboardHidden: Boolean },
  lifetimes: { attached() { this._alive = true; this.syncSelected(); }, detached() { this._alive = false; clearTimeout(this._navigationTimer); clearTimeout(this._syncTimer); } },
  pageLifetimes: { show() { this.syncSelected(); } },
  methods: {
    syncSelected() {
      const page = getCurrentPages().slice(-1)[0];
      const bar = page && typeof page.getTabBar === 'function' && page.getTabBar();
      if (!bar?.data.list.length) {
        if (this._alive) this._syncTimer = setTimeout(() => this.syncSelected(), 80);
        return;
      }
      const items = bar.data.list;
      const view = getApp().globalData.customerTab || 'xiaok';
      const selected = items.findIndex(item => item.pagePath === '/' + page.route && (!item.customerView || item.customerView === view));
      this.setData({ items, selected: Math.max(0, selected), floating: items[Math.max(0, selected)]?.key !== 'xiaok', keyboardHidden: false });
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index), item = this.data.items[index];
      if (!item || this._switching) return;
      const app = getApp(), page = getCurrentPages().slice(-1)[0];
      const floating = item.key !== 'xiaok', animate = floating !== this.data.floating;
      const previousView = app.globalData.customerTab;
      if (item.customerView) app.globalData.customerTab = item.customerView;
      this.setData({ selected: index, floating });
      const navigate = () => {
        this._switching = false;
        if (page && '/' + page.route === item.pagePath && item.customerView) { page.setData({ customerTab: item.customerView }, () => page.syncTabBar()); return; }
        wx.switchTab({ url: item.pagePath, fail: () => {
          app.globalData.customerTab = previousView;
          const bar = page && typeof page.getTabBar === 'function' && page.getTabBar();
          if (bar) bar.syncSelected();
        } });
      };
      if (animate && !app.globalData.reduceMotion) { this._switching = true; this._navigationTimer = setTimeout(navigate, 320); }
      else navigate();
    },
  },
});
