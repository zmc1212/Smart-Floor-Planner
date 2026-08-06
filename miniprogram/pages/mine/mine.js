const app = getApp();
const api = require('../../utils/api.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
const { openAIDesignTab } = require('../../utils/aiDesignNavigation.js');
const { canAccessAIDesign } = require('../../utils/aiDesignAccess.js');
const {
  buildWorkbenchActions,
  buildDashboardSlices,
  getFloorPlanRoomCount
} = require('./mine-model.js');

const DEFAULT_AVATAR = '/images/mine-v6/profile-avatar.jpg';

const FALLBACK_PROFILE = {
  name: '员工账号',
  avatar: '',
  enterpriseName: '智能量房助手',
  phoneMasked: '',
  roleLabel: '员工账号',
  role: ''
};

const ACTION_TARGETS = {
  createPromotion: () => wx.navigateTo({ url: '/packages/business/promotion-record-detail/promotion-record-detail?mode=create' }),
  commissions: () => wx.navigateTo({ url: '/packages/business/commission-records/commission-records' }),
  leads: () => wx.switchTab({ url: '/pages/leads-management/leads-management' }),
  inspiration: () => wx.navigateTo({ url: '/packages/business/inspiration/inspiration' }),
  measure: () => wx.switchTab({ url: '/pages/index/index' }),
  aiDesign: () => openAIDesignTab()
};

function formatFloorPlanDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date
    .toLocaleDateString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
    .replace(/\//g, '-');
}

Page({
  data: {
    isLoggedIn: false,
    isStaff: false,
    canUseAIDesign: false,
    loadingMine: false,
    mineError: '',
    floorPlansLoading: false,
    floorPlansError: '',
    mineData: {
      profile: FALLBACK_PROFILE,
      actions: [],
      workbenchCards: [],
      todos: []
    },
    workbenchActions: [],
    floorPlans: [],
    primaryTodo: null,
    remainingTodos: [],
    summaryCards: [],
    displayTodos: [],
    overviewCards: [],
    navigationTop: 47,
    navigationHeight: 32,
    navigationRight: 14,
    defaultAvatarUrl: DEFAULT_AVATAR
  },

  onLoad() {
    this.syncNavigationMetrics();
  },

  onShow() {
    this.syncNavigationMetrics();
    this.syncTabBar();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const token = wx.getStorageSync('token');
    const openid = app.globalData.openid || wx.getStorageSync('openid') || (userInfo && userInfo.openid);

    if (token && userInfo) {
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      this.setData({
        isLoggedIn: true,
        isStaff: userInfo.role === 'staff',
        canUseAIDesign: canAccessAIDesign(userInfo),
        loadingMine: false,
        floorPlans: [],
        mineError: '',
        floorPlansLoading: false,
        floorPlansError: ''
      });
      this.fetchMineData();
      return;
    }

    if (openid && userInfo) {
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      this.setData({
        isLoggedIn: true,
        isStaff: userInfo.role === 'staff',
        canUseAIDesign: canAccessAIDesign(userInfo),
        loadingMine: false,
        mineError: '',
        floorPlansLoading: false,
        floorPlansError: '',
        mineData: {
          ...this.data.mineData,
          profile: {
            ...FALLBACK_PROFILE,
            name: userInfo.nickname || userInfo.name || '微信用户',
            avatar: userInfo.avatar || userInfo.avatarUrl || '',
            phoneMasked: userInfo.phoneMasked || ''
          }
        }
      });
      if (userInfo.role === 'staff') {
        this.fetchMineData();
      } else {
        this.fetchMyFloorPlans();
      }
      return;
    }

    this.setData({
      isLoggedIn: false,
      isStaff: false,
      canUseAIDesign: false,
      loadingMine: false,
      mineError: '',
      floorPlansLoading: false,
      floorPlansError: '',
      floorPlans: [],
      mineData: {
        profile: FALLBACK_PROFILE,
        actions: [],
        workbenchCards: [],
        todos: []
      },
      workbenchActions: [],
      primaryTodo: null,
      remainingTodos: [],
      summaryCards: [],
      displayTodos: [],
      overviewCards: []
    });
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.syncSelected();
    }
  },

  syncNavigationMetrics() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let menuRect = null;
    try {
      menuRect = wx.getMenuButtonBoundingClientRect();
    } catch (error) {
      console.warn('Failed to read menu button metrics', error);
    }

    const statusBarHeight = windowInfo.statusBarHeight || 0;
    const menuTop = menuRect && menuRect.top ? menuRect.top : statusBarHeight + 4;
    const menuHeight = menuRect && menuRect.height ? menuRect.height : 32;
    const menuLeft = menuRect && menuRect.left ? menuRect.left : windowInfo.windowWidth;

    this.setData({
      navigationTop: Math.max(statusBarHeight, menuTop),
      navigationHeight: menuHeight,
      navigationRight: Math.max(14, windowInfo.windowWidth - menuLeft + 8)
    });
  },

  goToLogin() {
    wx.navigateTo({ url: '/packages/business/login/login' });
  },

  async fetchMineData() {
    this.setData({ loadingMine: true, mineError: '' });
    try {
      const res = await api.request('/miniprogram/mine', 'GET');
      const data = res.data || {};
      const profile = data.profile || FALLBACK_PROFILE;
      const workbenchCards = data.workbenchCards || [];
      const todos = data.todos || [];
      const canUseAIDesign = canAccessAIDesign({
        role: data.isStaff ? 'staff' : 'user',
        enterpriseId: profile.enterpriseId,
      });
      const workbenchActions = buildWorkbenchActions(data.actions, canUseAIDesign);

      this.setData({
        loadingMine: false,
        isStaff: !!data.isStaff,
        canUseAIDesign,
        mineData: {
          profile: { ...FALLBACK_PROFILE, ...profile },
          actions: data.actions || [],
          workbenchCards,
          todos
        },
        workbenchActions,
        ...buildDashboardSlices(workbenchCards, todos)
      });

      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        role: data.isStaff ? 'staff' : 'user',
        staffRole: profile.role,
        staffId: profile.staffId,
        enterpriseId: profile.enterpriseId,
        enterpriseName: profile.enterpriseName,
        nickname: profile.name,
        avatar: profile.avatar
      };
      wx.setStorageSync('userInfo', app.globalData.userInfo);
      this.syncTabBar();

      if (!data.isStaff) {
        this.fetchMyFloorPlans();
      }
    } catch (err) {
      this.setData({
        loadingMine: false,
        mineError: (err && err.error) || '工作台加载失败，请检查网络后重试'
      });
      if (err && err.statusCode === 401) {
        this.clearSession();
        return;
      }
    }
  },

  async fetchMyFloorPlans() {
    this.setData({ floorPlansLoading: true, floorPlansError: '' });
    try {
      const res = await api.request('/floorplans', 'GET');
      if (res.success && res.data) {
        const floorPlans = res.data.map((item) => ({
          ...item,
          roomCount: getFloorPlanRoomCount(item.layoutData),
          createdAt: formatFloorPlanDate(item.createdAt)
        }));
        this.setData({ floorPlans, floorPlansLoading: false });
        return;
      }
      this.setData({
        floorPlansLoading: false,
        floorPlansError: (res && res.error) || '户型加载失败，请稍后重试'
      });
    } catch (err) {
      console.error('Failed to fetch floor plans', err);
      this.setData({
        floorPlansLoading: false,
        floorPlansError: (err && err.error) || '户型加载失败，请检查网络后重试'
      });
    }
  },

  retryMine() {
    this.fetchMineData();
  },

  retryFloorPlans() {
    this.fetchMyFloorPlans();
  },

  onTapAction(e) {
    const target = e.currentTarget.dataset.target;
    this.navigateByTarget(target);
  },

  onTapCard(e) {
    const target = e.currentTarget.dataset.target;
    this.navigateByTarget(target);
  },

  navigateByTarget(target) {
    if (!target) return;

    if (target.indexOf('promotion:') === 0) {
      const payload = target.slice('promotion:'.length);
      const parts = payload.split('?');
      const view = parts[0] || 'my';
      const extraQuery = parts[1] ? `&${parts[1]}` : '';
      wx.navigateTo({ url: `/packages/business/promotion-records/promotion-records?view=${view}${extraQuery}` });
      return;
    }

    const handler = ACTION_TARGETS[target];
    if (handler) {
      handler();
      return;
    }

    wx.showToast({ title: '功能建设中', icon: 'none' });
  },

  onOpenAllTodos() {
    const role = this.data.mineData.profile.role;
    const viewMap = {
      salesperson: 'my',
      enterprise_admin: 'admin',
      admin: 'admin',
      super_admin: 'admin',
      designer: 'design',
      measurer: 'measure'
    };
    wx.navigateTo({ url: `/packages/business/promotion-records/promotion-records?view=${viewMap[role] || 'my'}` });
  },

  onOpenTodoDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/packages/business/promotion-record-detail/promotion-record-detail?id=${id}` });
  },

  onOpenFloorPlan(e) {
    const id = e.currentTarget.dataset.id;
    const floorPlan = this.data.floorPlans.find((item) => item._id === id);
    if (!floorPlan) return;
    openSurveyingEditor({ floorPlanId: floorPlan._id });
  },

  onAIGen(e) {
    const id = e.currentTarget.dataset.id;
    const floorPlan = this.data.floorPlans.find((item) => item._id === id);
    if (!floorPlan) {
      wx.showToast({ title: '无法获取户型数据', icon: 'none' });
      return;
    }
    openAIDesignTab({ floorPlanId: floorPlan._id });
  },

  onOpenAIHome() {
    openAIDesignTab();
  },

  onCreateNew() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  async onEnableNotification() {
    const { requestNotification } = require('../../utils/notification.js');
    try {
      await requestNotification();
    } catch (e) {
      console.error('Notification enable failed', e);
    }
  },

  onOpenAccountSecurity() {
    const profile = this.data.mineData.profile || FALLBACK_PROFILE;
    wx.showActionSheet({
      itemList: [
        `账号：${profile.name || '未设置'}`,
        `角色：${profile.roleLabel || '普通用户'}`,
        `手机：${profile.phoneMasked || '未绑定'}`,
        '退出登录'
      ],
      success: (res) => {
        if (res.tapIndex === 3) this.onLogout();
      }
    });
  },

  clearSession() {
    app.globalData.openid = null;
    app.globalData.userInfo = null;
    app.globalData.token = null;
    wx.removeStorageSync('openid');
    wx.removeStorageSync('userInfo');
    wx.removeStorageSync('token');
    this.setData({
      isLoggedIn: false,
      isStaff: false,
      loadingMine: false,
      mineError: '',
      floorPlansLoading: false,
      floorPlansError: '',
      floorPlans: [],
      mineData: {
        profile: FALLBACK_PROFILE,
        actions: [],
        workbenchCards: [],
        todos: []
      },
      workbenchActions: [],
      primaryTodo: null,
      remainingTodos: [],
      summaryCards: [],
      displayTodos: [],
      overviewCards: []
    });
    this.syncTabBar();
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      confirmText: '退出',
      success: (res) => {
        if (res.confirm) {
          this.clearSession();
          wx.showToast({ title: '已退出', icon: 'success' });
        }
      }
    });
  }
});
