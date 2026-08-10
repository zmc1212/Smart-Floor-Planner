Page({
  data: {
    openid: '',
    statusBarHeight: 0,
    navBarHeightTotal: 0,
    capsuleRightInset: 190,
    designerEntryTop: 50,
    designerProfile: null,
    showDesignerSheet: false,
    pendingLeadId: ''
  },

  onLoad(options) {
    const app = getApp();
    const systemInfo = wx.getSystemInfoSync();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const navBarHeightTotal = menuButton.bottom + (menuButton.top - systemInfo.statusBarHeight);
    const capsuleRightInset = Math.max(180, systemInfo.windowWidth - menuButton.left + 16);
    const designerEntryTop = Math.max(44, navBarHeightTotal - systemInfo.statusBarHeight + 8);

    this.setData({
      openid: app.globalData.openid || '',
      statusBarHeight: systemInfo.statusBarHeight,
      navBarHeightTotal: navBarHeightTotal,
      capsuleRightInset,
      designerEntryTop
    });
    if (options && options.leadId) this.setData({ pendingLeadId: String(options.leadId) });
  },

  onShow() {
    const app = getApp();
    this.syncTabBar();
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

  onDesignerProfileChange(event) {
    this.setData({ designerProfile: event.detail && event.detail.profile ? event.detail.profile : null });
  },

  onOpenDesignerSheet() {
    if (this.data.designerProfile) this.setData({ showDesignerSheet: true });
  },

  onCloseDesignerSheet() {
    this.setData({ showDesignerSheet: false });
  },

  onRetryDesignerProfile() {
    const leadList = this.selectComponent('#leadList');
    if (leadList) leadList.onRefresh();
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) {
      tabBar.syncSelected();
    }
  }
});
