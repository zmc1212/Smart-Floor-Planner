const api = require('../../../utils/api.js');
const { navigateToRoleLanding } = require('../../../utils/identity-navigation.js');

const COPY_BY_TYPE = {
  staff: {
    title: '员工入驻码',
    subtitle: '扫码加入本企业 · 成为设计师或测量员',
    scanCopy: '请员工扫描此码',
    shareLabel: '一键分享',
    info: '扫码后授权手机号，完成员工入驻',
    promises: [
      { mark: '职', title: '员工入驻', copy: '加入本企业' },
      { mark: '岗', title: '岗位确认', copy: '设计师/测量员' },
      { mark: '开', title: '开始服务', copy: '进入工作台' }
    ]
  },
  referrer: {
    title: '推荐人入驻码',
    subtitle: '扫码成为推荐人 · 开始推广获客',
    scanCopy: '请推荐人扫描此码',
    shareLabel: '一键分享',
    info: '扫码后授权手机号，完成推荐人入驻',
    promises: [
      { mark: '推', title: '推荐入驻', copy: '加入本企业' },
      { mark: '广', title: '出示服务码', copy: '获客推广' },
      { mark: '益', title: '跟进收益', copy: '查看进度' }
    ]
  }
};

const CODE_LABELS = {
  staff: '员工入驻码',
  referrer: '推荐人入驻码'
};

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

function shareState(data, extra) {
  const merged = extra ? Object.assign({}, data, extra) : data;
  const meta = (merged.codesByType && merged.codesByType[merged.activeType]) || {};
  const shareToken = String(meta.token || '').trim();
  return {
    shareToken,
    canShare: Boolean(merged.hasActive && shareToken && !merged.loading && !merged.acting)
  };
}

function confirmModal(options) {
  // WeChat caps confirmText/cancelText at 4 characters; longer values make
  // showModal fail with no UI, which looks like a dead tap.
  const confirmText = String(options.confirmText || '确定').slice(0, 4);
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title,
      content: options.content,
      confirmText,
      confirmColor: options.destructive ? '#E11D48' : '#00C365',
      cancelText: '取消',
      success: (result) => resolve(Boolean(result.confirm)),
      fail: () => {
        wx.showToast({ title: '确认弹窗打开失败，请重试', icon: 'none' });
        resolve(false);
      }
    });
  });
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    enterpriseName: '',
    tabs: [
      { codeType: 'staff', label: '员工入驻码' },
      { codeType: 'referrer', label: '推荐人入驻码' }
    ],
    activeType: 'staff',
    activeCopy: COPY_BY_TYPE.staff,
    hasActive: true,
    codesByType: {},
    qrImagePath: '',
    shareToken: '',
    canShare: false,
    loading: true,
    acting: false,
    errorMessage: ''
  },

  onLoad() {
    this.setData(navigationMetrics());
    this.loadJoinCodes();
  },

  onUnload() {
    this.qrRequestId = (this.qrRequestId || 0) + 1;
  },

  commit(extra) {
    const next = Object.assign({}, extra, shareState(this.data, extra));
    this.setData(next);
    if (next.canShare) {
      wx.showShareMenu({ menus: ['shareAppMessage'] });
    } else if (wx.hideShareMenu) {
      wx.hideShareMenu({ menus: ['shareAppMessage'] });
    }
  },

  selectTab(event) {
    const codeType = event.currentTarget.dataset.type;
    if (!codeType || codeType === this.data.activeType || this.data.acting) return;
    this.commit({
      activeType: codeType,
      activeCopy: COPY_BY_TYPE[codeType] || COPY_BY_TYPE.staff
    });
    this.loadActiveImage();
  },

  async loadJoinCodes() {
    this.commit({ loading: true, errorMessage: '' });
    try {
      const result = await api.request('/miniprogram/enterprise-join-codes', 'GET');
      const rows = (result.data && result.data.codes) || [];
      const codesByType = {};
      rows.forEach((row) => {
        codesByType[row.codeType] = row;
      });
      this.commit({
        enterpriseName: (result.data && result.data.enterpriseName) || '',
        codesByType
      });
      await this.loadActiveImage();
    } catch (error) {
      this.commit({
        loading: false,
        hasActive: false,
        qrImagePath: '',
        errorMessage: '入驻码暂时无法读取，请检查网络后重试。'
      });
    }
  },

  async loadActiveImage() {
    const requestId = (this.qrRequestId || 0) + 1;
    this.qrRequestId = requestId;
    const codeType = this.data.activeType;
    const meta = this.data.codesByType[codeType];
    const hasActive = Boolean(meta && meta.hasActive);
    this.commit({
      loading: hasActive,
      hasActive,
      errorMessage: '',
      qrImagePath: '',
      activeCopy: COPY_BY_TYPE[codeType] || COPY_BY_TYPE.staff
    });
    if (!hasActive) {
      this.commit({ loading: false });
      return;
    }
    try {
      await this.fetchJoinCodeImage(codeType, requestId);
      if (requestId !== this.qrRequestId) return;
      this.commit({ loading: false });
    } catch (error) {
      if (requestId !== this.qrRequestId) return;
      this.commit({
        loading: false,
        qrImagePath: '',
        errorMessage: '入驻码暂时无法生成，请稍后重试。微信失败时当前码仍有效，不必换新。'
      });
    }
  },

  fetchJoinCodeImage(codeType, requestId) {
    const token = getApp().globalData.token || wx.getStorageSync('token');
    const baseUrl = api.getBaseUrls()[0];
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${baseUrl}/miniprogram/enterprise-join-codes/${encodeURIComponent(codeType)}/image?cache=${Date.now()}`,
        method: 'GET',
        responseType: 'arraybuffer',
        header: { Authorization: token ? `Bearer ${token}` : '' },
        success: (response) => {
          if (response.statusCode < 200 || response.statusCode >= 300 || !(response.data instanceof ArrayBuffer)) {
            reject(new Error('入驻码图片响应无效'));
            return;
          }
          const filePath = `${wx.env.USER_DATA_PATH}/enterprise-join-code-${codeType}.png`;
          wx.getFileSystemManager().writeFile({
            filePath,
            data: response.data,
            success: () => {
              if (requestId === this.qrRequestId) this.setData({ qrImagePath: filePath });
              resolve(filePath);
            },
            fail: reject
          });
        },
        fail: reject
      });
    });
  },

  onRetry() {
    if (this.data.acting) return;
    this.loadJoinCodes();
  },

  onGenerate() {
    this.confirmAndRotate(false);
  },

  onRotate() {
    this.confirmAndRotate(true);
  },

  async confirmAndRotate(hasActive) {
    if (this.data.acting) return;
    const codeType = this.data.activeType;
    const label = CODE_LABELS[codeType] || '入驻码';
    const accepted = await confirmModal({
      title: hasActive ? `换新${label}` : `生成${label}`,
      content: hasActive
        ? '换新后旧码立即失效。请确认已通知仍在使用旧码的人员后再继续。'
        : '将创建仅供当前企业使用的入驻码，供微信扫码入驻。',
      confirmText: hasActive ? '确认换新' : '确认生成',
      destructive: hasActive
    });
    if (!accepted) return;

    this.commit({ acting: true });
    try {
      await api.request(`/miniprogram/enterprise-join-codes/${encodeURIComponent(codeType)}/rotate`, 'POST', {});
      wx.showToast({
        title: hasActive ? `${label}已换新` : `${label}已生成`,
        icon: 'success'
      });
      await this.loadJoinCodes();
    } catch (error) {
      wx.showToast({
        title: (error && (error.error || error.message)) || (hasActive ? '换新失败' : '生成失败'),
        icon: 'none'
      });
    } finally {
      this.commit({ acting: false });
    }
  },

  async onDisable() {
    if (this.data.acting || !this.data.hasActive) return;
    const codeType = this.data.activeType;
    const label = CODE_LABELS[codeType] || '入驻码';
    const accepted = await confirmModal({
      title: `停用${label}`,
      content: '停用后不能继续用此码入驻；已建立的员工、推荐人关系和历史业务记录不会被修改。',
      confirmText: '确认停用',
      destructive: true
    });
    if (!accepted) return;

    this.commit({ acting: true });
    try {
      await api.request(`/miniprogram/enterprise-join-codes/${encodeURIComponent(codeType)}/disable`, 'POST', {});
      wx.showToast({ title: `${label}已停用`, icon: 'success' });
      await this.loadJoinCodes();
    } catch (error) {
      wx.showToast({
        title: (error && (error.error || error.message)) || '停用失败',
        icon: 'none'
      });
    } finally {
      this.commit({ acting: false });
    }
  },

  onShareAppMessage() {
    const token = this.data.shareToken;
    const enterpriseName = String(this.data.enterpriseName || '').trim();
    const title = this.data.activeType === 'staff'
      ? (enterpriseName ? `邀请加入${enterpriseName}` : '邀请加入本企业 · 成为设计师或测量员')
      : (enterpriseName ? `邀请成为${enterpriseName}推荐人` : '邀请成为本企业推荐人');
    return {
      title,
      path: token
        ? `/packages/business/onboarding/onboarding?token=${encodeURIComponent(token)}`
        : '/pages/index/index',
      imageUrl: this.data.qrImagePath || ''
    };
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) {
      wx.navigateBack({
        fail: () => this.leaveToRoleHome()
      });
      return;
    }
    this.leaveToRoleHome();
  },

  leaveToRoleHome() {
    const app = getApp();
    const identity = app && app.globalData && app.globalData.userInfo;
    if (!navigateToRoleLanding(identity)) {
      wx.switchTab({ url: '/pages/index/index' });
    }
  }
});
