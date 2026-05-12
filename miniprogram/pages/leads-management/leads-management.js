Page({
  data: {
    openid: '',
    statusBarHeight: 0,
    navBarHeightTotal: 0
  },

  onLoad() {
    const app = getApp();
    const systemInfo = wx.getSystemInfoSync();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const navBarHeightTotal = menuButton.bottom + (menuButton.top - systemInfo.statusBarHeight);

    this.setData({
      openid: app.globalData.openid || '',
      statusBarHeight: systemInfo.statusBarHeight,
      navBarHeightTotal: navBarHeightTotal
    });
  },

  onShow() {
    const app = getApp();
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
  },

  onOpenLeadModal() {
    this.setData({ showLeadModal: true });
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
  }
});
