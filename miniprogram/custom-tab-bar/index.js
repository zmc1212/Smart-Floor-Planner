const api = require('../utils/api.js');
const { openSurveyingEditor } = require('../utils/surveyNavigation.js');
const { ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG } = require('../utils/debugConfig.js');
const { roleForIdentity } = require('../utils/identity-navigation.js');

const LEGACY_ITEMS = [
  { key: 'home', pagePath: '/pages/index/index', text: '首页', iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
  { key: 'leads', pagePath: '/pages/leads-management/leads-management', text: '线索', iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
  { key: 'measure', pagePath: '/packages/surveying/editor/surveying-editor', text: '量房', center: true },
  { key: 'ai-design', pagePath: '/pages/ai-design/ai-design', text: '设计', requiresEnterprise: true, visible: false, iconPath: '/images/mine-icons/tab-ai.png', selectedIconPath: '/images/mine-icons/tab-ai-active.png' },
  { key: 'mine', pagePath: '/pages/mine/mine', text: '我的', iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
];

// Only expose destinations with an executable route and a matching server capability.
const ROLE_ITEMS = {
  customer: [
    { key: 'service', capability: 'customer.service', pagePath: '/pages/index/index', text: '服务', tab: true, iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'projects', capability: 'customer.projects', pagePath: '/packages/business/customer-projects/customer-projects', text: '项目', iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  referrer: [
    { key: 'promotion', capability: 'referrer.promotion', pagePath: '/packages/business/referrer-workbench/referrer-workbench', text: '推广', iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  designer: [
    { key: 'workbench', capability: 'staff.leads', pagePath: '/pages/index/index', text: '工作台', tab: true, iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'customers', capability: 'staff.leads', pagePath: '/pages/leads-management/leads-management', text: '客户', tab: true, iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'design', capability: 'staff.design', pagePath: '/pages/ai-design/ai-design', text: '设计', tab: true, iconPath: '/images/mine-icons/tab-ai.png', selectedIconPath: '/images/mine-icons/tab-ai-active.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  measurer: [
    { key: 'schedule', capability: 'staff.schedule', pagePath: '/pages/index/index', text: '日程', tab: true, iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'tasks', capability: 'staff.tasks', pagePath: '/pages/leads-management/leads-management', text: '任务', tab: true, iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'survey', capability: 'staff.surveying', pagePath: '/pages/ai-design/ai-design', text: '量房', tab: true, iconPath: '/images/mine-icons/tab-ai.png', selectedIconPath: '/images/mine-icons/tab-ai-active.png' },
    { key: 'mine', capability: 'account', pagePath: '/pages/mine/mine', text: '我的', tab: true, iconPath: '/images/mine-icons/tab-mine.png', selectedIconPath: '/images/mine-icons/tab-mine-active.png' }
  ],
  enterprise_admin: [
    { key: 'operations', capability: 'enterprise.operations', pagePath: '/pages/index/index', text: '经营', tab: true, iconPath: '/images/mine-icons/tab-home.png', selectedIconPath: '/images/mine-icons/tab-home-active.png' },
    { key: 'customers', capability: 'enterprise.customers', pagePath: '/pages/leads-management/leads-management', text: '客户', tab: true, iconPath: '/images/mine-icons/tab-leads.png', selectedIconPath: '/images/mine-icons/tab-leads-active.png' },
    { key: 'appointments', capability: 'enterprise.appointments', pagePath: '/pages/ai-design/ai-design', text: '预约', tab: true, iconPath: '/images/mine-icons/tab-ai.png', selectedIconPath: '/images/mine-icons/tab-ai-active.png' },
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
  const canUseAIDesign = Boolean(globalData && globalData.userInfo && globalData.userInfo.role === 'staff' && globalData.userInfo.enterpriseId);
  return LEGACY_ITEMS.map((item) => ({ ...item, visible: !item.requiresEnterprise || canUseAIDesign }));
}

Component({
  data: {
    selected: 0,
    suppressed: false,
    compactMeasureTab: true,
    list: LEGACY_ITEMS
  },

  lifetimes: {
    attached() {
      this.syncSelected();
    }
  },

  pageLifetimes: {
    show() {
      this.syncSelected();
    }
  },

  methods: {
    async switchTab(e) {
      const index = e.currentTarget.dataset.index;
      const item = this.data.list[index];
      if (!item) return;

      if (!item.visible) {
        this.syncSelected();
        return;
      }

      if (item.center) {
        await this.openMostRecentlyEditedSurvey();
        return;
      }

      this.setData({ selected: index });
      const navigate = item.tab === false || item.pagePath.startsWith('/packages/') ? 'reLaunch' : 'switchTab';
      wx[navigate]({ url: item.pagePath, fail: () => this.syncSelected() });
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
      const list = visibleItems(globalData);
      const pages = getCurrentPages();
      const current = pages && pages.length ? `/${pages[pages.length - 1].route}` : '';
      const index = list.findIndex((item) => item.pagePath === current && !item.center);
      this.setData({
        list,
        compactMeasureTab: list.some((item) => item.center) && list.filter((item) => item.visible).length === 4,
        selected: index >= 0 && list[index].visible ? index : this.data.selected,
      });
    }
  }
});

module.exports = { ROLE_ITEMS, visibleItems };
