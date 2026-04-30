const app = getApp();
const api = require('../../utils/api.js');

function formatPickerDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatPickerTime(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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
    followUpNote: '',
    followUpDate: '',
    followUpTime: '09:00',
    followUpStatusText: '',
    measureDueText: '',
    designDueText: '',
    measureResultSummary: '',
    designNote: '',
    measurers: [],
    designers: [],
    salespeople: [],
    measurerIndex: -1,
    designerIndex: -1,
    promoterIndex: -1,
    selectedMeasurerName: '选择测量员',
    selectedDesignerName: '选择设计师',
    selectedPromoterName: '选择地推员'
  },

  onLoad(options) {
    this.setData({
      mode: options.mode || 'detail',
      recordId: options.id || '',
      userInfo: app.globalData.userInfo || {}
    });
    wx.setNavigationBarTitle({
      title: options.mode === 'create' ? '新建报备' : '报备详情'
    });
  },

  onShow() {
    if (this.data.mode === 'create') return;
    this.fetchDetail();
  },

  async fetchDetail() {
    const openid = app.globalData.openid;
    if (!openid || !this.data.recordId) return;

    this.setData({ loading: true });
    try {
      const res = await api.request(`/promotion-records/${this.data.recordId}?openid=${openid}`, 'GET');
      if (res.success) {
        const record = res.data;
        const nextFollowUpAt = record.nextFollowUpAt ? new Date(record.nextFollowUpAt) : null;

        this.setData({
          record,
          followUpDate: nextFollowUpAt ? formatPickerDate(nextFollowUpAt) : '',
          followUpTime: nextFollowUpAt ? formatPickerTime(nextFollowUpAt) : '09:00',
          followUpStatusText: this.buildDueStatusText(record.nextFollowUpAt, '跟进'),
          measureDueText: this.buildDueStatusText(record.measureTask && record.measureTask.dueAt, '测量'),
          designDueText: this.buildDueStatusText(record.designTask && record.designTask.dueAt, '设计'),
          loading: false
        });

        if ((app.globalData.userInfo || {}).staffRole === 'enterprise_admin') {
          this.fetchStaffOptions(record);
        }
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
        api.request(`/staff?openid=${openid}&roles=measurer`, 'GET'),
        api.request(`/staff?openid=${openid}&roles=designer`, 'GET'),
        api.request(`/staff?openid=${openid}&roles=salesperson`, 'GET')
      ]);

      const measurers = measurersRes.data || [];
      const designers = designersRes.data || [];
      const salespeople = salesRes.data || [];

      this.setData({
        measurers,
        designers,
        salespeople,
        measurerIndex: measurers.findIndex(item => item._id === record.measureTask.assignedTo?._id),
        designerIndex: designers.findIndex(item => item._id === record.designTask.assignedTo?._id),
        promoterIndex: salespeople.findIndex(item => item._id === (record.promoterId._id || record.promoterId)),
        selectedMeasurerName: record.measureTask.assignedTo?.displayName || record.measureTask.assignedTo?.username || '选择测量员',
        selectedDesignerName: record.designTask.assignedTo?.displayName || record.designTask.assignedTo?.username || '选择设计师',
        selectedPromoterName: record.promoterId.displayName || record.promoterId.username || '选择地推员'
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

  onFollowUpInput(e) {
    this.setData({ followUpNote: e.detail.value });
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
    const openid = app.globalData.openid;
    const { form } = this.data;
    if (!form.enterpriseName || !form.contactPerson || !form.phone) {
      wx.showToast({ title: '请填写必填项', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中' });
    try {
      const res = await api.request('/promotion-records', 'POST', {
        openid,
        ...form,
        location: this.data.location
      });
      wx.hideLoading();
      if (res.success) {
        wx.showToast({ title: '报备成功', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/promotion-record-detail/promotion-record-detail?id=${res.data._id}`
          });
        }, 600);
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.error || '提交失败', icon: 'none' });
    }
  },

  async updateRecord(payload) {
    const openid = app.globalData.openid;
    try {
      const res = await api.request(`/promotion-records/${this.data.recordId}`, 'PUT', {
        openid,
        ...payload
      });
      if (res.success) {
        wx.showToast({ title: '操作成功', icon: 'success' });
        this.setData({
          followUpNote: '',
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
      selectedMeasurerName: item ? (item.displayName || item.username) : '选择测量员'
    });
  },

  onDesignerChange(e) {
    const designerIndex = Number(e.detail.value);
    const item = this.data.designers[designerIndex];
    this.setData({
      designerIndex,
      selectedDesignerName: item ? (item.displayName || item.username) : '选择设计师'
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
  }
});
