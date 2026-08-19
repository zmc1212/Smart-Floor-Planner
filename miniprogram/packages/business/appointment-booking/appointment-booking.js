const api = require('../../../utils/api.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
    actionWidth: Math.max(0, Number(windowInfo.windowWidth || 390) - 28),
  };
}

function dateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextDates(maxAdvanceDays = 30) {
  const count = Math.max(
    1,
    Math.min(181, Number.isInteger(Number(maxAdvanceDays)) ? Number(maxAdvanceDays) + 1 : 31)
  );
  return Array.from({ length: count }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() + index);
    return {
      key: dateKey(date),
      label: index === 0 ? '今天' : index === 1 ? '明天' : `周${'日一二三四五六'[date.getDay()]}`,
      shortDate: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });
}

function formatSlotTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function formatLead(lead) {
  return {
    name: String(lead && lead.name || '客户'),
    phone: String(lead && lead.phone || ''),
    address: String(lead && (lead.communityName || lead.address) || '').trim(),
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    actionWidth: 362,
    leadId: '', customerMode: false,
    customer: null,
    address: '',
    dates: [],
    selectedDate: '',
    slots: [],
    selectedSlot: null,
    loading: true,
    loadingSlots: false,
    submitting: false,
    error: '',
  },

  onLoad(options) {
    const dates = nextDates();
    this.setData({
      ...navigationMetrics(),
      leadId: String(options.leadId || options.id || ''), customerMode: options.mode === 'customer',
      dates,
      selectedDate: dates[0] && dates[0].key || '',
    });
    this.load();
  },

  async load() {
    if (!this.data.leadId) {
      this.setData({ loading: false, error: '未找到客户线索，请返回后重新进入。' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request(`/leads/${encodeURIComponent(this.data.leadId)}`, 'GET');
      if (!result.data) throw new Error('客户线索暂时无法读取');
      const customer = formatLead(result.data);
      this.setData({ customer, address: customer.address });
      await this.loadSlots();
    } catch (error) {
      const rawMessage = error && (error.message || error.error) || '';
      const message = /lead id must be a positive PostgreSQL bigint/i.test(rawMessage)
        ? '客户线索暂时无法读取，请返回后重新进入。'
        : rawMessage || '客户线索暂时无法读取';
      this.setData({ error: message });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadSlots() {
    if (!this.data.selectedDate || !this.data.leadId) return;
    this.setData({ loadingSlots: true, selectedSlot: null, slots: [], error: '' });
    try {
      const result = await api.request(
        `/appointments/availability?leadId=${encodeURIComponent(this.data.leadId)}&date=${encodeURIComponent(this.data.selectedDate)}`,
        'GET'
      );
      const maxAdvanceDays = Number(result.data && result.data.maxAdvanceDays);
      const dates = nextDates(maxAdvanceDays);
      const slots = (result.data && result.data.slots || []).map((slot) => ({
        ...slot,
        label: `${formatSlotTime(slot.startAt)} - ${formatSlotTime(slot.endAt)}`,
      }));
      this.setData({ dates, slots });
    } catch (error) {
      this.setData({ error: error.message || error.error || '可用时段暂时无法读取' });
    } finally {
      this.setData({ loadingSlots: false });
    }
  },

  chooseDate(event) {
    const selectedDate = String(event.currentTarget.dataset.date || '');
    if (!this.data.dates.some((item) => item.key === selectedDate)) return;
    this.setData({ selectedDate });
    this.loadSlots();
  },

  onBack() {
    wx.navigateBack();
  },

  chooseSlot(event) {
    const slot = event.currentTarget.dataset.slot;
    if (slot && slot.startAt && slot.endAt) this.setData({ selectedSlot: slot });
  },

  onAddressInput(event) {
    this.setData({ address: String(event.detail.value || '').slice(0, 300) });
  },

  async submit() {
    const { leadId, selectedSlot, address, submitting } = this.data;
    if (submitting || !selectedSlot) return;
    if (!String(address || '').trim()) {
      wx.showToast({ title: '请填写上门地址', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await api.request('/appointments', 'POST', {
        leadId,
        startAt: selectedSlot.startAt,
        endAt: selectedSlot.endAt,
        address: String(address).trim(),
      });
      wx.showToast({ title: '预约已确认', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (error) {
      wx.showToast({ title: error.message || error.error || '创建预约失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },
});
