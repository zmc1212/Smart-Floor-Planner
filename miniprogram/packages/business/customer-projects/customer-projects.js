const api = require('../../../utils/api.js');
const { rankCustomerProjects } = require('../../../utils/customerServiceHome.js');

Page({
  data: {
    loading: true,
  },

  onLoad() {
    this.redirect();
  },

  onShow() {
    this.redirect();
  },

  async redirect() {
    if (this._redirectInFlight) return;
    this._redirectInFlight = true;
    this.setData({ loading: true });
    try {
      const result = await api.request('/miniprogram/customer-projects', 'GET');
      const ranked = rankCustomerProjects(result.data || []);
      const leadId = ranked[0] && ranked[0].leadId;
      if (leadId) {
        wx.redirectTo({
          url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}`,
        });
        return;
      }
    } catch (error) {
      // Fall through to Service tab when the list is empty or unavailable.
    } finally {
      this._redirectInFlight = false;
    }
    wx.switchTab({ url: '/pages/index/index' });
  },
});
