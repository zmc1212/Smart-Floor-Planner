const { requestNotification, TEMPLATE_ID } = require('../../../utils/notification.js');
const session = require('../../../utils/session.js');

function readNotificationState(page) {
  if (!wx.getSetting) {
    page.setData({ notificationStatus: '当前版本不支持', notificationAccepted: false });
    return;
  }
  wx.getSetting({
    withSubscriptions: true,
    success(result) {
      const itemSettings = result.subscriptionsSetting && result.subscriptionsSetting.itemSettings;
      const state = itemSettings && itemSettings[TEMPLATE_ID];
      const labels = { accept: '已允许', reject: '已拒绝', ban: '已关闭' };
      page.setData({
        notificationStatus: labels[state] || '未设置',
        notificationAccepted: state === 'accept'
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
    notificationAccepted: false
  },

  onShow() {
    readNotificationState(this);
  },

  async onEnableNotification() {
    try {
      await requestNotification();
    } catch (error) {
      console.error('Notification subscription failed', error);
    } finally {
      readNotificationState(this);
    }
  },

  onOpenSystemSettings() {
    if (!wx.openSetting) {
      wx.showToast({ title: '当前微信版本不支持权限设置', icon: 'none' });
      return;
    }
    wx.openSetting({ complete: () => readNotificationState(this) });
  },

  onOpenAccountSecurity() {
    wx.navigateTo({ url: '/packages/business/account-security/account-security' });
  },

  onLogout() {
    session.confirmLogout();
  }
});
