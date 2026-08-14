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
    qrError: false,
    qrRefreshing: false
  },

  lifetimes: {
    detached() {
      if (this._retryTimer) clearTimeout(this._retryTimer);
    }
  },

  methods: {
    buildQrImageUrl(profile) {
      const signedUrl = profile && profile.wechatQrUrl ? String(profile.wechatQrUrl) : '';
      if (!signedUrl) return '';
      // The signature does not cover this client-only cache key. It lets a QR
      // retry bypass WeChat's cached failed image response even when a new
      // signature is generated within the same second.
      return `${signedUrl}${signedUrl.includes('?') ? '&' : '?'}_qrRetry=${Date.now()}`;
    },

    prepareProfile(profile) {
      const qrSourceUrl = this.buildQrImageUrl(profile);
      if (this._retryTimer) {
        clearTimeout(this._retryTimer);
        this._retryTimer = null;
      }
      this._qrRequestId = (this._qrRequestId || 0) + 1;
      const requestId = this._qrRequestId;
      this.setData({
        qrImageUrl: '',
        qrLoading: Boolean(qrSourceUrl),
        qrError: false,
        qrRefreshing: false
      });
      if (qrSourceUrl) this.fetchQrToLocalFile(qrSourceUrl, requestId, profile);
    },

    fetchQrToLocalFile(url, requestId, profile) {
      wx.request({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        success: (response) => {
          if (response.statusCode !== 200 || !response.data) {
            this.handleQrFetchFailure(requestId, `HTTP ${response.statusCode}`);
            return;
          }
          const contentType = String(response.header && (response.header['content-type'] || response.header['Content-Type']) || '');
          const extension = contentType.includes('png') ? 'png' : 'jpg';
          const profileId = String(profile && (profile._id || profile.id) || 'current').replace(/[^a-zA-Z0-9_-]/g, '');
          const filePath = `${wx.env.USER_DATA_PATH}/designer-qr-${profileId || 'current'}.${extension}`;
          wx.getFileSystemManager().writeFile({
            filePath,
            data: response.data,
            success: () => {
              if (requestId !== this._qrRequestId) return;
              this.setData({ qrImageUrl: filePath, qrLoading: false, qrError: false, qrRefreshing: false });
            },
            fail: (error) => this.handleQrFetchFailure(requestId, error && error.errMsg || '写入二维码临时文件失败')
          });
        },
        fail: (error) => this.handleQrFetchFailure(requestId, error && error.errMsg || '二维码请求失败')
      });
    },

    handleQrFetchFailure(requestId, reason) {
      if (requestId !== this._qrRequestId) return;
      console.warn('Failed to fetch designer QR image', reason);
      this.setData({ qrImageUrl: '', qrLoading: false, qrError: true, qrRefreshing: false });
    },

    onClose() {
      this.triggerEvent('close');
    },

    onSheetTap() {},

    onQrLoad() {
      this.setData({ qrLoading: false, qrError: false });
    },

    onQrError() {
      if (this.data.qrRefreshing) return;
      this.setData({ qrLoading: false, qrError: true });
    },

    onRetryQr() {
      if (this.data.qrRefreshing) return;
      // Unmount the failed image and wait for the parent to return a newly
      // signed URL. Otherwise WeChat can immediately retry its cached failure.
      this.setData({
        qrImageUrl: '',
        qrLoading: true,
        qrError: false,
        qrRefreshing: true
      });
      this.triggerEvent('retry');
      this._retryTimer = setTimeout(() => {
        if (!this.data.qrRefreshing) return;
        this.setData({ qrLoading: false, qrError: true, qrRefreshing: false });
        this._retryTimer = null;
      }, 10000);
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
