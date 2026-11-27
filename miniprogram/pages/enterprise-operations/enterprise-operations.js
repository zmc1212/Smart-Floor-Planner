const { roleForIdentity } = require('../../utils/identity-navigation.js');
const { syncAiEntryVisibility } = require('../../utils/ai-entries.js');

Page({
  data: {
    role: '',
    aiEntriesEnabled: false,
  },

  syncRole() {
    const globalData = (getApp() && getApp().globalData) || {};
    const bootstrap = globalData.bootstrap;
    const role = (bootstrap && bootstrap.current && bootstrap.current.role)
      || roleForIdentity(globalData.userInfo);
    this.setData({
      role: ['designer', 'measurer', 'enterprise_admin'].includes(role) ? role : '',
    });
  },

  onLoad() {
    this.syncRole();
  },

  onShow() {
    this.syncRole();
    this.syncAiEntryVisibility();
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.syncSelected === 'function') tabBar.syncSelected();
  },
  syncAiEntryVisibility,
});
