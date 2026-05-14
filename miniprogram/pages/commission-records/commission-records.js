const app = getApp();
const api = require('../../utils/api.js');

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

function buildSummary(records) {
  const month = new Date();
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1).getTime();
  return records.reduce(
    (summary, item) => {
      const amount = Number(item.commissionAmount || 0);
      const generatedAt = item.generatedAt ? new Date(item.generatedAt).getTime() : 0;
      if (item.status === 'pending_settlement') {
        summary.pendingCount += 1;
        summary.pendingAmount += amount;
      }
      if (item.status === 'paid') summary.paidCount += 1;
      if (generatedAt >= monthStart) summary.monthCount += 1;
      return summary;
    },
    { pendingCount: 0, pendingAmount: 0, paidCount: 0, monthCount: 0 }
  );
}

Page({
  data: {
    records: [],
    loading: true,
    summary: {
      pendingCount: 0,
      pendingAmount: 0,
      paidCount: 0,
      monthCount: 0
    }
  },

  onShow() {
    this.fetchData();
  },

  async fetchData() {
    const openid = app.globalData.openid || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');
    if (!openid && !token) return;

    this.setData({ loading: true });
    try {
      const res = await api.request('/commission-records', 'GET');
      const records = (res.data || []).map((item) => ({
        ...item,
        generatedAtText: formatDate(item.generatedAt)
      }));
      this.setData({
        records,
        summary: buildSummary(records),
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.error || '加载失败', icon: 'none' });
    }
  }
});
