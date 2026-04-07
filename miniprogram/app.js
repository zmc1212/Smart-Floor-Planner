App({
  globalData: {
    aiConfig: {
      pollinationsImageUrl: 'https://image.pollinations.ai/prompt/',
      pollinationsGenUrl: 'https://gen.pollinations.ai',
      pollinationsChatUrl: 'https://gen.pollinations.ai/v1/chat/completions'
    }
  },
  onLaunch() {
    console.log('智能量房大师小程序启动');
  }
});
