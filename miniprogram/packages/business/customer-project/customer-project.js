const api = require('../../../utils/api');

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

function formatRange(range) {
  const match = String(range || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return { date: '待确认', time: '' };
  const start = new Date(match[1].replaceAll('"', ''));
  const end = new Date(match[2].replaceAll('"', ''));
  const two = (value) => String(value).padStart(2, '0');
  return { date: `${start.getFullYear()}-${two(start.getMonth() + 1)}-${two(start.getDate())}`, time: `${two(start.getHours())}:${two(start.getMinutes())} - ${two(end.getHours())}:${two(end.getMinutes())}` };
}

Page({
  data: { navigationTop: 24, navigationHeight: 32, navigationRight: 96, leadId: '', loading: true, appointment: null, range: null, error: '' },
  onLoad(query) { this.setData({ ...navigationMetrics(), leadId: query.leadId || query.id || '' }); this.load(); },
  async onShow() { if (this.data.leadId) await this.load(); },
  async load() {
    if (!this.data.leadId) return this.setData({ loading: false, error: '缺少客户项目' });
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(`/appointments?leadId=${encodeURIComponent(this.data.leadId)}`, 'GET');
      const appointment = (result.data || []).find((item) => item.status === 'confirmed') || null;
      this.setData({ appointment, range: appointment ? formatRange(appointment.timeRange) : null });
    } catch (error) { this.setData({ error: error.message || '暂时无法加载预约' }); }
    finally { this.setData({ loading: false }); }
  },
  reschedule() {
    const { appointment, leadId } = this.data;
    if (!appointment) return;
    wx.navigateTo({ url: `/packages/business/appointment-reschedule/appointment-reschedule?leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointment.id)}&version=${appointment.version}` });
  },
  onBack() { wx.navigateBack(); },
});
