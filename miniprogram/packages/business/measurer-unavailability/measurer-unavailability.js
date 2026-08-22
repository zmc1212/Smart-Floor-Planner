const api = require('../../../utils/api');
const { formatAppointmentDisplay } = require('../../../utils/appointmentTimeRange.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

function localDate(value = new Date()) {
  const date = new Date(value);
  const two = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

function parseRange(range) {
  const display = formatAppointmentDisplay(range);
  if (!display.dateKey) return { date: '待确认', time: '待确认' };
  return { date: display.dateKey, time: display.timeText };
}

function combineDateTime(date, time) {
  return `${date}T${time}:00+08:00`;
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    saving: false,
    deletingId: '',
    error: '',
    date: localDate(),
    slotMode: 'afternoon',
    startTime: '13:00',
    endTime: '18:00',
    presetTags: ['调休休假', '外出培训', '个人事务', '设备检修'],
    reason: '',
    periods: [],
  },
  onLoad() { this.setData(navigationMetrics()); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/measurer-unavailability', 'GET');
      this.setData({ periods: (result.data || []).map((item) => ({ ...item, ...parseRange(item.timeRange) })) });
    } catch (error) {
      this.setData({ error: error.message || '暂时无法读取不可用时间' });
    } finally {
      this.setData({ loading: false });
    }
  },
  onDateChange(event) { this.setData({ date: event.detail.value }); },
  selectSlotMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode) return;
    if (mode === 'all_day') {
      this.setData({ slotMode: mode, startTime: '09:00', endTime: '18:00' });
    } else if (mode === 'morning') {
      this.setData({ slotMode: mode, startTime: '09:00', endTime: '12:00' });
    } else if (mode === 'afternoon') {
      this.setData({ slotMode: mode, startTime: '13:00', endTime: '18:00' });
    } else {
      this.setData({ slotMode: 'custom' });
    }
  },
  selectPresetTag(event) {
    const tag = event.currentTarget.dataset.tag;
    if (!tag) return;
    this.setData({ reason: this.data.reason === tag ? '' : tag });
  },
  onStartTimeChange(event) { this.setData({ startTime: event.detail.value, slotMode: 'custom' }); },
  onEndTimeChange(event) { this.setData({ endTime: event.detail.value, slotMode: 'custom' }); },
  onReasonInput(event) { this.setData({ reason: event.detail.value }); },
  async save() {
    if (this.data.saving) return;
    const startAt = combineDateTime(this.data.date, this.data.startTime);
    const endAt = combineDateTime(this.data.date, this.data.endTime);
    if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
      wx.showToast({ title: '结束时间需晚于开始时间', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      await api.request('/measurer-unavailability', 'POST', { startAt, endAt, reason: this.data.reason.trim() });
      wx.showToast({ title: '已保存不可用时间', icon: 'success' });
      this.setData({ reason: '' });
      await this.load();
    } catch (error) {
      wx.showToast({ title: error.message || '保存失败，请重试', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },
  remove(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.deletingId) return;
    wx.showModal({
      title: '删除不可用时间',
      content: '删除后，该时段将重新参与预约排期。',
      confirmText: '删除',
      confirmColor: '#d14343',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ deletingId: id });
        try {
          await api.request(`/measurer-unavailability?id=${encodeURIComponent(id)}`, 'DELETE');
          wx.showToast({ title: '已删除', icon: 'success' });
          await this.load();
        } catch (error) {
          wx.showToast({ title: error.message || '删除失败，请重试', icon: 'none' });
        } finally {
          this.setData({ deletingId: '' });
        }
      },
    });
  },
  onBack() { wx.navigateBack(); },
});
