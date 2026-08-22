const app = getApp();
const api = require('../../../utils/api.js');
const { loadDesignerQrToTempFile } = require('../../../utils/designerContact.js');

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

function buildEligibilityStatus(wechatId, hasQr) {
  const id = String(wechatId || '').trim();
  const missing = [];
  if (!id) missing.push('微信号');
  if (!hasQr) missing.push('个人二维码');
  if (!missing.length) {
    return {
      assignmentEligible: true,
      eligibilityLabel: '资料已齐，可接客户',
      eligibilityTone: 'ready',
    };
  }
  return {
    assignmentEligible: false,
    eligibilityLabel: `还差${missing.join('和')}，补齐后才能接客户`,
    eligibilityTone: 'pending',
  };
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
    wechatQrPath: '',
    hasWechatQr: false,
    assignmentEligible: false,
    eligibilityLabel: '',
    eligibilityTone: 'pending',
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

  applyWechatEligibility(wechatId, hasQr) {
    const status = buildEligibilityStatus(wechatId, hasQr);
    this.setData({
      assignmentEligible: status.assignmentEligible,
      eligibilityLabel: status.eligibilityLabel,
      eligibilityTone: status.eligibilityTone,
    });
  },

  async loadWechatProfile() {
    try {
      const result = await api.request('/miniprogram/staff/wechat-profile', 'GET');
      const data = result.data || {};
      const wechatId = data.wechatId || '';
      const wechatQrUrl = data.wechatQrUrl || '';
      const hasWechatQr = Boolean(wechatQrUrl || data.wechatQrAssetId);
      this.setData({
        wechatId,
        wechatQrUrl,
        hasWechatQr,
        wechatQrPath: '',
      });
      this.applyWechatEligibility(wechatId, hasWechatQr);
      if (wechatQrUrl) await this.loadQrPreview(wechatQrUrl);
    } catch (error) {
      wx.showToast({ title: (error && error.error) || '微信资料读取失败', icon: 'none' });
    }
  },

  async loadQrPreview(url) {
    const requestId = (this._qrRequestId || 0) + 1;
    this._qrRequestId = requestId;
    try {
      const wechatQrPath = await loadDesignerQrToTempFile(url, 'profile-self');
      if (requestId !== this._qrRequestId) return;
      this.setData({ wechatQrPath, hasWechatQr: true });
    } catch (error) {
      if (requestId !== this._qrRequestId) return;
      console.warn('Failed to load self WeChat QR preview', error);
      this.setData({ wechatQrPath: '' });
    }
  },

  onWechatIdInput(event) {
    const wechatId = event.detail.value;
    this.setData({ wechatId });
    this.applyWechatEligibility(wechatId, this.data.hasWechatQr);
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
          const wechatQrUrl = upload.data && upload.data.wechatQrUrl
            ? upload.data.wechatQrUrl
            : this.data.wechatQrUrl;
          this.setData({
            uploadingQr: false,
            wechatQrUrl,
            hasWechatQr: true,
            wechatQrPath: filePath,
          });
          this.applyWechatEligibility(this.data.wechatId, true);
          wx.showToast({ title: '二维码已更新', icon: 'success' });
          if (wechatQrUrl && wechatQrUrl !== filePath) {
            this.loadQrPreview(wechatQrUrl);
          }
        } catch (error) {
          this.setData({ uploadingQr: false });
          wx.showToast({
            title: (error && error.error) || '二维码上传失败',
            icon: 'none',
            duration: 3200,
          });
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
    if (this.data.isDesigner) {
      if (!wechatId || wechatId.length > 64) {
        wx.showToast({ title: '请填写微信「我」页的微信号（不要填昵称）', icon: 'none' });
        return;
      }
      if (/[\u4e00-\u9fff]/.test(wechatId) || /\s/.test(wechatId)) {
        wx.showToast({ title: '请填写微信号，不要填微信昵称或空格', icon: 'none' });
        return;
      }
      if (!this.data.hasWechatQr) {
        wx.showToast({ title: '请先上传个人微信二维码，补齐后才能接客户', icon: 'none' });
        return;
      }
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
        const wechat = await api.request('/miniprogram/staff/wechat-profile', 'PATCH', { wechatId });
        const data = (wechat && wechat.data) || {};
        this.applyWechatEligibility(data.wechatId || wechatId, Boolean(data.wechatQrAssetId || this.data.hasWechatQr));
      }
      const profile = { ...(result.data || {}), avatar: (result.data && result.data.avatar) || avatar };
      syncStoredProfile(profile);
      this.setData({ saving: false, profile, nickname: profile.name, pendingAvatarPath: '', wechatId });
      wx.showToast({ title: '资料已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (error) {
      this.setData({ saving: false });
      wx.showToast({ title: (error && error.error) || '资料保存失败', icon: 'none', duration: 3200 });
    }
  }
});
