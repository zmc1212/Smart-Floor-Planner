const app = getApp();
const api = require('../../utils/api.js');

const IDENTITY_LABELS = {
  salesperson: '认证地推员',
  measurer: '认证测量员',
  designer: '认证设计师',
  enterprise_admin: '企业管理员',
};

Page({
  data: {
    isLoggedIn: false,
    userInfo: {
      nickname: '',
      avatar: '',
      communityName: '',
      phone: '',
      staffRole: ''
    },
    floorPlans: [],
    workbenchSummary: null,
    staffItems: [],
    todoItems: [],
    overdueTodoItems: [],
    commissionItems: [],
    defaultAvatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0',
    identityLabel: ''
  },

  onShow() {
    if (app.globalData.openid && app.globalData.userInfo) {
      const userInfo = app.globalData.userInfo;
      this.setData({
        isLoggedIn: true,
        userInfo,
        floorPlans: [],
        staffItems: [],
        todoItems: [],
        overdueTodoItems: [],
        workbenchSummary: null,
        commissionItems: [],
        identityLabel: IDENTITY_LABELS[userInfo.staffRole] || '员工账号'
      });

      if (userInfo.role === 'staff') {
        this.fetchWorkbenchData(app.globalData.openid);
      } else {
        this.fetchMyFloorPlans(app.globalData.openid);
      }
      this.refreshUserInfo();
    } else {
      this.setData({
        isLoggedIn: false,
        floorPlans: [],
        staffItems: [],
        todoItems: [],
        overdueTodoItems: [],
        workbenchSummary: null,
        commissionItems: []
      });
    }
  },

  async onGetPhoneNumber(e) {
    if (e.detail.errMsg !== "getPhoneNumber:ok") {
      wx.showToast({ title: '已取消授权', icon: 'none' });
      return;
    }

    const phoneCode = e.detail.code;
    if (!phoneCode) {
      wx.showToast({ title: '获取手机号失败', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '登录中' });
    try {
      const res = await api.phoneLogin(phoneCode);
      wx.hideLoading();

      if (res.success && res.openid) {
        app.globalData.openid = res.openid;
        app.globalData.userInfo = res.user;

        wx.setStorageSync('openid', res.openid);
        wx.setStorageSync('userInfo', res.user);

        app.syncProfessionalContext();

        this.setData({
          isLoggedIn: true,
          userInfo: res.user,
          identityLabel: IDENTITY_LABELS[res.user.staffRole] || '员工账号'
        });

        wx.showToast({ title: '登录成功', icon: 'success' });

        if (res.user.role === 'staff') {
          this.fetchWorkbenchData(res.openid);
        } else {
          this.fetchMyFloorPlans(res.openid);
        }
      } else {
        throw new Error(res.error || '登录失败');
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.error || err.message || '登录失败', icon: 'none' });
    }
  },

  async fetchWorkbenchData(openid) {
    if (!openid) return;
    try {
      const [summaryRes, recordsRes, commissionRes, todosRes, overdueRes] = await Promise.all([
        api.request(`/workbench/summary?openid=${openid}`, 'GET'),
        api.request(`/promotion-records?openid=${openid}`, 'GET'),
        api.request(`/commission-records?openid=${openid}`, 'GET').catch(() => ({ success: true, data: [] })),
        api.request(`/workbench/todos?openid=${openid}&view=mine`, 'GET').catch(() => ({ success: true, data: [] })),
        api.request(`/workbench/todos?openid=${openid}&view=overdue`, 'GET').catch(() => ({ success: true, data: [] }))
      ]);

      if (summaryRes.success) {
        this.setData({ workbenchSummary: summaryRes.data });
      }

      if (recordsRes.success) {
        this.setData({ staffItems: recordsRes.data.slice(0, 5) });
      }

      if (commissionRes.success) {
        this.setData({ commissionItems: commissionRes.data.slice(0, 5) });
      }

      if (todosRes.success) {
        this.setData({ todoItems: (todosRes.data || []).slice(0, 5) });
      }

      if (overdueRes.success) {
        this.setData({ overdueTodoItems: (overdueRes.data || []).slice(0, 5) });
      }
    } catch (err) {
      console.error('Fetch workbench failed', err);
    }
  },

  async fetchMyFloorPlans(openid) {
    if (!openid) return;
    try {
      const res = await api.request(`/floorplans?openid=${openid}`, 'GET');
      if (res.success && res.data) {
        const formatted = res.data.map(fp => {
          let roomCount = 0;
          if (fp.layoutData) {
            try {
              const rooms = typeof fp.layoutData === 'string' ? JSON.parse(fp.layoutData) : fp.layoutData;
              roomCount = Array.isArray(rooms) ? rooms.length : (rooms ? 1 : 0);
            } catch (e) {}
          }
          return {
            ...fp,
            roomCount,
            createdAt: new Date(fp.createdAt).toLocaleDateString('zh-CN', {
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit'
            }).replace(/\//g, '-')
          };
        });
        this.setData({ floorPlans: formatted });
      }
    } catch (err) {
      console.error('Failed to fetch floor plans', err);
    }
  },

  onOpenPromotionList(e) {
    const view = e.currentTarget.dataset.view || 'my';
    wx.navigateTo({
      url: `/pages/promotion-records/promotion-records?view=${view}`
    });
  },

  onCreatePromotionRecord() {
    wx.navigateTo({
      url: '/pages/promotion-record-detail/promotion-record-detail?mode=create'
    });
  },

  onOpenPromotionDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/promotion-record-detail/promotion-record-detail?id=${id}`
    });
  },

  onOpenTodoDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/promotion-record-detail/promotion-record-detail?id=${id}`
    });
  },

  onOpenCommissions() {
    wx.navigateTo({
      url: '/pages/commission-records/commission-records'
    });
  },

  onOpenFloorPlan(e) {
    const id = e.currentTarget.dataset.id;
    const fp = this.data.floorPlans.find(f => f._id === id);
    if (fp) {
      app.globalData.restoreFloorPlan = Object.assign({}, fp, { isRestore: true });
      wx.navigateTo({ url: '/pages/editor/editor' });
    }
  },

  onAIGen(e) {
    const id = e.currentTarget.dataset.id;
    const fp = this.data.floorPlans.find(f => f._id === id);
    if (!fp || !fp.layoutData) {
      wx.showToast({ title: '无法获取户型数据', icon: 'none' });
      return;
    }

    let rooms = fp.layoutData;
    if (typeof rooms === 'string') {
      try { rooms = JSON.parse(rooms); } catch (e) {}
    }
    const targetRoom = Array.isArray(rooms) ? rooms[0] : rooms;
    if (targetRoom) {
      app.globalData.currentAIGenRoom = targetRoom;
      wx.navigateTo({ url: '/pages/ai-gen/ai-gen' });
    }
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    wx.showLoading({ title: '处理中' });
    wx.getFileSystemManager().readFile({
      filePath: avatarUrl,
      encoding: 'base64',
      success: (res) => {
        const base64Avatar = 'data:image/jpeg;base64,' + res.data;
        this.setData({ 'userInfo.avatar': base64Avatar }, () => this.onSaveProfile(true));
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '读取头像失败', icon: 'none' });
      }
    });
  },

  onNicknameChange(e) {
    this.setData({ 'userInfo.nickname': e.detail.value });
  },

  onCommunityNameChange(e) {
    this.setData({ 'userInfo.communityName': e.detail.value });
  },

  async onSaveProfile(isAutoSave = false) {
    const openid = app.globalData.openid;
    if (!openid) {
      wx.showToast({ title: '尚未登录', icon: 'none' });
      return;
    }

    if (!isAutoSave) wx.showLoading({ title: '保存中' });

    try {
      const res = await api.request(`/users/${openid}`, 'PUT', {
        nickname: this.data.userInfo.nickname,
        avatar: this.data.userInfo.avatar,
        communityName: this.data.userInfo.communityName
      });

      wx.hideLoading();

      if (res.success) {
        app.globalData.userInfo = { ...app.globalData.userInfo, ...(res.data || {}) };
        wx.setStorageSync('userInfo', app.globalData.userInfo);
        if (res.data) this.setData({ userInfo: app.globalData.userInfo });
        wx.showToast({ title: isAutoSave ? '头像更新完成' : '保存成功', icon: 'success' });
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.error || '保存失败', icon: 'none' });
    }
  },

  async refreshUserInfo() {
    const openid = app.globalData.openid;
    if (!openid) return;

    try {
      const res = await api.request(`/users/${openid}`, 'GET');
      if (res.success && res.data) {
        app.globalData.userInfo = { ...app.globalData.userInfo, ...res.data };
        wx.setStorageSync('userInfo', app.globalData.userInfo);
        this.setData({
          userInfo: app.globalData.userInfo,
          identityLabel: IDENTITY_LABELS[app.globalData.userInfo.staffRole] || '员工账号'
        });
      }
    } catch (err) {
      console.error('Refresh user info failed', err);
    }
  },

  onCreateNew() {
    wx.navigateTo({ url: '/pages/editor/editor' });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          app.globalData.openid = null;
          app.globalData.userInfo = null;
          wx.removeStorageSync('openid');
          wx.removeStorageSync('userInfo');
          this.setData({
            isLoggedIn: false,
            userInfo: { nickname: '', avatar: '', communityName: '', phone: '', staffRole: '' },
            floorPlans: [],
            staffItems: [],
            todoItems: [],
            overdueTodoItems: [],
            workbenchSummary: null,
            commissionItems: []
          });
          wx.showToast({ title: '已退出', icon: 'success' });
        }
      }
    });
  }
});
