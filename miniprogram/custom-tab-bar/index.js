const api = require('../utils/api.js');
const { openSurveyingEditor } = require('../utils/surveyNavigation.js');
const { canAccessAIDesign } = require('../utils/aiDesignAccess.js');
const { ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG } = require('../utils/debugConfig.js');

Component({
  data: {
    selected: 0,
    suppressed: false,
    compactMeasureTab: true,
    list: [
      {
        key: 'home',
        pagePath: '/pages/index/index',
        text: '首页',
        iconPath: '/images/mine-icons/tab-home.png',
        selectedIconPath: '/images/mine-icons/tab-home-active.png'
      },
      {
        key: 'leads',
        pagePath: '/pages/leads-management/leads-management',
        text: '线索',
        iconPath: '/images/mine-icons/tab-leads.png',
        selectedIconPath: '/images/mine-icons/tab-leads-active.png'
      },
      {
        key: 'measure',
        pagePath: '/packages/surveying/editor/surveying-editor',
        text: '量房',
        center: true
      },
      {
        key: 'ai-design',
        pagePath: '/pages/ai-design/ai-design',
        text: '设计',
        requiresEnterprise: true,
        visible: false,
        iconPath: '/images/mine-icons/tab-ai.png',
        selectedIconPath: '/images/mine-icons/tab-ai-active.png'
      },
      {
        key: 'mine',
        pagePath: '/pages/mine/mine',
        text: '我的',
        iconPath: '/images/mine-icons/tab-mine.png',
        selectedIconPath: '/images/mine-icons/tab-mine-active.png'
      }
    ]
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
      wx.switchTab({
        url: item.pagePath,
        fail: () => this.syncSelected(),
      });
    },

    async openMostRecentlyEditedSurvey() {
      if (this.isOpeningSurvey) return;
      this.isOpeningSurvey = true;
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
        if (ENABLE_OFFLINE_SURVEY_ENTRY_DEBUG) {
          openSurveyingEditor({ startNewSurvey: true });
          return;
        }

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
      const canUseAIDesign = canAccessAIDesign();
      const list = this.data.list.map((item) => ({
        ...item,
        visible: !item.requiresEnterprise || canUseAIDesign,
      }));
      const pages = getCurrentPages();
      const current = pages && pages.length ? `/${pages[pages.length - 1].route}` : '';
      const index = list.findIndex((item) => item.pagePath === current && !item.center);
      this.setData({
        list,
        compactMeasureTab: !canUseAIDesign,
        selected: index >= 0 && list[index].visible ? index : this.data.selected,
      });
    }
  }
});
