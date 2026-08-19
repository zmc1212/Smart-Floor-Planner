const api = require('../../../utils/api');

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

function parseRange(value) {
  const match = String(value || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return { dateText: '时间待确认', timeText: '—' };
  const start = new Date(match[1].replaceAll('"', ''));
  const end = new Date(match[2].replaceAll('"', ''));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { dateText: '时间待确认', timeText: '—' };
  const pad = (number) => String(number).padStart(2, '0');
  return {
    dateText: `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 周${'日一二三四五六'[start.getDay()]}`,
    timeText: `${pad(start.getHours())}:${pad(start.getMinutes())} - ${pad(end.getHours())}:${pad(end.getMinutes())}`
  };
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
    canUpdateAddress: false,
    canRebook: false
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
      loading: Boolean(leadId),
      error: leadId ? '' : '缺少客户线索信息，请返回后重新进入'
    });
  },

  onShow() {
    if (this.data.leadId) this.load();
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(
        `/appointments?leadId=${encodeURIComponent(this.data.leadId)}&appointmentId=${encodeURIComponent(this.data.appointmentId)}`,
        'GET'
      );
      const items = result.data || [];
      const appointment = items.find((item) => item.id === this.data.appointmentId) || items[0];
      if (!appointment) throw new Error('未找到预约记录');
      const confirmed = appointment.status === 'confirmed';
      const expired = appointment.status === 'expired';
      const role = this.data.staffRole;
      this.setData({
        appointment: {
          ...appointment,
          ...parseRange(appointment.timeRange),
          statusLabel: STATUS_LABELS[appointment.status] || appointment.status
        },
        appointmentId: appointment.id,
        canReschedule: confirmed && (this.data.customerMode || ['designer', 'enterprise_admin'].includes(role)),
        canCancel: confirmed && ['designer', 'enterprise_admin'].includes(role),
        canComplete: (confirmed || expired) && ['measurer', 'enterprise_admin'].includes(role),
        canUpdateAddress: confirmed && ['designer', 'measurer', 'enterprise_admin'].includes(role),
        canRebook: (expired || appointment.status === 'cancelled')
          && (this.data.customerMode || ['designer', 'measurer', 'enterprise_admin'].includes(role))
      });
    } catch (error) {
      this.setData({ error: error.error || error.message || '预约详情加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onBack() { wx.navigateBack(); },

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

  reschedule() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.canReschedule) return;
    const mode = this.data.customerMode ? 'customer' : 'internal';
    wx.navigateTo({
      url: `/packages/business/appointment-reschedule/appointment-reschedule?mode=${mode}&leadId=${encodeURIComponent(this.data.leadId)}&appointmentId=${encodeURIComponent(appointment.id)}&version=${appointment.version}`
    });
  },

  updateAddress() {
    const appointment = this.data.appointment;
    if (!appointment || !this.data.canUpdateAddress || this.data.acting) return;
    wx.showModal({
      title: appointment.address ? '修改服务地址' : '补充服务地址',
      editable: true,
      content: appointment.address || '',
      placeholderText: '请输入详细上门地址',
      confirmText: '保存地址',
      success: async (result) => {
        if (!result.confirm || this.data.acting) return;
        const address = String(result.content || '').trim();
        if (!address) {
          wx.showToast({ title: '请填写服务地址', icon: 'none' });
          return;
        }
        this.setData({ acting: true });
        try {
          await api.request(`/appointments/${appointment.id}/address`, 'POST', { address, version: appointment.version });
          wx.showToast({ title: '服务地址已保存', icon: 'success' });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.error || error.message || '保存地址失败，请重试', icon: 'none' });
        } finally {
          this.setData({ acting: false });
        }
      }
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
