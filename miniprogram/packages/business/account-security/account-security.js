const api = require('../../../utils/api.js');
const session = require('../../../utils/session.js');

Page({
  data: {
    loading: true,
    submitting: false,
    loadError: '',
    profile: {},
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  },

  onLoad() {
    this.loadProfile();
  },

  async loadProfile() {
    this.setData({ loading: true, loadError: '' });
    try {
      const result = await api.request('/miniprogram/profile', 'GET');
      this.setData({ loading: false, profile: result.data || {} });
    } catch (error) {
      this.setData({
        loading: false,
        loadError: (error && error.error) || '账号信息加载失败，请检查网络后重试'
      });
    }
  },

  onPasswordInput(event) {
    const field = event.currentTarget.dataset.field;
    if (['currentPassword', 'newPassword', 'confirmPassword'].includes(field)) {
      this.setData({ [field]: event.detail.value });
    }
  },

  async onChangePassword() {
    if (this.data.submitting) return;
    const { currentPassword, newPassword, confirmPassword } = this.data;
    if (!currentPassword) {
      wx.showToast({ title: '请输入当前密码', icon: 'none' });
      return;
    }
    if (newPassword.length < 6) {
      wx.showToast({ title: '新密码不能少于 6 位', icon: 'none' });
      return;
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次输入的新密码不一致', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.request('/miniprogram/account/password', 'PUT', { currentPassword, newPassword });
      session.clearSession();
      this.setData({ submitting: false });
      wx.showModal({
        title: '密码已修改',
        content: '请使用新密码重新登录。',
        showCancel: false,
        confirmText: '重新登录',
        success: () => session.goToLogin()
      });
    } catch (error) {
      this.setData({ submitting: false });
      wx.showToast({ title: (error && error.error) || '密码修改失败', icon: 'none' });
    }
  },

  onLogout() {
    session.confirmLogout();
  }
});
