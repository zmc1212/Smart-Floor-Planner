const { parseWebviewOptions } = require('../../../utils/legal-docs.js');

Page({
  data: {
    url: ''
  },

  onLoad(options) {
    const parsed = parseWebviewOptions(options);
    if (!parsed.url) {
      wx.showToast({ title: '链接无效', icon: 'none' });
      return;
    }

    this.setData({ url: parsed.url });
    wx.setNavigationBarTitle({ title: parsed.title });
  }
});
