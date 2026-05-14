const api = require('../../utils/api.js');

const DEFAULT_RECENT_LEADS = [
  {
    name: '张女士',
    phone: '13800000000',
    communityName: '',
    area: '',
    stylePreference: '',
    avatar: '/images/lead-avatar-zhang.png'
  },
  {
    name: '李先生',
    phone: '13900000000',
    communityName: '',
    area: '',
    stylePreference: '',
    avatar: '/images/lead-avatar-li.png'
  },
  {
    name: '王女士',
    phone: '13700000000',
    communityName: '',
    area: '',
    stylePreference: '',
    fullImage: '/images/lead-avatar-wang.png'
  }
];

Page({
  data: {
    statusBarHeight: 0,
    navBarHeightTotal: 0,
    isStaff: false,
    loading: false,
    floorPlanId: '',
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

    const userInfo = app.globalData.userInfo || {};
    const isStaff = userInfo.role === 'staff';

    this.setData({
      statusBarHeight: systemInfo.statusBarHeight,
      navBarHeightTotal,
      isStaff,
      floorPlanId: options.floorPlanId || ''
    });

    if (isStaff) {
      this.fetchRecentLeads();
    }
  },

  async fetchRecentLeads() {
    try {
      const res = await api.request('/leads', 'GET', { limit: 10 });
      if (res.success) {
        const recentLeads = res.data || [];
        const fallbackAvatars = [
          '/images/lead-avatar-zhang.png',
          '/images/lead-avatar-li.png',
          '/images/lead-avatar-zhang.png'
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
    if (this.data.loading) return;

    const { formData, floorPlanId } = this.data;

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
        ...formData,
        openid: app.globalData.openid,
        source: 'MiniProgram',
        floorPlanId
      };

      const res = await api.request('/leads', 'POST', payload);

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
              url: `/pages/lead-detail/lead-detail?id=${res.data._id}`
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
