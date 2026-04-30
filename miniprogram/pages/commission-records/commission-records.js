const app = getApp();
const api = require('../../utils/api.js');

Page({
  data: {
    records: [],
    loading: true
  },

  onShow() {
    this.fetchData();
  },

  async fetchData() {
    const openid = app.globalData.openid;
    if (!openid) return;

    this.setData({ loading: true });
    try {
      const res = await api.request(`/commission-records?openid=${openid}`, 'GET');
      if (res.success) {
        this.setData({ records: res.data || [], loading: false });
      }
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  }
});
