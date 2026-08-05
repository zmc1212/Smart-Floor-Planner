const api = require('../../utils/api.js');
const { buildFloorPlanPreview, pickLeadFloorPlan } = require('./lead-list-model.js');

const STATUS_LABELS = {
  new: '待跟进',
  contacted: '待跟进',
  measuring: '量房中',
  measured: '复房中',
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
  measured: 'remeasuring',
  assigned: 'designing',
  designing: 'designing',
  quoting: 'designing',
  converted: 'converted',
  closed: 'closed'
};

const STATUS_ICONS = {
  pending: '/images/leads-v4/clock-blue.png',
  measuring: '/images/leads-v4/ruler-green.png',
  remeasuring: '/images/leads-v4/ruler-purple.png',
  designing: '/images/leads-v4/ruler-orange.png',
  converted: '/images/leads-v4/ruler-orange.png',
  closed: '/images/leads-v4/ruler-orange.png'
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
      { id: 'remeasuring', query: 'measured', label: '复房中' },
      { id: 'designing', query: 'assigned', label: '设计中' },
      { id: 'converted', query: 'converted', label: '已成交' }
    ],
    heroSummary: {
      todayNew: 0,
      following: 0,
      converted: 0
    },
    currentTab: 'all',
    currentTabIndex: 0,
    allLeads: [],
    leads: [],
    searchKeyword: '',
    loading: false,
    refreshing: false,
    errorMessage: '',
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

      this.setData({ loading: true, errorMessage: '' });

      try {
        const activeTab = this.data.tabs[this.data.currentTabIndex] || this.data.tabs[0];
        let url = `/leads?page=${page}&limit=${this.data.pageSize}`;
        if (activeTab.query !== 'all') {
          url += `&status=${activeTab.query}`;
        }

        const res = await api.request(url, 'GET');

        if (res.success && res.data) {
          const formatted = res.data.map((lead) => this.formatLead(lead));
          const allLeads = reset ? formatted : this.data.allLeads.concat(formatted);

          this.setData({
            allLeads,
            leads: this.filterLeads(allLeads, this.data.searchKeyword),
            page: page + 1,
            hasMore: formatted.length === this.data.pageSize,
            loading: false,
            refreshing: false
          });

          if (reset) {
            this.updateHeroStats(allLeads, res.stats);
          }
        } else {
          this.setData({
            loading: false,
            refreshing: false,
            errorMessage: (res && res.error) || '暂时无法获取客户线索'
          });
        }
      } catch (err) {
        console.error('Fetch leads failed', err);
        this.setData({
          loading: false,
          refreshing: false,
          errorMessage: (err && err.error) || '网络异常，请稍后重试'
        });
      }
    },

    formatLead(lead) {
      const status = lead.status || 'new';
      const statusTone = STATUS_TONES[status] || 'closed';
      const name = lead.name || '客户';
      const planPreview = buildFloorPlanPreview(lead);
      const plan = pickLeadFloorPlan(lead);
      const externalSource = plan && plan.externalSource;
      const areaValue = lead.area || (externalSource && externalSource.area);
      const area = areaValue ? `${areaValue}m²` : '';
      const style = lead.stylePreference || planPreview.layoutLabel;

      return {
        ...lead,
        displayName: name,
        planPreview,
        phoneMasked: this.maskPhone(lead.phone),
        communityLabel: lead.communityName
          || (externalSource && externalSource.communityName)
          || lead.city
          || '待录入小区',
        areaLabel: area,
        styleLabel: style,
        statusLabel: STATUS_LABELS[status] || status,
        statusTone,
        statusIcon: STATUS_ICONS[statusTone],
        followLabel: `最新跟进：${this.getLastFollowDate(lead)}`
      };
    },

    getLastFollowDate(lead) {
      const records = lead.followUpRecords || [];
      const latest = records.length ? records[records.length - 1] : null;
      return this.formatDate((latest && latest.createdAt) || lead.updatedAt || lead.createdAt);
    },

    maskPhone(phone) {
      const text = String(phone || '');
      if (text.length < 7) return text || '暂无手机号';
      return text.replace(/^(\d{3})\d{4}(\d+)/, '$1****$2');
    },

    formatDate(value) {
      if (!value) return '暂无';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '暂无';
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    },

    onTabChange(e) {
      const index = Number(e.currentTarget.dataset.index);
      const tab = this.data.tabs[index];
      if (!tab) return;

      this.setData({
        currentTabIndex: index,
        currentTab: tab.id
      });
      this.fetchLeads(true);
    },

    onSearchInput(e) {
      const searchKeyword = e.detail.value || '';
      this.setData({
        searchKeyword,
        leads: this.filterLeads(this.data.allLeads, searchKeyword)
      });
    },

    filterLeads(leads, keyword) {
      const normalized = String(keyword || '').trim().toLowerCase();
      if (!normalized) return leads;

      return leads.filter((lead) => [
        lead.displayName,
        lead.phone,
        lead.phoneMasked,
        lead.communityLabel,
        lead.areaLabel,
        lead.styleLabel
      ].some((value) => String(value || '').toLowerCase().includes(normalized)));
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
        url: `/packages/business/lead-detail/lead-detail?id=${id}`
      });
    },

    onPlanPreviewError(e) {
      const id = String(e.currentTarget.dataset.id || '');
      const useGraphFallback = (lead) => {
        if (String(lead._id || '') !== id || lead.planPreview.type !== 'image') return lead;
        return {
          ...lead,
          planPreview: {
            ...lead.planPreview,
            type: lead.planPreview.segments.length ? 'graph' : 'empty'
          }
        };
      };
      this.setData({
        allLeads: this.data.allLeads.map(useGraphFallback),
        leads: this.data.leads.map(useGraphFallback)
      });
    },

    onAddLead() {
      this.triggerEvent('add');
    },

    onSearch(e) {
      this.onSearchInput(e);
    },

    onFilterTap() {
      wx.showActionSheet({
        itemList: this.data.tabs.map((tab) => tab.label),
        success: ({ tapIndex }) => {
          const tab = this.data.tabs[tapIndex];
          if (!tab) return;
          this.setData({
            currentTabIndex: tapIndex,
            currentTab: tab.id
          });
          this.fetchLeads(true);
        }
      });
    },

    onRetry() {
      this.fetchLeads(true);
    },

    onStartMeasure(e) {
      const id = e.currentTarget.dataset.id;
      wx.navigateTo({
        url: `/packages/business/lead-detail/lead-detail?id=${id}&action=measure`
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
        : (stats.new || 0)
          + (stats.contacted || 0)
          + (stats.measuring || 0)
          + (stats.measured || 0)
          + (stats.assigned || 0)
          + (stats.designing || 0)
          + (stats.quoting || 0);

      this.setData({
        heroSummary: {
          todayNew,
          following,
          converted: stats.converted || leads.filter((lead) => lead.status === 'converted').length
        }
      });
    }
  }
});
