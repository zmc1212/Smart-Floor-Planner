App({
  globalData: {
    aiConfig: {
      pollinationsImageUrl: 'https://image.pollinations.ai/prompt/',
      pollinationsGenUrl: 'https://gen.pollinations.ai',
      pollinationsChatUrl: 'https://gen.pollinations.ai/v1/chat/completions'
    },
    currentAIGenRoom: null,
    userInfo: null,
    openid: null,
    referral: {
      enterpriseId: null,
      staffId: null
    }
  },
  onLaunch(options) {
    console.log('智能量房大师小程序启动', options);
    this.handleReferral(options);
    
    // 2. 从本地缓存恢复用户信息并同步专业属性
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      this.syncProfessionalContext();
    }
    
    // Restore session from storage
    const openid = wx.getStorageSync('openid');
    if (openid && userInfo) {
      this.globalData.openid = openid;
      this.globalData.userInfo = userInfo;
      console.log('会话已恢复:', openid);
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
    if (userInfo && userInfo.role === 'staff' && userInfo.enterpriseId) {
      if (!this.globalData.referral.enterpriseId || this.globalData.referral.enterpriseId === userInfo.enterpriseId) {
        this.globalData.referral = {
          enterpriseId: userInfo.enterpriseId,
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
