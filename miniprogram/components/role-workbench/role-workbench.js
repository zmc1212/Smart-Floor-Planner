const api = require('../../utils/api.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');

function rangeLabel(range) {
  const match = String(range || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) return '时间待确认';
  const start = new Date(match[1].replaceAll('"', ''));
  if (Number.isNaN(start.getTime())) return '时间待确认';
  const pad = (value) => String(value).padStart(2, '0');
  return `${start.getMonth() + 1}月${start.getDate()}日 ${pad(start.getHours())}:${pad(start.getMinutes())}`;
}

function statusLabel(status) {
  return ({
    new: '待联系',
    contacted: '待推进',
    measuring: '量房中',
    measured: '已量房',
    assigned: '待设计',
    designing: '方案中',
    quoting: '待报价',
    converted: '已签约',
  })[status] || '服务跟进';
}

Component({
  properties: {
    role: { type: String, value: '' },
    focus: { type: String, value: 'overview' },
  },

  data: {
    loading: true,
    error: '',
    title: '',
    subtitle: '',
    summary: [],
    items: [],
    emptyCopy: '',
    secondary: null,
    activityCode: null,
  },

  lifetimes: {
    attached() { this.load(); },
  },

  pageLifetimes: {
    show() { this.load(); },
  },

  methods: {
    async load() {
      this.setData({ loading: true, error: '' });
      try {
        const isCustomer = this.properties.role === 'customer';
        const result = await api.request(isCustomer ? '/miniprogram/customer-projects' : '/miniprogram/workbench', 'GET');
        const payload = isCustomer
          ? this.customerPayload(result.data || [])
          : result.data || {};
        const focus = this.properties.focus;
        const source = focus === 'tasks' || focus === 'survey'
          ? payload.tasks
          : focus === 'appointments'
            ? payload.appointments
            : payload.primaryItems;
        const items = (source || []).map((item) => ({
          ...item,
          metaLabel: item.metaLabel || (item.timeRange ? rangeLabel(item.timeRange) : statusLabel(item.status)),
          actionLabel: item.action === 'survey' || item.canSurveyNow
            ? '立即量房'
            : focus === 'survey'
              ? '进入量房'
              : item.action === 'appointment'
                ? '查看预约'
                : '查看客户',
        }));
        const emptyCopy = isCustomer
          ? '完成服务后，项目会出现在这里'
          : focus === 'survey'
          ? '暂无可进入的已指派量房任务'
          : focus === 'tasks'
            ? '当前没有待交接的量房任务'
            : focus === 'appointments'
              ? '当前没有需要协调的预约'
              : payload.role === 'designer'
                ? '当前没有已派客户'
                : payload.role === 'measurer'
                  ? '今天没有已确认安排或待量房任务'
                  : '当前没有需要处理的异常';
        this.setData({
          title: payload.title || '工作台',
          subtitle: payload.subtitle || '',
          summary: payload.summary || [],
          items,
          emptyCopy,
          secondary: payload.secondary || null,
          activityCode: payload.activityCode || null,
          loading: false,
        });
      } catch (error) {
        this.setData({
          loading: false,
          error: error.error || error.message || '工作台加载失败，请检查网络后重试',
        });
      }
    },

    customerPayload(projects) {
      const items = (projects || []).map((project) => {
        const stage = Number(project.publishedDesignCount || 0) > 0
          ? '方案已发布'
          : project.hasFormalFloorPlan
            ? '正式量房已完成'
            : project.appointmentStatus === 'confirmed'
              ? '已确认上门服务'
              : '服务准备中';
        return {
          id: project.leadId,
          leadId: project.leadId,
          title: '免费设计与量房',
          subtitle: '预约、户型档案和已发布方案由本人查看',
          status: project.status,
          metaLabel: stage,
          action: 'customer-project',
        };
      });
      return {
        role: 'customer',
        title: '我的装修服务',
        subtitle: '查看属于您的预约、正式量房与设计方案',
        summary: [
          { key: 'projects', label: '服务项目', value: items.length, detail: '仅本人可查看', tone: 'green' },
          { key: 'published', label: '已发布方案', value: (projects || []).filter((item) => Number(item.publishedDesignCount || 0) > 0).length, detail: '设计师主动发布', tone: 'orange' },
        ],
        primaryItems: items,
        secondary: { label: '查看全部项目', target: 'projects' },
      };
    },

    openItem(event) {
      const item = event.currentTarget.dataset.item;
      if (!item) return;
      if (this.properties.focus === 'survey' || item.action === 'survey' || item.canSurveyNow) {
        if (!item.leadId) return;
        openSurveyingEditor({ leadId: item.leadId, floorPlanId: item.floorPlanId || '' });
        return;
      }
      if (item.action === 'appointment' && item.appointmentId && item.leadId) {
        wx.navigateTo({
          url: `/packages/business/appointment-detail/appointment-detail?leadId=${encodeURIComponent(item.leadId)}&appointmentId=${encodeURIComponent(item.appointmentId)}`,
        });
        return;
      }
      if (item.action === 'customer-project' && item.leadId) {
        wx.navigateTo({ url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(item.leadId)}` });
        return;
      }
      if (item.leadId) {
        wx.navigateTo({ url: `/packages/business/lead-detail/lead-detail?id=${encodeURIComponent(item.leadId)}` });
      }
    },

    openSecondary() {
      const target = this.data.secondary && this.data.secondary.target;
      if (target === 'customers') {
        wx.switchTab({ url: '/pages/leads-management/leads-management' });
      } else if (target === 'projects') {
        wx.navigateTo({ url: '/packages/business/customer-projects/customer-projects' });
      } else if (target === 'appointments') {
        wx.switchTab({ url: '/pages/ai-design/ai-design' });
      } else if (target === 'unavailability') {
        wx.navigateTo({ url: '/packages/business/measurer-unavailability/measurer-unavailability' });
      } else if (target === 'activity-code') {
        wx.navigateTo({ url: '/packages/business/staff-activity-code/staff-activity-code' });
      }
    },

    openActivityCode() {
      wx.navigateTo({ url: '/packages/business/staff-activity-code/staff-activity-code' });
    },

    openBooking(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || !item.leadId) return;
      wx.navigateTo({
        url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(item.leadId)}`,
      });
    },
  },
});
