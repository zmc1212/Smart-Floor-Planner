const api = require('../../../utils/api.js');

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

function projectStage(item) {
  if (item.serviceStageLabel) return { label: item.serviceStageLabel, tone: item.serviceStage || 'preparing' };
  if (Number(item.publishedDesignCount || 0) > 0) return { label: '方案已发布', tone: 'published' };
  if (item.hasFormalFloorPlan) return { label: '正式量房已完成', tone: 'surveyed' };
  if (item.appointmentStatus === 'expired') return { label: '预约已过期', tone: 'expired' };
  if (item.appointmentStatus === 'cancelled') return { label: '待重新预约', tone: 'preparing' };
  if (item.appointmentStatus === 'confirmed') return { label: '已确认上门服务', tone: 'scheduled' };
  if (item.appointmentStatus === 'completed') return { label: '上门服务已完成', tone: 'surveyed' };
  return { label: '服务准备中', tone: 'preparing' };
}

function formatUpdatedAt(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '服务状态将持续更新';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日更新`;
}

Page({
  data: { navigationTop: 24, navigationHeight: 32, navigationRight: 96, loading: true, error: '', projects: [] },
  onLoad() { this.setData(navigationMetrics()); this.load(); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/customer-projects', 'GET');
      this.setData({ projects: (result.data || []).map((item) => ({ ...item, stage: projectStage(item), updatedLabel: formatUpdatedAt(item.updatedAt) })) });
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法读取项目' });
    } finally { this.setData({ loading: false }); }
  },
  openProject(event) {
    const leadId = String(event.currentTarget.dataset.id || '');
    if (leadId) wx.navigateTo({ url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}` });
  },
  backToService() { wx.reLaunch({ url: '/pages/index/index' }); },
});
