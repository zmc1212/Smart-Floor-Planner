const { guideSlideState, markRoleGuideSeen } = require('../../../utils/roleGuide.js');

const MEASURER_GUIDE_SLIDES = Object.freeze([
  Object.freeze({
    image: '/packages/guides/assets/measurer-v1/measurement-bench.png',
    imageClass: 'measurement-bench-art',
    title: '连接测距仪，量房更顺手',
    description: '在工作台连接激光测距仪，读数会按毫米记录，\n现场测量少一步手动抄写。',
    assurance: '设备状态随时可查看'
  }),
  Object.freeze({
    image: '/packages/guides/assets/measurer-v1/measurement-path.png',
    imageClass: 'measurement-path-art',
    title: '沿着墙线量，户型自动成形',
    description: '从起点开始逐墙采集尺寸，按提示完成转角与闭合，\n正式户型会跟着你的测量路径建立。',
    assurance: '手动读数与蓝牙读数都留有记录'
  }),
  Object.freeze({
    image: '/packages/guides/assets/measurer-v1/measurement-complete.png',
    imageClass: 'measurement-complete-art',
    title: '量房完成，资料可交付',
    description: '保存并确认完成量房，设计顾问即可继续方案，\n客户也能看到真实的服务进度。',
    assurance: '数据仅用于当前客户服务'
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
    totalSteps: MEASURER_GUIDE_SLIDES.length,
    steps: [0, 1, 2],
    stepLabels: ['连接', '量墙', '交付'],
    slides: MEASURER_GUIDE_SLIDES,
    activeSlide: MEASURER_GUIDE_SLIDES[0],
    source: ''
  },

  onLoad(options = {}) {
    this.setData({ ...navigationMetrics(), source: String(options.source || '') });
    markRoleGuideSeen('measurer');
  },

  onSkip() { this.leaveGuide(); },

  goToStep(step) {
    const next = guideSlideState(MEASURER_GUIDE_SLIDES, step);
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
    if (this.data.currentStep < MEASURER_GUIDE_SLIDES.length - 1) {
      this.goToStep(this.data.currentStep + 1);
      return;
    }
    this.openTasks();
  },

  openTasks() {
    wx.navigateBack({
      delta: 1,
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
