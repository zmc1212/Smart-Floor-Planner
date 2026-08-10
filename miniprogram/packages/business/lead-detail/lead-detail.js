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

function getPlanSpaceCount(plan) {
  const floor = surveyLayout.getActiveFloor(plan && plan.layoutData);
  return Array.isArray(floor && floor.spaces)
    ? floor.spaces.filter((space) => space && space.closed).length
    : 0;
}

function toPlanDisplay(plan) {
  const spaceCount = getPlanSpaceCount(plan);
  const metadata = [
    plan.status === 'completed' ? '已完成' : '量房中',
    spaceCount ? `${spaceCount}个空间` : '',
    formatPlanDate(plan.updatedAt || plan.createdAt)
  ].filter(Boolean);
  return {
    ...plan,
    historyName: plan.name || '历史正式量房',
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
    acquisitionConfirmedTime: '',
    statusLabel: '新线索',
    nextAction: '开始正式量房',
    stageRail: buildStageRail('new'),
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
      const formalPlans = getFormalPlans(res.data).map(toPlanDisplay);
      const staffRole = getStaffRole();
      const designerProfile = res.data.assignedTo && typeof res.data.assignedTo === 'object'
        ? res.data.assignedTo
        : null;
      this.setData({
        lead: res.data,
        staffRole,
        designerProfile,
        acquisitionConfirmedTime: formatConfirmationDate(res.data.acquiredAt),
        canContactDesigner: staffRole === 'measurer' && Boolean(designerProfile && (designerProfile.wechatId || designerProfile.wechatQrUrl)),
        canViewAcquisition: staffRole === 'measurer' || staffRole === 'designer',
        statusLabel: STATUS_LABELS[res.data.status] || res.data.status || '新线索',
        nextAction: getNextAction(res.data.status),
        stageRail: buildStageRail(res.data.status),
        activeFloorPlan: formalPlans[0] || null,
        previousFloorPlans: formalPlans.slice(1),
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false, errorMessage: (err && err.error) || '线索详情加载失败，请稍后重试' });
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
