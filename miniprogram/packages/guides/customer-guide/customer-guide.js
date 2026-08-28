const { guideSlideState } = require('../../../utils/roleGuide.js');

const CUSTOMER_GUIDE_SLIDES = Object.freeze([
  Object.freeze({
    image: '/packages/guides/assets/customer-v1/three-free-benefits.png',
    imageClass: 'three-free-art',
    title: '三个免费，装修更省心',
    description: '免费效果图、免费家装设计顾问和免费家装现场顾问，都能在这里找到。',
    assurance: '三项服务不收费'
  }),
  Object.freeze({
    image: '/packages/guides/assets/customer-v1/home-archive.png',
    imageClass: 'home-archive-art',
    title: '把装修想法说清楚',
    description: '把喜欢的风格、房间和需要解决的问题告诉我们，服务从你的需求开始。',
    assurance: '先了解，再决定下一步'
  }),
  Object.freeze({
    image: '/packages/guides/assets/customer-v1/service-route.png',
    imageClass: 'service-route-art',
    title: '专业服务陪你走三步',
    description: '从需求沟通、预约量房到方案沟通，每一步都有清晰的服务安排。',
    assurance: '以实际服务进度为准'
  }),
  Object.freeze({
    image: '/packages/guides/assets/customer-v1/service-archive.png',
    imageClass: 'service-archive-art',
    title: '服务进度都在这里',
    description: '服务进度、户型档案与设计方案，会在你的服务档案中持续更新。',
    assurance: '三个免费服务，进度持续可看'
  })
]);

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    currentStep: 0,
    totalSteps: CUSTOMER_GUIDE_SLIDES.length,
    steps: [0, 1, 2, 3],
    slides: CUSTOMER_GUIDE_SLIDES,
    activeSlide: CUSTOMER_GUIDE_SLIDES[0]
  },

  onLoad() {
    this.setData(navigationMetrics());
  },

  onSkip() { this.leaveGuide(); },

  goToStep(step) {
    const next = guideSlideState(CUSTOMER_GUIDE_SLIDES, step);
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
    if (this.data.currentStep < CUSTOMER_GUIDE_SLIDES.length - 1) {
      this.goToStep(this.data.currentStep + 1);
      return;
    }
    this.leaveGuide();
  },

  leaveGuide() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/index/index' })
    });
  }
});
