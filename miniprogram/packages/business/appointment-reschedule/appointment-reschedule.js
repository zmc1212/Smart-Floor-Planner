const api = require('../../../utils/api');

function dateText(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function timeText(date) { const d = new Date(date); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function appointmentDates(offset, maxAdvanceDays) {
  const count = Math.min(5, Math.max(0, maxAdvanceDays - offset + 1));
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + offset + index);
    return { key: dateText(date), label: offset + index === 0 ? '今天' : offset + index === 1 ? '明天' : `周${'日一二三四五六'[date.getDay()]}` };
  });
}
function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
    actionWidth: Math.max(0, Number(windowInfo.windowWidth || 390) - 24)
  };
}

Page({
  data: {
    navigationTop: 24, navigationHeight: 32, navigationRight: 96, actionWidth: 366,
    leadId: '', appointmentId: '', version: 0, internalMode: false, pageTitle: '改期预约',
    dates: [], dateOffset: 0, maxAdvanceDays: 30, selectedDate: '', slots: [],
    selectedSlot: null, selectedSlotStart: '', reason: '', loading: true, submitting: false, error: ''
  },
  onLoad(query) {
    const dates = appointmentDates(0, 30);
    const internalMode = query.mode === 'internal';
    this.setData({ ...navigationMetrics(), leadId: query.leadId, appointmentId: query.appointmentId, version: Number(query.version || 0), internalMode, pageTitle: internalMode ? '调整上门时间' : '改期预约', dates, selectedDate: dates[0].key });
    this.loadSlots();
  },
  async loadSlots() {
    this.setData({ loading: true, error: '', selectedSlot: null, selectedSlotStart: '' });
    try {
      const response = await api.request(`/appointments/availability?leadId=${encodeURIComponent(this.data.leadId)}&date=${this.data.selectedDate}`, 'GET');
      const maxAdvanceDays = Number.isInteger(Number(response.data && response.data.maxAdvanceDays)) ? Number(response.data.maxAdvanceDays) : this.data.maxAdvanceDays;
      this.setData({ maxAdvanceDays, dates: appointmentDates(this.data.dateOffset, maxAdvanceDays), slots: (response.data.slots || []).map((slot) => ({ ...slot, label: `${timeText(slot.startAt)} - ${timeText(slot.endAt)}` })) });
    } catch (error) { this.setData({ error: error.error || error.message || '可用时段加载失败' }); }
    finally { this.setData({ loading: false }); }
  },
  chooseDate(event) { this.setData({ selectedDate: event.currentTarget.dataset.date }); this.loadSlots(); },
  previousDates() { const dateOffset = Math.max(0, this.data.dateOffset - 5); if (dateOffset === this.data.dateOffset) return; const dates = appointmentDates(dateOffset, this.data.maxAdvanceDays); this.setData({ dateOffset, dates, selectedDate: dates[0].key }); this.loadSlots(); },
  nextDates() { const dateOffset = this.data.dateOffset + 5; if (dateOffset > this.data.maxAdvanceDays) return; const dates = appointmentDates(dateOffset, this.data.maxAdvanceDays); if (!dates.length) return; this.setData({ dateOffset, dates, selectedDate: dates[0].key }); this.loadSlots(); },
  chooseSlot(event) { const selectedSlot = event.currentTarget.dataset.slot; this.setData({ selectedSlot, selectedSlotStart: selectedSlot && selectedSlot.startAt || '' }); },
  onReasonInput(event) { this.setData({ reason: event.detail.value }); },
  onBack() { wx.navigateBack(); },
  async submit() {
    const slot = this.data.selectedSlot;
    const reason = String(this.data.reason || '').trim();
    if (!slot || this.data.submitting) return;
    if (this.data.internalMode && !reason) { wx.showToast({ title: '请填写调整原因', icon: 'none' }); return; }
    this.setData({ submitting: true });
    try {
      const action = this.data.internalMode ? 'internal-reschedule' : 'customer-reschedule';
      await api.request(`/appointments/${this.data.appointmentId}/${action}`, 'POST', { startAt: slot.startAt, endAt: slot.endAt, version: this.data.version, ...(this.data.internalMode ? { reason } : {}) });
      wx.showToast({ title: '改期成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (error) { wx.showToast({ title: error.error || error.message || '改期失败', icon: 'none' }); }
    finally { this.setData({ submitting: false }); }
  }
});
