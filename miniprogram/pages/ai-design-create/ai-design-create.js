const aiService = require('../../utils/aiDesignService.js');
const { validateTaskInput } = require('../../utils/aiDesignValidation.js');

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
    workflowId: '',
    workflowTitle: '',
    workflowLeadName: '',
    workflowStageLabel: '',
    createNewWorkflow: false,
    loading: true,
    submitting: false,
    uploadingRole: '',
    uploadErrorRole: '',
    capabilities: null,
    price: 10,
    spaceAssetId: '',
    referenceAssetId: '',
    spaceImagePath: '',
    referenceImagePath: '',
    styles: [],
    selectedStyleKey: '',
  },

  async onLoad(options) {
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
      workflowId: options.workflowId || '',
      createNewWorkflow: options.createNewWorkflow === '1',
    });
    await this.loadInitialData();
  },

  async loadInitialData() {
    try {
      const [capabilities, sourcePlans] = await Promise.all([
        aiService.loadCapabilities(),
        this.data.floorPlanId ? aiService.loadSources().catch(() => []) : Promise.resolve([]),
      ]);
      const priceItem = (capabilities.modes || []).find((item) => item.key === this.data.mode);
      const styles = capabilities.styles || [];
      const nextData = {
        capabilities,
        price: priceItem ? priceItem.credits : 10,
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
        const useResultAsSource = this.data.mode !== source.mode && source.resultAssetId && source.resultImageUrl;
        nextData.spaceAssetId = useResultAsSource ? source.resultAssetId : (source.spaceAssetId || '');
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
      } else if (this.data.workflowId) {
        const workflows = await aiService.loadWorkflows({ workflowId: this.data.workflowId });
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
          const baselineTask = workflow.selectedTask || workflow.latestTask;
          if (this.data.mode !== 'floor_plan_render' && baselineTask && baselineTask.resultAssetId && baselineTask.resultImageUrl) {
            nextData.spaceAssetId = baselineTask.resultAssetId;
            nextData.spaceImagePath = baselineTask.resultImageUrl;
            nextData.selectedStyleKey = baselineTask.styleKey || nextData.selectedStyleKey;
          }
        }
      }
      this.setData(nextData);
    } catch (error) {
      wx.showToast({ title: error.error || '加载 AI 配置失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
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
    this.setData({ uploadingRole: role, uploadErrorRole: '', [pathKey]: filePath, [assetKey]: '' });
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
      this.setData({ uploadingRole: '' });
    }
    wx.showToast(feedback);
  },

  selectStyle(event) {
    this.setData({ selectedStyleKey: event.currentTarget.dataset.key });
  },

  async submit() {
    if (this.data.submitting || this.data.uploadingRole) return;
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
        referenceAssetId: this.data.mode === 'reference_recreate' ? this.data.referenceAssetId : undefined,
        styleKey: this.data.mode === 'reference_recreate' ? undefined : this.data.selectedStyleKey,
        floorPlanId: this.data.floorPlanId || undefined,
        leadId: this.data.leadId || undefined,
        roomId: this.data.roomId || undefined,
        targetScope: this.data.targetScope || undefined,
        workflowId: this.data.workflowId || undefined,
        createNewWorkflow: this.data.createNewWorkflow,
      });
      wx.redirectTo({ url: `/pages/ai-design-result/ai-design-result?id=${task.id}&run=1` });
    } catch (error) {
      if (error.existingTaskId) {
        wx.redirectTo({ url: `/pages/ai-design-result/ai-design-result?id=${error.existingTaskId}` });
        return;
      }
      wx.showToast({ title: error.error || '创建任务失败', icon: 'none' });
      this.setData({ submitting: false });
    }
  },
});
