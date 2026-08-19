const api = require('../../../utils/api.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return { navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24), navigationHeight: Number(menuRect && menuRect.height || 32), navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10) };
}
function formatUpdatedAt(value) { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '状态更新中' : `${date.getMonth() + 1}月${date.getDate()}日更新`; }

Page({
  data: { navigationTop: 24, navigationHeight: 32, navigationRight: 96, loading: true, error: '', enterpriseName: '', items: [] },
  onLoad() { this.setData(navigationMetrics()); this.load(); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/referrer-progress', 'GET');
      this.setData({ enterpriseName: result.data && result.data.enterpriseName || '', items: (result.data && result.data.items || []).map((item) => ({ ...item, updatedLabel: formatUpdatedAt(item.updatedAt) })) });
    } catch (error) { this.setData({ error: error.message || error.error || '暂时无法读取服务进度' }); }
    finally { this.setData({ loading: false }); }
  },
  backToPromotion() { wx.navigateBack(); },
});
