const app = getApp();
const api = require('../../utils/api.js');

const DEFAULT_AVATAR =
  'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0';

const FALLBACK_PROFILE = {
  name: '员工账号',
  avatar: '',
  enterpriseName: '智能量房助手',
  phoneMasked: '',
  roleLabel: '员工账号',
  role: ''
};

const ACTION_TARGETS = {
  createPromotion: () => wx.navigateTo({ url: '/pages/promotion-record-detail/promotion-record-detail?mode=create' }),
  commissions: () => wx.navigateTo({ url: '/pages/commission-records/commission-records' }),
  leads: () => wx.switchTab({ url: '/pages/leads-management/leads-management' }),
  inspiration: () => wx.switchTab({ url: '/pages/inspiration/inspiration' }),
  measure: () => wx.switchTab({ url: '/pages/index/index' })
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

function getFloorPlanRoomCount(layoutData) {
  if (!layoutData) return 0;
  try {
    const rooms = typeof layoutData === 'string' ? JSON.parse(layoutData) : layoutData;
    return Array.isArray(rooms) ? rooms.length : rooms ? 1 : 0;
  } catch (e) {
    return 0;
  }
}

Page({
  data: {
    isLoggedIn: false,
    isStaff: false,
    loadingMine: false,
    mineData: {
      profile: FALLBACK_PROFILE,
      actions: [],
      workbenchCards: [],
      todos: []
    },
    floorPlans: [],
    defaultAvatarUrl: DEFAULT_AVATAR
  },

  onShow() {
    this.syncTabBar();
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo');
    const token = wx.getStorageSync('token');
    const openid = app.globalData.openid || wx.getStorageSync('openid') || (userInfo && userInfo.openid);

    if (token && userInfo) {
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      this.setData({ isLoggedIn: true, floorPlans: [] });
      this.fetchMineData();
      return;
    }

    if (openid && userInfo) {
      app.globalData.userInfo = userInfo;
      app.globalData.openid = openid;
      this.setData({ isLoggedIn: true, isStaff: userInfo.role === 'staff' });
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
      floorPlans: [],
      mineData: {
        profile: FALLBACK_PROFILE,
        actions: [],
        workbenchCards: [],
        todos: []
      }
    });
  },

  syncTabBar() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().setData({ selected: 4 });
    }
  },

  goToLogin() {
    wx.navigateTo({ url: '/pages/login/login' });
  },

  async fetchMineData() {
    this.setData({ loadingMine: true });
    try {
      const res = await api.request('/miniprogram/mine', 'GET');
      const data = res.data || {};
      const profile = data.profile || FALLBACK_PROFILE;

      this.setData({
        loadingMine: false,
        isStaff: !!data.isStaff,
        mineData: {
          profile: { ...FALLBACK_PROFILE, ...profile },
          actions: data.actions || [],
          workbenchCards: data.workbenchCards || [],
          todos: data.todos || []
        }
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

      if (!data.isStaff) {
        this.fetchMyFloorPlans();
      }
    } catch (err) {
      this.setData({ loadingMine: false });
      if (err && err.statusCode === 401) {
        this.clearSession();
        return;
      }
      wx.showToast({ title: err.error || '加载失败', icon: 'none' });
    }
  },

  async fetchMyFloorPlans() {
    try {
      const res = await api.request('/floorplans', 'GET');
      if (res.success && res.data) {
        const floorPlans = res.data.map((item) => ({
          ...item,
          roomCount: getFloorPlanRoomCount(item.layoutData),
          createdAt: formatFloorPlanDate(item.createdAt)
        }));
        this.setData({ floorPlans });
      }
    } catch (err) {
      console.error('Failed to fetch floor plans', err);
    }
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
      wx.navigateTo({ url: `/pages/promotion-records/promotion-records?view=${view}${extraQuery}` });
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
    wx.navigateTo({ url: `/pages/promotion-records/promotion-records?view=${viewMap[role] || 'my'}` });
  },

  onOpenTodoDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/promotion-record-detail/promotion-record-detail?id=${id}` });
  },

  onOpenFloorPlan(e) {
    const id = e.currentTarget.dataset.id;
    const floorPlan = this.data.floorPlans.find((item) => item._id === id);
    if (!floorPlan) return;
    app.globalData.restoreFloorPlan = { ...floorPlan, isRestore: true };
    wx.navigateTo({ url: '/pages/editor/editor' });
  },

  onAIGen(e) {
    const id = e.currentTarget.dataset.id;
    const floorPlan = this.data.floorPlans.find((item) => item._id === id);
    if (!floorPlan || !floorPlan.layoutData) {
      wx.showToast({ title: '无法获取户型数据', icon: 'none' });
      return;
    }

    let rooms = floorPlan.layoutData;
    if (typeof rooms === 'string') {
      try {
        rooms = JSON.parse(rooms);
      } catch (e) {}
    }
    const targetRoom = Array.isArray(rooms) ? rooms[0] : rooms;
    if (targetRoom) {
      app.globalData.currentAIGenRoom = targetRoom;
      wx.navigateTo({ url: '/pages/ai-gen/ai-gen' });
    }
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
      floorPlans: [],
      mineData: {
        profile: FALLBACK_PROFILE,
        actions: [],
        workbenchCards: [],
        todos: []
      }
    });
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
