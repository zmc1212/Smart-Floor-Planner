const aiService = require('../../../utils/aiDesignService.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../../utils/aiDesignAccess.js');

const MODE_TITLES = {
  reference_recreate: '参考图复刻',
  style_transform: '空间换风格',
  floor_plan_render: '户型生成',
  soft_furnishing: '软装深化',
};

function decorateTask(task, project) {
  const ratioParts = String(task.outputAspectRatio || '1:1').split(':').map(Number);
  const ratio = ratioParts.length === 2 && ratioParts[0] > 0 && ratioParts[1] > 0
    ? ratioParts[0] / ratioParts[1]
    : 1;
  const isFloorPlanGeneration = task.mode === 'floor_plan_render';
  const sourceCompareImageUrl = isFloorPlanGeneration
    ? ''
    : ((task.mode === 'reference_recreate' ? task.referenceImageUrl : task.controlImageUrl)
      || task.spaceImageUrl
      || '');
  const ratioAwareHeight = Math.round(750 / ratio);
  return {
    ...task,
    projectTitle: project ? project.projectDisplayTitle : '',
    canContinueWorkflow: Boolean(
      task.workflowId
        && task.hasExactTargetContext
        && ['soft_furnishing', 'base_render'].includes(task.nextStageKey)
    ),
    modeTitle: task.recipeName || MODE_TITLES[task.mode] || 'AI 设计',
    sourceCompareImageUrl,
    showComparison: Boolean(sourceCompareImageUrl),
    preserveComposition: task.mode === 'reference_recreate',
    floorPlanCompare: Boolean(task.controlImageUrl)
      && task.mode !== 'reference_recreate'
      && !isFloorPlanGeneration,
    resultImageMode: ratio < 0.85 || ratio > 1.25 ? 'aspectFit' : 'aspectFill',
    resultStageHeight: Math.max(720, Math.min(760, ratioAwareHeight)),
  };
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: (result) => {
        if (result.statusCode === 200 && result.tempFilePath) {
          resolve(result.tempFilePath);
          return;
        }
        reject({ type: 'download', detail: result });
      },
      fail: (error) => reject({ type: 'download', detail: error }),
    });
  });
}

function saveImageToAlbum(filePath) {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: resolve,
      fail: (error) => reject({ type: 'album', detail: error }),
    });
  });
}

function isAlbumPermissionError(error) {
  if (!error || error.type !== 'album') return false;
  const message = String((error.detail && error.detail.errMsg) || '').toLowerCase();
  return message.includes('auth deny')
    || message.includes('auth denied')
    || message.includes('authorize no response')
    || message.includes('permission denied');
}

Page({
  data: {
    id: '',
    task: null,
    loading: true,
    running: false,
    saving: false,
    comparePercent: 50,
    pageScrollTop: 0,
  },

  onLoad(options) {
    if (!canAccessAIDesign()) {
      showAIDesignAccessDenied();
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

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
      const [response, sources] = await Promise.all([
        aiService.getTask(this.data.id),
        Promise.resolve().then(() => aiService.loadSources()).catch(() => []),
      ]);
      const project = (sources || []).find((item) => item.floorPlanId === response.floorPlanId);
      const task = decorateTask(response, project);
      this.compareRect = null;
      this.setData({ task, loading: false });
      if (task.status === 'succeeded') this.resetPageScroll();
      if (this.shouldRun && ['created', 'pending'].includes(task.status) && !this.data.running) {
        this.shouldRun = false;
        this.startRun();
      } else if (['created', 'pending', 'processing'].includes(task.status)) {
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
        this.setData({ task: decorateTask(task, this.data.task && { projectDisplayTitle: this.data.task.projectTitle }), running: false });
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

  async saveResult() {
    const task = this.data.task;
    if (!task || !task.resultImageUrl || this.data.saving) return;
    this.setData({ saving: true });
    wx.showLoading({ title: '保存中...' });
    let feedback = { title: '已保存到相册', icon: 'success' };
    let needsAlbumPermission = false;
    try {
      const filePath = await downloadImage(task.resultImageUrl);
      await saveImageToAlbum(filePath);
    } catch (error) {
      needsAlbumPermission = isAlbumPermissionError(error);
      feedback = {
        title: error && error.type === 'download' ? '图片下载失败' : '图片保存失败',
        icon: 'none',
      };
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }

    if (needsAlbumPermission) {
      wx.showModal({
        title: '需要相册权限',
        content: '请在设置中允许保存图片到相册后重试。',
        confirmText: '去设置',
        success: (result) => {
          if (result.confirm) wx.openSetting();
        },
      });
      return;
    }
    wx.showToast(feedback);
  },

  async retry() {
    if (this.data.running) return;
    this.setData({ running: true });
    try {
      const task = await aiService.retryTask(this.data.id);
      this.setData({ task: decorateTask(task, this.data.task && { projectDisplayTitle: this.data.task.projectTitle }), running: false });
      this.startPolling();
    } catch (error) {
      this.setData({ running: false });
      wx.showToast({ title: error.error || '重试失败', icon: 'none' });
    }
  },

  reuseInputs() {
    const task = this.data.task;
    if (!task) return;
    if (task.recipeId) {
      wx.switchTab({ url: '/pages/ai-design/ai-design' });
      return;
    }
    wx.navigateTo({ url: `/packages/ai-workflow/create/ai-design-create?mode=${task.mode}&sourceTaskId=${task.id}` });
  },

  continueWorkflow() {
    const task = this.data.task;
    if (!task) return;
    const nextMode = task.nextStageKey === 'soft_furnishing'
      ? 'soft_furnishing'
      : task.nextStageKey === 'base_render'
        ? 'style_transform'
        : task.mode;
    const query = [
      `mode=${nextMode}`,
      `sourceResultTaskId=${task.id}`,
      `workflowId=${task.workflowId}`,
      `floorPlanId=${task.floorPlanId}`,
      `targetScope=${task.targetScope}`,
      task.roomId ? `roomId=${task.roomId}` : '',
      task.leadId ? `leadId=${task.leadId}` : '',
    ].filter(Boolean).join('&');
    wx.navigateTo({ url: `/packages/ai-workflow/create/ai-design-create?${query}` });
  },

  handlePrimaryAction() {
    const task = this.data.task;
    if (task && task.recipeId) {
      wx.switchTab({ url: '/pages/ai-design/ai-design' });
      return;
    }
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
    if (task && task.canContinueWorkflow) {
      this.continueWorkflow();
      return;
    }
    this.reuseInputs();
  },

  openHistory() {
    wx.navigateTo({ url: '/packages/ai-workflow/history/ai-design-history' });
  },

  browseRecipes() {
    wx.switchTab({ url: '/pages/ai-design/ai-design' });
  },

  onShareAppMessage() {
    const task = this.data.task || {};
    return {
      title: `${task.recipeName || task.modeTitle || 'AI 设计'}成果`,
      path: `/packages/ai-workflow/result/ai-design-result?id=${this.data.id}`,
      imageUrl: task.resultImageUrl || '',
    };
  },
});
