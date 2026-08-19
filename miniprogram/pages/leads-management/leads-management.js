const { roleForIdentity } = require('../../utils/identity-navigation.js');

Page({
  data: {
    openid: '',
    statusBarHeight: 0,
    navBarHeightTotal: 0,
    capsuleRightInset: 190,
    pendingLeadId: '',
    roleWorkbenchRole: '',
    canCreateLead: false
  },

  getRoleWorkbenchRole() {
    const globalData = getApp().globalData;
    const bootstrap = globalData.bootstrap;
    const role = (bootstrap && bootstrap.current && bootstrap.current.role)
      || roleForIdentity(globalData.userInfo);
    return role === 'measurer' ? role : '';
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
    const roleWorkbenchRole = this.getRoleWorkbenchRole();
    if (roleWorkbenchRole) {
      this.setData({ roleWorkbenchRole });
      return;
    }
    this.setData({ roleWorkbenchRole: '', canCreateLead: role === 'enterprise_admin' });
    if (this.data.openid !== app.globalData.openid) {
      this.setData({
        openid: app.globalData.openid || ''
      });
    }
    
    // Trigger refresh in lead-list component if needed
    const leadList = this.selectComponent('#leadList');
    if (leadList) {
      leadList.onRefresh();
    }
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
