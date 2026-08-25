const {
  loadDesignerQrToTempFile,
  copyDesignerWechatId,
} = require('../../utils/designerContact.js');
const { openSheet, closeSheet, clearSheetTimer } = require('../../utils/sheetMotion.js');

const DIALOG_KEYS = Object.freeze({
  mountedKey: 'dialogMounted',
  openKey: 'dialogOpen',
});

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
    displayName: '专属设计师',
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
        this.syncDesigner(designer);
        openSheet(this, DIALOG_KEYS);
        return;
      }
      closeSheet(this, DIALOG_KEYS);
    },
  },

  lifetimes: {
    detached() {
      this._qrRequestId = (this._qrRequestId || 0) + 1;
      clearSheetTimer(this, DIALOG_KEYS.openKey);
    },
  },

  methods: {
    noop() {},

    syncDesigner(designer) {
      const wechatId = String((designer && designer.wechatId) || '').trim();
      const wechatQrUrl = designer && designer.wechatQrUrl ? String(designer.wechatQrUrl) : '';
      const displayName = String((designer && designer.displayName) || '').trim() || '专属设计师';
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
