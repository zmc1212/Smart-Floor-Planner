const api = require('../../../utils/api.js');
const surveyLayout = require('../../../utils/surveyLayout.js');
const { openSurveyingEditor, clearSurveyingEditorDraft } = require('../../../utils/surveyNavigation.js');
const { openAIDesignEntry } = require('../../../utils/aiDesignNavigation.js');
const {
  fetchProtectedImage,
  readCachedProtectedImage,
  floorPlanCacheKey,
  publishedImageCacheKey,
} = require('../../../utils/protectedImageCache.js');
const { createWallSegments, resolveProtectedPreviewEndpoint } = require('../../../components/lead-list/lead-list-model.js');

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

const POST_SURVEY_SERVICE_STAGES = new Set([
  'survey_completed',
  'design_published',
  'converted',
  'closed',
]);

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

function getNextAction(status, staffRole, isAssignedMeasurer) {
  const normalized = normalizeStatus(status);
  if (staffRole === 'designer' && !isAssignedMeasurer) {
    if (normalized === 'new') return '等待测量员完成正式量房';
    if (normalized === 'measuring') return '等待正式量房完成后进入方案设计';
  }
  if (staffRole === 'enterprise_admin' && ['new', 'measuring'].includes(normalized)) {
    return '查看量房进度与服务安排';
  }
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

function formatSchemeDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function resolveSchemeCoverGenerationId(scheme) {
  const images = Array.isArray(scheme && scheme.images) ? scheme.images : [];
  const cover = images.length ? images[images.length - 1] : null;
  return (cover && cover.generationId)
    || (Array.isArray(scheme && scheme.generationIds) ? scheme.generationIds[scheme.generationIds.length - 1] : '')
    || '';
}

function resolveSchemeCoverEndpoint(scheme, leadId) {
  const images = Array.isArray(scheme && scheme.images) ? scheme.images : [];
  const cover = images.length ? images[images.length - 1] : null;
  if (cover && cover.imageEndpoint) return cover.imageEndpoint;
  const generationId = resolveSchemeCoverGenerationId(scheme);
  if (!generationId || !leadId) return '';
  return `/leads/${leadId}/published-generations/${generationId}/image`;
}

function decoratePublishedScheme(scheme, leadId) {
  const imageCount = Number(scheme && scheme.imageCount)
    || (Array.isArray(scheme && scheme.images) ? scheme.images.length : 0)
    || (Array.isArray(scheme && scheme.generationIds) ? scheme.generationIds.length : 0);
  const coverEndpoint = resolveSchemeCoverEndpoint(scheme, leadId);
  const generationId = resolveSchemeCoverGenerationId(scheme);
  const cacheKey = publishedImageCacheKey(leadId, generationId || `${scheme && scheme.id}-cover`);
  return {
    ...scheme,
    imageCount,
    coverEndpoint,
    coverCacheKey: cacheKey,
    coverPath: coverEndpoint ? readCachedProtectedImage(cacheKey) : '',
    displayMeta: [
      scheme && scheme.finalized ? '定稿' : '已发布',
      formatSchemeDate(scheme && scheme.publishedAt),
    ].filter(Boolean).join(' · '),
  };
}

function shouldHideOperationalAppointment(lead) {
  if (!lead) return true;
  if (POST_SURVEY_SERVICE_STAGES.has(lead.serviceStage)) return true;
  return ['measured', 'assigned', 'designing', 'quoting', 'converted', 'closed'].includes(lead.status);
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

function getStaffContact(value, options = {}) {
  const canAssign = Boolean(options.canAssign);
  if (!value || typeof value !== 'object') {
    return { name: '待分配', phone: '', canCall: false, canAssign };
  }
  const name = String(value.displayName || value.username || '').trim();
  const phone = String(value.phone || '').trim();
  const isUnassigned = !name;
  return {
    name: name || '待分配',
    phone,
    canCall: Boolean(phone),
    canAssign: canAssign && isUnassigned,
  };
}

function getClosedSpaceNames(plan) {
  const floor = surveyLayout.getActiveFloor(plan && plan.layoutData);
  return (Array.isArray(floor && floor.spaces) ? floor.spaces : [])
    .filter((space) => space && space.closed)
    .map((space) => String(space.name || '').trim())
    .filter(Boolean);
}

function buildHouseFacts(lead, activeFloorPlan, appointment) {
  if (!lead || !activeFloorPlan || !POST_SURVEY_SERVICE_STAGES.has(lead.serviceStage)) {
    return null;
  }
  const facts = [];
  const communityName = String(lead.communityName || '').trim();
  if (communityName) facts.push({ label: '小区', value: communityName });
  const area = String(lead.area || '').trim();
  if (area) facts.push({ label: '面积', value: `${area}m²` });
  const address = String((appointment && appointment.address) || '').trim();
  if (address) facts.push({ label: '地址', value: address });
  const roomNames = getClosedSpaceNames(activeFloorPlan);
  if (roomNames.length) facts.push({ label: '房间', value: roomNames.join('、') });
  if (!facts.length) return null;
  return { facts, roomNames };
}

function canViewFloorPlanPreview(lead, staffRole, staffId, activeFloorPlan) {
  if (!lead || !activeFloorPlan || activeFloorPlan.status !== 'completed') return false;
  if (staffRole === 'enterprise_admin') return true;
  if (!staffId) return false;
  if (staffRole === 'designer' && staffIdOf(lead.assignedTo) === staffId) return true;
  if (staffRole === 'measurer' && staffIdOf(lead.measurerId) === staffId) return true;
  return false;
}

function buildFloorPlanPreviewState(leadId, plan) {
  if (!plan) {
    return {
      previewPath: '',
      previewState: '',
      previewEndpoint: '',
      previewSegments: [],
    };
  }
  const previewEndpoint = resolveProtectedPreviewEndpoint(plan);
  const previewSegments = previewEndpoint ? [] : createWallSegments(plan.layoutData);
  const cacheKey = floorPlanCacheKey(leadId, plan);
  const previewPath = previewEndpoint ? readCachedProtectedImage(cacheKey) : '';
  return {
    previewPath,
    previewState: previewEndpoint ? (previewPath ? 'loaded' : 'loading') : '',
    previewEndpoint,
    previewSegments,
    previewCacheKey: cacheKey,
  };
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

function getStaffId() {
  const app = getApp();
  const user = app && app.globalData && app.globalData.userInfo;
  if (!user) return '';
  return String(user.staffId || '');
}

function canEditLeadProfile(lead, staffRole, staffId) {
  if (!lead || lead.archivedAt) return false;
  if (staffRole === 'enterprise_admin') return true;
  if (!staffId) return false;
  if (staffRole === 'designer' && staffIdOf(lead.assignedTo) === staffId) return true;
  if (staffRole === 'measurer' && staffIdOf(lead.measurerId) === staffId) return true;
  return false;
}

/** Designer AI entry after formal survey — not gated on already-published schemes. */
function canOpenAIDesignWorkbench(lead, staffRole, formalPlans) {
  if (!lead || lead.archivedAt) return false;
  if (staffRole !== 'designer') return false;
  if (['converted', 'closed'].includes(lead.status)) return false;
  if (!Array.isArray(formalPlans) || formalPlans.length === 0) return false;
  if (normalizeStatus(lead.status) === 'designing') return true;
  return ['survey_completed', 'design_published'].includes(lead.serviceStage);
}

function staffIdOf(value) {
  if (value == null) return '';
  if (typeof value === 'object') return String(value._id || value.id || '');
  return String(value);
}

function appointmentSummary(value) {
  const match = String(value || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return '上门时间待确认';
  const start = new Date(match[1].replaceAll('"', ''));
  const end = new Date(match[2].replaceAll('"', ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '上门时间待确认';
  const pad = (number) => String(number).padStart(2, '0');
  return `${start.getMonth() + 1}月${start.getDate()}日 ${pad(start.getHours())}:${pad(start.getMinutes())}-${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

Page({
  data: {
    leadId: '',
    lead: null,
    activeFloorPlan: null,
    previousFloorPlans: [],
    staffRole: '',
    canEditMeasurements: false,
    canEditProfile: false,
    appointment: null,
    canScheduleAppointment: false,
    canRebookAppointment: false,
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
    publishedSchemes: [],
    canOpenAIDesign: false,
    measurerContact: getStaffContact(null),
    designerContact: getStaffContact(null),
    canViewFloorPlanPreview: false,
    floorPlanPreviewPath: '',
    floorPlanPreviewState: '',
    floorPlanPreviewSegments: [],
    houseFacts: null,
    showStaffAssignSheet: false,
    staffAssignRole: '',
    staffAssignLoading: false,
    staffAssignSubmitting: false,
    staffAssignCandidates: [],
    staffAssignError: '',
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
    const publishedSchemes = (Array.isArray(lead.publishedSchemes) ? lead.publishedSchemes : [])
      .map((scheme) => decoratePublishedScheme(scheme, this.data.leadId));
    const staffRole = getStaffRole();
    const staffId = getStaffId();
    const isAssignedMeasurer = Boolean(staffId) && staffIdOf(lead.measurerId) === staffId;
    const conversionActions = lead.conversionActions || {};
    const activeFloorPlan = formalPlans[0] || null;
    const canAssignStaff = staffRole === 'enterprise_admin' && !lead.archivedAt;
    const previewState = buildFloorPlanPreviewState(this.data.leadId, activeFloorPlan);
    this.setData({
      lead,
      staffRole,
      statusLabel: lead.serviceStageLabel || STATUS_LABELS[lead.status] || lead.status || '新线索',
      nextAction: lead.nextAction || getNextAction(lead.status, staffRole, isAssignedMeasurer),
      stageRail: buildStageRail(lead.status),
      canMarkConverted: Boolean(conversionActions.canMarkConverted),
      canRevertConversion: Boolean(conversionActions.canRevertConversion),
      convertedByName: getStaffName(lead.convertedBy) || '历史数据未记录',
      convertedTime: formatConfirmationDate(lead.convertedAt),
      convertedAmountText: formatContractAmount(lead.contractAmount),
      showInternalConversionDetails: ['enterprise_admin', 'designer', 'measurer', 'salesperson'].includes(staffRole),
      canEditProfile: canEditLeadProfile(lead, staffRole, staffId),
      canEditMeasurements: staffRole === 'measurer' || isAssignedMeasurer,
      conversionSkipsStages: !['designing', 'measured', 'assigned', 'quoting'].includes(lead.status),
      activeFloorPlan,
      previousFloorPlans: formalPlans.slice(1),
      publishedSchemes,
      canOpenAIDesign: canOpenAIDesignWorkbench(lead, staffRole, formalPlans),
      measurerContact: getStaffContact(lead.measurerId, { canAssign: canAssignStaff && !lead.measurerId }),
      designerContact: getStaffContact(lead.assignedTo, { canAssign: canAssignStaff && !lead.assignedTo }),
      canViewFloorPlanPreview: canViewFloorPlanPreview(lead, staffRole, staffId, activeFloorPlan),
      floorPlanPreviewPath: previewState.previewPath,
      floorPlanPreviewState: previewState.previewState,
      floorPlanPreviewSegments: previewState.previewSegments,
      loading: false
    });
    this.refreshAppointmentEntry(staffRole, lead, isAssignedMeasurer);
    this.loadPublishedSchemeCovers(publishedSchemes);
    this.loadFloorPlanPreview(activeFloorPlan, previewState);
  },

  async loadFloorPlanPreview(plan, previewState) {
    const state = previewState || buildFloorPlanPreviewState(this.data.leadId, plan);
    if (!this.data.canViewFloorPlanPreview || !plan || !state.previewEndpoint) return;
    if (state.previewPath) {
      this.setData({
        floorPlanPreviewPath: state.previewPath,
        floorPlanPreviewState: 'loaded',
      });
      return;
    }
    try {
      const previewPath = await fetchProtectedImage(
        state.previewEndpoint,
        state.previewCacheKey || floorPlanCacheKey(this.data.leadId, plan)
      );
      this.setData({
        floorPlanPreviewPath: previewPath,
        floorPlanPreviewState: 'loaded',
      });
    } catch (error) {
      const segments = createWallSegments(plan.layoutData);
      this.setData({
        floorPlanPreviewState: segments.length ? 'graph' : 'error',
        floorPlanPreviewSegments: segments,
      });
    }
  },

  async loadPublishedSchemeCovers(schemes) {
    const list = Array.isArray(schemes) ? schemes : [];
    if (!list.length) return;
    const updates = {};
    await Promise.all(list.map(async (scheme, index) => {
      if (!scheme || !scheme.coverEndpoint) return;
      try {
        const coverPath = await fetchProtectedImage(
          scheme.coverEndpoint,
          scheme.coverCacheKey || publishedImageCacheKey(this.data.leadId, scheme.id || index)
        );
        updates[`publishedSchemes[${index}].coverPath`] = coverPath;
      } catch (error) {
        // Keep mint placeholder when protected cover cannot load.
      }
    }));
    if (Object.keys(updates).length) this.setData(updates);
  },

  async refreshAppointmentEntry(staffRole, lead, isAssignedMeasurer) {
    const hideOperational = shouldHideOperationalAppointment(lead);
    const activeFloorPlan = this.data.activeFloorPlan;
    const needsHouseFacts = Boolean(
      lead
      && activeFloorPlan
      && POST_SURVEY_SERVICE_STAGES.has(lead.serviceStage)
    );
    const canOpen = ['designer', 'measurer', 'enterprise_admin'].includes(staffRole)
      && lead
      && this.data.leadId;

    if (!needsHouseFacts && hideOperational) {
      this.setData({
        appointment: null,
        canScheduleAppointment: false,
        canRebookAppointment: false,
        houseFacts: null,
      });
      return;
    }
    if (!canOpen) {
      this.setData({
        appointment: null,
        canScheduleAppointment: false,
        canRebookAppointment: false,
        houseFacts: buildHouseFacts(lead, activeFloorPlan, null),
      });
      return;
    }
    try {
      const result = await api.request(`/appointments?leadId=${encodeURIComponent(this.data.leadId)}`, 'GET');
      const items = result.data || [];
      const appointment = items.find((item) => item.status === 'confirmed')
        || items.find((item) => item.status === 'expired' || item.status === 'cancelled')
        || items[0]
        || null;
      const normalizedAppointment = appointment
        ? { ...appointment, summary: appointmentSummary(appointment.timeRange) }
        : null;
      const canBook = !hideOperational
        && Boolean(lead.canRebook)
        && (
          staffRole === 'enterprise_admin'
          || staffRole === 'designer'
          || (staffRole === 'measurer' && lead.source === 'staff_activity' && isAssignedMeasurer)
        );
      this.setData({
        appointment: hideOperational ? null : normalizedAppointment,
        canScheduleAppointment: canBook,
        canRebookAppointment: canBook && Boolean(appointment),
        houseFacts: buildHouseFacts(lead, activeFloorPlan, normalizedAppointment),
      });
    } catch (error) {
      this.setData({
        appointment: null,
        canScheduleAppointment: false,
        canRebookAppointment: false,
        houseFacts: buildHouseFacts(lead, activeFloorPlan, null),
      });
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

  onRetryDetail() {
    this.fetchLeadDetail();
  },

  onCallStaff(event) {
    const phone = String((event.currentTarget.dataset && event.currentTarget.dataset.phone) || '').trim();
    if (!phone) return;
    wx.makePhoneCall({ phoneNumber: phone });
  },

  onStaffCardTap(event) {
    const role = String((event.currentTarget.dataset && event.currentTarget.dataset.role) || '');
    const contact = role === 'designer' ? this.data.designerContact : this.data.measurerContact;
    if (contact && contact.canAssign) {
      this.openStaffAssignSheet(role);
      return;
    }
    this.onCallStaff(event);
  },

  openStaffAssignSheet(role) {
    if (this.data.staffRole !== 'enterprise_admin' || this.data.staffAssignSubmitting) return;
    const normalizedRole = role === 'measurer' ? 'measurer' : 'designer';
    this.setData({
      showStaffAssignSheet: true,
      staffAssignRole: normalizedRole,
      staffAssignLoading: true,
      staffAssignError: '',
      staffAssignCandidates: [],
    });
    this.loadStaffAssignCandidates(normalizedRole);
  },

  onCloseStaffAssignSheet() {
    if (this.data.staffAssignSubmitting) return;
    this.setData({
      showStaffAssignSheet: false,
      staffAssignRole: '',
      staffAssignCandidates: [],
      staffAssignError: '',
    });
  },

  async loadStaffAssignCandidates(role) {
    try {
      const result = await api.request(
        `/miniprogram/enterprise-staff?role=${encodeURIComponent(role)}`,
        'GET'
      );
      const items = (result.data && result.data.items) || [];
      const staffAssignCandidates = items
        .filter((item) => item && item.assignmentEligible)
        .map((item) => ({
          id: item.id,
          displayName: item.displayName,
          phone: item.phone || '',
          roleLabel: item.roleLabel,
          statusLabel: item.statusLabel,
          statusTone: item.statusTone,
        }));
      this.setData({
        staffAssignLoading: false,
        staffAssignCandidates,
        staffAssignError: staffAssignCandidates.length ? '' : '当前没有可派人员',
      });
    } catch (error) {
      this.setData({
        staffAssignLoading: false,
        staffAssignError: (error && (error.error || error.message)) || '人员名册加载失败',
        staffAssignCandidates: [],
      });
    }
  },

  async onConfirmStaffAssign(event) {
    const staffId = String((event.currentTarget.dataset && event.currentTarget.dataset.id) || '');
    const role = this.data.staffAssignRole;
    if (!staffId || !role || !this.data.leadId || this.data.staffAssignSubmitting) return;
    this.setData({ staffAssignSubmitting: true });
    try {
      const payload = role === 'designer'
        ? { designerId: staffId }
        : { measurerId: staffId };
      const res = await api.request(`/leads/${this.data.leadId}/assign-staff`, 'POST', payload);
      if (!res.success || !res.data) throw new Error((res && res.error) || '派单失败');
      this.setData({ showStaffAssignSheet: false, staffAssignRole: '' });
      this.applyLeadDetail(res.data);
      wx.showToast({ title: '派单成功', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: (err && err.error) || (err && err.message) || '派单失败，请重试', icon: 'none' });
    } finally {
      this.setData({ staffAssignSubmitting: false });
    }
  },

  onPreviewFloorPlan() {
    const { floorPlanPreviewPath } = this.data;
    if (!floorPlanPreviewPath) return;
    wx.previewImage({ current: floorPlanPreviewPath, urls: [floorPlanPreviewPath] });
  },

  onScheduleAppointment() {
    if (!this.data.canScheduleAppointment || !this.data.leadId) return;
    wx.navigateTo({
      url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(this.data.leadId)}`,
    });
  },

  onOpenAppointment() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.leadId) return;
    wx.navigateTo({
      url: `/packages/business/appointment-detail/appointment-detail?leadId=${encodeURIComponent(this.data.leadId)}&appointmentId=${encodeURIComponent(appointment.id)}`
    });
  },

  onOpenPublishedScheme(event) {
    const schemeIndex = Number(event.currentTarget.dataset.schemeIndex);
    const scheme = this.data.publishedSchemes[schemeIndex];
    if (!scheme || !this.data.leadId) return;
    const schemeId = encodeURIComponent(scheme.id || '');
    wx.navigateTo({
      url: `/packages/business/customer-ai-schemes/customer-ai-schemes?leadId=${encodeURIComponent(this.data.leadId)}&schemeId=${schemeId}&mode=staff`,
    });
  },

  onOpenAllPublishedSchemes() {
    if (!this.data.leadId || !this.data.publishedSchemes.length) return;
    const finalized = this.data.publishedSchemes.find((scheme) => scheme && scheme.finalized);
    const schemeId = finalized ? `&schemeId=${encodeURIComponent(finalized.id)}` : '';
    wx.navigateTo({
      url: `/packages/business/customer-ai-schemes/customer-ai-schemes?leadId=${encodeURIComponent(this.data.leadId)}${schemeId}&mode=staff`,
    });
  },

  onOpenAIDesignWorkbench() {
    if (!this.data.canOpenAIDesign) return;
    const plan = this.data.activeFloorPlan;
    openAIDesignEntry({
      leadId: this.data.leadId,
      floorPlanId: plan && plan._id,
    });
  },

  onEditProfile() {
    if (!this.data.canEditProfile || !this.data.leadId) return;
    wx.navigateTo({
      url: `/packages/business/lead-form/lead-form?mode=edit&leadId=${encodeURIComponent(this.data.leadId)}`
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

  onHistoryRecordTap(e) {
    if (!this.data.canEditMeasurements) return;
    this.onContinueMeasure(e);
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
