const api = require('./utils/api.js');

function resolveApiRequest(apiModule) {
  if (typeof apiModule === 'function') return apiModule;
  if (!apiModule) return null;
  if (typeof apiModule.request === 'function') return apiModule.request;
  if (typeof apiModule.default === 'function') return apiModule.default;
  if (apiModule.default && typeof apiModule.default.request === 'function') {
    return apiModule.default.request;
  }
  return null;
}

App({
  globalData: {
    userInfo: null,
    openid: null,
    token: null,
    referral: {
      enterpriseId: null,
      staffId: null
    },
    pendingBluetoothAutoConnect: false,
    justLoggedIn: false,
    sessionHydrated: false,
    sessionHydrating: false,
    sessionHydrationToken: null,
    sessionHydrationPromise: null,
    bootstrap: null,
    sessionRecovery: null,
    lastValidIdentityContext: null,
    roleLandingRedirected: false,
    roleLandingRestoreRetries: 0,
    deepLinkRedirecting: false,
    launchOptions: null,
    pendingLeadReferrerFilter: null,
    updateState: 'idle',
    updateManager: null
  },
  onLaunch(options) {
    console.log('智能量房大师小程序启动', options);
    this.globalData.launchOptions = options || {};
    this.initUpdateManager();
    this.handleReferral(options);
    
    // 1. Restore session from storage (Priority: Token)
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    const openid = wx.getStorageSync('openid'); // Legacy fallback

    if (token) {
      this.globalData.token = token;
      this.globalData.userInfo = userInfo || null;
      this.globalData.openid = openid || (userInfo && userInfo.openid) || null;
      console.log('会话已恢复 (JWT)');
      // Branding is synchronized after the signed session/bootstrap refresh
      // below, when the API module and enterprise context are ready.
      this.hydrateStoredSession();
    } else if (openid || userInfo) {
      // Legacy-only storage cannot prove the active signed context.
      this.globalData.sessionRecovery = { reason: 'signed_context_required' };
      wx.removeStorageSync('openid');
      wx.removeStorageSync('userInfo');
    }

    // 3. Silent Bluetooth Reconnection (静默自动重连)
    // JWT 会话可能尚无 openid；有 token 或 openid + 记忆设备即可尝试。
    this.trySilentBluetoothReconnect();
  },
  onShow(options) {
    if (options) {
      this.globalData.launchOptions = options;
    }
    this.handleReferral(options);
    if (this.globalData.token && !this.globalData.sessionHydrated) {
      this.hydrateStoredSession();
    } else if (this.globalData.sessionHydrated) {
      this.guardCurrentRoute();
    }
    this.trySilentBluetoothReconnect();
  },

  initUpdateManager() {
    if (this._updateManagerInitialized) return this.globalData.updateManager;
    this._updateManagerInitialized = true;
    if (
      typeof wx === 'undefined'
      || typeof wx.getUpdateManager !== 'function'
      || (typeof wx.canIUse === 'function' && !wx.canIUse('getUpdateManager'))
    ) {
      this.globalData.updateState = 'unsupported';
      return null;
    }
    const updateManager = wx.getUpdateManager();
    this.globalData.updateManager = updateManager;
    this.globalData.updateState = 'checking';

    updateManager.onCheckForUpdate((res) => {
      this.globalData.updateState = res && res.hasUpdate ? 'downloading' : 'latest';
      this.globalData.updateHasUpdate = !!(res && res.hasUpdate);
      this.syncUpdateStateToCurrentPage();
    });
    updateManager.onUpdateReady(() => {
      this.globalData.updateState = 'ready';
      this.syncUpdateStateToCurrentPage();
      this.promptUpdateRestart();
    });
    updateManager.onUpdateFailed(() => {
      this.globalData.updateState = 'failed';
      this.syncUpdateStateToCurrentPage();
    });
    return updateManager;
  },

  promptUpdateRestart() {
    if (this._updatePromptVisible || typeof wx === 'undefined' || typeof wx.showModal !== 'function') return;
    const updateManager = this.globalData.updateManager;
    if (!updateManager || typeof updateManager.applyUpdate !== 'function') return;
    this._updatePromptVisible = true;
    wx.showModal({
      title: '版本更新',
      content: '新版本已准备好，请重启小程序后使用。',
      confirmText: '立即重启',
      cancelText: '稍后再说',
      success: (res) => {
        this._updatePromptVisible = false;
        if (res && res.confirm) updateManager.applyUpdate();
      },
      fail: () => {
        this._updatePromptVisible = false;
      }
    });
  },

  getUpdateState() {
    return this.globalData.updateState || 'idle';
  },

  syncUpdateStateToCurrentPage() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const currentPage = pages.length ? pages[pages.length - 1] : null;
    if (currentPage && typeof currentPage.syncUpdateStatus === 'function') {
      currentPage.syncUpdateStatus();
    }
  },

  trySilentBluetoothReconnect() {
    if (this.globalData.bleConnected) return;
    if (!(this.globalData.token || this.globalData.openid)) return;

    const bluetooth = require('./utils/bluetooth.js');
    if (!bluetooth.hasRememberedDevice || !bluetooth.hasRememberedDevice()) return;
    if (bluetooth.isSessionConnected && bluetooth.isSessionConnected()) {
      this.globalData.bleConnected = true;
      this.notifyBleConnectionResult(true);
      return;
    }

    bluetooth.autoConnectBLE(
      () => {},
      (success) => {
        this.globalData.bleConnected = !!success;
        console.log('App: 静默蓝牙重连结果:', success);
        this.notifyBleConnectionResult(!!success);
      },
      () => {
        this.globalData.bleConnected = false;
        this.notifyBleConnectionResult(false);
      },
      true
    );
  },

  notifyBleConnectionResult(success) {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (!pages.length) return;
    const currentPage = pages[pages.length - 1];
    if (typeof currentPage.updateBleConnected === 'function') {
      currentPage.updateBleConnected(!!success);
    }
    if (success) {
      if (typeof currentPage.onBLESuccess === 'function') currentPage.onBLESuccess();
      if (typeof currentPage.syncBleConnectionState === 'function') {
        currentPage.syncBleConnectionState();
      }
    } else if (typeof currentPage.onBluetoothDisconnect === 'function') {
      currentPage.onBluetoothDisconnect();
    }
  },

  async hydrateStoredSession() {
    const currentToken = this.globalData.token;
    if (!currentToken) return;
    if (this.globalData.sessionHydrating) {
      if (this.globalData.sessionHydrationToken === currentToken) {
        return this.globalData.sessionHydrationPromise;
      }
      await this.globalData.sessionHydrationPromise;
      return this.hydrateStoredSession();
    }

    this.globalData.sessionHydrating = true;
    this.globalData.sessionHydrationToken = currentToken;
    let activeToken = currentToken;
    const hydration = (async () => {
      try {
        const refreshed = await api.request('/auth/miniprogram', 'POST', {
          type: 'refresh',
          token: activeToken
        }, { suppressUnauthorized: true });
        // A newer login can finish while an old cold-start refresh is pending.
        // That old task must not overwrite or clear the newer signed session.
        if (this.globalData.token !== activeToken) return;
        if (!refreshed || !refreshed.token || !refreshed.user) throw new Error('Session refresh failed');
        activeToken = refreshed.token;
        this.globalData.token = activeToken;
        this.globalData.userInfo = refreshed.user;
        this.globalData.openid = refreshed.openid || refreshed.user.openid || null;
        wx.setStorageSync('token', activeToken);
        wx.setStorageSync('userInfo', refreshed.user);
        if (refreshed.openid) wx.setStorageSync('openid', refreshed.openid);
        this.globalData.sessionHydrated = true;
        const bootstrap = await api.request('/miniprogram/bootstrap', 'GET', {}, { suppressUnauthorized: true });
        if (this.globalData.token !== activeToken) return;
        if (!bootstrap || !bootstrap.current || !bootstrap.current.context) {
          throw Object.assign(new Error('Identity bootstrap failed'), { statusCode: 401, error: 'Identity bootstrap failed' });
        }
        this.globalData.bootstrap = bootstrap;
        this.globalData.lastValidIdentityContext = bootstrap.current.context;
        this.globalData.sessionRecovery = null;
        wx.setStorageSync('lastValidIdentityContext', bootstrap.current.context);
        this.syncProfessionalContext();
        this.restoreRoleLanding();
        this.guardCurrentRoute();
        this.refreshCustomTabBar();
        if (typeof this.refreshMineRoleGuideEntry === 'function') {
          this.refreshMineRoleGuideEntry();
        }
        this.trySilentBluetoothReconnect();
      } catch (error) {
        if (this.globalData.token !== activeToken) return;
        if (error && (error.statusCode === 401 || error.error === 'Unauthorized')) {
          const navigation = require('./utils/identity-navigation.js');
          const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
          const currentRoute = pages.length
            ? pages[pages.length - 1].route
            : (this.globalData.launchOptions && this.globalData.launchOptions.path);
          const keepPublicScanLanding = navigation.isScanLandingRoute(currentRoute);
          this.globalData.token = null;
          this.globalData.userInfo = null;
          this.globalData.openid = null;
          wx.removeStorageSync('token');
          wx.removeStorageSync('userInfo');
          wx.removeStorageSync('openid');
          this.globalData.bootstrap = null;
          if (keepPublicScanLanding) {
            // Service, onboarding and enterprise-registration codes are public
            // entry points. A stale role token must not replace their cold-start
            // destination with identity recovery; the page can continue its
            // anonymous resolve/phone-authorization flow after the token clears.
            this.globalData.sessionRecovery = null;
            this.globalData.lastValidIdentityContext = null;
            wx.removeStorageSync('lastValidIdentityContext');
            this.globalData.sessionHydrated = true;
            return;
          }
          this.globalData.sessionRecovery = {
            reason: error.code || 'identity_context_invalid',
            lastValidIdentityContext: this.globalData.lastValidIdentityContext || wx.getStorageSync('lastValidIdentityContext') || null
          };
          this.globalData.sessionHydrated = true;
          wx.reLaunch({ url: `/packages/business/identity-recovery/identity-recovery?reason=${encodeURIComponent(error.code || 'identity_context_invalid')}` });
        } else {
          this.globalData.sessionRecovery = {
            reason: 'bootstrap_unavailable',
            retryable: true,
            lastValidIdentityContext: this.globalData.lastValidIdentityContext || wx.getStorageSync('lastValidIdentityContext') || null
          };
          this.globalData.sessionHydrated = true;
        }
      } finally {
        if (this.globalData.sessionHydrationPromise === hydration) {
          this.globalData.sessionHydrating = false;
          this.globalData.sessionHydrationToken = null;
          this.globalData.sessionHydrationPromise = null;
        }
      }
    })();
    this.globalData.sessionHydrationPromise = hydration;
    return hydration;
  },

  restoreRoleLanding() {
    if (this.globalData.roleLandingRedirected || !this.globalData.userInfo) return;
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    if (!pages.length) {
      if (this.globalData.roleLandingRestoreRetries < 3) {
        this.globalData.roleLandingRestoreRetries += 1;
        setTimeout(() => this.restoreRoleLanding(), 50);
      }
      return;
    }
    this.globalData.roleLandingRestoreRetries = 0;
    const current = pages[pages.length - 1].route || '';
    const rootRoutes = new Set(['pages/index/index', 'pages/mine/mine']);
    const navigation = require('./utils/identity-navigation.js');
    const identity = {
      ...this.globalData.userInfo,
      ...((this.globalData.bootstrap && this.globalData.bootstrap.current) || {})
    };
    if (navigation.isScanLandingRoute(current)) {
      const scene = navigation.currentEnterScene(
        this.globalData.launchOptions && this.globalData.launchOptions.scene
      );
      if (!navigation.shouldLeaveScanLanding(current, identity, scene)) return;
    } else if (!rootRoutes.has(current)) {
      return;
    }
    if (!navigation.navigateToRoleLanding(identity)) return;
    this.globalData.roleLandingRedirected = true;
  },
  guardCurrentRoute() {
    if (this.globalData.deepLinkRedirecting || !this.globalData.bootstrap) return;
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const current = pages.length ? `/${pages[pages.length - 1].route}` : '';
    if (!current || current.includes('/login') || current.includes('/identity-recovery') || current.includes('/onboarding') || current.includes('/enterprise-register') || current.includes('/free-design-service')) return;
    const navigation = require('./utils/identity-navigation.js');
    const result = navigation.guardDeepLink(current, this.globalData.bootstrap);
    if (result.allowed || !result.redirectPath || result.redirectPath === current) return;
    this.globalData.deepLinkRedirecting = true;
    wx.reLaunch({
      url: result.redirectPath,
      complete: () => { this.globalData.deepLinkRedirecting = false; }
    });
  },
  refreshCustomTabBar() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = pages.length ? pages[pages.length - 1] : null;
    if (!page) return;
    if (typeof page.getTabBar === 'function') {
      const tabBar = page.getTabBar();
      if (tabBar && typeof tabBar.syncSelected === 'function') tabBar.syncSelected();
    }
    if (typeof page.selectComponent === 'function') {
      const embedded = page.selectComponent('custom-tab-bar');
      if (embedded && typeof embedded.syncSelected === 'function') embedded.syncSelected();
    }
  },
  refreshMineRoleGuideEntry() {
    const pages = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
    const page = pages.length ? pages[pages.length - 1] : null;
    if (page && typeof page.refreshRoleGuideEntry === 'function') {
      page.refreshRoleGuideEntry();
    }
  },
  handleReferral(options) {
    const query = options.query || {};
    let eid = query.eid || query.enterpriseId;
    let sid = query.sid || query.staffId;

    // Handle scene for QR Code
    if (options.scene && options.query.scene) {
      const scene = decodeURIComponent(options.query.scene);
      // Expected format: eid=123&sid=456
      const params = {};
      scene.split('&').forEach(p => {
        const [k, v] = p.split('=');
        params[k] = v;
      });
      eid = eid || params.eid;
      sid = sid || params.sid;
    }

    if (eid) {
      this.globalData.referral.enterpriseId = eid;
      console.log('Detected referral Enterprise:', eid);
    }
    if (sid) {
      this.globalData.referral.staffId = sid;
      console.log('Detected referral Staff:', sid);
    }
  },

  // 自动同步专业版身份（如果是员工登录，则海报和线索默认指向自己）
  syncProfessionalContext() {
    const userInfo = this.globalData.userInfo;
    const isStaff = userInfo && userInfo.role === 'staff';
    const isPlatformSales = userInfo && userInfo.staffRole === 'salesperson';

    if (isStaff || isPlatformSales) {
      // 平台地推没有企业 ID，但仍需同步 staffId
      if (userInfo.enterpriseId || isPlatformSales) {
        this.globalData.referral = {
          enterpriseId: userInfo.enterpriseId || '',
          staffId: userInfo.staffId || ''
        };
        console.log('App: Professional context synced to self');
      }
    }
    
    // 如果有企业 ID，同步品牌信息
    if (this.globalData.referral.enterpriseId) {
      this.syncBranding(this.globalData.referral.enterpriseId);
    }
  },

  async syncBranding(enterpriseId) {
    try {
      // Keep this compatible with both the normal CommonJS API export and
      // WeChat's occasionally wrapped module shape after a hot reload.
      const request = resolveApiRequest(api);
      if (typeof request !== 'function') {
        throw new TypeError('Mini Program API request method is unavailable');
      }

      const res = await request(`/branding/${enterpriseId}`, 'GET');
      if (res.success && res.data) {
        this.globalData.branding = res.data;
        console.log('App: Branding synced:', res.data);
        // 通知当前页面更新（如果需要）
        const pages = getCurrentPages();
        if (pages.length > 0) {
          const currentPage = pages[pages.length - 1];
          if (currentPage.onBrandingReady) {
            currentPage.onBrandingReady(res.data);
          }
        }
      }
    } catch (err) {
      console.error('App: Failed to sync branding:', err);
    }
  }
});
