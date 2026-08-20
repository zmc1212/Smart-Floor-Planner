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
    statusBarHeight: 0,
    navBarHeightTotal: 0,
    isStaff: false,
    loading: false,
    pageLoading: false,
    isEditMode: false,
    leadId: '',
    floorPlanId: '',
    pageTitle: '客户资料',
    submitLabel: '立即提交',
    styleOptions: ['现代简约', '北欧风格', '奶油风', '新中式', '工业风', '法式轻奢'],
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
    const systemInfo = wx.getSystemInfoSync();
    const menuButton = wx.getMenuButtonBoundingClientRect();
    const navBarHeightTotal = menuButton.bottom + (menuButton.top - systemInfo.statusBarHeight);
    const leadId = options.leadId || options.id || '';
    const isEditMode = options.mode === 'edit' && Boolean(leadId);

    const userInfo = app.globalData.userInfo || {};
    const isStaff = userInfo.role === 'staff';

    this.setData({
      statusBarHeight: systemInfo.statusBarHeight,
      navBarHeightTotal,
      isStaff,
      leadId,
      isEditMode,
      pageTitle: isEditMode ? '补充客户资料' : '客户资料',
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
      const res = await api.request(`/leads/${encodeURIComponent(leadId)}`, 'GET');
      if (!res.success || !res.data) throw new Error(res.error || '客户资料加载失败');
      const lead = res.data;
      this.setData({
        formData: {
          name: lead.name || '',
          phone: lead.phone || '',
          communityName: lead.communityName || '',
          area: lead.area ? String(lead.area) : '',
          stylePreference: lead.stylePreference || ''
        }
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
      [`formData.${field}`]: value
    });
  },

  onStyleChange(e) {
    const index = e.detail.value;
    this.setData({
      ['formData.stylePreference']: this.data.styleOptions[index]
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
        communityName: formData.communityName.trim(),
        area: formData.area ? parseFloat(formData.area) : null,
        stylePreference: formData.stylePreference || null,
      };

      if (isEditMode) {
        const res = await api.request(`/leads/${encodeURIComponent(leadId)}`, 'PUT', payload);
        if (!res.success) {
          wx.showToast({ title: res.error || '保存失败', icon: 'none' });
          return;
        }
        wx.showToast({ title: '资料已保存', icon: 'success' });
        setTimeout(() => this.onBack(), 800);
        return;
      }

      const res = await api.request('/leads', 'POST', {
        ...payload,
        openid: app.globalData.openid,
        source: 'MiniProgram',
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
