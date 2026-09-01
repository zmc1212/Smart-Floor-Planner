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

  onHide() {
    this._leftCustomerTab = true;
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

    const leadList = this.selectComponent('#leadList');
    const pending = app.globalData.pendingLeadReferrerFilter;
    const pendingMembershipId = pending && String(pending.membershipId || '').trim();
    let handledList = false;

    if (pendingMembershipId) {
      app.globalData.pendingLeadReferrerFilter = null;
      this._leftCustomerTab = false;
      if (leadList && typeof leadList.setReferrerFilter === 'function') {
        leadList.setReferrerFilter({
          membershipId: pendingMembershipId,
          displayName: String(pending.displayName || '推广人').trim() || '推广人'
        });
        handledList = true;
      }
    } else if (this._leftCustomerTab) {
      this._leftCustomerTab = false;
      if (leadList && typeof leadList.hasReferrerFilter === 'function' && leadList.hasReferrerFilter()) {
        leadList.clearReferrerFilter();
        handledList = true;
      }
    }

    if (!handledList && this._listReady && leadList) {
      leadList.fetchLeads(true);
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
