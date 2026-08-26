const app = getApp();
const api = require('../../../utils/api.js');

function formatPickerDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPickerTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const STAGE_INDEX = {
  reported: 0,
  contacted: 1,
  measuring: 2,
  designing: 3,
  quoted: 4,
  paid: 4,
};

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatStageTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function maskPhone(value) {
  const phone = String(value || '').trim();
  if (/^1\d{10}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  if (phone.length > 7) return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  return phone;
}

function getStaffName(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'string') return fallback;
  return value.displayName || value.username || fallback;
}

function getOperatorId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value._id || value.id || '');
}

function buildNextStageLabel(stage) {
  const labels = {
    reported: '待联系',
    contacted: '待量房',
    measuring: '量房中',
    designing: '设计中',
    quoted: '待成交',
    paid: '已成交',
    closed_lost: '已失效',
  };
  return labels[stage] || '待跟进';
}

function buildStageSteps(record) {
  const stage = record.businessStage || 'reported';
  const stageIndex = STAGE_INDEX[stage] ?? 0;
  const followUps = Array.isArray(record.followUpRecords) ? record.followUpRecords : [];
  const firstContact = followUps
    .filter((item) => item.type === 'follow_up')
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())[0];
  const terminalComplete = stage === 'quoted' || stage === 'paid';
  const isClosedLost = stage === 'closed_lost';
  const currentIndex = terminalComplete || isClosedLost
    ? -1
    : stage === 'reported'
      ? 1
      : stage === 'contacted'
        ? 2
        : Math.min(stageIndex, 3);
  const completedThrough = terminalComplete
    ? 3
    : isClosedLost
      ? 0
      : stage === 'reported'
        ? 0
        : stage === 'contacted'
          ? 1
          : Math.max(1, currentIndex - 1);
  const labels = [
    '已报备',
    stage === 'reported' ? '待联系' : '已联系',
    stage === 'measuring' ? '量房中' : '待量房',
    terminalComplete ? '设计完成' : '设计中',
  ];
  const dates = [
    record.createdAt,
    firstContact && firstContact.createdAt,
    record.measureTask && (record.measureTask.acceptedAt || record.measureTask.assignedAt),
    record.designTask && (record.designTask.completedAt || record.designTask.assignedAt),
  ];

  return labels.map((label, index) => {
    const state = index <= completedThrough ? 'complete' : index === currentIndex ? 'current' : 'pending';
    const nextState = index + 1 <= completedThrough ? 'complete' : index + 1 === currentIndex ? 'current' : 'pending';
    return {
      key: `stage-${index}`,
      label,
      state,
      timeText: state === 'complete' ? formatStageTime(dates[index]) : '',
      connectorComplete: index < labels.length - 1 && nextState !== 'pending',
    };
  });
}

Page({
  data: {
    mode: 'detail',
    recordId: '',
    record: null,
    loading: false,
    userInfo: {},
    form: {
      enterpriseName: '',
      creditCode: '',
      contactPerson: '',
      phone: '',
      city: '',
      address: '',
      industry: '',
      notes: ''
    },
    location: null,
    locationLabel: '',
    submitting: false,
    industryOptions: ['装修公司', '设计公司', '建材企业', '施工企业', '房地产/物业', '其他'],
    industryIndex: -1,
    selectedRegion: [],
    followUpNote: '',
    followUpDate: '',
    followUpTime: '',
    followUpNoteLength: 0,
    followUpStatusText: '',
    claimStatusText: '',
    claimRequestedAtText: '',
    measureDueText: '',
    designDueText: '',
    timelineRecords: [],
    measureResultSummary: '',
    designNote: '',
    measurers: [],
    designers: [],
    salespeople: [],
    measurerIndex: -1,
    designerIndex: -1,
    promoterIndex: -1,
    selectedMeasurerName: '选择家装现场顾问',
    selectedDesignerName: '选择家装设计顾问',
    selectedPromoterName: '选择地推员',
    measurerAssignmentLabel: '未分配',
    designerAssignmentLabel: '未分配',
    maskedPhone: '',
    nextStageLabel: '待跟进',
    reportedAtText: '',
    stageSteps: []
  },

  onLoad(options) {
    this.setData({
      mode: options.mode || 'detail',
      recordId: options.id || '',
      userInfo: app.globalData.userInfo || wx.getStorageSync('userInfo') || {}
    });
    wx.setNavigationBarTitle({
      title: options.mode === 'create' ? '新建企业报备' : '报备详情'
    });
  },

  onShow() {
    if (this.data.mode === 'create') return;
    this.fetchDetail();
  },

  async fetchDetail() {
    const openid = app.globalData.openid;
    const token = wx.getStorageSync('token');
    if ((!openid && !token) || !this.data.recordId) return;

    this.setData({ loading: true });
    try {
      const res = await api.request(`/promotion-records/${this.data.recordId}`, 'GET');
      if (res.success) {
        const record = res.data;
        const nextFollowUpAt = record.nextFollowUpAt ? new Date(record.nextFollowUpAt) : null;
        const currentUser = this.data.userInfo || {};
        const currentUserId = String(currentUser._id || currentUser.id || '');
        const currentUserName = currentUser.displayName || currentUser.username || '';
        const timelineRecords = (record.followUpRecords || [])
          .slice()
          .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
          .map((item, index) => ({
            ...item,
            key: `${item.createdAt || 'timeline'}-${index}`,
            displayTime: formatDateTime(item.createdAt),
            isSelf: Boolean(
              (currentUserId && getOperatorId(item.operatorId) === currentUserId) ||
              (currentUserName && item.operator === currentUserName)
            ),
          }));

        this.setData({
          record,
          followUpDate: nextFollowUpAt ? formatPickerDate(nextFollowUpAt) : '',
          followUpTime: nextFollowUpAt ? formatPickerTime(nextFollowUpAt) : '',
          followUpStatusText: this.buildDueStatusText(record.nextFollowUpAt, '跟进'),
          claimStatusText: this.buildClaimStatusText(record),
          claimRequestedAtText: record.claimRequest && record.claimRequest.requestedAt ? this.formatTimelineDate(record.claimRequest.requestedAt) : '',
          measureDueText: this.buildDueStatusText(record.measureTask && record.measureTask.dueAt, '测量'),
          designDueText: this.buildDueStatusText(record.designTask && record.designTask.dueAt, '设计'),
          timelineRecords,
          maskedPhone: maskPhone(record.phone),
          nextStageLabel: buildNextStageLabel(record.businessStage),
          reportedAtText: formatDateTime(record.createdAt),
          stageSteps: buildStageSteps(record),
          measurerAssignmentLabel: getStaffName(record.measureTask && record.measureTask.assignedTo, '未分配'),
          designerAssignmentLabel: getStaffName(record.designTask && record.designTask.assignedTo, '未分配'),
          loading: false
        });

        if ((this.data.userInfo || {}).staffRole === 'enterprise_admin') {
          this.fetchStaffOptions(record);
        }
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  async fetchStaffOptions(record) {
    const openid = app.globalData.openid;
    try {
      const [measurersRes, designersRes, salesRes] = await Promise.all([
        api.request('/staff?roles=measurer', 'GET'),
        api.request('/staff?roles=designer', 'GET'),
        api.request('/staff?roles=salesperson', 'GET')
      ]);

      const measurers = measurersRes.data || [];
      const designers = designersRes.data || [];
      const salespeople = salesRes.data || [];

      this.setData({
        measurers,
        designers,
        salespeople,
        measurerIndex: measurers.findIndex(item => item._id === (record.measureTask && record.measureTask.assignedTo?._id)),
        designerIndex: designers.findIndex(item => item._id === (record.designTask && record.designTask.assignedTo?._id)),
        promoterIndex: salespeople.findIndex(item => item._id === ((record.promoterId && record.promoterId._id) || record.promoterId)),
        selectedMeasurerName: getStaffName(record.measureTask && record.measureTask.assignedTo, '选择家装现场顾问'),
        selectedDesignerName: getStaffName(record.designTask && record.designTask.assignedTo, '选择家装设计顾问'),
        measurerAssignmentLabel: getStaffName(record.measureTask && record.measureTask.assignedTo, '未分配'),
        designerAssignmentLabel: getStaffName(record.designTask && record.designTask.assignedTo, '未分配'),
        selectedPromoterName: (record.promoterId && (record.promoterId.displayName || record.promoterId.username)) || '选择地推员'
      });
    } catch (err) {
      console.error('Failed to load staff options', err);
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`form.${field}`]: e.detail.value
    });
  },

  onChooseLocation() {
    wx.chooseLocation({
      success: (res) => {
        this.setData({
          location: {
            latitude: res.latitude,
            longitude: res.longitude,
            name: res.name || res.address || ''
          },
          locationLabel: res.name || res.address || '已选择定位'
        });
      }
    });
  },

  onIndustryChange(e) {
    const industryIndex = Number(e.detail.value);
    const industry = this.data.industryOptions[industryIndex] || '';
    this.setData({
      industryIndex,
      'form.industry': industry
    });
  },

  onRegionChange(e) {
    const selectedRegion = e.detail.value || [];
    this.setData({
      selectedRegion,
      'form.city': selectedRegion.filter(Boolean).join(' ')
    });
  },

  onFollowUpInput(e) {
    const followUpNote = e.detail.value || '';
    this.setData({
      followUpNote,
      followUpNoteLength: followUpNote.length
    });
  },

  onFollowUpDateChange(e) {
    this.setData({ followUpDate: e.detail.value });
  },

  onFollowUpTimeChange(e) {
    this.setData({ followUpTime: e.detail.value });
  },

  onMeasureResultInput(e) {
    this.setData({ measureResultSummary: e.detail.value });
  },

  onDesignNoteInput(e) {
    this.setData({ designNote: e.detail.value });
  },

  async onCreateRecord() {
    if (this.data.submitting) return;
    const openid = app.globalData.openid;
    const { form } = this.data;
    if (!form.enterpriseName || !form.contactPerson || !form.phone) {
      wx.showToast({ title: '请填写必填项', icon: 'none' });
      return;
    }

    this.setData({ submitting: true });
    wx.showLoading({ title: '提交中' });
    try {
      const res = await api.request('/promotion-records', 'POST', {
        ...form,
        location: this.data.location
      });
      wx.hideLoading();
      if (res.success) {
        this.setData({ submitting: false });
        wx.showToast({ title: '报备成功', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({
            url: `/packages/business/promotion-record-detail/promotion-record-detail?id=${res.data._id}`
          });
        }, 600);
      } else {
        this.setData({ submitting: false });
        wx.showToast({ title: res.error || '提交失败', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      this.setData({ submitting: false });
      wx.showToast({ title: err.error || '提交失败', icon: 'none' });
    }
  },

  async onClaimRecord() {
    const openid = app.globalData.openid;
    if (!openid || !this.data.recordId) return;

    wx.showLoading({ title: '认领中' });
    try {
      const res = await api.request(`/promotion-records/pool`, 'POST', {
        recordId: this.data.recordId
      });
      wx.hideLoading();
      if (res.success) {
        const isPendingApproval = res.data && res.data.poolStatus === 'claimed' && res.data.claimRequest && res.data.claimRequest.status === 'pending';
        wx.showToast({ title: isPendingApproval ? '已提交认领申请' : '认领成功', icon: 'success' });
        this.fetchDetail(); // 刷新详情
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.error || '认领失败', icon: 'none' });
    }
  },

  async updateRecord(payload) {
    const openid = app.globalData.openid;
    try {
      const res = await api.request(`/promotion-records/${this.data.recordId}`, 'PUT', {
        ...payload
      });
      if (res.success) {
        wx.showToast({ title: '操作成功', icon: 'success' });
        this.setData({
          followUpNote: '',
          followUpNoteLength: 0,
          measureResultSummary: '',
          designNote: ''
        });
        this.fetchDetail();
      }
    } catch (err) {
      wx.showToast({ title: err.error || '更新失败', icon: 'none' });
    }
  },

  onSaveFollowUp() {
    if (!this.data.followUpNote.trim() && !this.data.followUpDate) return;
    this.updateRecord({
      followUpNote: this.data.followUpNote,
      nextFollowUpAt: this.buildNextFollowUpAt()
    });
  },

  onCompleteFollowUp() {
    this.updateRecord({
      followUpCompleted: true,
      nextFollowUpAt: this.buildNextFollowUpAt()
    });
  },

  onAcceptMeasure() {
    this.updateRecord({ measureTaskStatus: 'accepted' });
  },

  onSubmitMeasure() {
    this.updateRecord({
      measureTaskStatus: 'submitted',
      measureResultSummary: this.data.measureResultSummary
    });
  },

  onStartDesign() {
    this.updateRecord({
      designTaskStatus: 'in_progress',
      designNote: this.data.designNote
    });
  },

  onCompleteDesign() {
    this.updateRecord({
      designTaskStatus: 'completed',
      designNote: this.data.designNote
    });
  },

  onMeasurerChange(e) {
    const measurerIndex = Number(e.detail.value);
    const item = this.data.measurers[measurerIndex];
    this.setData({
      measurerIndex,
      selectedMeasurerName: item ? (item.displayName || item.username) : '选择家装现场顾问',
      measurerAssignmentLabel: item ? (item.displayName || item.username) : '未分配'
    });
  },

  onDesignerChange(e) {
    const designerIndex = Number(e.detail.value);
    const item = this.data.designers[designerIndex];
    this.setData({
      designerIndex,
      selectedDesignerName: item ? (item.displayName || item.username) : '选择家装设计顾问',
      designerAssignmentLabel: item ? (item.displayName || item.username) : '未分配'
    });
  },

  onPromoterChange(e) {
    const promoterIndex = Number(e.detail.value);
    const item = this.data.salespeople[promoterIndex];
    this.setData({
      promoterIndex,
      selectedPromoterName: item ? (item.displayName || item.username) : '选择地推员'
    });
  },

  onAssignMeasurer() {
    const item = this.data.measurers[this.data.measurerIndex];
    if (!item) return;
    this.updateRecord({ assignMeasurer: item._id });
  },

  onAssignDesigner() {
    const item = this.data.designers[this.data.designerIndex];
    if (!item) return;
    this.updateRecord({ assignDesigner: item._id });
  },

  onResolveConflict() {
    const item = this.data.salespeople[this.data.promoterIndex];
    if (!item) return;
    this.updateRecord({
      ownershipStatus: 'manually_locked',
      promoterId: item._id,
      resolution: 'manual_override'
    });
  },

  buildNextFollowUpAt() {
    if (!this.data.followUpDate) return '';
    return `${this.data.followUpDate}T${this.data.followUpTime || '09:00'}:00`;
  },

  buildDueStatusText(value, label) {
    if (!value) return `${label}截止时间未设置`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return `${label}截止时间未设置`;
    const text = `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    if (date.getTime() < Date.now()) {
      return `${label}已超时：${text}`;
    }
    return `${label}截止：${text}`;
  },

  buildClaimStatusText(record) {
    if (!record || !record.poolStatus) return '';
    if (record.poolStatus === 'claimed' && record.claimRequest && record.claimRequest.status === 'pending') {
      return '认领申请待管理员审批';
    }
    if (record.poolStatus === 'in_pool') {
      return '当前在公海池，可认领';
    }
    if (record.poolStatus === 'protected') {
      return '当前处于保护期';
    }
    return '';
  },

  formatTimelineDate(value) {
    return formatDateTime(value);
  }
});
