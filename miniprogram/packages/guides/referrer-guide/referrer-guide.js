const { guideSlideState, markRoleGuideSeen, shouldCompleteGuideInCurrentRole } = require('../../../utils/roleGuide.js');

const REFERRER_GUIDE_SLIDES = Object.freeze([
  Object.freeze({
    image: '/packages/guides/assets/referrer-v1/service-code.png',
    imageClass: 'service-code-art',
    title: '一张服务码，开始推荐',
    description: '选择已加入的装修公司，出示推广服务码，\n让有装修需求的客户扫码领取服务。',
    assurance: ''
  }),
  Object.freeze({
    image: '/packages/guides/assets/referrer-v1/progress.png',
    imageClass: 'progress-art',
    title: '服务进展，清楚可见',
    description: '在「客户」中查看客户处于已预约、量房、\n方案发布或已签约等阶段。',
    assurance: '仅展示脱敏服务进度'
  }),
  Object.freeze({
    image: '/packages/guides/assets/referrer-v1/earnings.png',
    imageClass: 'earnings-art',
    title: '客户签约，收益有记录',
    description: '属于你的客户签约后，可以在「收益」中\n查看本人提成和发放状态。',
    assurance: '客户隐私始终受到保护'
  })
]);

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

function bootstrapMembershipId() {
  const app = typeof getApp === 'function' ? getApp() : null;
  return String(
    app && app.globalData && app.globalData.bootstrap && app.globalData.bootstrap.current
      && app.globalData.bootstrap.current.context
      && app.globalData.bootstrap.current.context.referrerMembershipId
      || ''
  );
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    currentStep: 0,
    totalSteps: REFERRER_GUIDE_SLIDES.length,
    steps: [0, 1, 2],
    slides: REFERRER_GUIDE_SLIDES,
    activeSlide: REFERRER_GUIDE_SLIDES[0],
    membershipId: '',
    source: ''
  },

  onLoad(options = {}) {
    this.setData({
      ...navigationMetrics(),
      membershipId: String(options.membershipId || bootstrapMembershipId()),
      source: String(options.source || '')
    });
    markRoleGuideSeen('referrer');
  },

  onSkip() {
    this.leaveGuide();
  },

  goToStep(step) {
    const next = guideSlideState(REFERRER_GUIDE_SLIDES, step);
    if (next.currentStep === this.data.currentStep) return;
    this.setData(next);
  },

  onSwiperChange(event) {
    this.goToStep(event && event.detail ? event.detail.current : this.data.currentStep);
  },

  onDotTap(event) {
    this.goToStep(event && event.currentTarget && event.currentTarget.dataset
      ? event.currentTarget.dataset.index
      : this.data.currentStep);
  },

  onPrimary() {
    if (this.data.currentStep < REFERRER_GUIDE_SLIDES.length - 1) {
      this.goToStep(this.data.currentStep + 1);
      return;
    }
    this.openServiceCode();
  },

  openServiceCode() {
    if (!shouldCompleteGuideInCurrentRole('referrer')) {
      this.leaveGuide();
      return;
    }
    const membershipId = this.data.membershipId || bootstrapMembershipId();
    if (!membershipId) {
      wx.reLaunch({ url: '/packages/business/referrer-workbench/referrer-workbench' });
      return;
    }
    wx.redirectTo({
      url: `/packages/business/promotion-service-code/promotion-service-code?membershipId=${encodeURIComponent(membershipId)}`,
      fail: () => wx.reLaunch({ url: '/packages/business/referrer-workbench/referrer-workbench' })
    });
  },

  leaveGuide() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/packages/business/referrer-workbench/referrer-workbench' })
    });
  }
});
