const app = getApp();
const api = require('../../utils/api.js');

const TITLE_MAP = {
  my: '我的企业',
  measure: '量房任务',
  design: '设计任务',
  admin: '报备管理',
  overdue: '超时任务',
  pool: '公海报备'
};

function buildListPath(view) {
  if (view === 'overdue') return '/workbench/todos?view=overdue';
  if (view === 'pool') return '/promotion-records?poolStatus=in_pool';
  return `/promotion-records?view=${view || 'my'}`;
}

Page({
  data: {
    view: 'my',
    title: '报备管理',
    records: [],
    loading: true,
    useTodoApi: false
  },

  onLoad(options) {
    const view = options.view || 'my';
    const title = TITLE_MAP[view] || '报备管理';
    this.setData({
      view,
      title,
      useTodoApi: view === 'overdue'
    });
    wx.setNavigationBarTitle({ title });
  },

  onShow() {
    this.fetchRecords();
  },

  async fetchRecords() {
    const openid = app.globalData.openid || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');
    if (!openid && !token) return;

    this.setData({ loading: true });
    try {
      const res = await api.request(buildListPath(this.data.view), 'GET');
      this.setData({
        records: (res.data || []).map((item) => ({
          ...item,
          key: item.key || item._id || item.recordId
        })),
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.error || '加载失败', icon: 'none' });
    }
  },

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/promotion-record-detail/promotion-record-detail?id=${id}` });
  },

  onCreateRecord() {
    wx.navigateTo({ url: '/pages/promotion-record-detail/promotion-record-detail?mode=create' });
  }
});
