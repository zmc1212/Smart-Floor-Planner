const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    userInfo: {
      nickname: '',
      avatar: '',
      communityName: ''
    },
    defaultAvatarUrl: 'https://mmbiz.qpic.cn/mmbiz/icTdbqWNOwNRna42FI242Lcia07jQodd2FJGIYQfG0LAJGFxM4FbnQP6yfMxBgJ0F3YRqJCJ1aPAK2dQagdusBZg/0'
  },

  onShow() {
    this.setData({ floorPlans: [] });
    // If user info is already loaded into globalData, display it.
    if (app.globalData.userInfo) {
      this.setData({
        userInfo: app.globalData.userInfo
      });
      this.fetchMyFloorPlans(app.globalData.openid);
    } else {
      // Sometimes globalData isn't populated fast enough, wait and poll or just use default.
      setTimeout(() => {
        if (app.globalData.userInfo) {
          this.setData({ userInfo: app.globalData.userInfo });
          this.fetchMyFloorPlans(app.globalData.openid);
        }
      }, 1000);
    }
  },

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

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    // We need to convert it to base64 to store in MongoDB directly
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
  }
});
