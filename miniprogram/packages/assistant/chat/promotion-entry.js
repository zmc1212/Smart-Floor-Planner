const api = require('../../../utils/api');
const {
  refreshWechatLoginCode, resolveWechatPhoneLoginInput, wechatPhoneAuthToast,
} = require('../../../utils/wechat-phone-auth');

const unavailable = new Set(['invalid_token', 'code_not_found', 'code_disabled', 'code_rotated', 'code_expired',
  'pending_source_expired', 'pending_source_invalid']);

function promotionError(error) {
  const code = error?.code || error?.error;
  if (unavailable.has(code)) return '这张推广码已失效，请重新扫码。';
  if (code === 'customer_service_ambiguous') return '请联系当前装修顾问确认服务归属。';
  if (code === 'wechat_user_mismatch') return '请用与当前微信登录一致的手机号授权。';
  return '暂时无法关联服务，请重试。';
}

function customerSession() {
  const { globalData } = getApp();
  const user = globalData.userInfo;
  return globalData.token && user?.phone && (globalData.bootstrap?.current?.mode || user.mode) === 'customer';
}

const promotionMethods = {
  preparePromotion(code) {
    this._promotion = { code, key: `acq-${Date.now()}-${Math.random().toString(36).slice(2, 12)}` };
    this.setData({ promotionEntry: { phase: 'loading' }, promotionResumedLeadId: '' });
  },

  async beginPromotion(code) {
    if (this.data.promotionSubmitting) return;
    this.controller.clear();
    this.preparePromotion(code);
    if (!await this.showPromotionEntry()) await this.showConsultation();
  },

  async showPromotionEntry() {
    const attempt = this._promotion;
    if (!attempt) return false;
    if (this.data.promotionEntry?.phase === 'loading') await this.resolvePromotionEntry();
    return !!this._promotion;
  },

  resolvePromotionEntry() {
    const attempt = this._promotion;
    if (!attempt || this.data.promotionSubmitting) return;
    if (attempt.flight) return attempt.flight;
    this.setData({ promotionEntry: { phase: 'loading' } });
    attempt.flight = this.readPromotionEntry(attempt).finally(() => { attempt.flight = null; });
    return attempt.flight;
  },

  async readPromotionEntry(attempt) {
    try {
      const app = getApp();
      if (app.globalData.sessionRecovery?.retryable && app.globalData.token) await app.hydrateStoredSession();
      const identity = app.globalData.token;
      const { data } = await api.request('/miniprogram/codes/resolve', 'POST', {
        token: attempt.code, sessionKey: attempt.key,
      }, { suppressUnauthorized: true });
      if (!this._alive || this._promotion !== attempt) return;
      if (identity !== app.globalData.token) throw new Error('客户身份已变更');
      if (!['referral', 'staff_activity'].includes(data?.kind)) throw { code: 'invalid_token' };
      if (data.existingAttribution && data.lead?.id) {
        this.finishPromotion(data.lead.id, true);
        return;
      }
      if (!data.pendingSource) throw { code: 'invalid_token' };
      attempt.pendingSource = data.pendingSource;
      const phase = customerSession() ? 'confirm' : 'phone';
      const brand = data.acquisition?.brandMode === 'branded' ? data.acquisition : null;
      this.setData({ promotionEntry: { phase, brandName: brand?.brandName || '', brandLogo: brand?.brandLogo || '' } });
      if (phase === 'phone') void refreshWechatLoginCode();
    } catch (error) {
      if (this._alive && this._promotion === attempt) this.showPromotionError(error);
    }
  },

  showPromotionError(error) {
    this.setData({ promotionEntry: { phase: 'error', message: promotionError(error),
      rescan: unavailable.has(error?.code || error?.error),
      canRetry: (error?.code || error?.error) !== 'customer_service_ambiguous' } });
  },

  async retryPromotionEntry() {
    await this.resolvePromotionEntry();
    if (this._alive && this._shown && !this._promotion) await this.showConsultation();
  },

  onPromotionPhone(event) {
    if (this.data.promotionSubmitting || this.data.promotionEntry?.phase !== 'phone') return;
    const auth = resolveWechatPhoneLoginInput(event.detail);
    if (!auth.ok) {
      wx.showToast({ title: wechatPhoneAuthToast(auth.reason, '可授权手机号后继续'), icon: 'none' });
      return;
    }
    return this.claimPromotionEntry(auth);
  },

  confirmPromotionEntry() {
    if (this.data.promotionEntry?.phase === 'confirm') return this.claimPromotionEntry();
  },

  async claimPromotionEntry(auth) {
    const attempt = this._promotion;
    if (!attempt?.pendingSource || this.data.promotionSubmitting) return;
    const app = getApp();
    const identity = app.globalData.token;
    this.setData({ promotionSubmitting: true });
    try {
      let phone = {};
      if (auth) {
        const loginCode = auth.kind === 'code' ? await refreshWechatLoginCode() : auth.loginCode;
        if (!loginCode) throw new Error('微信登录凭证获取失败');
        phone = auth.kind === 'code' ? { loginCode, phoneCode: auth.phoneCode }
          : { loginCode, encryptedData: auth.encryptedData, iv: auth.iv };
      }
      if (!this._alive || this._promotion !== attempt) return;
      const response = await api.request('/miniprogram/referrals/authorize-and-create-lead', 'POST', {
        ...phone, pendingSource: attempt.pendingSource, idempotencyKey: attempt.key,
      }, { headers: { 'Idempotency-Key': attempt.key }, suppressUnauthorized: true });
      if (!this._alive || this._promotion !== attempt) return;
      if (identity !== app.globalData.token) throw new Error('客户身份已变更');
      if (response.token) {
        app.globalData.token = response.token;
        app.globalData.sessionHydrated = false;
        wx.setStorageSync('token', response.token);
        await app.hydrateStoredSession();
        if (app.globalData.sessionRecovery || app.globalData.bootstrap?.current?.mode !== 'customer')
          throw new Error('客户身份资料刷新失败');
      }
      if (!this._alive || this._promotion !== attempt) return;
      this.finishPromotion(response.data?.lead?.id, response.existingAttribution === true);
      if (this._shown) await this.showConsultation();
    } catch (error) {
      if (this._alive && this._promotion === attempt) {
        if (error?.code === 'phone_authorization_required') {
          this.setData({ 'promotionEntry.phase': 'phone' });
          void refreshWechatLoginCode();
        } else this.showPromotionError(error);
      }
    } finally {
      if (this._alive) this.setData({ promotionSubmitting: false });
    }
  },

  finishPromotion(leadId, existing) {
    const code = this._promotion.code;
    this.consumePromotion();
    this.controller.clear();
    // A plain entry resumes the authoritative current service. A successful
    // first claim can still carry the verified acquisition setup into its chat.
    this._options = existing ? {} : { entryCode: code };
    this.setData({ promotionResumedLeadId: existing ? String(leadId || '') : '' });
  },

  consumePromotion() {
    this._promotion = null;
    this.setData({ promotionEntry: null });
    if (this.data.embedded) this.triggerEvent('promotionentryconsumed');
  },

  async cancelPromotionEntry() {
    if (this.data.promotionSubmitting) return;
    this.consumePromotion();
    this._options = {};
    const mode = getApp().globalData.bootstrap?.current?.mode;
    if (!this.data.embedded && mode && mode !== 'customer') return this.back();
    if (this._shown) await this.showConsultation();
  },

  openPromotionArchive() {
    const leadId = this.data.promotionResumedLeadId;
    if (!this.data.fatal && /^[1-9]\d{0,18}$/.test(leadId)) {
      wx.navigateTo({ url: '/packages/business/customer-project/customer-project?leadId=' + encodeURIComponent(leadId) });
    }
  },
};

module.exports = { promotionMethods };
