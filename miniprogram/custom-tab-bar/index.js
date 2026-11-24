const api = require('../utils/api.js');
const { openSurveyingEditor } = require('../utils/surveyNavigation.js');
const { ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG } = require('../utils/debugConfig.js');
const { roleForIdentity } = require('../utils/identity-navigation.js');

const STAFF_TABS = [
  { key: 'xiaok', capability: 'construction.projects', pagePath: '/pages/index/index', staffView: 'xiaok', text: '小K', icon: 'chat', tab: true },
  { key: 'workbench', capability: 'construction.projects', pagePath: '/pages/index/index', staffView: 'workbench', text: '工作台', icon: 'home', dockedIconPath: './assets/notebook-dock-home.png', tab: true },
  { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', icon: 'mine', dockedIconPath: './assets/notebook-dock-mine.png', tab: true },
].map(item => ({
  ...item,
  iconPath: './assets/notebook-' + item.icon + '.png',
  selectedIconPath: './assets/notebook-' + item.icon + '-active.png'
}));

const STAFF_ROLE_ITEMS = {
  designer: STAFF_TABS,
  construction_staff: STAFF_TABS
    .filter(item => item.key !== 'xiaok')
    .map(item => item.key === 'workbench' ? { ...item, key: 'site', text: '工地' } : item),
  enterprise_admin: STAFF_TABS
};

// Only expose destinations with an executable route and a matching server capability.
const ROLE_ITEMS = {
  customer: [
    { key: 'xiaok', capability: 'customer.service', pagePath: '/pages/index/index', customerView: 'xiaok', text: '小K', tab: true },
    { key: 'service', capability: 'customer.service', pagePath: '/pages/index/index', customerView: 'service', text: '工地', tab: true },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true }
  ],
  referrer: [
    { key: 'promotion', capability: 'referrer.promotion', pagePath: '/packages/business/referrer-workbench/referrer-workbench', text: '推广', iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'progress', capability: 'referrer.progress', pagePath: '/packages/business/referrer-progress/referrer-progress', text: '客户', iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'earnings', capability: 'referrer.earnings', pagePath: '/packages/business/referrer-earnings/referrer-earnings', text: '收益', iconPath: '/images/mine-icons/earn-g.png', selectedIconPath: '/images/mine-icons/earn-a.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  ...STAFF_ROLE_ITEMS,
  measurer: [
    { key: 'workbench', capability: 'staff.schedule', pagePath: '/pages/index/index', text: '工作台', tab: true, iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'data', capability: 'staff.data', pagePath: '/pages/enterprise-operations/enterprise-operations', text: '数据', tab: true, iconPath: '/images/operations-dashboard/chart.png', selectedIconPath: '/images/operations-dashboard/chart.png' },
    { key: 'customers', capability: 'staff.tasks', pagePath: '/pages/leads-management/leads-management', text: '客户', tab: true, iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'earnings', capability: 'staff.earnings', pagePath: '/packages/enterprise/staff-earnings/staff-earnings', text: '收益', iconPath: '/images/mine-icons/earn-g.png', selectedIconPath: '/images/mine-icons/earn-a.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  platform_admin: [
    { key: 'devices', capability: 'platform.devices', pagePath: '/packages/platform/devices/devices', text: '设备', iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'review', capability: 'platform.review', pagePath: '/packages/platform/enterprise-review/enterprise-review', text: '审核', iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  salesperson: [
    { key: 'promotion', capability: 'promotion.records', pagePath: '/packages/business/promotion-records/promotion-records', text: '报备', iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ]
};

function currentRole(globalData) {
  const bootstrap = globalData && globalData.bootstrap;
  if (bootstrap && bootstrap.current && ROLE_ITEMS[bootstrap.current.role]) return bootstrap.current.role;
  // Bootstrap hydrates asynchronously on cold launch. Reuse the signed
  // stored context so the first tab render matches the active identity.
  const storedRole = roleForIdentity(globalData && globalData.userInfo);
  return storedRole && ROLE_ITEMS[storedRole] ? storedRole : null;
}

function visibleItems(globalData) {
  const role = currentRole(globalData);
  if (role) {
    const capabilities = (globalData.bootstrap && globalData.bootstrap.current
      && globalData.bootstrap.current.capabilities) || [];
    return ROLE_ITEMS[role]
      .filter((item) => !capabilities.length || capabilities.includes(item.capability))
      .map((item) => ({ ...item, visible: true }));
  }
  // Guests use customer navigation; professional tabs stay role scoped.
  return ROLE_ITEMS.customer.map((item) => ({ ...item, visible: true }));
}

function applyServerBadges(list, badges) {
  const unavailable = Boolean(badges && badges.status === 'unavailable');
  const counts = (!unavailable && badges && badges.status === 'ok' && badges.counts) || {};
  return {
    list: list.map((item) => {
      const count = item.customerView === 'service' || item.staffView ? 0 : Number(counts[item.key] || 0);
      return {
        ...item,
        badgeText: count > 0 ? (count > 99 ? '99+' : String(count)) : ''
      };
    }),
    badgeUnavailable: unavailable,
    badgeUnavailableText: unavailable ? (badges.message || '暂时无法读取') : ''
  };
}

Component({
  data: {
    selected: 0,
    suppressed: false,
    customerNavigation: false, staffNavigation: false, keyboardHidden: false,
    staffFloating: false, twoTabs: false,
    compactMeasureTab: true,
    badgeUnavailable: false,
    badgeUnavailableText: '',
    list: []
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    },
    detached() {
      this.cancelTabTransition();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    },
    hide() {
      this.cancelTabTransition();
    }
  },

  methods: {
    cancelTabTransition() {
      if (this._tabTransition) clearTimeout(this._tabTransition.timer);
      this._tabTransition = null;
    },
    async switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item || this._tabTransition) return;

      if (!item.visible) {
        this.syncSelected();
        return;
      }

      if (item.center) {
        await this.openMostRecentlyEditedSurvey();
        return;
      }

      const globalData = getApp().globalData;
      const role = currentRole(globalData);
      const staffFloating = this.data.staffNavigation && item.key !== 'xiaok';
      const animate = this.data.staffNavigation && staffFloating !== this.data.staffFloating
        && !globalData.reduceMotion;

      this.setData({ selected: index, staffFloating });
      const navigate = () => {
        this._tabTransition = null;
        const current = getApp().globalData;
        if (animate && (currentRole(current) !== role || !visibleItems(current).some(tab => tab.key === item.key))) {
          this.syncSelected();
          return;
        }
        if (item.staffView) {
          const previous = current.siteWorkbenchTab;
          current.siteWorkbenchTab = item.staffView;
          const pages = getCurrentPages(), page = pages[pages.length - 1];
          if (page && '/' + page.route === item.pagePath) {
            page.setData({ siteWorkbenchTab: item.staffView }, () => this.syncSelected());
            return;
          }
          wx.switchTab({ url: item.pagePath, fail: () => { current.siteWorkbenchTab = previous; this.syncSelected(); } });
          return;
        }
        const method = item.tab === false || item.pagePath.startsWith('/packages/') ? 'reLaunch' : 'switchTab';
        wx[method]({ url: item.pagePath, fail: () => this.syncSelected() });
      };

      if (animate) this._tabTransition = { role, key: item.key, timer: setTimeout(navigate, 320) };
      else navigate();
    },

    async openMostRecentlyEditedSurvey() {
      if (this.isOpeningSurvey) return;
      this.isOpeningSurvey = true;

      if (ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG) {
        openSurveyingEditor({ startNewSurvey: true });
        this.isOpeningSurvey = false;
        return;
      }

      wx.showLoading({ title: '加载量房记录' });

      try {
        const res = await api.request('/floorplans?page=1&limit=1', 'GET');
        const latestPlan = Array.isArray(res && res.data) ? res.data[0] : null;

        if (latestPlan && latestPlan._id) {
          openSurveyingEditor({ floorPlanId: latestPlan._id });
          return;
        }

        openSurveyingEditor({ startNewSurvey: true });
      } catch (err) {
        wx.showToast({
          title: (err && err.error) || '加载最近量房失败',
          icon: 'none'
        });
      } finally {
        wx.hideLoading();
        this.isOpeningSurvey = false;
      }
    },

    syncSelected() {
      const globalData = (getApp() && getApp().globalData) || {};
      const decorated = applyServerBadges(
        visibleItems(globalData),
        globalData.bootstrap && globalData.bootstrap.badges
      );
      const list = decorated.list;
      const pages = getCurrentPages();
      const current = pages && pages.length ? `/${pages[pages.length - 1].route}` : '';
      const role = currentRole(globalData);
      const customerNavigation = ['customer', null].includes(role);
      const staffNavigation = Object.prototype.hasOwnProperty.call(STAFF_ROLE_ITEMS, role);
      const hasWorkbenchTab = list.some(item => item.staffView);
      const customerView = globalData.customerTab || 'xiaok';
      const staffView = globalData.siteWorkbenchTab || 'workbench';
      // Session and badge refreshes can run before the pending route change.
      const pending = this._tabTransition;
      const pendingIndex = pending?.role === role ? list.findIndex(item => item.key === pending.key) : -1;
      const index = pendingIndex >= 0 ? pendingIndex : list.findIndex((item) => item.pagePath === current && !item.center
        && (!item.customerView || item.customerView === customerView) && (!item.staffView || item.staffView === staffView));
      this.setData({
        list,
        customerNavigation,
        staffNavigation,
        staffFloating: staffNavigation && list[index]?.key !== 'xiaok',
        twoTabs: staffNavigation && list.filter(item => item.visible).length === 2,
        suppressed: list.length === 0 || customerNavigation || Boolean(globalData.siteWorkbenchSheetOpen),
        compactMeasureTab: list.some((item) => item.center) && list.filter((item) => item.visible).length === 4,
        selected: index >= 0 && list[index].visible ? index : hasWorkbenchTab ? -1 : this.data.selected,
        keyboardHidden: hasWorkbenchTab && current === '/pages/index/index' && staffView === 'xiaok' && this.data.keyboardHidden,
        badgeUnavailable: decorated.badgeUnavailable && !hasWorkbenchTab,
        badgeUnavailableText: decorated.badgeUnavailableText
      });
    }
  }
});

module.exports = { ROLE_ITEMS, visibleItems };
