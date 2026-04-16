const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    isLoggedIn: false,
    userInfo: {
      nickname: '',
      avatar: '',
      communityName: '',
      phone: ''
    },
    floorPlans: [],
    defaultAvatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'
  },

  onShow() {
    // Check if already logged in
    if (app.globalData.openid && app.globalData.userInfo) {
      this.setData({
        isLoggedIn: true,
        userInfo: app.globalData.userInfo,
        floorPlans: []
      });
      this.fetchMyFloorPlans(app.globalData.openid);
    } else {
      this.setData({
        isLoggedIn: false,
        floorPlans: []
      });
    }
  },

  // ---- Phone number quick login ----
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
        // Save to globalData
        app.globalData.openid = res.openid;
        app.globalData.userInfo = res.user;

        this.setData({
          isLoggedIn: true,
          userInfo: res.user
        });

        wx.showToast({ title: '登录成功', icon: 'success' });

        // Load floor plans
        this.fetchMyFloorPlans(res.openid);
      } else {
        throw new Error(res.error || '登录失败');
      }
    } catch (err) {
      wx.hideLoading();
      console.error('Phone login failed:', err);
      wx.showToast({ title: err.error || '登录失败', icon: 'none' });
    }
  },

  // ---- Floor plans ----
  async fetchMyFloorPlans(openid) {
    if (!openid) return;
    try {
      const res = await api.request(`/floorplans?openid=${openid}`, 'GET');
      if (res.success && res.data) {
        const formatted = res.data.map(fp => ({
          ...fp,
          createdAt: new Date(fp.createdAt).toLocaleString()
        }));
        this.setData({ floorPlans: formatted });
      }
    } catch (err) {
      console.error('Failed to fetch floor plans', err);
    }
  },

  onOpenFloorPlan(e) {
    const id = e.currentTarget.dataset.id;
    const fp = this.data.floorPlans.find(f => f._id === id);
    if (fp) {
      app.globalData.restoreFloorPlan = fp;
      wx.switchTab({
        url: '/pages/index/index'
      });
    }
  },

  // ---- Profile editing ----
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    wx.getFileSystemManager().readFile({
      filePath: avatarUrl,
      encoding: 'base64',
      success: (res) => {
        const base64Avatar = 'data:image/jpeg;base64,' + res.data;
        this.setData({
          'userInfo.avatar': base64Avatar
        });
      },
      fail: (err) => {
        console.error('Failed to read avatar file', err);
        wx.showToast({ title: '读取头像失败', icon: 'none' });
      }
    });
  },

  onNicknameChange(e) {
    this.setData({
      'userInfo.nickname': e.detail.value
    });
  },

  onCommunityNameChange(e) {
    this.setData({
      'userInfo.communityName': e.detail.value
    });
  },

  async onSaveProfile() {
    const openid = app.globalData.openid;
    if (!openid) {
      wx.showToast({ title: '尚未登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中' });
    try {
      const res = await api.request(`/users/${openid}`, 'PUT', {
        nickname: this.data.userInfo.nickname,
        avatar: this.data.userInfo.avatar,
        communityName: this.data.userInfo.communityName
      });
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
      
      // Update global Data
      app.globalData.userInfo = this.data.userInfo;
      
    } catch (err) {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  // ---- Logout ----
  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          app.globalData.openid = null;
          app.globalData.userInfo = null;
          this.setData({
            isLoggedIn: false,
            userInfo: { nickname: '', avatar: '', communityName: '', phone: '' },
            floorPlans: []
          });
          wx.showToast({ title: '已退出', icon: 'success' });
        }
      }
    });
  }
});
