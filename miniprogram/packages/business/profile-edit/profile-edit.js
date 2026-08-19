const app = getApp();
const api = require('../../../utils/api.js');

const DEFAULT_AVATAR = '/images/mine-v6/profile-avatar.jpg';

function syncStoredProfile(profile) {
  const userInfo = {
    ...(app.globalData.userInfo || wx.getStorageSync('userInfo') || {}),
    nickname: profile.name,
    avatar: profile.avatar,
    staffRole: profile.role,
    enterpriseName: profile.enterpriseName
  };
  app.globalData.userInfo = userInfo;
  wx.setStorageSync('userInfo', userInfo);
}

Page({
  data: {
    loading: true,
    saving: false,
    uploadingQr: false,
    loadError: '',
    profile: {},
    nickname: '',
    pendingAvatarPath: '',
    defaultAvatar: DEFAULT_AVATAR,
    isDesigner: false,
    wechatId: '',
    wechatQrUrl: '',
  },

  onLoad() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true, loadError: '' });
    try {
      const result = await api.request('/miniprogram/profile', 'GET');
      const profile = result.data || {};
      const isDesigner = profile.role === 'designer';
      this.setData({ loading: false, profile, nickname: profile.name || '', isDesigner });
      if (isDesigner) await this.loadWechatProfile();
    } catch (error) {
      this.setData({
        loading: false,
        loadError: (error && error.error) || '个人资料加载失败，请检查网络后重试'
      });
    }
  },

  onChooseAvatar(event) {
    const avatarUrl = event.detail && event.detail.avatarUrl;
    if (avatarUrl) this.setData({ pendingAvatarPath: avatarUrl });
  },

  async loadWechatProfile() {
    try {
      const result = await api.request('/miniprogram/staff/wechat-profile', 'GET');
      const data = result.data || {};
      this.setData({
        wechatId: data.wechatId || '',
        wechatQrUrl: data.wechatQrUrl || '',
      });
    } catch (error) {
      wx.showToast({ title: (error && error.error) || '微信资料读取失败', icon: 'none' });
    }
  },

  onWechatIdInput(event) {
    this.setData({ wechatId: event.detail.value });
  },

  onChooseWechatQr() {
    if (this.data.uploadingQr) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: async (result) => {
        const filePath = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath;
        if (!filePath) return;
        this.setData({ uploadingQr: true });
        try {
          const upload = await api.uploadStaffWechatQr(filePath);
          this.setData({
            uploadingQr: false,
            wechatQrUrl: upload.data && upload.data.wechatQrUrl ? upload.data.wechatQrUrl : this.data.wechatQrUrl,
          });
          wx.showToast({ title: '二维码已更新', icon: 'success' });
        } catch (error) {
          this.setData({ uploadingQr: false });
          wx.showToast({ title: (error && error.error) || '二维码上传失败', icon: 'none' });
        }
      },
    });
  },

  onNicknameInput(event) {
    this.setData({ nickname: event.detail.value });
  },

  async onSave() {
    if (this.data.saving) return;
    const nickname = String(this.data.nickname || '').trim();
    if (!nickname || nickname.length > 30) {
      wx.showToast({ title: '昵称应为 1–30 个字符', icon: 'none' });
      return;
    }
    const wechatId = String(this.data.wechatId || '').trim();
    if (this.data.isDesigner && (!wechatId || wechatId.length > 64)) {
      wx.showToast({ title: '请填写 1–64 个字符的微信号', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      let avatar = this.data.profile.avatar || '';
      if (this.data.pendingAvatarPath) {
        const upload = await api.uploadProfileAvatar(this.data.pendingAvatarPath);
        avatar = upload.data && upload.data.avatar ? upload.data.avatar : avatar;
      }
      const result = await api.request('/miniprogram/profile', 'PATCH', { nickname });
      if (this.data.isDesigner) {
        await api.request('/miniprogram/staff/wechat-profile', 'PATCH', { wechatId });
      }
      const profile = { ...(result.data || {}), avatar: (result.data && result.data.avatar) || avatar };
      syncStoredProfile(profile);
      this.setData({ saving: false, profile, nickname: profile.name, pendingAvatarPath: '' });
      wx.showToast({ title: '资料已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ saving: false });
      wx.showToast({ title: (error && error.error) || '资料保存失败', icon: 'none' });
    }
  }
});
