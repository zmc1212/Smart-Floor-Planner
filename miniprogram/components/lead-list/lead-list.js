const api = require('../../utils/api.js');

Component({
  properties: {
    openid: {
      type: String,
      value: '',
      observer: function (newVal) {
        console.log('[LeadList] OpenID changed:', newVal);
        if (newVal) {
          this.fetchLeads(true);
        }
      }
    }
  },

  data: {
    tabs: [
      { id: 'all', label: '全部' },
      { id: 'new', label: '新线索' },
      { id: 'measuring', label: '量房中' },
      { id: 'designing', label: '设计中' },
      { id: 'converted', label: '已成交' }
    ],
    currentTab: 'all',
    currentTabIndex: 0,
    leads: [],
    loading: false,
    refreshing: false,
    page: 1,
    pageSize: 10,
    hasMore: true,
    statusMap: {
      'new': '新线索',
      'contacted': '已联系',
      'measuring': '量房中',
      'designing': '设计中',
      'quoting': '报价中',
      'converted': '已签约',
      'closed': '已关闭'
    },
    stats: [
      { key: 'all', label: '全部线索', count: 0, icon: '📋', tone: 'blue' },
      { key: 'new', label: '待跟进', count: 0, icon: '🔥', tone: 'orange' },
      { key: 'measuring', label: '量房中', count: 0, icon: '📐', tone: 'green' },
      { key: 'converted', label: '已成交', count: 0, icon: '✅', tone: 'purple' }
    ]
  },

  lifetimes: {
    attached() {
      console.log('[LeadList] Attached, current openid:', this.data.openid);
      this.fetchLeads(true);
    }
  },

  methods: {
    async fetchLeads(reset = false) {
      if (this.data.loading) return;
      
      const page = reset ? 1 : this.data.page;
      const openid = this.data.openid || getApp().globalData.openid;
      
      if (!openid) return;

      this.setData({ loading: true });
      
      try {
        let url = `/leads?page=${page}&limit=${this.data.pageSize}`;
        if (this.data.currentTab !== 'all') {
          url += `&status=${this.data.currentTab}`;
        }

        const res = await api.request(url, 'GET');
        console.log('LeadList fetch success:', res);
        
        if (res.success && res.data) {
          const formatted = res.data.map(lead => {
            return {
              ...lead,
              statusLabel: this.data.statusMap[lead.status] || lead.status,
              createdAtFormatted: new Date(lead.createdAt).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric'
              }),
              roomCount: lead.floorPlanIds ? lead.floorPlanIds.length : 0
            };
          });

          this.setData({
            leads: reset ? formatted : [...this.data.leads, ...formatted],
            page: page + 1,
            hasMore: formatted.length === this.data.pageSize,
            loading: false,
            refreshing: false
          });
          
          if (reset) {
            this.updateStats(formatted);
          }
        }
      } catch (err) {
        console.error('Fetch leads failed', err);
        this.setData({ loading: false, refreshing: false });
      }
    },

    onTabChange(e) {
      const index = e.currentTarget.dataset.index;
      const tabId = this.data.tabs[index].id;
      this.setData({ 
        currentTabIndex: index,
        currentTab: tabId
      });
      this.fetchLeads(true);
    },

    onSwiperChange(e) {
      const index = e.detail.current;
      const tabId = this.data.tabs[index].id;
      this.setData({ 
        currentTabIndex: index,
        currentTab: tabId
      });
      this.fetchLeads(true);
    },

    onRefresh() {
      this.setData({ refreshing: true });
      this.fetchLeads(true);
    },

    onLoadMore() {
      if (this.data.hasMore) {
        this.fetchLeads();
      }
    },

    onLeadClick(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({
        url: `/pages/lead-detail/lead-detail?id=${id}`
      });
    },

    onAddLead() {
      this.triggerEvent('add');
    },

    onSearch(e) {
      const query = e.detail.value;
      // TODO: Implement search
      console.log('Searching for:', query);
    },

    onStartMeasure(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({
        url: `/pages/lead-detail/lead-detail?id=${id}&action=measure`
      });
    },

    updateStats(leads) {
      // In a real app, this would come from a dedicated stats API
      // Here we simulate it based on the current list for UI demonstration
      const stats = this.data.stats.map(s => {
        let count = 0;
        if (s.key === 'all') count = leads.length * 5; // Simulating larger total
        else if (s.key === 'new') count = leads.filter(l => l.status === 'new').length;
        else if (s.key === 'measuring') count = leads.filter(l => l.status === 'measuring').length;
        else if (s.key === 'converted') count = leads.filter(l => l.status === 'converted').length;
        return { ...s, count };
      });
      this.setData({ stats });
    }
  }
});
