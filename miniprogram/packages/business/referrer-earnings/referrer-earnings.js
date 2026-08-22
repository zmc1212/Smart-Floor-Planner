const api = require('../../../utils/api.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return { navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24), navigationHeight: Number(menuRect && menuRect.height || 32), navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10) };
}

function statusMeta(status) {
  return status === 'paid'
    ? { label: '已发放', tone: 'paid' }
    : status === 'voided'
      ? { label: '已作废', tone: 'voided' }
      : { label: '待发放', tone: 'payable' };
}

function countLabel(value) {
  return `${Number(value || 0)}笔`;
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    enterpriseName: '',
    items: [],
    payableCountLabel: '0笔',
    paidCountLabel: '0笔'
  },
  onLoad() { this.setData(navigationMetrics()); this.load(); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/referrer-earnings', 'GET');
      const payload = result.data || {};
      const items = (payload.items || []).map((item) => ({
        ...item,
        statusMeta: statusMeta(item.status)
      }));
      this.setData({
        enterpriseName: payload.enterpriseName || '',
        items,
        payableCountLabel: countLabel(payload.payableCount),
        paidCountLabel: countLabel(payload.paidCount)
      });
    } catch (error) {
      this.setData({ error: error.message || error.error || '暂时无法读取收益' });
    } finally {
      this.setData({ loading: false });
    }
  },
  backToPromotion() { wx.navigateBack(); },
});
