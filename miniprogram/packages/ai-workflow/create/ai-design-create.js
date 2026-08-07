const aiService = require('../../../utils/aiDesignService.js');
const { validateTaskInput } = require('../../../utils/aiDesignValidation.js');
const { canAccessAIDesign, showAIDesignAccessDenied } = require('../../../utils/aiDesignAccess.js');

const STYLE_PREVIEW_IMAGES = {
  modern: '/images/page-ip-v3/ai-create-style-modern.jpg',
  cream: '/images/page-ip-v3/ai-create-style-cream.jpg',
  new_chinese: '/images/page-ip-v3/ai-create-style-chinese.jpg',
};

function withStylePreviews(styles) {
  return (styles || []).map((style) => ({
    ...style,
    previewImage: STYLE_PREVIEW_IMAGES[style.key] || '',
  }));
}

function getRequiredInputReason(data) {
  const hasSpaceSource = Boolean(data.spaceAssetId || data.sourceResultTaskId);

  if (data.mode === 'reference_recreate') {
    if (data.floorPlanId) {
      return data.referenceAssetId ? '' : '请上传参考图';
    }
    if (!data.spaceAssetId) return '请上传空间图';
    return data.referenceAssetId ? '' : '请上传参考图';
  }

  if (data.mode === 'floor_plan_render') {
    if (!data.floorPlanId) return '请先选择正式户型';
    if (data.targetScope === 'single_room' && !data.roomId) return '请先选择具体房间';
    return '';
  }

  if (!hasSpaceSource) {
    return data.mode === 'soft_furnishing'
      ? '请上传空间或基准图'
      : '请上传空间图';
  }
  return '';
}

function deriveSubmitState(data) {
  if (!data.modeAvailable) {
    return {
      canSubmit: false,
      submitBlockedReason: data.modeUnavailableReason || 'AI 设计服务暂不可用',
    };
  }

  const needsStyle = data.mode !== 'reference_recreate';
  if (needsStyle && !(data.styles || []).length) {
    return { canSubmit: false, submitBlockedReason: '暂无可用风格' };
  }

  const inputReason = getRequiredInputReason(data);
  if (inputReason) {
    return { canSubmit: false, submitBlockedReason: inputReason };
  }

  if (needsStyle && !data.selectedStyleKey) {
    return { canSubmit: false, submitBlockedReason: '请选择目标风格' };
  }

  if (!data.hasEnoughCredits) {
    return { canSubmit: false, submitBlockedReason: 'AI 点数不足' };
  }

  return { canSubmit: true, submitBlockedReason: '' };
}

Page({
  data: {
    mode: 'reference_recreate',
    modeTitle: '复刻心动网图',
    floorPlanId: '',
    leadId: '',
    roomId: '',
    targetScope: '',
    targetLabel: '',
    floorPlanName: '',
    targetMeta: '',
    sourceTaskId: '',
    requestedSourceResultTaskId: '',
    workflowId: '',
    workflowTitle: '',
    workflowLeadName: '',
    workflowStageLabel: '',
    createNewWorkflow: false,
    loading: true,
    loadError: '',
    submitting: false,
    uploadingRole: '',
    uploadErrorRole: '',
    capabilities: null,
    price: 10,
    availableBalance: 0,
    hasEnoughCredits: false,
    creditStatusText: '正在读取企业 AI 点数',
    modeAvailable: false,
    modeUnavailableReason: '正在读取 AI 能力',
    canSubmit: false,
    submitBlockedReason: '正在读取 AI 能力',
    spaceAssetId: '',
    referenceAssetId: '',
    sourceResultTaskId: '',
    autoSourceLabel: '',
    spaceImagePath: '',
    referenceImagePath: '',
    styles: [],
    selectedStyleKey: '',
  },

  async onLoad(options) {
    if (!canAccessAIDesign()) {
      showAIDesignAccessDenied();
      wx.switchTab({ url: '/pages/index/index' });
      return;
    }

    const supportedModes = ['reference_recreate', 'style_transform', 'floor_plan_render', 'soft_furnishing'];
    const mode = supportedModes.includes(options.mode) ? options.mode : 'reference_recreate';
    const modeTitles = {
      reference_recreate: '参考图复刻',
      style_transform: '空间换风格',
      floor_plan_render: '户型生成',
      soft_furnishing: '软装深化',
    };
    this.setData({
      mode,
      modeTitle: modeTitles[mode],
      floorPlanId: options.floorPlanId || '',
      leadId: options.leadId || '',
      roomId: options.roomId || '',
      targetScope: options.targetScope || (options.roomId ? 'single_room' : options.floorPlanId ? 'whole_floor_plan' : ''),
      sourceTaskId: options.sourceTaskId || '',
      requestedSourceResultTaskId: options.sourceResultTaskId || '',
      workflowId: options.workflowId || '',
      createNewWorkflow: options.createNewWorkflow === '1',
    });
    await this.loadInitialData();
  },

  async loadInitialData() {
    this.setData({ loading: true, loadError: '' });
    try {
      const [capabilities, sourcePlans] = await Promise.all([
        aiService.loadCapabilities(),
        this.data.floorPlanId ? aiService.loadSources().catch(() => []) : Promise.resolve([]),
      ]);
      const priceItem = (capabilities.modes || []).find((item) => item.key === this.data.mode);
      const price = priceItem ? priceItem.credits : 10;
      const availableBalance = Number(capabilities.account && capabilities.account.availableBalance || 0);
      const styles = withStylePreviews(capabilities.styles || []);
      const provider = capabilities.provider || {};
      const targetSupport = provider.floorPlanTargetSupport || {};
      const resolvedScope = this.data.targetScope || (this.data.roomId ? 'single_room' : 'whole_floor_plan');
      const targetSupported = this.data.mode !== 'floor_plan_render' || targetSupport[resolvedScope] !== false;
      const modeAvailable = Boolean(priceItem && priceItem.enabled) && targetSupported;
      let modeUnavailableReason = '';
      if (!modeAvailable) {
        modeUnavailableReason = this.data.mode === 'floor_plan_render' && !targetSupported
          ? (resolvedScope === 'single_room' ? '单房间生成服务暂不可用' : '全屋生成服务暂不可用')
          : 'AI 设计服务暂不可用';
      }
      const nextData = {
        capabilities,
        price,
        availableBalance,
        hasEnoughCredits: availableBalance >= price,
        creditStatusText: availableBalance >= price
          ? `剩余 ${availableBalance} 点，可放心生成`
          : `剩余 ${availableBalance} 点 · 请联系企业管理员补充`,
        modeAvailable,
        modeUnavailableReason,
        styles,
        selectedStyleKey: styles[0] ? styles[0].key : '',
      };
      const sourcePlan = sourcePlans.find((item) => item.floorPlanId === this.data.floorPlanId);
      const sourceRoom = sourcePlan && this.data.targetScope === 'single_room'
        ? (sourcePlan.rooms || []).find((item) => item.roomId === this.data.roomId)
        : null;
      if (sourcePlan) {
        nextData.floorPlanName = sourcePlan.floorPlanName || '正式户型';
        nextData.targetLabel = this.data.targetScope === 'single_room' && sourceRoom
          ? sourceRoom.roomName
          : '完整户型';
        nextData.targetMeta = this.data.targetScope === 'single_room' && sourceRoom
          ? `${sourceRoom.roomSize} · ${sourceRoom.openingCount} 个门窗开口`
          : `${sourcePlan.closedRoomCount || (sourcePlan.rooms || []).length} 个闭合房间 · 全屋俯视效果`;
      }
      if (this.data.sourceTaskId) {
        const source = await aiService.getTask(this.data.sourceTaskId);
        if (this.data.mode !== source.mode && !source.hasExactTargetContext) {
          throw new Error('旧任务缺少明确房间范围，只能使用“再设计”复用原始输入');
        }
        const useResultAsSource = this.data.mode !== source.mode
          && source.hasExactTargetContext
          && source.resultImageUrl;
        nextData.spaceAssetId = useResultAsSource ? '' : (source.spaceAssetId || '');
        nextData.sourceResultTaskId = useResultAsSource ? source.id : '';
        nextData.referenceAssetId = source.referenceAssetId || '';
        nextData.spaceImagePath = useResultAsSource ? source.resultImageUrl : (source.spaceImageUrl || '');
        nextData.referenceImagePath = source.referenceImageUrl || '';
        nextData.selectedStyleKey = source.styleKey || nextData.selectedStyleKey;
        nextData.workflowId = source.workflowId || '';
        nextData.workflowTitle = source.workflowTitle || '';
        nextData.workflowLeadName = source.leadName || '';
        nextData.createNewWorkflow = false;
        nextData.floorPlanId = source.floorPlanId || this.data.floorPlanId;
        nextData.leadId = source.leadId || this.data.leadId;
        nextData.roomId = source.roomId || this.data.roomId;
        nextData.targetScope = source.targetScope || (source.roomId ? 'single_room' : this.data.targetScope);
        nextData.targetLabel = source.targetLabel || nextData.targetLabel;
        nextData.floorPlanName = nextData.floorPlanName || (source.floorPlanId ? '正式户型' : '');
        nextData.targetMeta = nextData.targetMeta || (nextData.targetScope === 'whole_floor_plan'
          ? '完整户型 · 全屋俯视效果'
          : nextData.targetLabel || '单房间设计');
        nextData.autoSourceLabel = useResultAsSource
          ? `${nextData.targetLabel || '当前空间'}方案基准图`
          : '';
      } else if (this.data.workflowId) {
        const workflows = await aiService.loadWorkflows({
          workflowId: this.data.workflowId,
          floorPlanId: this.data.floorPlanId,
          targetScope: this.data.targetScope,
          roomId: this.data.roomId,
        });
        const workflow = workflows[0];
        if (workflow) {
          nextData.workflowId = workflow.id;
          nextData.workflowTitle = workflow.title || '';
          nextData.workflowLeadName = workflow.lead && workflow.lead.name ? workflow.lead.name : '';
          nextData.workflowStageLabel = workflow.currentStageLabel || '';
          nextData.floorPlanId = workflow.sourceFloorPlanId || this.data.floorPlanId;
          nextData.floorPlanName = nextData.floorPlanName || (nextData.floorPlanId ? '正式户型' : '');
          if (nextData.floorPlanId && !this.data.targetScope) {
            nextData.targetScope = 'whole_floor_plan';
            nextData.targetLabel = '完整户型';
            nextData.targetMeta = '完整户型 · 全屋俯视效果';
          }
          nextData.leadId = workflow.lead && workflow.lead.id ? workflow.lead.id : this.data.leadId;
          const sourceTask = workflow.targetContext && workflow.targetContext.sourceTask;
          if (this.data.requestedSourceResultTaskId
            && (!sourceTask || sourceTask.id !== this.data.requestedSourceResultTaskId)) {
            throw new Error('当前空间基准图已变化，请返回后重试');
          }
          if (['style_transform', 'soft_furnishing'].includes(this.data.mode)
            && sourceTask && sourceTask.resultImageUrl) {
            nextData.spaceAssetId = '';
            nextData.sourceResultTaskId = sourceTask.id;
            nextData.spaceImagePath = sourceTask.resultImageUrl;
            nextData.selectedStyleKey = sourceTask.styleKey || nextData.selectedStyleKey;
            nextData.autoSourceLabel = `${nextData.targetLabel || '当前空间'}方案基准图`;
          }
        }
      }
      Object.assign(nextData, deriveSubmitState({ ...this.data, ...nextData }));
      this.setData(nextData);
    } catch (error) {
      const loadError = error.error || '加载 AI 配置失败，请检查网络后重试';
      this.setData({
        loadError,
        canSubmit: false,
        submitBlockedReason: 'AI 配置加载失败',
      });
      wx.showToast({ title: loadError, icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  retryLoad() {
    if (this.data.loading) return;
    return this.loadInitialData();
  },

  deriveSubmitState(data) {
    return deriveSubmitState(data || this.data);
  },

  refreshSubmitState(update = {}) {
    const nextData = { ...this.data, ...update };
    this.setData({ ...update, ...deriveSubmitState(nextData) });
  },

  selectImage(event) {
    const role = event.currentTarget.dataset.role;
    if (this.data.uploadingRole || this.data.submitting) return;
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (file && file.tempFilePath) this.uploadImage(role, file.tempFilePath);
      },
    });
  },

  retryImage(event) {
    const role = event.currentTarget.dataset.role;
    const pathKey = role === 'reference' ? 'referenceImagePath' : 'spaceImagePath';
    if (this.data.uploadingRole || this.data.submitting || !this.data[pathKey]) return;
    return this.uploadImage(role, this.data[pathKey]);
  },

  async uploadImage(role, filePath) {
    const pathKey = role === 'reference' ? 'referenceImagePath' : 'spaceImagePath';
    const assetKey = role === 'reference' ? 'referenceAssetId' : 'spaceAssetId';
    this.setData({
      uploadingRole: role,
      uploadErrorRole: '',
      [pathKey]: filePath,
      [assetKey]: '',
      ...(role === 'space' ? { sourceResultTaskId: '', autoSourceLabel: '' } : {}),
    });
    wx.showLoading({ title: '上传中...' });
    let feedback;
    try {
      const asset = await aiService.uploadAsset(filePath);
      this.setData({ [assetKey]: asset.id });
      feedback = { title: '图片已上传', icon: 'success' };
    } catch (error) {
      this.setData({ uploadErrorRole: role, [assetKey]: '' });
      feedback = { title: error.error || '图片上传失败', icon: 'none' };
    } finally {
      wx.hideLoading();
      this.refreshSubmitState({ uploadingRole: '' });
    }
    wx.showToast(feedback);
  },

  selectStyle(event) {
    if (this.data.submitting || this.data.uploadingRole) return;
    this.refreshSubmitState({ selectedStyleKey: event.currentTarget.dataset.key });
  },

  async submit() {
    if (this.data.submitting || this.data.uploadingRole) return;
    if (!this.data.canSubmit) {
      if (this.data.submitBlockedReason === 'AI 点数不足') {
        wx.showModal({
          title: 'AI 点数不足',
          content: `本次需要 ${this.data.price} 点，请联系企业管理员补充 AI 点数后重试。`,
          showCancel: false,
        });
        return;
      }
      wx.showToast({ title: this.data.submitBlockedReason || '当前暂不可生成', icon: 'none' });
      return;
    }
    const available = this.data.capabilities && this.data.capabilities.account
      ? this.data.capabilities.account.availableBalance
      : 0;
    if (this.data.mode === 'floor_plan_render') {
      const provider = (this.data.capabilities && this.data.capabilities.provider) || {};
      const support = provider.floorPlanTargetSupport || {};
      if (support[this.data.targetScope] === false) {
        wx.showToast({
          title: this.data.targetScope === 'whole_floor_plan' ? '全屋俯视生成服务暂未配置' : '单房间生成服务暂未配置',
          icon: 'none',
        });
        return;
      }
    }
    const validation = validateTaskInput({
      mode: this.data.mode,
      spaceAssetId: this.data.spaceAssetId,
      sourceResultTaskId: this.data.sourceResultTaskId,
      referenceAssetId: this.data.referenceAssetId,
      styleKey: this.data.selectedStyleKey,
      floorPlanId: this.data.floorPlanId,
      targetScope: this.data.targetScope,
      roomId: this.data.roomId,
      availableBalance: available,
      price: this.data.price,
    });
    if (!validation.valid && validation.insufficient) {
      wx.showModal({
        title: 'AI 点数不足',
        content: `本次需要 ${this.data.price} 点，请联系平台管理员为企业调整点数。`,
        showCancel: false,
      });
      return;
    }
    if (!validation.valid) {
      wx.showToast({ title: validation.error, icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    try {
      const task = await aiService.createTask({
        mode: this.data.mode,
        spaceAssetId: this.data.mode === 'reference_recreate' && this.data.floorPlanId
          ? undefined
          : this.data.spaceAssetId,
        sourceResultTaskId: this.data.sourceResultTaskId || undefined,
        referenceAssetId: this.data.mode === 'reference_recreate' ? this.data.referenceAssetId : undefined,
        styleKey: this.data.mode === 'reference_recreate' ? undefined : this.data.selectedStyleKey,
        floorPlanId: this.data.floorPlanId || undefined,
        leadId: this.data.leadId || undefined,
        roomId: this.data.roomId || undefined,
        targetScope: this.data.targetScope || undefined,
        workflowId: this.data.workflowId || undefined,
        createNewWorkflow: this.data.createNewWorkflow,
      });
      wx.redirectTo({ url: `/packages/ai-workflow/result/ai-design-result?id=${task.id}&run=1` });
    } catch (error) {
      if (error.existingTaskId) {
        wx.redirectTo({ url: `/packages/ai-workflow/result/ai-design-result?id=${error.existingTaskId}` });
        return;
      }
      wx.showToast({ title: error.error || '创建任务失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});
