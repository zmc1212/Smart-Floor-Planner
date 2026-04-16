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
    // No longer auto-login; user must login via phone number on "我的" page
  }
});
