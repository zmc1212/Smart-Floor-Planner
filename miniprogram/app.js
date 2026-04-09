const api = require('./utils/api.js');

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
    this.login();
  },
  async login() {
    try {
      const res = await api.wechatLogin();
      this.globalData.openid = res.openid;
      this.globalData.userInfo = res.user;
      console.log('Login success, openid:', res.openid);
    } catch (err) {
      console.error('Failed to log in:', err);
    }
  }
});
