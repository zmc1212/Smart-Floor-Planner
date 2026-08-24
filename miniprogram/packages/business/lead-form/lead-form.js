const api = require('../../../utils/api.js');

const DEFAULT_RECENT_LEADS = [
  {
    name: '张女士',
    phone: '13800000000',
    communityName: '',
    area: '',
    stylePreference: '',
    avatar: '/packages/business/assets/leads/lead-avatar-zhang.png'
  },
  {
    name: '李先生',
    phone: '13900000000',
    communityName: '',
    area: '',
    stylePreference: '',
    avatar: '/packages/business/assets/leads/lead-avatar-li.png'
  },
  {
    name: '王女士',
    phone: '13700000000',
    communityName: '',
    area: '',
    stylePreference: '',
    fullImage: '/packages/business/assets/leads/lead-avatar-wang.png'
  }
];

Page({
  data: {
    isStaff: false,
    loading: false,
    pageLoading: false,
    isEditMode: false,
    leadId: '',
    floorPlanId: '',
    pageTitle: '客户资料',
    submitLabel: '立即提交',
    styleOptions: ['现代简约', '北欧风格', '奶油风', '新中式', '工业风', '法式轻奢'],
    serviceNeedOptions: [],
    formData: {
      name: '',
      phone: '',
      communityName: '',
      area: '',
      stylePreference: ''
    },
    recentLeads: [],
    recentLeadChips: DEFAULT_RECENT_LEADS
  },

  onLoad(options) {
    const app = getApp();
    const leadId = options.leadId || options.id || '';
    const isEditMode = options.mode === 'edit' && Boolean(leadId);
    const pageTitle = isEditMode ? '补充客户资料' : '客户资料';

    const userInfo = app.globalData.userInfo || {};
    const isStaff = userInfo.role === 'staff';

    wx.setNavigationBarTitle({ title: pageTitle });

    this.setData({
      isStaff,
      leadId,
      isEditMode,
      pageTitle,
      submitLabel: isEditMode ? '保存资料' : '立即提交',
      floorPlanId: options.floorPlanId || ''
    });

    if (isEditMode) {
      this.loadLeadForEdit(leadId);
      return;
    }

    if (isStaff) {
      this.fetchRecentLeads();
    }
  },

  async loadLeadForEdit(leadId) {
    this.setData({ pageLoading: true });
    try {
      const [res, needsRes] = await Promise.all([
        api.request(`/leads/${encodeURIComponent(leadId)}`, 'GET'),
        api.request(`/leads/${encodeURIComponent(leadId)}/service-needs`, 'GET').catch(() => null),
      ]);
      if (!res.success || !res.data) throw new Error(res.error || '客户资料加载失败');
      const lead = res.data;
      const selectedNeeds = new Set((needsRes && needsRes.data && needsRes.data.needKeys) || []);
      const serviceNeedOptions = (needsRes && needsRes.data && needsRes.data.options || []).map((item) => ({
        ...item,
        selected: selectedNeeds.has(item.key),
      }));
      this.setData({
        formData: {
          name: lead.name || '',
          phone: lead.phone || '',
          communityName: lead.communityName || '',
          area: lead.area ? String(lead.area) : '',
          stylePreference: lead.stylePreference || ''
        },
        serviceNeedOptions,
      });
    } catch (err) {
      wx.showToast({ title: (err && err.error) || '客户资料加载失败', icon: 'none' });
      setTimeout(() => this.onBack(), 1200);
    } finally {
      this.setData({ pageLoading: false });
    }
  },

  async fetchRecentLeads() {
    try {
      const res = await api.request('/leads', 'GET', { limit: 10 });
      if (res.success) {
        const recentLeads = res.data || [];
        const fallbackAvatars = [
          '/packages/business/assets/leads/lead-avatar-zhang.png',
          '/packages/business/assets/leads/lead-avatar-li.png',
          '/packages/business/assets/leads/lead-avatar-zhang.png'
        ];
        const recentLeadChips = recentLeads.slice(0, 3).map((lead, index) => ({
          ...lead,
          avatar: fallbackAvatars[index] || fallbackAvatars[0]
        }));

        this.setData({
          recentLeads,
          recentLeadChips: recentLeadChips.length ? recentLeadChips : DEFAULT_RECENT_LEADS
        });
      }
    } catch (err) {
      console.error('Fetch recent leads failed', err);
    }
  },

  onRefreshRecent() {
    if (this.data.isStaff) {
      this.fetchRecentLeads();
    }
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/index/index'
        });
      }
    });
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    this.setData({
      [`formData.${field}`]: field === 'communityName' ? String(value || '').slice(0, 160) : value
    });
  },

  chooseCommunityLocation() {
    wx.chooseLocation({
      success: (result) => {
        const name = String(result.name || result.address || '').trim();
        if (!name) {
          wx.showToast({ title: '未获取到小区名称', icon: 'none' });
          return;
        }
        this.setData({
          'formData.communityName': name.slice(0, 160)
        });
      }
    });
  },

  onStyleChange(e) {
    const index = e.detail.value;
    this.setData({
      ['formData.stylePreference']: this.data.styleOptions[index]
    });
  },

  onToggleServiceNeed(e) {
    const key = String(e.currentTarget.dataset.key || '');
    if (!key) return;
    this.setData({
      serviceNeedOptions: this.data.serviceNeedOptions.map((item) => (
        item.key === key ? { ...item, selected: !item.selected } : item
      )),
    });
  },

  onSelectRecentLead(e) {
    const index = e.currentTarget.dataset.index;
    const lead = this.data.recentLeadChips[index];
    if (!lead) return;

    this.setData({
      formData: {
        name: lead.name || '',
        phone: lead.phone || '',
        communityName: lead.communityName || '',
        area: lead.area || '',
        stylePreference: lead.stylePreference || ''
      }
    });
  },

  async onSubmit() {
    if (this.data.loading || this.data.pageLoading) return;

    const { formData, floorPlanId, isEditMode, leadId } = this.data;

    if (!formData.name) {
      return wx.showToast({ title: '请输入称呼', icon: 'none' });
    }
    if (!formData.phone || !/^1[3-9]\d{9}$/.test(formData.phone)) {
      return wx.showToast({ title: '请输入正确手机号', icon: 'none' });
    }
    if (!formData.communityName) {
      return wx.showToast({ title: '请输入小区名称', icon: 'none' });
    }

    this.setData({ loading: true });

    try {
      const app = getApp();
      const payload = {
        name: formData.name.trim(),
        phone: formData.phone.trim(),
        communityName: formData.communityName.trim().slice(0, 160),
        area: formData.area ? parseFloat(formData.area) : null,
        stylePreference: formData.stylePreference || null,
      };

      if (isEditMode) {
        const res = await api.request(`/leads/${encodeURIComponent(leadId)}`, 'PUT', payload);
        if (!res.success) {
          wx.showToast({ title: res.error || '保存失败', icon: 'none' });
          return;
        }
        const needKeys = this.data.serviceNeedOptions.filter((item) => item.selected).map((item) => item.key);
        try {
          await api.request(`/leads/${encodeURIComponent(leadId)}/service-needs`, 'PATCH', { needKeys });
        } catch (needsError) {
          wx.showToast({ title: '资料已保存，服务需求稍后重试', icon: 'none' });
          setTimeout(() => this.onBack(), 1000);
          return;
        }
        wx.showToast({ title: '资料已保存', icon: 'success' });
        setTimeout(() => this.onBack(), 800);
        return;
      }

      const res = await api.request('/leads', 'POST', {
        ...payload,
        openid: app.globalData.openid,
        source: 'manual_entry',
        floorPlanId: floorPlanId || undefined
      });

      if (res.success) {
        wx.showToast({ title: '提交成功', icon: 'success' });

        if (floorPlanId) {
          getApp().globalData.requireLeadFirst = false;
        }

        setTimeout(() => {
          const pages = getCurrentPages();
          const prevPage = pages[pages.length - 2];

          if (prevPage && prevPage.route === 'pages/leads-management/leads-management') {
            const leadList = prevPage.selectComponent('#leadList');
            if (leadList) {
              leadList.onRefresh();
            }
          }

          if (res.data && res.data._id) {
            wx.redirectTo({
              url: `/packages/business/lead-detail/lead-detail?id=${res.data._id}`
            });
          } else {
            this.onBack();
          }
        }, 1500);
      } else {
        wx.showToast({ title: res.error || '提交失败', icon: 'none' });
      }
    } catch (err) {
      console.error(err);
      wx.showToast({ title: '网络错误', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
