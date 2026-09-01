const api = require('../../utils/api.js');
const {
  fetchProtectedImage,
  floorPlanCacheKey,
} = require('../../utils/protectedImageCache.js');
const { buildFloorPlanPreview, pickLeadFloorPlan } = require('./lead-list-model.js');

const STATUS_LABELS = {
  acquired: '新线索',
  new: '新线索',
  contacted: '新线索',
  measuring: '量房中',
  measured: '方案设计',
  assigned: '方案设计',
  designing: '方案设计',
  quoting: '方案设计',
  converted: '已签约',
  closed: '已关闭'
};

const STATUS_TONES = {
  acquired: 'pending',
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
    canAdd: {
      type: Boolean,
      value: true
    },
    openid: {
      type: String,
      value: '',
      observer(newVal, oldVal) {
        if (newVal && newVal !== oldVal) {
          this.fetchLeads(true);
        }
      }
    }
  },

  data: {
    tabs: [
      { id: 'all', query: 'all', label: '全部' },
      { id: 'new', query: 'new', label: '新线索' },
      { id: 'measuring', query: 'measuring', label: '量房中' },
      { id: 'designing', query: 'designing', label: '方案设计' },
      { id: 'converted', query: 'converted', label: '已签约' },
      { id: 'closed', query: 'closed', label: '已关闭' }
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
    referrerMembershipId: '',
    referrerFilterLabel: '',
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
      if (this._fetching) {
        if (reset) this._pendingReset = true;
        return;
      }

      const page = reset ? 1 : this.data.page;
      const app = getApp();
      const hasSession = Boolean(
        this.data.openid
        || app.globalData.openid
        || app.globalData.token
      );

      if (!hasSession) return;

      this._fetching = true;
      this.setData({ loading: true, errorMessage: '' });

      try {
        const activeTab = this.data.tabs[this.data.currentTabIndex] || this.data.tabs[0];
        let url = `/leads?page=${page}&limit=${this.data.pageSize}`;
        if (activeTab.query !== 'all') {
          url += `&status=${activeTab.query}`;
        }
        if (this.data.referrerMembershipId) {
          url += `&referrerMembershipId=${encodeURIComponent(this.data.referrerMembershipId)}`;
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
            loading: false
          });
          this.loadProtectedPlanPreviews(allLeads);

          if (reset) {
            this.updateHeroStats(allLeads, res.stats);
          }
        } else {
          this.setData({
            loading: false,
            errorMessage: (res && res.error) || '暂时无法获取客户线索'
          });
        }
      } catch (err) {
        console.error('Fetch leads failed', err);
        this.setData({
          loading: false,
          errorMessage: (err && err.error) || '网络异常，请稍后重试'
        });
      } finally {
        const shouldReplay = this._pendingReset;
        this._pendingReset = false;
        this._fetching = false;
        this._closingRefresher = true;
        this.setData({ refreshing: false }, () => {
          this._closingRefresher = false;
          if (shouldReplay) this.fetchLeads(true);
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

    async loadProtectedPlanPreviews(leads) {
      const targets = (Array.isArray(leads) ? leads : []).filter((lead) => (
        lead
        && lead.planPreview
        && lead.planPreview.type === 'protected'
        && lead.planPreview.previewEndpoint
        && !lead.planPreview.previewPath
      ));
      if (!targets.length) return;

      await Promise.all(targets.map(async (lead) => {
        try {
          const previewPath = await fetchProtectedImage(
            lead.planPreview.previewEndpoint,
            floorPlanCacheKey(lead._id, pickLeadFloorPlan(lead))
          );
          const applyPreviewPath = (item) => {
            if (String(item._id || '') !== String(lead._id || '')) return item;
            return {
              ...item,
              planPreview: {
                ...item.planPreview,
                previewPath,
              },
            };
          };
          this.setData({
            allLeads: this.data.allLeads.map(applyPreviewPath),
            leads: this.data.leads.map(applyPreviewPath),
          });
        } catch (error) {
          const fallback = (item) => {
            if (String(item._id || '') !== String(lead._id || '')) return item;
            if (item.planPreview.type !== 'protected') return item;
            return {
              ...item,
              planPreview: {
                ...item.planPreview,
                type: item.planPreview.segments.length ? 'graph' : 'empty',
              },
            };
          };
          this.setData({
            allLeads: this.data.allLeads.map(fallback),
            leads: this.data.leads.map(fallback),
          });
        }
      }));
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
      if (this._fetching || this._closingRefresher) return;
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
        if (String(lead._id || '') !== id) return lead;
        if (!['image', 'protected'].includes(lead.planPreview.type)) return lead;
        return {
          ...lead,
          planPreview: {
            ...lead.planPreview,
            type: lead.planPreview.segments.length ? 'graph' : 'empty',
            previewUrl: '',
            previewPath: '',
          }
        };
      };
      this.setData({
        allLeads: this.data.allLeads.map(useGraphFallback),
        leads: this.data.leads.map(useGraphFallback)
      });
    },

    onAddLead() {
      if (!this.properties.canAdd) return;
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

    hasReferrerFilter() {
      return Boolean(this.data.referrerMembershipId);
    },

    setReferrerFilter(filter) {
      const membershipId = String((filter && filter.membershipId) || '').trim();
      const displayName = String((filter && filter.displayName) || '推广人').trim() || '推广人';
      if (!membershipId) return;
      this.setData({
        referrerMembershipId: membershipId,
        referrerFilterLabel: displayName
      });
      this.fetchLeads(true);
    },

    clearReferrerFilter() {
      if (!this.data.referrerMembershipId && !this.data.referrerFilterLabel) {
        this.fetchLeads(true);
        return;
      }
      this.setData({
        referrerMembershipId: '',
        referrerFilterLabel: ''
      });
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
          + (stats.acquired || 0)
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
