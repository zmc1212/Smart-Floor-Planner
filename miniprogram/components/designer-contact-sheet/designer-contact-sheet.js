const {
  loadDesignerQrToTempFile,
  copyDesignerWechatId,
} = require('../../utils/designerContact.js');
const { openSheet, closeSheet, clearSheetTimer } = require('../../utils/sheetMotion.js');

const DIALOG_KEYS = Object.freeze({
  mountedKey: 'dialogMounted',
  openKey: 'dialogOpen',
});

function readCapsuleBottom() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const statusBarHeight = Number(windowInfo.statusBarHeight || 0);
  const menuTop = Number((menuRect && menuRect.top) || statusBarHeight + 6);
  const menuHeight = Number((menuRect && menuRect.height) || 32);
  return Math.ceil(Number((menuRect && menuRect.bottom) || menuTop + menuHeight));
}

function isCustomTabBarVisible() {
  try {
    const pages = getCurrentPages();
    const page = pages && pages.length ? pages[pages.length - 1] : null;
    if (!page || typeof page.getTabBar !== 'function') return false;
    const tabBar = page.getTabBar();
    if (!tabBar || !tabBar.data || tabBar.data.suppressed) return false;
    return Array.isArray(tabBar.data.list) && tabBar.data.list.length > 0;
  } catch (error) {
    return false;
  }
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
    },
    designer: {
      type: Object,
      value: null,
    },
  },

  data: {
    dialogMounted: false,
    dialogOpen: false,
    capsuleBottom: 84,
    aboveTabBar: false,
    displayName: '专属家装设计顾问',
    wechatId: '',
    hasQr: false,
    qrPath: '',
    qrLoading: false,
    qrError: false,
    professionalTitleVisible: false,
    professionalTitle: '',
    professionalExperienceLabel: '',
    professionalServiceLabel: '',
  },

  observers: {
    'visible, designer'(visible, designer) {
      if (visible) {
        this.syncHostSafeArea();
        this.syncDesigner(designer);
        openSheet(this, DIALOG_KEYS);
        return;
      }
      closeSheet(this, DIALOG_KEYS);
    },
  },

  lifetimes: {
    attached() {
      this.syncHostSafeArea();
    },

    detached() {
      this._qrRequestId = (this._qrRequestId || 0) + 1;
      clearSheetTimer(this, DIALOG_KEYS.openKey);
    },
  },

  methods: {
    noop() {},

    syncHostSafeArea() {
      this.setData({
        capsuleBottom: readCapsuleBottom(),
        aboveTabBar: isCustomTabBarVisible(),
      });
    },

    syncDesigner(designer) {
      const wechatId = String((designer && designer.wechatId) || '').trim();
      const wechatQrUrl = designer && designer.wechatQrUrl ? String(designer.wechatQrUrl) : '';
      const displayName = String((designer && designer.displayName) || '').trim() || '专属家装设计顾问';
      const professionalProfile = designer && designer.professionalProfile && typeof designer.professionalProfile === 'object'
        ? designer.professionalProfile
        : null;
      const hasQr = Boolean(wechatQrUrl);
      this.setData({
        displayName,
        wechatId,
        hasQr,
        qrPath: '',
        qrLoading: hasQr,
        qrError: false,
        professionalTitleVisible: Boolean(professionalProfile && professionalProfile.titleVisible && professionalProfile.title),
        professionalTitle: String((professionalProfile && professionalProfile.title) || '').trim(),
        professionalExperienceLabel: String((professionalProfile && professionalProfile.experienceLabel) || '').trim(),
        professionalServiceLabel: String((professionalProfile && professionalProfile.serviceLabel) || '').trim(),
      });
      if (hasQr) {
        this.loadQr(wechatQrUrl);
      }
    },

    async loadQr(url) {
      const requestId = (this._qrRequestId || 0) + 1;
      this._qrRequestId = requestId;
      this.setData({ qrLoading: true, qrError: false, qrPath: '' });
      try {
        const designer = this.properties.designer;
        const cacheKey = String((designer && designer.id) || 'assigned');
        const qrPath = await loadDesignerQrToTempFile(url, cacheKey);
        if (requestId !== this._qrRequestId) return;
        this.setData({ qrPath, qrLoading: false, qrError: false });
      } catch (error) {
        if (requestId !== this._qrRequestId) return;
        console.warn('Failed to load designer WeChat QR', error);
        this.setData({ qrPath: '', qrLoading: false, qrError: true });
      }
    },

    onRetryQr() {
      const designer = this.properties.designer;
      const url = designer && designer.wechatQrUrl;
      if (url) this.loadQr(url);
    },

    onPreviewQr() {
      const { qrPath } = this.data;
      if (!qrPath) return;
      wx.previewImage({ current: qrPath, urls: [qrPath] });
    },

    onCopyWechat() {
      const { wechatId, hasQr } = this.data;
      if (!wechatId) return;
      copyDesignerWechatId(wechatId, { withSearchHint: !hasQr }).catch(() => {
        wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' });
      });
    },

    onClose() {
      this.triggerEvent('close');
    },
  },
});
