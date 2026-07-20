Page({
  onLoad(options) {
    const query = Object.keys(options || {})
      .filter((key) => options[key])
      .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(options[key])}`)
      .join('&');
    wx.redirectTo({ url: `/pages/ai-design/ai-design${query ? `?${query}` : ''}` });
  },
});
