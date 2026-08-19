const api = require('../../../utils/api.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return { navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24), navigationHeight: Number(menuRect && menuRect.height || 32), navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10) };
}
function money(value) { return `¥${Number(value || 0).toFixed(2)}`; }
function statusMeta(status) { return status === 'paid' ? { label: '已支付', tone: 'paid' } : status === 'voided' ? { label: '已作废', tone: 'voided' } : { label: '待支付', tone: 'payable' }; }

Page({
  data: { navigationTop: 24, navigationHeight: 32, navigationRight: 96, loading: true, error: '', enterpriseName: '', items: [], payableTotal: '¥0.00', paidTotal: '¥0.00' },
  onLoad() { this.setData(navigationMetrics()); this.load(); },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/referrer-earnings', 'GET');
      const items = (result.data && result.data.items || []).map((item) => ({ ...item, amountLabel: money(item.amount), statusMeta: statusMeta(item.status) }));
      const total = (status) => items.filter((item) => item.status === status).reduce((sum, item) => sum + Number(item.amount || 0), 0);
      this.setData({ enterpriseName: result.data && result.data.enterpriseName || '', items, payableTotal: money(total('payable')), paidTotal: money(total('paid')) });
    } catch (error) { this.setData({ error: error.message || error.error || '暂时无法读取收益' }); }
    finally { this.setData({ loading: false }); }
  },
  backToPromotion() { wx.navigateBack(); },
});
