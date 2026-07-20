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
    justLoggedIn: false
  },
  onLaunch(options) {
    console.log('智能量房大师小程序启动', options);
    this.handleReferral(options);
    
    // 1. Restore session from storage (Priority: Token)
    const token = wx.getStorageSync('token');
    const userInfo = wx.getStorageSync('userInfo');
    const openid = wx.getStorageSync('openid'); // Legacy fallback

    if (token && userInfo) {
      this.globalData.token = token;
      this.globalData.userInfo = userInfo;
      this.globalData.openid = openid || (userInfo.openid);
      console.log('会话已恢复 (JWT):', userInfo.displayName || userInfo.username);
      this.syncProfessionalContext();
    } else if (openid && userInfo) {
      // Legacy session recovery
      this.globalData.openid = openid;
      this.globalData.userInfo = userInfo;
      console.log('会话已恢复 (Legacy OpenID):', openid);
      this.syncProfessionalContext();
    }

    // 3. Silent Bluetooth Reconnection (静默自动重连)
    const bluetooth = require('./utils/bluetooth.js');
    if (this.globalData.openid && bluetooth.hasRememberedDevice && bluetooth.hasRememberedDevice()) {
      bluetooth.autoConnectBLE(
        () => {}, // 测量回调由具体页面在 onShow 中重绑定
        (success) => {
          this.globalData.bleConnected = success;
          console.log('App: 静默蓝牙重连结果:', success);
          // 通知当前活跃页面更新状态（主要用于更新首页呼吸灯等 UI）
          const pages = getCurrentPages();
          if (pages.length > 0) {
            const currentPage = pages[pages.length - 1];
            if (success && currentPage.onBLESuccess) {
              currentPage.onBLESuccess();
            } else if (!success && currentPage.onBluetoothDisconnect) {
              currentPage.onBluetoothDisconnect();
            }
          }
        },
        () => {
          this.globalData.bleConnected = false;
          const pages = getCurrentPages();
          if (pages.length > 0) {
            const currentPage = pages[pages.length - 1];
            if (currentPage.onBluetoothDisconnect) currentPage.onBluetoothDisconnect();
          }
        },
        true // silent: true 开启静默模式，无弹窗和提示
      );
    }
  },
  onShow(options) {
    this.handleReferral(options);
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
    const api = require('./utils/api.js');
    try {
      const res = await api.request(`/branding/${enterpriseId}`, 'GET');
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
