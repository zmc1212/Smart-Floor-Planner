const api = require('../../utils/api.js');

const STATUS_LABELS = {
  new: '待跟进',
  contacted: '待跟进',
  measuring: '量房中',
  measured: '设计中',
  assigned: '设计中',
  designing: '设计中',
  quoting: '设计中',
  converted: '已成交',
  closed: '已关闭'
};

const STATUS_TONES = {
  new: 'pending',
  contacted: 'pending',
  measuring: 'measuring',
  measured: 'designing',
  assigned: 'designing',
  designing: 'designing',
  quoting: 'designing',
  converted: 'converted',
  closed: 'closed'
};

Component({
  properties: {
    openid: {
      type: String,
      value: '',
      observer(newVal) {
        if (newVal) {
          this.fetchLeads(true);
        }
      }
    }
  },

  data: {
    tabs: [
      { id: 'all', query: 'all', label: '全部' },
      { id: 'new', query: 'new', label: '待跟进' },
      { id: 'measuring', query: 'measuring', label: '量房中' },
      { id: 'designing', query: 'assigned', label: '设计中' },
      { id: 'converted', query: 'converted', label: '已成交' }
    ],
    heroStats: [
      { key: 'new', label: '今日新增', count: 0 },
      { key: 'following', label: '跟进中', count: 0 },
      { key: 'converted', label: '已成交', count: 0 }
    ],
    currentTab: 'all',
    currentTabIndex: 0,
    leads: [],
    loading: false,
    refreshing: false,
    page: 1,
    pageSize: 10,
    hasMore: true
  },

  lifetimes: {
    attached() {
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
        const activeTab = this.data.tabs[this.data.currentTabIndex] || this.data.tabs[0];
        let url = `/leads?page=${page}&limit=${this.data.pageSize}`;
        if (activeTab.query !== 'all') {
          url += `&status=${activeTab.query}`;
        }

        const res = await api.request(url, 'GET');

        if (res.success && res.data) {
          const formatted = res.data.map((lead, index) => this.formatLead(lead, index));

          this.setData({
            leads: reset ? formatted : this.data.leads.concat(formatted),
            page: page + 1,
            hasMore: formatted.length === this.data.pageSize,
            loading: false,
            refreshing: false
          });

          if (reset) {
            this.updateHeroStats(formatted, res.stats);
          }
        } else {
          this.setData({ loading: false, refreshing: false });
        }
      } catch (err) {
        console.error('Fetch leads failed', err);
        this.setData({ loading: false, refreshing: false });
      }
    },

    formatLead(lead, index) {
      const status = lead.status || 'new';
      const name = lead.name || '客户';
      const area = lead.area ? `${lead.area}m²` : '';
      const style = lead.stylePreference || this.getRoomLayoutLabel(lead);
      const lastFollow = this.getLastFollow(lead);

      return {
        ...lead,
        displayName: name,
        avatarText: name.slice(0, 1),
        avatarTone: index % 4 === 3 ? 'building' : '',
        avatarUrl: lead.avatar || lead.avatarUrl || '',
        phoneMasked: this.maskPhone(lead.phone),
        communityLabel: lead.communityName || lead.city || '待录入小区',
        areaLabel: area,
        styleLabel: style,
        statusLabel: STATUS_LABELS[status] || status,
        statusTone: STATUS_TONES[status] || 'closed',
        followLabel: lastFollow || `最新跟进：${this.formatRelativeTime(lead.updatedAt || lead.createdAt)}`
      };
    },

    getRoomLayoutLabel(lead) {
      const count = lead.floorPlanIds && lead.floorPlanIds.length ? lead.floorPlanIds.length : 0;
      if (count >= 3) return '三室两厅';
      if (count === 2) return '两室一厅';
      if (count === 1) return '一室一厅';
      return '';
    },

    getLastFollow(lead) {
      const records = lead.followUpRecords || [];
      if (!records.length) return '';
      const latest = records[records.length - 1];
      return latest && latest.createdAt
        ? `最新跟进：${this.formatRelativeTime(latest.createdAt)}`
        : '';
    },

    maskPhone(phone) {
      const text = String(phone || '');
      if (text.length < 7) return text || '暂无手机号';
      return text.replace(/^(\d{3})\d{4}(\d+)/, '$1****$2');
    },

    formatRelativeTime(value) {
      if (!value) return '暂无记录';

      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '暂无记录';

      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const target = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
      const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

      if (target === today) return `今天 ${time}`;
      if (target === today - 86400000) return `昨天 ${time}`;
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    },

    onTabChange(e) {
      const index = e.currentTarget.dataset.index;
      const tab = this.data.tabs[index];
      if (!tab) return;

      this.setData({
        currentTabIndex: index,
        currentTab: tab.id
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
      console.log('Searching for:', query);
    },

    onFilterTap() {
      wx.showToast({
        title: '筛选功能开发中',
        icon: 'none'
      });
    },

    onStartMeasure(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({
        url: `/pages/lead-detail/lead-detail?id=${id}&action=measure`
      });
    },

    updateHeroStats(leads, apiStats) {
      const stats = apiStats || {};
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
      const todayNew = stats.todayNew !== undefined
        ? stats.todayNew
        : leads.filter((lead) => {
          const created = new Date(lead.createdAt);
          return `${created.getFullYear()}-${created.getMonth()}-${created.getDate()}` === todayKey;
        }).length;

      const following = stats.following !== undefined
        ? stats.following
        : (stats.new || 0) + (stats.measuring || 0) + (stats.assigned || 0) + (stats.designing || 0);

      this.setData({
        heroStats: [
          { key: 'new', label: '今日新增', count: todayNew },
          { key: 'following', label: '跟进中', count: following },
          { key: 'converted', label: '已成交', count: stats.converted || leads.filter((lead) => lead.status === 'converted').length }
        ]
      });
    }
  }
});
