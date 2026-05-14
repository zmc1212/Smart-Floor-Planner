const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    view: 'my',
    title: '企业报备',
    records: [],
    loading: true,
    useTodoApi: false
  },

  onLoad(options) {
    const view = options.view || 'my';
    const titleMap = {
      my: '我的企业',
      measure: '测量任务',
      design: '设计任务',
      admin: '企业报备',
      overdue: '超时任务',
      pool: '公海报备'
    };
    this.setData({
      view,
      title: titleMap[view] || '企业报备',
      useTodoApi: view === 'overdue'
    });
    wx.setNavigationBarTitle({ title: titleMap[view] || '企业报备' });
  },

  onShow() {
    this.fetchRecords();
  },

  async fetchRecords() {
    const openid = app.globalData.openid;
    if (!openid) return;

    this.setData({ loading: true });
    try {
      const path = this.data.useTodoApi
        ? '/workbench/todos?view=overdue'
        : `/promotion-records?view=${this.data.view === 'pool' ? 'all' : this.data.view}${this.data.view === 'pool' ? '&pool=true' : ''}`;
      const res = await api.request(path, 'GET');
      if (res.success) {
        this.setData({
          records: (res.data || []).map(item => ({
            ...item,
            key: item.key || item._id || item.recordId
          })),
          loading: false
        });
      } else {
        this.setData({ loading: false });
      }
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/promotion-record-detail/promotion-record-detail?id=${id}`
    });
  },

  onCreateRecord() {
    wx.navigateTo({
      url: '/pages/promotion-record-detail/promotion-record-detail?mode=create'
    });
  }
});
