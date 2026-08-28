const { guideSlideState, markRoleGuideSeen, shouldCompleteGuideInCurrentRole } = require('../../../utils/roleGuide.js');

const ENTERPRISE_GUIDE_SLIDES = Object.freeze([
  Object.freeze({
    image: '/packages/guides/assets/enterprise-owner-v1/activity-code.png',
    imageClass: 'activity-code-art',
    title: '一张活动码，开始获客',
    description: '把活动码发给客户，客户扫码提交装修需求，\n线索会进入门店待分配。',
    assurance: ''
  }),
  Object.freeze({
    image: '/packages/guides/assets/enterprise-owner-v1/team-onboarding.png',
    imageClass: 'team-onboarding-art',
    title: '邀请伙伴，建立服务团队',
    description: '向员工和推广人出示对应入驻码，\n扫码即可加入你的门店。',
    assurance: '不同身份使用对应入驻码'
  }),
  Object.freeze({
    image: '/packages/guides/assets/enterprise-owner-v1/operations-priority.png',
    imageClass: 'operations-priority-art',
    title: '经营全盘，异常优先处理',
    description: '在「经营」查看线索、量房、方案和签约进度，\n优先处理待派单与过期预约。',
    assurance: '经营数据仅限本企业'
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
    totalSteps: ENTERPRISE_GUIDE_SLIDES.length,
    steps: [0, 1, 2],
    slides: ENTERPRISE_GUIDE_SLIDES,
    activeSlide: ENTERPRISE_GUIDE_SLIDES[0],
    source: ''
  },

  onLoad(options = {}) {
    this.setData({ ...navigationMetrics(), source: String(options.source || '') });
    markRoleGuideSeen('enterprise_admin');
  },

  onSkip() { this.leaveGuide(); },

  goToStep(step) {
    const next = guideSlideState(ENTERPRISE_GUIDE_SLIDES, step);
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
    if (this.data.currentStep < ENTERPRISE_GUIDE_SLIDES.length - 1) {
      this.goToStep(this.data.currentStep + 1);
      return;
    }
    this.openActivityCode();
  },

  openActivityCode() {
    if (!shouldCompleteGuideInCurrentRole('enterprise_admin')) {
      this.leaveGuide();
      return;
    }
    wx.redirectTo({
      url: '/packages/business/staff-activity-code/staff-activity-code',
      fail: () => wx.reLaunch({ url: '/pages/index/index' })
    });
  },

  leaveGuide() {
    wx.navigateBack({ delta: 1, fail: () => wx.reLaunch({ url: '/pages/index/index' }) });
  }
});
