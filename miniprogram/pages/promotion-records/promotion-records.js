const app = getApp();
const api = require('../../utils/api.js');

const TITLE_MAP = {
  my: '我的企业',
  measure: '量房任务',
  design: '设计任务',
  admin: '报备管理',
  overdue: '超时任务',
  pool: '可认领客户'
};

const FILTER_TABS = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '待处理' },
  { key: 'measuring', label: '量房中', businessStage: 'measuring' },
  { key: 'designing', label: '设计中', businessStage: 'designing' },
  { key: 'paid', label: '已成交', businessStage: 'paid' }
];

function getInitialFilter(options, view) {
  if (options.filter) return options.filter;
  return view === 'overdue' ? 'todo' : 'all';
}

function buildPromotionPath(view, filter) {
  const params = [];
  const tab = FILTER_TABS.find((item) => item.key === filter);

  if (view === 'pool') {
    params.push('poolStatus=in_pool');
  } else {
    params.push(`view=${encodeURIComponent(view || 'my')}`);
  }

  if (tab && tab.businessStage) {
    params.push(`businessStage=${encodeURIComponent(tab.businessStage)}`);
  }

  return `/promotion-records?${params.join('&')}`;
}

function buildListPath(view, filter) {
  if (view === 'overdue' && filter === 'todo') return '/workbench/todos?view=overdue';
  if (filter === 'todo') return '/workbench/todos?view=mine';
  return buildPromotionPath(view, filter);
}

function usesTodoApi(view, filter) {
  return filter === 'todo';
}

Page({
  data: {
    view: 'my',
    title: '报备管理',
    filterTabs: FILTER_TABS,
    activeFilter: 'all',
    records: [],
    loading: true,
    useTodoApi: false
  },

  onLoad(options) {
    const view = options.view || 'my';
    const title = TITLE_MAP[view] || '报备管理';
    const activeFilter = getInitialFilter(options, view);
    this.setData({
      view,
      title,
      activeFilter,
      useTodoApi: usesTodoApi(view, activeFilter)
    });
    wx.setNavigationBarTitle({ title });
  },

  onShow() {
    this.fetchRecords();
  },

  async fetchRecords() {
    const openid = app.globalData.openid || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');
    if (!openid && !token) return;

    this.setData({ loading: true });
    try {
      const { view, activeFilter } = this.data;
      const useTodoApi = usesTodoApi(view, activeFilter);
      const res = await api.request(buildListPath(view, activeFilter), 'GET');
      this.setData({
        records: (res.data || []).map((item) => ({
          ...item,
          key: item.key || item._id || item.recordId
        })),
        useTodoApi,
        loading: false
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.error || '加载失败', icon: 'none' });
    }
  },

  onFilterTap(e) {
    const filter = e.currentTarget.dataset.filter;
    if (!filter || filter === this.data.activeFilter) return;
    this.setData({
      activeFilter: filter,
      useTodoApi: usesTodoApi(this.data.view, filter)
    });
    this.fetchRecords();
  },

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/pages/promotion-record-detail/promotion-record-detail?id=${id}` });
  },

  onCreateRecord() {
    wx.navigateTo({ url: '/pages/promotion-record-detail/promotion-record-detail?mode=create' });
  }
});
