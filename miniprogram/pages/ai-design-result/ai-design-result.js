const aiService = require('../../utils/aiDesignService.js');

const MODE_TITLES = {
  reference_recreate: '参考图复刻',
  style_transform: '空间换风格',
  floor_plan_render: '户型生成',
  soft_furnishing: '软装深化',
};

Page({
  data: {
    id: '',
    task: null,
    loading: true,
    running: false,
    comparePercent: 50,
    pageScrollTop: 0,
  },

  onLoad(options) {
    this.shouldRun = options.run === '1';
    this.setData({ id: options.id || '' });
    if (!options.id) {
      wx.showToast({ title: '任务参数错误', icon: 'none' });
      return;
    }
    this.loadTask();
  },

  onShow() {
    this.resetPageScroll();
  },

  resetPageScroll() {
    this.setData({ pageScrollTop: 1 }, () => {
      wx.nextTick(() => this.setData({ pageScrollTop: 0 }));
    });
  },

  onUnload() {
    this.stopPolling();
    this.compareRect = null;
  },

  async loadTask() {
    try {
      const response = await aiService.getTask(this.data.id);
      const task = { ...response, modeTitle: MODE_TITLES[response.mode] || 'AI 设计' };
      this.setData({ task, loading: false });
      if (task.status === 'succeeded') this.resetPageScroll();
      if (this.shouldRun && task.status === 'created' && !this.data.running) {
        this.shouldRun = false;
        this.startRun();
      } else if (task.status === 'created' || task.status === 'processing') {
        this.startPolling();
      } else {
        this.stopPolling();
      }
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: error.error || '读取任务失败', icon: 'none' });
    }
  },

  startRun() {
    if (this.data.running) return;
    this.setData({ running: true });
    this.startPolling();
    aiService.runTask(this.data.id)
      .then((task) => {
        this.setData({ task: { ...task, modeTitle: MODE_TITLES[task.mode] || 'AI 设计' }, running: false });
        if (task.status !== 'processing') this.stopPolling();
      })
      .catch(() => {
        this.setData({ running: false });
        setTimeout(() => this.loadTask(), 800);
      });
  },

  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.loadTask(), 2500);
  },

  stopPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  },

  handleCompareTouch(event) {
    const touch = event.touches && event.touches[0];
    if (!touch) return;

    const updatePercent = (rect) => {
      if (!rect || !rect.width) return;
      const percent = Math.max(5, Math.min(95, ((touch.clientX - rect.left) / rect.width) * 100));
      this.setData({ comparePercent: Math.round(percent) });
    };

    if (this.compareRect) {
      updatePercent(this.compareRect);
      return;
    }

    wx.createSelectorQuery().in(this).select('.compare-stage').boundingClientRect((rect) => {
      this.compareRect = rect || null;
      updatePercent(rect);
    }).exec();
  },

  previewResult() {
    const task = this.data.task;
    if (task && task.resultImageUrl) wx.previewImage({ urls: [task.resultImageUrl], current: task.resultImageUrl });
  },

  saveResult() {
    const task = this.data.task;
    if (!task || !task.resultImageUrl) return;
    wx.showLoading({ title: '保存中...' });
    wx.downloadFile({
      url: task.resultImageUrl,
      success: (download) => {
        if (download.statusCode !== 200) {
          wx.showToast({ title: '图片下载失败', icon: 'none' });
          return;
        }
        wx.saveImageToPhotosAlbum({
          filePath: download.tempFilePath,
          success: () => wx.showToast({ title: '已保存到相册', icon: 'success' }),
          fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' }),
        });
      },
      fail: () => wx.showToast({ title: '图片下载失败', icon: 'none' }),
      complete: () => wx.hideLoading(),
    });
  },

  async retry() {
    if (this.data.running) return;
    this.setData({ running: true });
    try {
      const task = await aiService.retryTask(this.data.id);
      this.setData({ task: { ...task, modeTitle: MODE_TITLES[task.mode] || 'AI 设计' }, running: false });
      this.startPolling();
    } catch (error) {
      this.setData({ running: false });
      wx.showToast({ title: error.error || '重试失败', icon: 'none' });
    }
  },

  reuseInputs() {
    const task = this.data.task;
    if (!task) return;
    wx.navigateTo({ url: `/pages/ai-design-create/ai-design-create?mode=${task.mode}&sourceTaskId=${task.id}` });
  },

  continueWorkflow() {
    const task = this.data.task;
    if (!task) return;
    const nextMode = task.nextStageKey === 'soft_furnishing'
      ? 'soft_furnishing'
      : task.nextStageKey === 'base_render'
        ? 'style_transform'
        : task.mode;
    wx.navigateTo({ url: `/pages/ai-design-create/ai-design-create?mode=${nextMode}&sourceTaskId=${task.id}` });
  },

  handlePrimaryAction() {
    const task = this.data.task;
    if (task && task.workflowId && ['proposal_pack', 'lighting'].includes(task.nextStageKey)) {
      wx.showModal({
        title: '请到后台继续深化',
        content: task.nextStageKey === 'proposal_pack'
          ? '当前方案已具备提案条件，请在后台 AI 设计工作台继续生成提案。'
          : '灯光深化属于后台高级能力，请在后台 AI 设计工作台继续。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }
    if (task && task.workflowId && ['soft_furnishing', 'base_render'].includes(task.nextStageKey)) {
      this.continueWorkflow();
      return;
    }
    this.reuseInputs();
  },

  openHistory() {
    wx.navigateTo({ url: '/pages/ai-design-history/ai-design-history' });
  },

  onShareAppMessage() {
    const task = this.data.task || {};
    return {
      title: `${task.modeTitle || 'AI 设计'}成果`,
      path: `/pages/ai-design-result/ai-design-result?id=${this.data.id}`,
      imageUrl: task.resultImageUrl || '',
    };
  },
});
