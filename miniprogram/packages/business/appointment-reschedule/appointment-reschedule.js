Page({
  onLoad(query) {
    const leadId = query.leadId || '';
    const appointmentId = query.appointmentId || '';
    if (!leadId || !appointmentId) {
      wx.showToast({ title: '预约信息不完整', icon: 'none' });
      setTimeout(() => {
        wx.navigateBack({ fail() {} });
      }, 400);
      return;
    }
    const params = [
      `leadId=${encodeURIComponent(leadId)}`,
      `appointmentId=${encodeURIComponent(appointmentId)}`,
    ];
    if (query.mode !== 'internal') {
      params.push('mode=customer');
    }
    if (query.version != null && query.version !== '') {
      params.push(`version=${encodeURIComponent(query.version)}`);
    }
    wx.redirectTo({
      url: `/packages/business/appointment-detail/appointment-detail?${params.join('&')}`,
    });
  },
});
