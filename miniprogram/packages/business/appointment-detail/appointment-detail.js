const api = require('../../../utils/api');
const surveyLayout = require('../../../utils/surveyLayout.js');
const { openSurveyingEditor } = require('../../../utils/surveyNavigation.js');
const {
  canEditLeadProfile,
  shouldOfferCommunitySync,
  syncAddressToLeadCommunity,
} = require('../../../utils/appointmentCommunitySync.js');
const {
  timeText,
  appointmentDates,
  formatConfirmRescheduleLabel,
} = require('../../../utils/appointmentSlotPicker.js');
const { formatAppointmentDisplay } = require('../../../utils/appointmentTimeRange.js');
const sitePhotos = require('../../../utils/sitePhotoService.js');

const STATUS_LABELS = {
  confirmed: '已确认',
  completed: '已完成',
  cancelled: '已取消',
  expired: '已过期'
};

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

function getStaffRole() {
  const app = getApp();
  const user = app && app.globalData && app.globalData.userInfo;
  return user && (user.staffRole || (user.role === 'staff' ? '' : user.role)) || '';
}

function getStaffId() {
  const app = getApp();
  const user = app && app.globalData && app.globalData.userInfo;
  if (!user) return '';
  return String(user.staffId || '');
}

function parseRange(value) {
  const display = formatAppointmentDisplay(value);
  return { dateText: display.dateText, timeText: display.timeText };
}

function hasCoordinates(appointment) {
  return appointment && appointment.latitude != null && appointment.longitude != null
    && Number.isFinite(Number(appointment.latitude))
    && Number.isFinite(Number(appointment.longitude));
}

function collectLeadPlans(lead) {
  const plans = [];
  const primary = lead && lead.primaryFloorPlanId;
  if (primary && typeof primary === 'object' && primary._id) plans.push(primary);
  (Array.isArray(lead && lead.floorPlanIds) ? lead.floorPlanIds : []).forEach((plan) => {
    if (plan && plan._id) plans.push(plan);
  });
  const seen = Object.create(null);
  return plans.filter((plan) => {
    const id = String(plan._id);
    if (!id || seen[id]) return false;
    seen[id] = true;
    return true;
  });
}

function hasCompletedFormalSurvey(lead) {
  return collectLeadPlans(lead).some((plan) => {
    if (plan.status !== 'completed') return false;
    const layout = surveyLayout.parseFormalSurveyLayout(plan.layoutData);
    if (!layout) return false;
    const floors = layout.surveyGraph && layout.surveyGraph.floors;
    if (!Array.isArray(floors)) return false;
    return floors.some((floor) => (floor.spaces || []).some((space) => space.closed === true));
  });
}

function selectLeadFloorPlan(lead) {
  return collectLeadPlans(lead).sort((left, right) => {
    const leftTime = new Date(left.updatedAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || 0).getTime();
    return rightTime - leftTime;
  })[0] || null;
}

function buildAppointmentsQuery(leadId, appointmentId) {
  const params = [];
  if (leadId) params.push(`leadId=${encodeURIComponent(leadId)}`);
  if (appointmentId) params.push(`appointmentId=${encodeURIComponent(appointmentId)}`);
  return `/appointments?${params.join('&')}`;
}

async function resolveLeadLifecycle(appointment, role) {
  const staffSurveyRole = ['measurer', 'enterprise_admin'].includes(role);
  const lifecycleOpen = appointment.status === 'confirmed' || appointment.status === 'expired';
  const emptyProfile = {
    communityName: '',
    canEditProfile: false,
  };
  if (!appointment.leadId) {
    return {
      leadTerminal: false,
      canComplete: false,
      canStartSurvey: false,
      startSurveyLabel: '开始量房',
      surveyFloorPlanId: '',
      ...emptyProfile,
    };
  }
  try {
    const leadResult = await api.request(`/leads/${encodeURIComponent(appointment.leadId)}`, 'GET');
    const lead = leadResult.data;
    const profile = {
      communityName: String(lead && lead.communityName || '').trim(),
      canEditProfile: canEditLeadProfile(lead, role, getStaffId()),
    };
    const leadTerminal = ['converted', 'closed'].includes(String(lead && lead.status || ''));
    if (leadTerminal || !lifecycleOpen || !staffSurveyRole) {
      return {
        leadTerminal,
        canComplete: false,
        canStartSurvey: false,
        startSurveyLabel: '开始量房',
        surveyFloorPlanId: '',
        ...profile,
      };
    }
    const activePlan = selectLeadFloorPlan(lead);
    const surveyReady = lead.serviceStage === 'survey_ready' || hasCompletedFormalSurvey(lead);
    return {
      leadTerminal: false,
      canComplete: surveyReady,
      canStartSurvey: !surveyReady,
      startSurveyLabel: activePlan ? '继续量房' : '开始量房',
      surveyFloorPlanId: activePlan ? String(activePlan._id) : '',
      ...profile,
    };
  } catch (error) {
    return {
      leadTerminal: false,
      canComplete: false,
      canStartSurvey: staffSurveyRole && lifecycleOpen,
      startSurveyLabel: '开始量房',
      surveyFloorPlanId: '',
      ...emptyProfile,
    };
  }
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    appointmentId: '',
    leadId: '',
    customerMode: false,
    staffRole: '',
    appointment: null,
    loading: true,
    acting: false,
    error: '',
    canReschedule: false,
    canCancel: false,
    canComplete: false,
    canStartSurvey: false,
    startSurveyLabel: '开始量房',
    surveyFloorPlanId: '',
    canUpdateAddress: false,
    canSyncCommunity: false,
    leadCommunityName: '',
    canEditProfile: false,
    canRebook: false,
    canNavigate: false,
    dates: [],
    dateOffset: 0,
    maxAdvanceDays: 30,
    selectedDate: '',
    slots: [],
    selectedSlot: null,
    selectedSlotStart: '',
    reason: '',
    slotsLoading: false,
    slotsError: '',
    rescheduleSubmitting: false,
    confirmRescheduleLabel: '确认改期至可用时段',
    canCaptureSitePhotos: false,
    sitePhotos: [],
    sitePhotoTags: sitePhotos.SPACE_TAGS,
    sitePhotoUploading: false,
    sitePhotoLimitReached: false,
    sitePhotoCaptureNonce: 0,
  },

  onLoad(options) {
    const appointmentId = options.appointmentId || options.id || '';
    const leadId = options.leadId || '';
    const customerMode = options.mode === 'customer';
    this.setData({
      ...navigationMetrics(),
      appointmentId,
      leadId,
      customerMode,
      staffRole: getStaffRole(),
      loading: Boolean(appointmentId || leadId),
      error: (appointmentId || leadId) ? '' : '缺少预约信息，请返回后重新进入'
    });
  },

  onShow() {
    if (this.data.appointmentId || this.data.leadId) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(
        buildAppointmentsQuery(this.data.leadId, this.data.appointmentId),
        'GET'
      );
      const items = result.data || [];
      const appointment = items.find((item) => item.id === this.data.appointmentId) || items[0];
      if (!appointment) throw new Error('未找到预约记录');
      const confirmed = appointment.status === 'confirmed';
      const expired = appointment.status === 'expired';
      const role = this.data.staffRole;
      const leadId = appointment.leadId || this.data.leadId;
      const lifecycle = await resolveLeadLifecycle(appointment, role);
      const lifecycleOpen = !lifecycle.leadTerminal;
      const canEditProfile = Boolean(lifecycle.canEditProfile);
      const leadCommunityName = String(lifecycle.communityName || '');
      const canSyncCommunity = shouldOfferCommunitySync({
        canEditProfile,
        communityName: leadCommunityName,
        address: appointment.address,
        customerMode: this.data.customerMode,
      });
      const canReschedule = lifecycleOpen && confirmed && !lifecycle.canComplete
        && (this.data.customerMode || ['designer', 'enterprise_admin'].includes(role));
      const dates = canReschedule ? appointmentDates(0, this.data.maxAdvanceDays) : [];
      this.setData({
        appointment: {
          ...appointment,
          ...parseRange(appointment.timeRange),
          statusLabel: STATUS_LABELS[appointment.status] || appointment.status
        },
        appointmentId: appointment.id,
        leadId,
        canReschedule,
        canCancel: lifecycleOpen && confirmed && ['designer', 'enterprise_admin'].includes(role),
        canComplete: lifecycleOpen && lifecycle.canComplete,
        canStartSurvey: lifecycleOpen && lifecycle.canStartSurvey,
        startSurveyLabel: lifecycle.startSurveyLabel,
        surveyFloorPlanId: lifecycle.surveyFloorPlanId,
        canUpdateAddress: lifecycleOpen && confirmed && ['designer', 'measurer', 'enterprise_admin'].includes(role),
        canSyncCommunity,
        leadCommunityName,
        canEditProfile,
        canRebook: lifecycleOpen && (expired || appointment.status === 'cancelled')
          && (this.data.customerMode || ['designer', 'measurer', 'enterprise_admin'].includes(role)),
        canNavigate: confirmed && hasCoordinates(appointment),
        canCaptureSitePhotos: !this.data.customerMode && Boolean(leadId)
          && ['designer', 'measurer', 'enterprise_admin'].includes(role),
        dateOffset: 0,
        dates,
        selectedDate: dates[0] && dates[0].key || '',
        selectedSlot: null,
        selectedSlotStart: '',
        reason: '',
        confirmRescheduleLabel: '确认改期至可用时段',
        slotsError: '',
      });
      if (canReschedule) {
        await this.loadSlots();
      } else {
        this.setData({ slots: [], slotsLoading: false, slotsError: '' });
      }
      if (!this.data.customerMode && leadId) await this.loadSitePhotos();
    } catch (error) {
      this.setData({ error: error.error || error.message || '预约详情加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onBack() { wx.navigateBack(); },

  async loadSitePhotos() {
    if (!this.data.leadId) return;
    try {
      const result = await sitePhotos.list(this.data.leadId);
      this.setData({
        sitePhotos: result.items || [],
        sitePhotoTags: result.spaceTags || sitePhotos.SPACE_TAGS,
        sitePhotoLimitReached: Number(result.remaining || 0) <= 0,
      });
    } catch (error) {
      console.warn('Failed to load site photos', error);
    }
  },

  captureSitePhoto() {
    if (this.data.acting || this.data.sitePhotoUploading) return;
    this.setData({ sitePhotoCaptureNonce: Date.now() });
  },

  onSitePhotoUploading(event) {
    this.setData({ sitePhotoUploading: Boolean(event.detail && event.detail.uploading) });
  },

  onSitePhotosChange(event) {
    const photos = sitePhotos.mergePhotos(this.data.sitePhotos, event.detail || {});
    this.setData({
      sitePhotos: photos,
      sitePhotoLimitReached: photos.length >= 30,
    });
  },

  onShareAppMessage() {
    const { leadId, appointment } = this.data;
    return {
      title: '上门量房预约卡片',
      path: `/packages/business/appointment-detail/appointment-detail?mode=customer&leadId=${encodeURIComponent(leadId || '')}&appointmentId=${encodeURIComponent(appointment && appointment.id || '')}`,
    };
  },

  rebook() {
    if (!this.data.canRebook || !this.data.leadId) return;
    const mode = this.data.customerMode ? 'customer' : 'internal';
    wx.navigateTo({
      url: `/packages/business/appointment-booking/appointment-booking?mode=${mode}&leadId=${encodeURIComponent(this.data.leadId)}`
    });
  },

  async loadSlots() {
    if (!this.data.canReschedule || !this.data.leadId || !this.data.selectedDate) return;
    this.setData({
      slotsLoading: true,
      slotsError: '',
      selectedSlot: null,
      selectedSlotStart: '',
      confirmRescheduleLabel: '确认改期至可用时段',
    });
    try {
      const response = await api.request(
        `/appointments/availability?leadId=${encodeURIComponent(this.data.leadId)}&date=${this.data.selectedDate}`,
        'GET'
      );
      const maxAdvanceDays = Number.isInteger(Number(response.data && response.data.maxAdvanceDays))
        ? Number(response.data.maxAdvanceDays)
        : this.data.maxAdvanceDays;
      this.setData({
        maxAdvanceDays,
        dates: appointmentDates(this.data.dateOffset, maxAdvanceDays),
        slots: (response.data && response.data.slots || []).map((slot) => ({
          ...slot,
          label: `${timeText(slot.startAt)} - ${timeText(slot.endAt)}`,
        })),
      });
    } catch (error) {
      this.setData({
        slots: [],
        slotsError: error.error || error.message || '可用时段加载失败',
      });
    } finally {
      this.setData({ slotsLoading: false });
    }
  },

  chooseDate(event) {
    const selectedDate = event.currentTarget.dataset.date;
    if (!selectedDate || selectedDate === this.data.selectedDate) return;
    this.setData({ selectedDate });
    this.loadSlots();
  },

  previousDates() {
    const dateOffset = Math.max(0, this.data.dateOffset - 5);
    if (dateOffset === this.data.dateOffset) return;
    const dates = appointmentDates(dateOffset, this.data.maxAdvanceDays);
    this.setData({ dateOffset, dates, selectedDate: dates[0] && dates[0].key || '' });
    this.loadSlots();
  },

  nextDates() {
    const dateOffset = this.data.dateOffset + 5;
    if (dateOffset > this.data.maxAdvanceDays) return;
    const dates = appointmentDates(dateOffset, this.data.maxAdvanceDays);
    if (!dates.length) return;
    this.setData({ dateOffset, dates, selectedDate: dates[0] && dates[0].key || '' });
    this.loadSlots();
  },

  chooseSlot(event) {
    const selectedSlot = event.currentTarget.dataset.slot;
    this.setData({
      selectedSlot,
      selectedSlotStart: selectedSlot && selectedSlot.startAt || '',
      confirmRescheduleLabel: formatConfirmRescheduleLabel({ selectedSlot }),
    });
  },

  onReasonInput(event) {
    this.setData({ reason: event.detail.value });
  },

  async submitReschedule() {
    const appointment = this.data.appointment;
    const slot = this.data.selectedSlot;
    if (!appointment || !this.data.canReschedule || !slot || this.data.rescheduleSubmitting) return;
    this.setData({ rescheduleSubmitting: true });
    try {
      const action = this.data.customerMode ? 'customer-reschedule' : 'internal-reschedule';
      const reason = String(this.data.reason || '').trim();
      await api.request(`/appointments/${appointment.id}/${action}`, 'POST', {
        startAt: slot.startAt,
        endAt: slot.endAt,
        version: this.data.appointment.version,
        ...(this.data.customerMode ? {} : { reason }),
      });
      wx.showToast({ title: '改期成功', icon: 'success' });
      this.setData({
        selectedSlot: null,
        selectedSlotStart: '',
        reason: '',
        confirmRescheduleLabel: '确认改期至可用时段',
      });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '改期失败', icon: 'none' });
      await this.load();
    } finally {
      this.setData({ rescheduleSubmitting: false });
    }
  },

  updateAddress() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.canUpdateAddress || this.data.acting) return;
    const hasLocation = hasCoordinates(appointment);
    wx.showActionSheet({
      itemList: hasLocation
        ? ['在地图上选择地点', '手动修改详细地址', '移除地图位置']
        : ['在地图上选择地点', '手动修改详细地址'],
      success: (choice) => {
        if (choice.tapIndex === 0) this.chooseLocationForAddress(appointment);
        if (choice.tapIndex === 1) this.editAddressText(appointment);
        if (choice.tapIndex === 2 && hasLocation) {
          this.saveAddress(appointment, appointment.address, null);
        }
      },
    });
  },

  chooseLocationForAddress(appointment) {
    wx.chooseLocation({
      success: async (result) => {
        const locationName = String(result.name || result.address || '').trim().slice(0, 200);
        const suggestedAddress = String(result.address || locationName || '').trim().slice(0, 300);
        const address = String(appointment.address || '').trim() || suggestedAddress;
        if (!address) return;
        await this.saveAddress(appointment, address, {
          locationName,
          latitude: result.latitude,
          longitude: result.longitude,
          coordinateSystem: 'gcj02',
        });
      },
    });
  },

  editAddressText(appointment) {
    wx.showModal({
      title: appointment.address ? '修改详细地址' : '补充详细地址',
      editable: true,
      content: appointment.address || '',
      placeholderText: '请输入小区、楼栋、单元和门牌号',
      confirmText: '保存地址',
      success: async (result) => {
        if (!result.confirm || this.data.acting) return;
        const address = String(result.content || '').trim();
        if (!address) {
          wx.showToast({ title: '请填写服务地址', icon: 'none' });
          return;
        }
        await this.saveAddress(appointment, address);
      }
    });
  },

  async saveAddress(appointment, address, location) {
    this.setData({ acting: true });
    try {
      await api.request(`/appointments/${appointment.id}/address`, 'POST', {
        address,
        ...(location === undefined ? {} : { location }),
        version: appointment.version,
      });
      wx.showToast({ title: '服务地址已保存', icon: 'success' });
      await this.load();
      this.offerCommunitySync(String(address || '').trim());
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '保存地址失败，请重试', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  },

  offerCommunitySync(address) {
    if (!shouldOfferCommunitySync({
      canEditProfile: this.data.canEditProfile,
      communityName: this.data.leadCommunityName,
      address,
      customerMode: this.data.customerMode,
    })) {
      return;
    }
    wx.showModal({
      title: '同步到客户小区',
      content: '是否将上门地址写入客户资料中的小区？',
      confirmText: '同步写入',
      cancelText: '暂不',
      success: (result) => {
        if (result.confirm) this.syncCommunityFromAddress(address);
      },
    });
  },

  async syncCommunityFromAddress(address) {
    const leadId = this.data.leadId;
    const addressText = String(address || (this.data.appointment && this.data.appointment.address) || '').trim();
    if (!leadId || !addressText || this.data.acting) return;
    this.setData({ acting: true });
    try {
      const result = await syncAddressToLeadCommunity(api, leadId, addressText);
      if (result.synced) {
        this.setData({ leadCommunityName: addressText.slice(0, 160), canSyncCommunity: false });
        wx.showToast({ title: '已写入客户小区', icon: 'success' });
        return;
      }
      if (result.reason === 'already_set') {
        this.setData({ canSyncCommunity: false });
        wx.showToast({ title: '客户已有小区，未覆盖', icon: 'none' });
        return;
      }
      wx.showToast({ title: '地址为空，无法同步', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '同步客户小区失败', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  },

  syncCommunity() {
    if (!this.data.canSyncCommunity) return;
    this.syncCommunityFromAddress(this.data.appointment && this.data.appointment.address);
  },

  openNavigation() {
    const appointment = this.data.appointment;
    if (!hasCoordinates(appointment)) {
      wx.showToast({ title: '暂未记录地图位置，请先补充地点', icon: 'none' });
      return;
    }
    wx.openLocation({
      latitude: Number(appointment.latitude),
      longitude: Number(appointment.longitude),
      name: appointment.locationName || appointment.address || '量房地点',
      address: appointment.address || '',
      scale: 18,
    });
  },

  cancel() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.canCancel || this.data.acting) return;
    wx.showModal({
      title: '取消本次预约',
      content: '',
      editable: true,
      placeholderText: '请填写取消原因',
      confirmText: '确认取消',
      confirmColor: '#c43b31',
      success: async (result) => {
        if (!result.confirm) return;
        const reason = String(result.content || '').trim();
        if (!reason) {
          wx.showToast({ title: '请填写取消原因', icon: 'none' });
          return;
        }
        await this.updateStatus('cancel', { version: appointment.version, reason }, '预约已取消');
      }
    });
  },

  complete() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.canComplete || this.data.acting) return;
    wx.showModal({
      title: '确认完成量房',
      content: '确认测量员已完成本次上门服务。此操作会结束当前预约。',
      confirmText: '确认完成',
      success: async (result) => {
        if (result.confirm) await this.updateStatus('complete', { version: appointment.version }, '预约已完成');
      }
    });
  },

  startSurvey() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.canStartSurvey || this.data.acting) return;
    openSurveyingEditor({
      leadId: appointment.leadId || this.data.leadId,
      floorPlanId: this.data.surveyFloorPlanId || '',
      communityName: appointment.locationName || appointment.address || '',
    });
  },

  async updateStatus(action, body, successText) {
    if (this.data.acting) return;
    this.setData({ acting: true });
    try {
      await api.request(`/appointments/${this.data.appointmentId}/${action}`, 'POST', body);
      wx.showToast({ title: successText, icon: 'success' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.error || error.message || '操作失败，请重试', icon: 'none' });
    } finally {
      this.setData({ acting: false });
    }
  }
});
