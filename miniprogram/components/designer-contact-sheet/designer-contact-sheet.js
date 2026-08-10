Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(visible) {
        if (visible) this.prepareProfile(this.data.profile);
      }
    },
    profile: {
      type: Object,
      value: null,
      observer(profile) {
        this.prepareProfile(profile);
      }
    }
  },

  data: {
    qrImageUrl: '',
    qrLoading: false,
    qrError: false
  },

  methods: {
    prepareProfile(profile) {
      const qrImageUrl = profile && profile.wechatQrUrl ? String(profile.wechatQrUrl) : '';
      this.setData({
        qrImageUrl,
        qrLoading: Boolean(qrImageUrl),
        qrError: false
      });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onSheetTap() {},

    onQrLoad() {
      this.setData({ qrLoading: false, qrError: false });
    },

    onQrError() {
      this.setData({ qrLoading: false, qrError: true });
    },

    onRetryQr() {
      this.setData({ qrLoading: true, qrError: false, qrImageUrl: '' });
      this.triggerEvent('retry');
      wx.nextTick(() => {
        const profile = this.data.profile;
        this.setData({ qrImageUrl: profile && profile.wechatQrUrl ? String(profile.wechatQrUrl) : '' });
      });
    },

    onCopyWechat() {
      const profile = this.data.profile;
      const wechatId = profile && profile.wechatId ? String(profile.wechatId) : '';
      if (!wechatId) {
        wx.showToast({ title: '设计师暂未提供微信号', icon: 'none' });
        return;
      }
      wx.setClipboardData({
        data: wechatId,
        success: () => wx.showToast({ title: '微信号已复制', icon: 'success' }),
        fail: () => wx.showToast({ title: '复制失败，请稍后重试', icon: 'none' })
      });
    }
  }
});
