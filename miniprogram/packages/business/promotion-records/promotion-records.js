const app = getApp();
const api = require('../../../utils/api.js');

const VIEW_TABS = [
  { key: 'my', label: '我的报备' },
  { key: 'measure', label: '待量房' },
  { key: 'design', label: '待设计' },
  { key: 'overdue', label: '已超时' },
  { key: 'pool', label: '公海' },
];

const STAGE_SUMMARY = {
  reported: '已完成企业报备，等待首次联系',
  contacted: '已联系客户，持续确认服务需求',
  measuring: '量房任务正在推进',
  designing: '量房完成，设计方案制作中',
  quoted: '方案已报价，等待客户确认',
  paid: '客户已成交',
  closed_lost: '该报备已结束',
};

const TIMELINE_COPY = {
  report_created: '已创建企业报备',
};

const LEGACY_TIMELINE_COPY = {
  'Promotion report created': '已创建企业报备',
};

function localizeTimelineCopy(value, type) {
  if (type && TIMELINE_COPY[type]) return TIMELINE_COPY[type];
  const text = String(value || '').trim();
  return LEGACY_TIMELINE_COPY[text] || text;
}

function buildListPath(view) {
  if (view === 'overdue') return '/workbench/todos?view=overdue';
  if (view === 'pool') return '/promotion-records?poolStatus=in_pool';
  if (view === 'measure') return '/promotion-records?view=measure&businessStage=measuring';
  if (view === 'design') return '/promotion-records?view=design&businessStage=designing';
  return `/promotion-records?view=${encodeURIComponent(view || 'my')}`;
}

function formatDateTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  const pad = (number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function maskPhone(phone) {
  const value = String(phone || '暂无电话');
  if (value.includes('*') || value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function getStatus(record, view, useTodoApi) {
  if (useTodoApi && record.overdue) return { key: 'overdue', text: '已超时' };
  if (view === 'pool' || record.poolStatus === 'in_pool') return { key: 'pool', text: '公海' };
  if (record.poolStatus === 'claimed' && record.claimRequest && record.claimRequest.status === 'pending') {
    return { key: 'pool', text: '待审批' };
  }

  const stage = record.businessStage;
  if (stage === 'measuring' || (useTodoApi && record.type === 'measure_task')) {
    return { key: 'measuring', text: '待量房' };
  }
  if (['designing', 'quoted'].includes(stage) || (useTodoApi && record.type === 'design_task')) {
    return { key: 'designing', text: '待设计' };
  }
  if (stage === 'paid') return { key: 'paid', text: '已成交' };
  if (stage === 'closed_lost') return { key: 'pool', text: '已结束' };
  return { key: 'followup', text: '待跟进' };
}

function getIconPath(statusKey) {
  if (statusKey === 'designing') return '/images/mine-icons/bulb.png';
  if (statusKey === 'overdue') return '/images/mine-icons/clipboard-pen.png';
  if (statusKey === 'pool') return '/images/mine-icons/users.png';
  if (statusKey === 'paid') return '/images/mine-icons/deal.png';
  if (statusKey === 'measuring') return '/images/mine-icons/buildingCog.png';
  return '/images/mine-icons/building.png';
}

function normalizeRecord(record, view, useTodoApi, userInfo) {
  const status = getStatus(record, view, useTodoApi);
  const followUpRecords = Array.isArray(record.followUpRecords) ? record.followUpRecords : [];
  const latestFollowUp = followUpRecords.length ? followUpRecords[followUpRecords.length - 1] : null;
  const locationText =
    (record.location && record.location.name) ||
    [record.city, record.address].filter(Boolean).join(' · ') ||
    '暂无地址';
  const dueValue = record.dueAt || (useTodoApi && record.dueLabel);
  const summary = localizeTimelineCopy(record.summary, record.summaryType);
  const latestFollowUpText = latestFollowUp
    ? localizeTimelineCopy(latestFollowUp.content, latestFollowUp.type)
    : '';

  return {
    ...record,
    key: record.key || record._id || record.recordId,
    recordId: record.recordId || record._id,
    enterpriseName: record.enterpriseName || record.title || '未命名企业',
    contactPerson: record.contactPerson || '联系人未填写',
    phoneText: maskPhone(record.phone),
    locationText,
    statusKey: status.key,
    statusText: status.text,
    iconPath: getIconPath(status.key),
    followUpText:
      summary ||
      latestFollowUpText ||
      record.notes ||
      STAGE_SUMMARY[record.businessStage] ||
      '等待更新跟进记录',
    timeLabel: dueValue ? '截止时间' : '报备时间',
    timeText: record.dueLabel || formatDateTime(dueValue || record.createdAt),
    canClaim:
      view === 'pool' &&
      userInfo.staffRole === 'salesperson' &&
      record.poolStatus === 'in_pool',
  };
}

function filterRecords(records, searchText) {
  const keyword = String(searchText || '').trim().toLowerCase();
  if (!keyword) return records;
  return records.filter((record) =>
    [record.enterpriseName, record.contactPerson, record.phone, record.locationText]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(keyword))
  );
}

Page({
  data: {
    view: 'my',
    viewTabs: VIEW_TABS,
    skeletonItems: [1, 2, 3],
    records: [],
    displayedRecords: [],
    searchText: '',
    loading: true,
    useTodoApi: false,
    userInfo: {},
    statusBarHeight: 0,
  },

  onLoad(options) {
    const systemInfo = wx.getSystemInfoSync();
    const requestedView = VIEW_TABS.some((item) => item.key === options.view) ? options.view : 'my';
    this.setData({
      view: requestedView,
      useTodoApi: requestedView === 'overdue',
      userInfo: app.globalData.userInfo || wx.getStorageSync('userInfo') || {},
      statusBarHeight: systemInfo.statusBarHeight || 0,
    });
  },

  onShow() {
    this.setData({
      userInfo: app.globalData.userInfo || wx.getStorageSync('userInfo') || {},
    });
    this.fetchRecords();
  },

  async fetchRecords() {
    const openid = app.globalData.openid || wx.getStorageSync('openid');
    const token = wx.getStorageSync('token');
    if (!openid && !token) {
      this.setData({ loading: false, records: [], displayedRecords: [] });
      return;
    }

    this.setData({ loading: true });
    try {
      const { view, searchText, userInfo } = this.data;
      const useTodoApi = view === 'overdue';
      const res = await api.request(buildListPath(view), 'GET');
      const records = (res.data || []).map((item) => normalizeRecord(item, view, useTodoApi, userInfo));
      this.setData({
        records,
        displayedRecords: filterRecords(records, searchText),
        useTodoApi,
        loading: false,
      });
    } catch (err) {
      this.setData({ loading: false, records: [], displayedRecords: [] });
      wx.showToast({ title: err.error || '加载失败', icon: 'none' });
    }
  },

  onSearchInput(e) {
    const searchText = e.detail.value || '';
    this.setData({
      searchText,
      displayedRecords: filterRecords(this.data.records, searchText),
    });
  },

  onViewTap(e) {
    const view = e.currentTarget.dataset.view;
    if (!view || view === this.data.view) return;
    this.setData({
      view,
      searchText: '',
      records: [],
      displayedRecords: [],
      useTodoApi: view === 'overdue',
    });
    this.fetchRecords();
  },

  onOpenDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: `/packages/business/promotion-record-detail/promotion-record-detail?id=${id}` });
  },

  async onClaimRecord(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;

    wx.showLoading({ title: '认领中' });
    try {
      const res = await api.request('/promotion-records/pool', 'POST', { recordId: id });
      wx.hideLoading();
      if (res.success) {
        const isPendingApproval =
          res.data &&
          res.data.poolStatus === 'claimed' &&
          res.data.claimRequest &&
          res.data.claimRequest.status === 'pending';
        wx.showToast({ title: isPendingApproval ? '已提交认领申请' : '认领成功', icon: 'success' });
        this.fetchRecords();
      }
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.error || '认领失败', icon: 'none' });
    }
  },

  onCreateRecord() {
    wx.navigateTo({ url: '/packages/business/promotion-record-detail/promotion-record-detail?mode=create' });
  },
});
