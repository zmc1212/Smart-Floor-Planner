const ownerReminders = require('../../../utils/owner-reminders');
const { aiEntriesEnabled, customerHomeTab } = require('../../../utils/ai-entries');

// 我的装修 and 我的 share the floating navigation; 小K keeps the docked bar.
function floatsFor(key) {
  return key === 'service' || key === 'mine';
}

// The customer-only navigation and its artwork stay in the asynchronously
// loaded assistant package. The main-package professional navigation is shared.
Component({
  properties: { items: Array, selected: Number, floating: Boolean, keyboardHidden: Boolean },
  data: { reminderBadge: '' },
  lifetimes: { attached() { this._alive = true; this.syncSelected(); }, detached() { this._alive = false; clearTimeout(this._navigationTimer); clearTimeout(this._syncTimer); } },
  pageLifetimes: { async show() {
    this.syncSelected();
    await getApp().globalData.sessionHydrationPromise;
    if (this._alive) void ownerReminders.refreshSummary();
  } },
  methods: {
    syncReminderBadge() {
      const count = ownerReminders.summary()?.unreadCount || 0;
      this.setData({ reminderBadge: count > 99 ? '99+' : count ? String(count) : '' });
    },
    syncSelected() {
      this.syncReminderBadge();
      const page = getCurrentPages().slice(-1)[0];
      const bar = page && typeof page.getTabBar === 'function' && page.getTabBar();
      if (!bar?.data.list.length) {
        if (this._alive) this._syncTimer = setTimeout(() => this.syncSelected(), 80);
        return;
      }
      const items = bar.data.list;
      const view = page.data?.customerTab || customerHomeTab(getApp().globalData);
      const selected = items.findIndex(item => item.pagePath === '/' + page.route && (!item.customerView || item.customerView === view));
      this.setData({ items, selected: Math.max(0, selected), floating: floatsFor(items[Math.max(0, selected)]?.key), keyboardHidden: false });
    },
    switchTab(event) {
      const index = Number(event.currentTarget.dataset.index), item = this.data.items[index];
      if (!item || this._switching) return;
      if (item.key === 'xiaok' && !aiEntriesEnabled()) { this.syncSelected(); return; }
      const app = getApp(), page = getCurrentPages().slice(-1)[0];
      const floating = floatsFor(item.key), animate = floating !== this.data.floating;
      const previousView = app.globalData.customerTab;
      if (item.customerView) app.globalData.customerTab = item.customerView;
      this.setData({ selected: index, floating });
      const navigate = () => {
        this._switching = false;
        if (item.key === 'xiaok' && !aiEntriesEnabled()) { this.syncSelected(); return; }
        if (page && '/' + page.route === item.pagePath && item.customerView) { page.syncHomeView(); return; }
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
