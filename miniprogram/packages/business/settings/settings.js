const {
  requestNotification,
  getTemplateIds,
  refreshTemplateConfig
} = require('../../../utils/notification.js');
const session = require('../../../utils/session.js');
const api = require('../../../utils/api.js');

const IDENTITY_LABELS = { customer: '客户身份', referrer: '推荐人身份', staff: '员工身份' };

async function readIdentityState(page) {
  try {
    const result = await api.request('/miniprogram/identity-contexts', 'GET');
    const current = result.current || {};
    const detail = current.mode === 'staff'
      ? (current.staffDisplayName || current.enterpriseName || '')
      : (current.enterpriseName || '个人');
    page.setData({ identityLabel: `${IDENTITY_LABELS[current.mode] || '当前身份'}${detail ? ` · ${detail}` : ''}`, identityCount: (result.contexts || []).length });
  } catch (error) {
    page.setData({ identityLabel: '读取失败', identityCount: 0 });
  }
}

async function readNotificationState(page, refresh = true) {
  if (!wx.getSetting) {
    page.setData({ notificationStatus: '当前版本不支持', notificationAccepted: false });
    return;
  }
  if (refresh) await refreshTemplateConfig();
  const templateIds = getTemplateIds();
  if (!templateIds.length) {
    page.setData({ notificationStatus: '配置不可用', notificationAccepted: false });
    return;
  }
  wx.getSetting({
    withSubscriptions: true,
    success(result) {
      const subscriptionsSetting = result.subscriptionsSetting || {};
      if (subscriptionsSetting.mainSwitch === false) {
        page.setData({ notificationStatus: '已关闭', notificationAccepted: false });
        return;
      }
      const itemSettings = subscriptionsSetting.itemSettings;
      const states = templateIds.map((templateId) => itemSettings && itemSettings[templateId]);
      const acceptedCount = states.filter((state) => state === 'accept').length;
      const notificationStatus = acceptedCount === templateIds.length
        ? '已允许'
        : acceptedCount > 0
          ? `已允许 ${acceptedCount}/${templateIds.length}`
          : states.includes('ban')
            ? '已关闭'
            : states.includes('reject')
              ? '已拒绝'
              : '未设置';
      page.setData({
        notificationStatus,
        notificationAccepted: acceptedCount > 0
      });
    },
    fail() {
      page.setData({ notificationStatus: '读取失败', notificationAccepted: false });
    }
  });
}

Page({
  data: {
    notificationStatus: '读取中',
    notificationAccepted: false,
    notificationRequesting: false,
    identityLabel: '读取中',
    identityCount: 0
  },

  onShow() {
    return Promise.all([readNotificationState(this), readIdentityState(this)]);
  },

  async onEnableNotification() {
    if (this.data.notificationRequesting) return;
    this.setData({ notificationRequesting: true });
    try {
      await requestNotification();
    } catch (error) {
      console.error('Notification subscription failed', error);
    } finally {
      this.setData({ notificationRequesting: false });
      await readNotificationState(this, false);
    }
  },

  onOpenSystemSettings() {
    if (!wx.openSetting) {
      wx.showToast({ title: '当前微信版本不支持权限设置', icon: 'none' });
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wx.openSetting({
        complete: async () => {
          await readNotificationState(this);
          resolve();
        }
      });
    });
  },

  onOpenAccountSecurity() {
    wx.navigateTo({ url: '/packages/business/account-security/account-security' });
  },

  onOpenIdentitySwitch() {
    wx.navigateTo({ url: '/packages/business/identity-switch/identity-switch' });
  },

  onLogout() {
    session.confirmLogout();
  }
});
