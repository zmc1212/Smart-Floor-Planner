const { roleForIdentity, getRoleLanding } = require('../../utils/identity-navigation');
const { serviceEntryCode } = require('../../utils/service-entry');

Page({
  data: {
    roleWorkbenchRole: '',
    customerTab: 'xiaok',
    promotionCode: '',
    requestedFamilyProjectId: '',
    siteWorkbenchTab: 'workbench',
    redirectingToRoleLanding: false,
  },

  onLoad(options) {
    const { globalData } = getApp();
    const requestedFamilyProjectId = /^[1-9]\d*$/.test(options?.familyProject || '') ? options.familyProject : '';
    const promotionCode = serviceEntryCode(options?.promotionCode);

    if (promotionCode) globalData.customerTab = 'xiaok';
    else if (options?.customerTab === 'service' || requestedFamilyProjectId) globalData.customerTab = 'service';

    this.setData({ promotionCode, requestedFamilyProjectId });
    this.syncHomeView();
  },

  async onShow() {
    const { globalData } = getApp();
    const hydration = globalData.sessionHydrationPromise;
    this.syncHomeView();

    if (hydration) {
      await hydration;
      const pages = getCurrentPages();
      if (globalData.token && pages[pages.length - 1] === this) {
        this.syncHomeView();
      }
    }
  },

  syncHomeView() {
    const { globalData } = getApp();
    const loggedIn = Boolean(globalData.token || (globalData.openid && globalData.userInfo) || wx.getStorageSync('token'));
    if (loggedIn && this.redirectAwayFromHomeIfNeeded()) return;

    const roleWorkbenchRole = loggedIn ? this.getRoleWorkbenchRole() : 'customer';
    if (roleWorkbenchRole === 'construction_staff') globalData.siteWorkbenchTab = 'workbench';
    this.setData({
      roleWorkbenchRole,
      customerTab: globalData.customerTab || 'xiaok',
      siteWorkbenchTab: globalData.siteWorkbenchTab || 'workbench',
    }, () => this.syncTabBar());
  },

  getRoleWorkbenchRole() {
    const { bootstrap, userInfo, sessionHydrationPromise } = getApp().globalData;
    const role = bootstrap?.current?.role || roleForIdentity(userInfo);
    // A token by itself does not determine which role-specific view to mount.
    if (!role && !sessionHydrationPromise) return 'customer';
    return ['customer', 'designer', 'measurer', 'enterprise_admin', 'construction_staff'].includes(role) ? role : '';
  },

  redirectAwayFromHomeIfNeeded() {
    const { globalData } = getApp();
    const identity = {
      ...globalData.userInfo,
      ...globalData.bootstrap?.current,
    };
    const role = roleForIdentity(identity);
    if (role !== 'salesperson' && role !== 'platform_admin') return false;
    if (this.data.redirectingToRoleLanding) return true;

    this.setData({ redirectingToRoleLanding: true });
    wx.reLaunch({
      url: getRoleLanding(identity),
      fail: () => this.setData({ redirectingToRoleLanding: false }),
    });
    return true;
  },

  syncTabBar() {
    const tabBar = this.getTabBar?.();
    tabBar?.syncSelected?.();
  },

  onSiteWorkbenchSheetChange(event) {
    getApp().globalData.siteWorkbenchSheetOpen = Boolean(event.detail?.open);
    this.syncTabBar();
  },

  onPromotionEntryConsumed() {
    this.setData({ promotionCode: '' });
  },

  onFamilyEntryConsumed() {
    this.setData({ requestedFamilyProjectId: '' });
  },

  onShareAppMessage(event) {
    if (event?.from === 'button' && event.target?.dataset?.shareType === 'owner-family' &&
        this.data.roleWorkbenchRole === 'customer' && this.data.customerTab === 'service') {
      const invite = this.selectComponent('#owner-site-home')?.familyInviteShare();
      if (invite) return invite;
    }
    return {
      title: '智能量房大师 - 专业 AR 量房设计工具',
      path: '/pages/index/index',
    };
  },
});
