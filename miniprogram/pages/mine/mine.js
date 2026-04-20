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

        // Save to storage for persistence
        wx.setStorageSync('openid', res.openid);
        wx.setStorageSync('userInfo', res.user);

        // Sync professional context (auto-branding for staff)
        app.syncProfessionalContext();

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
        const formatted = res.data.map(fp => {
          let roomCount = 0;
          if (fp.layoutData) {
            try {
              const rooms = typeof fp.layoutData === 'string' ? JSON.parse(fp.layoutData) : fp.layoutData;
              roomCount = Array.isArray(rooms) ? rooms.length : (rooms ? 1 : 0);
            } catch (e) {
              console.error('Parse layoutData failed', e);
            }
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

  onOpenFloorPlan(e) {
    const id = e.currentTarget.dataset.id;
    const fp = this.data.floorPlans.find(f => f._id === id);
    if (fp) {
      app.globalData.restoreFloorPlan = Object.assign({}, fp, { isRestore: true });
      wx.navigateTo({
        url: '/pages/editor/editor'
      });
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
      try {
        rooms = JSON.parse(rooms);
      } catch (e) {
        console.error('Parse layoutData failed', e);
      }
    }

    // AI生成通常针对一个具体房间，我们取第一个房间或整体数据
    const targetRoom = Array.isArray(rooms) ? rooms[0] : rooms;

    if (targetRoom) {
      getApp().globalData.currentAIGenRoom = targetRoom;
      wx.navigateTo({
        url: '/pages/ai-gen/ai-gen'
      });
    } else {
      wx.showToast({ title: '户型数据为空', icon: 'none' });
    }
  },

  // ---- Profile editing ----
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    wx.showLoading({ title: '处理中' });
    wx.getFileSystemManager().readFile({
      filePath: avatarUrl,
      encoding: 'base64',
      success: (res) => {
        const base64Avatar = 'data:image/jpeg;base64,' + res.data;
        this.setData({
          'userInfo.avatar': base64Avatar
        }, () => {
          // Auto-save when avatar changes
          this.onSaveProfile(true);
        });
      },
      fail: (err) => {
        wx.hideLoading();
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
        wx.showToast({ title: isAutoSave ? '头像更新完成' : '保存成功', icon: 'success' });
        
        // Update global Data
        app.globalData.userInfo = res.data || this.data.userInfo;
        // Update storage
        wx.setStorageSync('userInfo', app.globalData.userInfo);
        
        // Sync local page state if server returned merged data
        if (res.data) {
          this.setData({ userInfo: res.data });
        }
      } else {
        throw new Error(res.error || '保存失败');
      }
    } catch (err) {
      wx.hideLoading();
      console.error('Update profile error:', err);
      wx.showToast({ title: err.error || '保存失败', icon: 'none' });
    }
  },

  onCreateNew() {
    wx.navigateTo({
      url: '/pages/editor/editor'
    });
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
          // Clear storage
          wx.removeStorageSync('openid');
          wx.removeStorageSync('userInfo');

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
