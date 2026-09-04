const api = require('../../../utils/api.js');
const {
  DEFAULT_PAGE_SIZE,
  appendQuery,
  parsePagination,
  mergePage,
  listFooterText,
} = require('../../../utils/list-pagination.js');

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
    paidCountLabel: '0笔',
    page: 1,
    hasMore: false,
    loadingMore: false,
    footerText: ''
  },
  onLoad() { this.setData(navigationMetrics()); this.load({ reset: true }); },
  onShow() { this.load({ reset: true }); },
  onReachBottom() { this.load({ reset: false }); },
  async load(options) {
    const reset = !options || options.reset !== false;
    if (this._fetching) return;
    if (!reset && (this.data.loadingMore || !this.data.hasMore)) return;
    this._fetching = true;
    const page = reset ? 1 : Number(this.data.page || 1);
    if (reset) this.setData({ loading: true, error: '', loadingMore: false });
    else this.setData({ loadingMore: true, footerText: listFooterText(true, true, this.data.items.length) });
    try {
      const result = await api.request(appendQuery('/miniprogram/referrer-earnings', {
        page,
        limit: DEFAULT_PAGE_SIZE,
      }), 'GET');
      const payload = result.data || {};
      const items = mergePage(
        this.data.items,
        (payload.items || []).map((item) => ({ ...item, statusMeta: statusMeta(item.status) })),
        reset
      );
      const pagination = parsePagination(payload);
      this.setData({
        loading: false,
        loadingMore: false,
        error: '',
        enterpriseName: payload.enterpriseName || '',
        items,
        page: page + 1,
        hasMore: pagination.hasMore,
        footerText: listFooterText(false, pagination.hasMore, items.length),
        payableCountLabel: countLabel(payload.payableCount),
        paidCountLabel: countLabel(payload.paidCount)
      });
    } catch (error) {
      this.setData({
        loading: false,
        loadingMore: false,
        error: reset ? (error.message || error.error || '暂时无法读取收益') : this.data.error,
        footerText: listFooterText(false, this.data.hasMore, reset ? 0 : this.data.items.length)
      });
    } finally {
      this._fetching = false;
    }
  },
});
