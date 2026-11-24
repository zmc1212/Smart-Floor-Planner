const { serviceEntryCode, openPromotionChat } = require('../../../utils/service-entry');

Page({
  data: { errorMessage: '' },

  onLoad(options = {}) {
    this.promotionCode = serviceEntryCode(options.entryCode || options.token || options.scene);
    return this.onRetry();
  },

  onRetry() {
    if (!this.promotionCode) {
      this.setData({ errorMessage: '未识别到有效推广码，请重新扫码。' });
      return;
    }
    this.setData({ errorMessage: '' });
    return openPromotionChat(this.promotionCode, () => this.setData({ errorMessage: '暂时无法打开小K，请重试。' }));
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  }
});
