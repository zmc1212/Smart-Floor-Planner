const api=require('../../../utils/api');
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
function slot(range){const m=String(range||'').match(/[[(]([^,]+),([^\])]+)[\])]/);if(!m)return {time:'待确认'};const s=new Date(m[1].replaceAll('"','')),e=new Date(m[2].replaceAll('"',''));const p=x=>String(x).padStart(2,'0');return {time:`${p(s.getHours())}:${p(s.getMinutes())} - ${p(e.getHours())}:${p(e.getMinutes())}`};}
Page({
  data: { navigationTop: 24, navigationHeight: 32, navigationRight: 96, loading: true, items: [], error: '' },
  onLoad() { this.setData(navigationMetrics()); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const r = await api.request('/appointments', 'GET');
      this.setData({ items: (r.data || []).map((x) => ({ ...x, ...slot(x.timeRange) })) });
    } catch (e) {
      this.setData({ error: e.message || '日程加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },
  manageUnavailability() {
    wx.navigateTo({ url: '/packages/business/measurer-unavailability/measurer-unavailability' });
  },
  onBack() { wx.navigateBack(); },
});
