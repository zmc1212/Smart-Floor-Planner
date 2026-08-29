const api = require('../../utils/api.js');

function normalizeAmount(value) {
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(String(value || '').trim());
  if (!match) return '';
  const normalized = `${match[1]}.${(match[2] || '').padEnd(2, '0')}`;
  return Number(normalized) > 0 ? normalized : '';
}

Component({
  properties: {
    item: { type: Object, value: null }
  },

  data: {
    visible: false,
    submitting: false,
    amount: '',
    error: ''
  },

  methods: {
    open() {
      const item = this.data.item;
      if (!item || !item.id || item.status !== 'payable') {
        wx.showToast({ title: '仅待支付提成可确认打款，请刷新后重试', icon: 'none' });
        return;
      }
      if (this.data.submitting) {
        wx.showToast({ title: '正在处理，请稍候', icon: 'none' });
        return;
      }
      const currentAmount = Number(item.amount || 0) > 0 ? normalizeAmount(item.amount) : '';
      this.setData({ visible: true, amount: currentAmount, error: '' });
    },

    changeAmount(event) {
      this.setData({ amount: event.detail.value, error: '' });
    },

    close() {
      if (this.data.submitting) return;
      this.setData({ visible: false, amount: '', error: '' });
    },

    stopTap() {},

    async confirm() {
      if (this.data.submitting) return;
      const payableAmount = normalizeAmount(this.data.amount);
      if (!payableAmount) {
        this.setData({ error: '请输入 0.01 至 999999999999.99，最多两位小数' });
        return;
      }
      const item = this.data.item;
      if (!item || !item.id || item.status !== 'payable') {
        this.setData({ error: '提成记录已变化，请关闭后刷新重试' });
        return;
      }
      this.setData({ submitting: true, error: '' });
      try {
        await api.request('/miniprogram/enterprise-commissions/mark-paid', 'POST', {
          payments: [{ commissionId: String(item.id), paidAmount: payableAmount }]
        });
        wx.showToast({ title: '已确认打款', icon: 'success' });
        this.setData({ visible: false, amount: '', error: '' });
        this.triggerEvent('paid', { id: String(item.id), paidAmount: payableAmount });
      } catch (error) {
        const message = error.message || error.error || '确认打款失败';
        this.setData({ error: message });
        wx.showToast({ title: message, icon: 'none' });
      } finally {
        this.setData({ submitting: false });
      }
    }
  }
});
