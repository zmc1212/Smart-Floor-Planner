const { roleForIdentity } = require('../../utils/identity-navigation.js');

Page({
  data: {
    openid: '',
    statusBarHeight: 0,
    navBarHeightTotal: 0,
    capsuleRightInset: 190,
    pendingLeadId: '',
    canCreateLead: false
  },

  onLoad(options) {
    const app = getApp();
    const systemInfo = wx.getSystemInfoSync();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const navBarHeightTotal = menuButton.bottom + (menuButton.top - systemInfo.statusBarHeight);
    const capsuleRightInset = Math.max(180, systemInfo.windowWidth - menuButton.left + 16);

    this.setData({
      openid: app.globalData.openid || '',
      statusBarHeight: systemInfo.statusBarHeight,
      navBarHeightTotal: navBarHeightTotal,
      capsuleRightInset
    });
    if (options && options.leadId) this.setData({ pendingLeadId: String(options.leadId) });
  },

  onShow() {
    const app = getApp();
    this.syncTabBar();
    const role = (app.globalData.bootstrap && app.globalData.bootstrap.current && app.globalData.bootstrap.current.role)
      || roleForIdentity(app.globalData.userInfo);
    const nextOpenid = app.globalData.openid || '';
    const canCreateLead = role === 'enterprise_admin';
    const patch = {};
    if (this.data.canCreateLead !== canCreateLead) patch.canCreateLead = canCreateLead;
    if (this.data.openid !== nextOpenid) patch.openid = nextOpenid;
    if (Object.keys(patch).length) this.setData(patch);

    if (this._listReady) {
      const leadList = this.selectComponent('#leadList');
      if (leadList) leadList.fetchLeads(true);
    }
    this._listReady = true;
    if (this.data.pendingLeadId) {
      const leadId = this.data.pendingLeadId;
      this.setData({ pendingLeadId: '' });
      wx.navigateTo({ url: `/packages/business/lead-detail/lead-detail?id=${leadId}` });
    }
  },

  onOpenLeadModal() {
    wx.navigateTo({
      url: '/packages/business/lead-form/lead-form',
    });
  },

  onCloseLeadModal() {
    this.setData({ showLeadModal: false });
  },

  onLeadSuccess() {
    this.setData({ showLeadModal: false });
    const leadList = this.selectComponent('#leadList');
    if (leadList) {
      leadList.onRefresh();
    }
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.syncSelected();
    }
  }
});
