const app = getApp();
const api = require('../../utils/api.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
const { openAIDesignTab } = require('../../utils/aiDesignNavigation.js');
const { canAccessAIDesign } = require('../../utils/aiDesignAccess.js');
const { roleForIdentity } = require('../../utils/identity-navigation.js');
const { mineRoleGuideEntry, openMineRoleGuide } = require('../../utils/roleGuide.js');
const session = require('../../utils/session.js');
const {
  profileForIdentity,
  buildWorkbenchActions,
  buildDashboardSlices,
  getFloorPlanRoomCount
} = require('./mine-model.js');
const {
  refreshAccountSettingsState
} = require('../../utils/account-settings-state.js');

const DEFAULT_AVATAR = '/images/mine-v6/profile-avatar.jpg';
const ROLE_SHELL_MINE_ROLES = ['designer', 'measurer', 'enterprise_admin', 'platform_admin'];

function isRoleShellMineRole(role) {
  return ROLE_SHELL_MINE_ROLES.includes(role);
}

const FALLBACK_PROFILE = {
  name: '员工账号',
  avatar: '',
  enterpriseName: '家客来',
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
    activeRole: '',
    showRoleGuideEntry: false,
    roleGuideHelper: '查看当前身份的工作方法',
    isRoleRestrictedUser: false,
    isRoleShellMine: false,
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
    unreadNotificationCount: 0,
    navigationTop: 47,
    navigationHeight: 32,
    navigationRight: 14,
    defaultAvatarUrl: DEFAULT_AVATAR,
    identityLabel: '读取中',
    identityCount: 0
  },

  onLoad() {
    this.syncNavigationMetrics();
  },

  onShow() {
    this.syncNavigationMetrics();
    this.syncTabBar();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const activeRole = (app.globalData.bootstrap && app.globalData.bootstrap.current && app.globalData.bootstrap.current.role)
      || roleForIdentity(userInfo);
    const isStaffRole = ['designer', 'measurer', 'enterprise_admin', 'salesperson'].includes(activeRole);
    const isRoleRestrictedUser = ['customer', 'referrer'].includes(activeRole);
    const token = wx.getStorageSync('token');
    const openid = app.globalData.openid || wx.getStorageSync('openid') || (userInfo && userInfo.openid);

    if (token && userInfo) {
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      const isRoleShellMine = isRoleShellMineRole(activeRole);
      this.setData({
        isLoggedIn: true,
        isStaff: isStaffRole,
        activeRole,
        ...mineRoleGuideEntry(activeRole, app.globalData.bootstrap, this._identityContexts),
        isRoleRestrictedUser,
        isRoleShellMine,
        canUseAIDesign: canAccessAIDesign(userInfo),
        loadingMine: false,
        mineData: {
          ...this.data.mineData,
          profile: profileForIdentity(userInfo, activeRole)
        },
        floorPlans: [],
        mineError: '',
        floorPlansLoading: false,
        floorPlansError: ''
      });
      if (isStaffRole) this.fetchMineData();
      else if (isRoleRestrictedUser) this.fetchProfileData();
      this.refreshRoleGuideEntry();
      return;
    }

    if (openid && userInfo) {
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      const isRoleShellMine = isRoleShellMineRole(activeRole);
      this.setData({
        isLoggedIn: true,
        isStaff: isStaffRole,
        activeRole,
        ...mineRoleGuideEntry(activeRole, app.globalData.bootstrap, this._identityContexts),
        isRoleRestrictedUser,
        isRoleShellMine,
        canUseAIDesign: canAccessAIDesign(userInfo),
        loadingMine: false,
        mineError: '',
        floorPlansLoading: false,
        floorPlansError: '',
        mineData: {
          ...this.data.mineData,
          profile: profileForIdentity(userInfo, activeRole)
        }
      });
      if (isStaffRole) {
        this.fetchMineData();
      } else if (!isRoleRestrictedUser) {
        this.fetchMyFloorPlans();
      }
      if (isRoleRestrictedUser) this.fetchProfileData();
      this.refreshRoleGuideEntry();
      return;
    }

    this.setData({
      isLoggedIn: false,
      isStaff: false,
      activeRole: '',
      showRoleGuideEntry: false,
      roleGuideHelper: '查看当前身份的工作方法',
      isRoleRestrictedUser: false,
      isRoleShellMine: false,
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

  async fetchProfileData() {
    try {
      const res = await api.request('/miniprogram/profile', 'GET');
      const profile = res.data || {};
      this.setData({
        mineData: {
          ...this.data.mineData,
          profile: { ...FALLBACK_PROFILE, ...profile }
        }
      });
      app.globalData.userInfo = {
        ...(app.globalData.userInfo || {}),
        role: profile.role || this.data.activeRole,
        mode: profile.role === 'referrer' ? 'referrer' : (app.globalData.userInfo || {}).mode,
        enterpriseName: profile.enterpriseName,
        nickname: profile.name,
        avatar: profile.avatar
      };
      wx.setStorageSync('userInfo', app.globalData.userInfo);
    } catch (err) {
      if (err && err.statusCode === 401) this.clearSession();
    }
  },

  async fetchMineData() {
    this.setData({
      loadingMine: !this.data.isRoleShellMine,
      mineError: ''
    });
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
          todos,
          unreadNotificationCount: Number(data.unreadNotificationCount || 0)
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
      const fallbackError = this.data.isRoleShellMine
        ? '资料暂时无法加载，请检查网络后重试'
        : '工作台加载失败，请检查网络后重试';
      this.setData({
        loadingMine: false,
        mineError: (err && err.error) || fallbackError
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
        const floorPlans = res.data.map((item) => {
          const roomCount = getFloorPlanRoomCount(item.layoutData);
          const createdAt = formatFloorPlanDate(item.createdAt);
          const projectSubtitle = item.display && item.display.projectSubtitle
            ? item.display.projectSubtitle
            : '';
          return {
            ...item,
            projectTitle: item.display && item.display.projectTitle
              ? item.display.projectTitle
              : (item.name || '未命名户型'),
            projectSubtitle,
            projectMeta: [projectSubtitle, createdAt, `${roomCount} 个空间`]
              .filter(Boolean)
              .join(' · '),
            roomCount,
            createdAt
          };
        });
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
    if (this.data.isRoleRestrictedUser) return;
    const id = e.currentTarget.dataset.id;
    const floorPlan = this.data.floorPlans.find((item) => item._id === id);
    if (!floorPlan) return;
    openSurveyingEditor({ floorPlanId: floorPlan._id });
  },

  onAIGen(e) {
    if (this.data.isRoleRestrictedUser) return;
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
    if (this.data.isRoleRestrictedUser) return;
    wx.switchTab({ url: '/pages/index/index' });
  },

  onOpenSystemSettings() {
    if (!wx.openSetting) {
      wx.showToast({ title: '当前微信版本不支持权限设置', icon: 'none' });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wx.openSetting({
        complete: () => resolve()
      });
    });
  },

  onOpenIdentitySwitch() {
    wx.navigateTo({ url: '/packages/business/identity-switch/identity-switch' });
  },

  onEditProfile() {
    wx.navigateTo({ url: '/packages/business/profile-edit/profile-edit' });
  },

  async refreshRoleGuideEntry() {
    const userInfo = app.globalData.userInfo || (typeof wx !== 'undefined' && wx.getStorageSync
      ? wx.getStorageSync('userInfo')
      : null);
    const activeRole = (app.globalData.bootstrap && app.globalData.bootstrap.current && app.globalData.bootstrap.current.role)
      || roleForIdentity(userInfo)
      || this.data.activeRole;
    const result = await refreshAccountSettingsState(this);
    this._identityContexts = (result && result.contexts) || [];
    this.setData({
      activeRole,
      ...mineRoleGuideEntry(activeRole, app.globalData.bootstrap, this._identityContexts)
    });
  },

  onOpenRoleGuide() {
    openMineRoleGuide({
      activeRole: this.data.activeRole,
      bootstrap: app.globalData.bootstrap,
      contexts: this._identityContexts
    });
  },

  onOpenAccountSecurity() {
    wx.navigateTo({ url: '/packages/business/account-security/account-security' });
  },

  clearSession() {
    session.clearSession();
    this.resetLoggedOutState();
  },

  resetLoggedOutState() {
    this.setData({
      isLoggedIn: false,
      isStaff: false,
      activeRole: '',
      showRoleGuideEntry: false,
      roleGuideHelper: '查看当前身份的工作方法',
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
      overviewCards: [],
      identityLabel: '读取中',
      identityCount: 0
    });
    this._identityContexts = [];
    this.syncTabBar();
  },

  onLogout() {
    session.confirmLogout({
      redirect: false,
      onCleared: () => {
        this.resetLoggedOutState();
        wx.showToast({ title: '已退出', icon: 'success' });
      }
    });
  }
});
