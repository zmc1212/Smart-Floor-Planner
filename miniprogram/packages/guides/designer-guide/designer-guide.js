const { guideSlideState, markRoleGuideSeen, shouldCompleteGuideInCurrentRole } = require('../../../utils/roleGuide.js');

const DESIGNER_GUIDE_SLIDES = Object.freeze([
  Object.freeze({
    image: '/packages/guides/assets/designer-advisor-v1/lead-claim.png',
    imageClass: 'lead-claim-art',
    title: '先接住合适的客户',
    description: '在「客户」中查看新需求，及时领取合适客户，\n不错过每一个装修机会。',
    assurance: ''
  }),
  Object.freeze({
    image: '/packages/guides/assets/designer-advisor-v1/survey-sync.png',
    imageClass: 'survey-sync-art',
    title: '量房资料自动接上',
    description: '量房完成后，资料自动关联到客户，\n方案准备更高效，流程不断档。',
    assurance: '仅使用已完成量房资料'
  }),
  Object.freeze({
    image: '/packages/guides/assets/designer-advisor-v1/scheme-delivery.png',
    imageClass: 'scheme-delivery-art',
    title: '方案交付，收益有记录',
    description: '方案交付给客户后，可在「收益」中\n查看收益进度，付出看得见。',
    assurance: '收益状态以系统记录为准'
  })
]);

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10)
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    currentStep: 0,
    totalSteps: DESIGNER_GUIDE_SLIDES.length,
    steps: [0, 1, 2],
    slides: DESIGNER_GUIDE_SLIDES,
    activeSlide: DESIGNER_GUIDE_SLIDES[0],
    source: ''
  },

  onLoad(options = {}) {
    this.setData({ ...navigationMetrics(), source: String(options.source || '') });
    markRoleGuideSeen('designer');
  },

  onSkip() { this.leaveGuide(); },

  goToStep(step) {
    const next = guideSlideState(DESIGNER_GUIDE_SLIDES, step);
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
    if (this.data.currentStep < DESIGNER_GUIDE_SLIDES.length - 1) {
      this.goToStep(this.data.currentStep + 1);
      return;
    }
    this.openEarnings();
  },

  openEarnings() {
    if (!shouldCompleteGuideInCurrentRole('designer')) {
      this.leaveGuide();
      return;
    }
    wx.redirectTo({
      url: '/packages/business/staff-earnings/staff-earnings',
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  },

  leaveGuide() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  }
});
