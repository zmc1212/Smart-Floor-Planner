const api = require('../../../utils/api.js');
const surveyLayout = require('../../../utils/surveyLayout.js');
const { openSurveyingEditor, clearSurveyingEditorDraft } = require('../../../utils/surveyNavigation.js');

const STATUS_LABELS = {
  new: '新线索',
  contacted: '新线索',
  acquired: '新线索',
  measuring: '量房中',
  measured: '方案设计',
  assigned: '方案设计',
  designing: '方案设计',
  quoting: '方案设计',
  converted: '已签约',
  closed: '已关闭'
};

const WORKFLOW_STAGES = ['新线索', '量房中', '方案设计', '已签约'];

function normalizeStatus(status) {
  if (['contacted', 'acquired'].includes(status)) return 'new';
  if (['measured', 'assigned', 'designing', 'quoting'].includes(status)) return 'designing';
  return status || 'new';
}

function buildStageRail(status) {
  const current = normalizeStatus(status);
  const currentIndex = Math.max(0, WORKFLOW_STAGES.indexOf(STATUS_LABELS[current] || '新线索'));
  return WORKFLOW_STAGES.map((label, index) => ({
    label,
    state: index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming'
  }));
}

function getNextAction(status) {
  const normalized = normalizeStatus(status);
  if (normalized === 'new') return '开始正式量房';
  if (normalized === 'measuring') return '完成墙图后进入方案设计';
  if (normalized === 'designing') return '等待方案沟通或客户确认';
  if (normalized === 'converted') return '已签约，无需继续推进';
  if (normalized === 'closed') return '该线索已关闭';
  return '';
}

function asPlan(value) {
  return value && typeof value === 'object' ? value : null;
}

function getFormalPlans(lead) {
  const plans = [];
  const primary = asPlan(lead && lead.primaryFloorPlanId);
  if (primary) plans.push(primary);
  (Array.isArray(lead && lead.floorPlanIds) ? lead.floorPlanIds : []).forEach((plan) => {
    if (asPlan(plan)) plans.push(plan);
  });
  const seen = Object.create(null);
  return plans.filter((plan) => {
    const id = String(plan._id || '');
    if (!id || seen[id] || !surveyLayout.isFormalSurveyLayout(plan.layoutData)) return false;
    seen[id] = true;
    return true;
  });
}

function formatPlanDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日更新`;
}

function formatConfirmationDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function todayDate() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function formatContractAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `¥${amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function getStaffName(value) {
  if (!value) return '';
  if (typeof value === 'object') return value.displayName || value.username || '';
  return String(value);
}

function getPlanSpaceCount(plan) {
  const floor = surveyLayout.getActiveFloor(plan && plan.layoutData);
  return Array.isArray(floor && floor.spaces)
    ? floor.spaces.filter((space) => space && space.closed).length
    : 0;
}

function toPlanDisplay(plan) {
  const spaceCount = getPlanSpaceCount(plan);
  const display = plan && typeof plan.display === 'object' ? plan.display : null;
  const projectTitle = typeof (display && display.projectTitle) === 'string'
    ? display.projectTitle.trim()
    : '';
  const projectSubtitle = typeof (display && display.projectSubtitle) === 'string'
    ? display.projectSubtitle.trim()
    : '';
  const metadata = [
    projectSubtitle,
    plan.status === 'completed' ? '已完成' : '量房中',
    spaceCount ? `${spaceCount}个空间` : '',
    formatPlanDate(plan.updatedAt || plan.createdAt)
  ].filter(Boolean);
  return {
    ...plan,
    historyName: projectTitle || plan.name || '历史正式量房',
    displayMeta: metadata.join(' · ')
  };
}

function getStaffRole() {
  const app = getApp();
  const user = app && app.globalData && app.globalData.userInfo;
  if (!user) return '';
  return user.staffRole || (user.role === 'staff' ? '' : user.role) || '';
}

Page({
  data: {
    leadId: '',
    lead: null,
    activeFloorPlan: null,
    previousFloorPlans: [],
    staffRole: '',
    canContactDesigner: false,
    canViewAcquisition: false,
    showDesignerSheet: false,
    designerProfile: null,
    canScheduleAppointment: false,
    acquisitionConfirmedTime: '',
    statusLabel: '新线索',
    nextAction: '开始正式量房',
    stageRail: buildStageRail('new'),
    canMarkConverted: false,
    canRevertConversion: false,
    convertedByName: '',
    convertedTime: '',
    convertedAmountText: '',
    showInternalConversionDetails: false,
    showConversionSheet: false,
    todayDateValue: todayDate(),
    conversionDate: todayDate(),
    conversionAmount: '',
    conversionNote: '',
    showRevertConversionSheet: false,
    revertConversionReason: '',
    conversionSubmitting: false,
    conversionSkipsStages: false,
    loading: true,
    errorMessage: '',
    deleting: false
  },

  onLoad(options) {
    this.setData({ leadId: options.id || options.leadId || '' });
  },

  onShow() {
    if (this.data.leadId) this.fetchLeadDetail();
  },

  async fetchLeadDetail() {
    this.setData({ loading: true, errorMessage: '' });
    try {
      const res = await api.request(`/leads/${this.data.leadId}`, 'GET');
      if (!res.success || !res.data) throw new Error('线索加载失败');
      this.applyLeadDetail(res.data);
    } catch (err) {
      this.setData({ loading: false, errorMessage: (err && err.error) || '线索详情加载失败，请稍后重试' });
    }
  },

  applyLeadDetail(lead) {
    const formalPlans = getFormalPlans(lead).map(toPlanDisplay);
    const staffRole = getStaffRole();
    const designerProfile = lead.assignedTo && typeof lead.assignedTo === 'object'
      ? lead.assignedTo
      : null;
    const conversionActions = lead.conversionActions || {};
    this.setData({
      lead,
      staffRole,
      designerProfile,
      acquisitionConfirmedTime: formatConfirmationDate(lead.acquiredAt),
      canContactDesigner: staffRole === 'measurer' && Boolean(designerProfile && (designerProfile.wechatId || designerProfile.wechatQrUrl)),
      canViewAcquisition: staffRole === 'measurer' || staffRole === 'designer',
      statusLabel: STATUS_LABELS[lead.status] || lead.status || '新线索',
      nextAction: getNextAction(lead.status),
      stageRail: buildStageRail(lead.status),
      canMarkConverted: Boolean(conversionActions.canMarkConverted),
      canRevertConversion: Boolean(conversionActions.canRevertConversion),
      convertedByName: getStaffName(lead.convertedBy) || '历史数据未记录',
      convertedTime: formatConfirmationDate(lead.convertedAt),
      convertedAmountText: formatContractAmount(lead.contractAmount),
      showInternalConversionDetails: ['enterprise_admin', 'designer', 'measurer', 'salesperson'].includes(staffRole),
      conversionSkipsStages: !['designing', 'measured', 'assigned', 'quoting'].includes(lead.status),
      activeFloorPlan: formalPlans[0] || null,
      previousFloorPlans: formalPlans.slice(1),
      loading: false
    });
    this.refreshAppointmentEntry(staffRole, lead);
  },

  async refreshAppointmentEntry(staffRole, lead) {
    const canOpen = staffRole === 'designer'
      && lead
      && !['closed', 'converted'].includes(lead.status);
    if (!canOpen) {
      this.setData({ canScheduleAppointment: false });
      return;
    }
    try {
      const result = await api.request(`/appointments?leadId=${encodeURIComponent(this.data.leadId)}`, 'GET');
      const hasConfirmedAppointment = (result.data || []).some((item) => item.status === 'confirmed');
      this.setData({ canScheduleAppointment: !hasConfirmedAppointment });
    } catch (error) {
      this.setData({ canScheduleAppointment: false });
    }
  },

  onOpenConversionSheet() {
    if (!this.data.canMarkConverted || this.data.conversionSubmitting) return;
    const currentChinaDate = todayDate();
    this.setData({
      showConversionSheet: true,
      todayDateValue: currentChinaDate,
      conversionDate: currentChinaDate,
      conversionAmount: '',
      conversionNote: ''
    });
  },

  onCloseConversionSheet() {
    if (!this.data.conversionSubmitting) this.setData({ showConversionSheet: false });
  },

  onSheetTap() {},

  onConversionDateChange(event) {
    this.setData({ conversionDate: event.detail.value });
  },

  onConversionAmountInput(event) {
    this.setData({ conversionAmount: event.detail.value });
  },

  onConversionNoteInput(event) {
    this.setData({ conversionNote: event.detail.value });
  },

  async onConfirmConversion() {
    if (!this.data.canMarkConverted || !this.data.conversionDate || this.data.conversionSubmitting) return;
    const amountText = String(this.data.conversionAmount || '').trim();
    const amount = amountText ? Number(amountText) : null;
    if (amountText && (!Number.isFinite(amount) || amount <= 0)) {
      wx.showToast({ title: '请输入有效的签约金额', icon: 'none' });
      return;
    }
    this.setData({ conversionSubmitting: true });
    try {
      const res = await api.request(`/leads/${this.data.leadId}/convert`, 'POST', {
        convertedOn: this.data.conversionDate,
        contractAmount: amount,
        conversionNote: String(this.data.conversionNote || '').trim()
      });
      if (!res.success || !res.data) throw new Error('标记已签约失败');
      this.setData({ showConversionSheet: false });
      this.applyLeadDetail(res.data);
      wx.showToast({ title: '已标记为已签约', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '标记失败，请重试', icon: 'none' });
    } finally {
      this.setData({ conversionSubmitting: false });
    }
  },

  onOpenRevertConversionSheet() {
    if (!this.data.canRevertConversion || this.data.conversionSubmitting) return;
    this.setData({ showRevertConversionSheet: true, revertConversionReason: '' });
  },

  onCloseRevertConversionSheet() {
    if (!this.data.conversionSubmitting) this.setData({ showRevertConversionSheet: false });
  },

  onRevertConversionReasonInput(event) {
    this.setData({ revertConversionReason: event.detail.value });
  },

  async onConfirmRevertConversion() {
    const reason = String(this.data.revertConversionReason || '').trim();
    if (!this.data.canRevertConversion || !reason || this.data.conversionSubmitting) return;
    this.setData({ conversionSubmitting: true });
    try {
      const res = await api.request(`/leads/${this.data.leadId}/revert-conversion`, 'POST', { reason });
      if (!res.success || !res.data) throw new Error('撤销签约标记失败');
      this.setData({ showRevertConversionSheet: false, revertConversionReason: '' });
      this.applyLeadDetail(res.data);
      wx.showToast({ title: '签约标记已撤销', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '撤销失败，请重试', icon: 'none' });
    } finally {
      this.setData({ conversionSubmitting: false });
    }
  },

  onOpenAcquisition() {
    wx.navigateTo({ url: `/packages/business/acquisition-center/acquisition-center?leadId=${this.data.leadId}` });
  },

  onOpenDesignerContact() {
    if (this.data.canContactDesigner) this.setData({ showDesignerSheet: true });
  },

  onCloseDesignerSheet() {
    this.setData({ showDesignerSheet: false });
  },

  onRetryDesignerProfile() {
    this.fetchLeadDetail();
  },

  onRetryDetail() {
    this.fetchLeadDetail();
  },

  onScheduleAppointment() {
    if (!this.data.canScheduleAppointment || !this.data.leadId) return;
    wx.navigateTo({
      url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(this.data.leadId)}`,
    });
  },

  onStartMeasure() {
    const plan = this.data.activeFloorPlan;
    openSurveyingEditor({
      leadId: this.data.leadId,
      leadName: this.data.lead && this.data.lead.name,
      communityName: this.data.lead && this.data.lead.communityName,
      floorPlanId: plan && plan._id
    });
  },

  onStartNewMeasure() {
    openSurveyingEditor({
      leadId: this.data.leadId,
      leadName: this.data.lead && this.data.lead.name,
      communityName: this.data.lead && this.data.lead.communityName,
      startNewSurvey: true
    });
  },

  onContinueMeasure(e) {
    const planId = e.currentTarget.dataset.id;
    const plan = this.data.previousFloorPlans.find((item) => item._id === planId);
    if (!plan) return;
    openSurveyingEditor({
      leadId: this.data.leadId,
      leadName: this.data.lead && this.data.lead.name,
      communityName: this.data.lead && this.data.lead.communityName,
      floorPlanId: plan._id
    });
  },

  onDeleteMeasure(e) {
    const planId = e && e.currentTarget && e.currentTarget.dataset.id;
    const plan = planId
      ? [this.data.activeFloorPlan, ...this.data.previousFloorPlans].find((item) => item && item._id === planId)
      : this.data.activeFloorPlan;
    if (!plan || !plan._id || this.data.deleting) return;

    wx.showModal({
      title: '删除量房',
      content: '删除后不可恢复，是否继续？',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async (modalRes) => {
        if (!modalRes.confirm) return;

        this.setData({ deleting: true });
        wx.showLoading({ title: '删除中...' });
        try {
          await api.request(`/floorplans/${plan._id}`, 'DELETE');
          clearSurveyingEditorDraft(this.data.leadId, plan._id);
          wx.showToast({ title: '量房已删除', icon: 'success' });
          await this.fetchLeadDetail();
        } catch (err) {
          wx.showToast({ title: (err && err.error) || '删除失败', icon: 'none' });
        } finally {
          wx.hideLoading();
          this.setData({ deleting: false });
        }
      }
    });
  }
});
