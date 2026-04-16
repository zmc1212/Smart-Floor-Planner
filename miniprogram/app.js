App({
  globalData: {
    aiConfig: {
      pollinationsImageUrl: 'https://image.pollinations.ai/prompt/',
      pollinationsGenUrl: 'https://gen.pollinations.ai',
      pollinationsChatUrl: 'https://gen.pollinations.ai/v1/chat/completions'
    },
    currentAIGenRoom: null,
    userInfo: null,
    openid: null
  },
  onLaunch() {
    console.log('智能量房大师小程序启动');
    // Restore session from storage
    const openid = wx.getStorageSync('openid');
    const userInfo = wx.getStorageSync('userInfo');
    if (openid && userInfo) {
      this.globalData.openid = openid;
      this.globalData.userInfo = userInfo;
      console.log('会话已恢复:', openid);
    }
  }
});
