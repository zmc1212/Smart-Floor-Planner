const api = require('./api');
const { errorCopy } = require('./assistant-client');
const initialEnterprise = () => ({ followupPlatform: false, followupEnterpriseName: '', followupEnterpriseOpen: false,
  followupEnterprises: [], followupEnterpriseQuery: '', followupEnterpriseLoading: false, followupEnterpriseMore: false,
  followupEnterpriseBusy: false, followupEnterpriseError: '' });
const token = () => getApp().globalData.token || wx.getStorageSync('token') || '';
const enterpriseMethods = {
  prepareFollowupEnterprise(context) {
    const role = context.staffRole || context.role;
    this.setData({ followupPlatform: ['admin', 'super_admin'].includes(role), followupEnterpriseName: context.enterpriseName || '' });
  },
  closeFollowupEnterprise() {
    if (this.data.followupEnterpriseBusy) return;
    this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1;
    this.setData({ followupEnterpriseOpen: false, followupEnterprises: [], followupEnterpriseError: '', followupEnterpriseLoading: false });
  },
  openFollowupEnterprise() {
    if (!this.data.followupPlatform || this.data.followupBusy || this.data.followupPending || this.data.followupEnterpriseBusy) return;
    this.setData({ followupEnterpriseOpen: true, followupEnterpriseQuery: '', followupEnterprises: [], followupEnterpriseError: '' });
    return this.loadFollowupEnterprises(true);
  },
  inputFollowupEnterprise(event) { this.setData({ followupEnterpriseQuery: String(event.detail.value || '').slice(0, 64) }); },
  searchFollowupEnterprises() { return this.loadFollowupEnterprises(true); },
  moreFollowupEnterprises() { if (this.data.followupEnterpriseMore) return this.loadFollowupEnterprises(false); },
  async loadFollowupEnterprises(reset) {
    if (!this._shown || !this.data.followupPlatform || this.data.followupEnterpriseBusy) return;
    if (!reset && this.data.followupEnterpriseLoading) return;
    const epoch = this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1, session = token();
    const page = reset ? 1 : (this._enterprisePage || 1) + 1;
    const q = reset ? this.data.followupEnterpriseQuery.trim() : this._enterpriseFilter;
    this.setData({ followupEnterpriseLoading: true, followupEnterpriseError: '' });
    try {
      const response = await api.request('/miniprogram/platform/enterprises', 'GET', { status: 'active', q, page, limit: 20 });
      if (!this._shown || this._enterpriseEpoch !== epoch || token() !== session) return;
      const result = response.data;
      if (!result || !Array.isArray(result.enterprises) || !result.pagination) throw { code: 'invalid_response' };
      this._enterprisePage = page; this._enterpriseFilter = q;
      this.setData({ followupEnterprises: reset ? result.enterprises : this.data.followupEnterprises.concat(result.enterprises),
        followupEnterpriseMore: page < result.pagination.totalPages });
    } catch (error) {
      if (this._shown && this._enterpriseEpoch === epoch && token() === session) this.setData({ followupEnterpriseError: errorCopy(error) });
    } finally {
      if (this._shown && this._enterpriseEpoch === epoch && token() === session) this.setData({ followupEnterpriseLoading: false });
    }
  },
  async selectFollowupEnterprise(event) {
    if (this.data.followupEnterpriseBusy || this.data.followupBusy || this.data.followupPending || !this._shown) return;
    const id = String(event.currentTarget.dataset.id), choice = this.data.followupEnterprises.find(e => String(e._id) === id);
    if (!choice || choice.status !== 'active') return;
    const app = getApp(), context = app.globalData.bootstrap?.current?.context || app.globalData.userInfo || {};
    const session = token(), epoch = this._enterpriseEpoch = (this._enterpriseEpoch || 0) + 1;
    this.setData({ followupEnterpriseBusy: true, followupEnterpriseError: '' });
    try {
      const result = await api.request('/miniprogram/identity-contexts/switch', 'POST', { mode: 'staff', staffId: context.staffId, enterpriseId: id });
      if (!this._shown || token() !== session || this._enterpriseEpoch !== epoch) return;
      if (!result.token || result.context?.enterpriseId !== id || result.context.staffId !== context.staffId) throw { code: 'invalid_response' };
      // Drop all previous private report/original state before committing the
      // new signed scope. Use the app's existing refresh/bootstrap workflow.
      this.followups.hide(); this.followups.selected = ''; this.followupMedia.clear(); this.controller.hide();
      this.setData({ followupActive: true, followupHistoryOpen: false, followupManageOpen: false, followupEnterpriseName: '', followupEnterpriseLoading: false });
      app.globalData.token = result.token; wx.setStorageSync('token', result.token);
      app.globalData.bootstrap = null; app.globalData.sessionHydrated = false;
      await app.hydrateStoredSession();
      const current = app.globalData.bootstrap?.current?.context;
      if (app.globalData.sessionRecovery || current?.enterpriseId !== id || current.staffId !== context.staffId) throw { code: 'identity_context_invalid' };
      if (!this._shown) return;
      this.prepareFollowupEnterprise(current);
      this.setData({ followupEnterpriseOpen: false, followupEnterprises: [] });
      await this.followups.show({ autoOpen: true });
    } catch (error) {
      if (this._shown && this._enterpriseEpoch === epoch) this.setData({ followupEnterpriseError: errorCopy(error) });
    } finally {
      if (this._alive) this.setData({ followupEnterpriseBusy: false });
    }
  },
};
module.exports = { initialEnterprise, enterpriseMethods };
