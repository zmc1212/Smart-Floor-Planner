const api = require('../../utils/api.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
const { formatAppointmentDisplay } = require('../../utils/appointmentTimeRange.js');

function rangeLabel(range) {
  const display = formatAppointmentDisplay(range);
  if (!display.dateKey) return '时间待确认';
  return `${display.dateLabel.replace('/', '月')}日 ${display.timeText.slice(0, 5)}`;
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

function findDesignerWechatProfileTodo(items) {
  return (items || []).find((item) => item && (item.action === 'profile' || item.id === 'designer-wechat-profile')) || null;
}

function wechatProfileMissingLabels(missing) {
  const labels = [];
  if ((missing || []).includes('wechatId')) labels.push('微信号');
  if ((missing || []).includes('wechatQr')) labels.push('个人二维码');
  return labels;
}

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try {
    menuRect = wx.getMenuButtonBoundingClientRect();
  } catch (error) {
    menuRect = null;
  }
  const menuLeft = Number((menuRect && menuRect.left) || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number((menuRect && menuRect.top) || windowInfo.statusBarHeight || 24),
    navigationHeight: Number((menuRect && menuRect.height) || 32),
    navigationRight: Math.max(94, Number(windowInfo.windowWidth || 390) - menuLeft + 10),
  };
}

Component({
  properties: {
    role: { type: String, value: '' },
    focus: { type: String, value: 'overview' },
  },

  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    title: '',
    subtitle: '',
    summary: [],
    items: [],
    emptyCopy: '',
    secondary: null,
    activityCode: null,
    dashboard: [],
    quickNav: [],
    dashboardPeriod: {
      kind: 'month',
      label: '本月',
      subtitle: '',
      from: '',
      to: '',
    },
    periodChips: [
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'year', label: '本年' },
    ],
    showPeriodSheet: false,
    customFrom: '',
    customTo: '',
    bleConnected: false,
    showBLEConnector: false,
  },

  observers: {
    role(role) {
      if (role === 'designer') this.scheduleWechatProfilePrompt();
    },
  },

  lifetimes: {
    attached() {
      this._pageVisible = true;
      this._wechatProfilePromptShownThisVisit = false;
      this.setData({
        ...navigationMetrics(),
        bleConnected: !!(getApp().globalData && getApp().globalData.bleConnected),
      });
      this.trySilentBleReconnect();
      this.load();
      this.scheduleWechatProfilePrompt();
    },
  },

  pageLifetimes: {
    show() {
      this.syncBleConnectionState();
      this.trySilentBleReconnect();
      if (this._pageVisible) {
        this.scheduleWechatProfilePrompt();
        return;
      }
      this._pageVisible = true;
      this._wechatProfilePromptShownThisVisit = false;
      this.load();
      this.scheduleWechatProfilePrompt();
    },
    hide() {
      this._pageVisible = false;
      this._wechatProfilePromptShownThisVisit = false;
      this._wechatProfilePromptOpen = false;
    },
  },

  methods: {
    isDesignerContext() {
      return (this.properties.role || this.data.role) === 'designer';
    },

    scheduleWechatProfilePrompt() {
      if (!this.isDesignerContext()) return;
      if (this._wechatProfilePromptShownThisVisit) return;
      this.maybePromptDesignerWechatProfile();
    },

    async maybePromptDesignerWechatProfile() {
      if (!this.isDesignerContext()) return;
      if (this._wechatProfilePromptShownThisVisit) return;
      if (this._wechatProfilePromptOpen || this._wechatProfileChecking) return;
      this._wechatProfileChecking = true;
      try {
        const status = await this.loadDesignerWechatProfileStatus();
        if (!status || status.complete) return;
        this.openWechatProfilePrompt(status.subtitle);
      } finally {
        this._wechatProfileChecking = false;
      }
    },

    async loadDesignerWechatProfileStatus() {
      try {
        const result = await api.request('/miniprogram/staff/wechat-profile', 'GET');
        const data = (result && result.data) || {};
        const missing = [];
        if (Array.isArray(data.missing)) {
          data.missing.forEach((key) => missing.push(key));
        }
        if (!missing.length) {
          if (!String(data.wechatId || '').trim()) missing.push('wechatId');
          if (!data.wechatQrAssetId && !data.wechatQrUrl) missing.push('wechatQr');
        }
        if (data.assignmentEligible || !missing.length) {
          return { complete: true };
        }
        const labels = wechatProfileMissingLabels(missing);
        return {
          complete: false,
          subtitle: labels.length
            ? `还差${labels.join('和')}，补齐后才能接客户与出示活动码`
            : '请先补齐微信号和个人二维码，客户才能加你微信',
        };
      } catch (error) {
        const todo = findDesignerWechatProfileTodo(this.data.items);
        if (!todo) return { complete: true };
        return { complete: false, subtitle: todo.subtitle };
      }
    },

    openWechatProfilePrompt(subtitle) {
      if (this._wechatProfilePromptOpen || this._wechatProfilePromptShownThisVisit) return;
      this._wechatProfilePromptOpen = true;
      const present = () => {
        wx.showModal({
          title: '请先完善微信资料',
          content: subtitle
            || '请先补齐微信号和个人二维码，客户才能加你微信，也才能接客户与出示活动码',
          confirmText: '去完善',
          cancelText: '稍后',
          success: (res) => {
            this._wechatProfilePromptShownThisVisit = true;
            this._wechatProfilePromptOpen = false;
            if (res.confirm) {
              wx.navigateTo({ url: '/packages/business/profile-edit/profile-edit' });
            }
          },
          fail: () => {
            this._wechatProfilePromptOpen = false;
          },
        });
      };
      setTimeout(present, 400);
    },

    padDatePart(value) {
      return String(value).padStart(2, '0');
    },

    formatDateInput(date) {
      return `${date.getFullYear()}-${this.padDatePart(date.getMonth() + 1)}-${this.padDatePart(date.getDate())}`;
    },

    defaultCustomRange() {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        customFrom: this.formatDateInput(from),
        customTo: this.formatDateInput(now),
      };
    },

    workbenchQuery() {
      const period = this.data.dashboardPeriod || {};
      const query = { period: period.kind || 'month' };
      if (period.kind === 'custom' && period.from && period.to) {
        query.from = period.from;
        query.to = period.to;
      }
      return query;
    },

    async load() {
      if (this._fetching) return;
      this._fetching = true;
      this.setData({ loading: true, error: '' });
      try {
        const isCustomer = this.properties.role === 'customer';
        const result = await api.request(
          isCustomer ? '/miniprogram/customer-projects' : '/miniprogram/workbench',
          'GET',
          isCustomer ? {} : this.workbenchQuery()
        );
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
          actionLabel: item.actionLabel
            || (item.serviceStage === 'design_published'
              ? '查看方案'
              : item.canContinueSurvey
              ? '继续量房'
              : item.action === 'survey' || item.canSurveyNow
              ? '立即量房'
              : focus === 'survey'
                ? '进入量房'
                : item.action === 'appointment'
                  ? '查看预约'
                  : item.action === 'staffing'
                    ? '需补人'
                    : item.action === 'profile'
                      ? '去完善'
                      : item.action === 'rebook'
                      ? '重新预约'
                      : item.action === 'reschedule'
                        ? '改期'
                        : this.properties.role === 'customer'
                          ? '看项目'
                          : '查看客户'),
        }));
        const emptyCopy = isCustomer
          ? '还没有进行中的服务'
          : focus === 'survey'
          ? '暂无可进入的已指派量房任务'
          : focus === 'tasks'
            ? '当前没有待交接的量房任务'
              : focus === 'appointments'
              ? '当前没有需要协调的预约'
              : payload.role === 'enterprise_admin'
                ? '当前没有需要优先处理的异常'
              : payload.role === 'designer'
                ? '当前没有已派客户'
                : payload.role === 'measurer'
                  ? '今天没有已确认安排或待量房任务'
                  : '当前没有需要处理的异常';
        const app = getApp();
        const userInfo = (app && app.globalData && app.globalData.userInfo) || {};
        const bootstrap = (app && app.globalData && app.globalData.bootstrap) || {};
        const staffName = userInfo.displayName || userInfo.name || (bootstrap.current && bootstrap.current.staffName) || '';
        const enterpriseName = (bootstrap.enterprise && bootstrap.enterprise.name) || userInfo.enterpriseName || '';
        const periodPayload = payload.period || {};
        const dashboardPeriod = {
          kind: periodPayload.kind || this.data.dashboardPeriod.kind || 'month',
          label: periodPayload.label || this.data.dashboardPeriod.label || '本月',
          subtitle: periodPayload.subtitle || '',
          from: periodPayload.from || this.data.dashboardPeriod.from || '',
          to: periodPayload.to || this.data.dashboardPeriod.to || '',
        };

        this.setData({
          title: payload.title || '工作台',
          subtitle: payload.subtitle || '',
          summary: payload.summary || [],
          items,
          emptyCopy,
          secondary: payload.secondary || null,
          activityCode: payload.activityCode || null,
          dashboard: payload.dashboard || [],
          quickNav: payload.quickNav || [],
          dashboardPeriod,
          staffName,
          enterpriseName,
          loading: false,
        });
        this.scheduleWechatProfilePrompt();
      } catch (error) {
        this.setData({
          loading: false,
          error: error.error || error.message || '工作台加载失败，请检查网络后重试',
        });
      } finally {
        this._fetching = false;
      }
    },

    selectPeriodChip(event) {
      const kind = event.currentTarget.dataset.kind;
      if (!kind || kind === this.data.dashboardPeriod.kind) return;
      this.setData({
        dashboardPeriod: {
          ...this.data.dashboardPeriod,
          kind,
          label: kind === 'week' ? '本周' : kind === 'year' ? '本年' : '本月',
          from: '',
          to: '',
        },
        showPeriodSheet: false,
      }, () => this.load());
    },

    openPeriodSheet() {
      const defaults = this.defaultCustomRange();
      this.setData({
        showPeriodSheet: true,
        customFrom: this.data.dashboardPeriod.from || defaults.customFrom,
        customTo: this.data.dashboardPeriod.to || defaults.customTo,
      });
    },

    closePeriodSheet() {
      this.setData({ showPeriodSheet: false });
    },

    onCustomFromChange(event) {
      this.setData({ customFrom: event.detail.value });
    },

    onCustomToChange(event) {
      this.setData({ customTo: event.detail.value });
    },

    confirmCustomPeriod() {
      const from = String(this.data.customFrom || '').trim();
      const to = String(this.data.customTo || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        wx.showToast({ title: '请选择起止日期', icon: 'none' });
        return;
      }
      if (from > to) {
        wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' });
        return;
      }
      this.setData({
        showPeriodSheet: false,
        dashboardPeriod: {
          kind: 'custom',
          label: '自定义',
          subtitle: this.data.dashboardPeriod.subtitle,
          from,
          to,
        },
      }, () => this.load());
    },

    customerPayload(projects) {
      const urgency = {
        appointment_expired: 0,
        awaiting_rebooking: 1,
        appointment_in_progress: 2,
        appointment_confirmed: 3,
        survey_completed: 4,
        design_published: 5,
        measurer_assigned: 6,
        assignment_pending: 7,
        claimed: 8,
        converted: 9,
        closed: 10,
      };
      const ranked = [...(projects || [])].sort((left, right) =>
        (urgency[left.serviceStage] ?? 20) - (urgency[right.serviceStage] ?? 20)
      );
      const featured = ranked[0] || null;
      const items = featured ? [{
        id: featured.leadId,
        leadId: featured.leadId,
        appointmentId: featured.appointmentId,
        appointmentVersion: featured.appointmentVersion,
        title: featured.serviceStageLabel || '当前服务',
        subtitle: featured.appointmentSummary || featured.nextAction || '预约、户型档案和已发布方案由本人查看',
        status: featured.status,
        serviceStage: featured.serviceStage,
        metaLabel: featured.appointmentSummary || featured.serviceStageLabel || '服务准备中',
        nextActionKind: featured.nextActionKind,
        action: featured.nextActionKind === 'rebook' || featured.nextActionKind === 'book'
          ? featured.nextActionKind
          : featured.nextActionKind === 'reschedule'
            ? 'reschedule'
            : 'customer-project',
        actionLabel: featured.nextActionLabel || '看项目',
        canBookAppointment: featured.nextActionKind === 'rebook' || featured.nextActionKind === 'book',
        canReschedule: featured.nextActionKind === 'reschedule',
        canRebook: featured.nextActionKind === 'rebook',
      }] : [];
      return {
        role: 'customer',
        title: '我的装修服务',
        subtitle: featured
          ? (featured.appointmentSummary || featured.nextAction || '查看属于您的预约、正式量房与设计方案')
          : '领取服务后，当前阶段和下一步会出现在这里',
        summary: [
          { key: 'stage', label: '当前阶段', value: featured ? 1 : 0, detail: featured ? featured.serviceStageLabel : '暂无进行中的服务', tone: featured && (featured.canRebook || featured.canReschedule) ? 'orange' : 'green' },
          { key: 'next', label: '下一步', value: featured ? 1 : 0, detail: featured ? (featured.nextActionLabel || featured.nextAction) : '还没有进行中的服务', tone: 'green' },
        ],
        primaryItems: items,
        secondary: featured
          ? { label: '我的服务档案', target: 'projects' }
          : { label: '返回服务', target: 'projects' },
      };
    },

    openItem(event) {
      const item = event.currentTarget.dataset.item;
      if (!item) return;
      if (item.action === 'appointment' && item.appointmentId && item.leadId) {
        this.openAppointment({ currentTarget: { dataset: { item } } });
        return;
      }
      if (this.properties.focus === 'survey' || item.action === 'survey' || item.canSurveyNow || item.canContinueSurvey) {
        this.openSurvey({ currentTarget: { dataset: { item } } });
        return;
      }
      if (item.action === 'staffing') {
        this.openStaffRoster(item);
        return;
      }
      if (item.action === 'profile') {
        wx.navigateTo({ url: '/packages/business/profile-edit/profile-edit' });
        return;
      }
      if (item.action === 'reschedule' && item.leadId && item.appointmentId) {
        this.openReschedule({ currentTarget: { dataset: { item } } });
        return;
      }
      if ((item.action === 'rebook' || item.action === 'book') && item.leadId) {
        wx.navigateTo({
          url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(item.leadId)}${this.properties.role === 'customer' ? '&mode=customer' : ''}`,
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

    openQuickNav(event) {
      const target = event.currentTarget.dataset.target;
      if (target === 'customers') {
        wx.switchTab({ url: '/pages/leads-management/leads-management' });
        return;
      }
      if (target === 'staffing') {
        this.openStaffRoster();
      }
    },

    openStaffRoster(item) {
      const focus = item && item.id === 'staffing-designer'
        ? 'designer'
        : item && item.id === 'staffing-measurer'
          ? 'measurer'
          : '';
      const query = focus ? `?focus=${encodeURIComponent(focus)}` : '';
      wx.navigateTo({
        url: `/packages/business/enterprise-staff/enterprise-staff${query}`,
      });
    },

    openEnterpriseException(event) {
      const item = event.currentTarget.dataset.item;
      if (!item) return;
      if (item.action === 'staffing') {
        this.openStaffRoster(item);
        return;
      }
      if (item.action === 'appointment' && item.appointmentId && item.leadId) {
        this.openAppointment({ currentTarget: { dataset: { item } } });
        return;
      }
      if (item.leadId) {
        wx.navigateTo({ url: `/packages/business/lead-detail/lead-detail?id=${encodeURIComponent(item.leadId)}` });
        return;
      }
      wx.showToast({ title: '暂无对应处理入口', icon: 'none' });
    },

    openSecondary() {
      const target = this.data.secondary && this.data.secondary.target;
      if (target === 'customers') {
        wx.switchTab({ url: '/pages/leads-management/leads-management' });
      } else if (target === 'projects') {
        const featured = (this.data.primaryItems || [])[0];
        const leadId = featured && featured.leadId;
        if (leadId) {
          wx.navigateTo({
            url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}`,
          });
        } else {
          wx.switchTab({ url: '/pages/index/index' });
        }
      } else if (target === 'appointments') {
        wx.reLaunch({ url: '/packages/business/enterprise-appointments/enterprise-appointments' });
      } else if (target === 'unavailability') {
        wx.navigateTo({ url: '/packages/business/measurer-unavailability/measurer-unavailability' });
      } else if (target === 'calendar') {
        wx.navigateTo({ url: '/packages/business/measurer-calendar/measurer-calendar' });
      } else if (target === 'activity-code') {
        wx.navigateTo({ url: '/packages/business/staff-activity-code/staff-activity-code' });
      } else if (target === 'join-codes') {
        wx.navigateTo({ url: '/packages/business/enterprise-join-codes/enterprise-join-codes' });
      }
    },

    openActivityCode() {
      const target = this.data.activityCode && this.data.activityCode.target;
      if (target === 'join-codes') {
        wx.navigateTo({ url: '/packages/business/enterprise-join-codes/enterprise-join-codes' });
        return;
      }
      wx.navigateTo({ url: '/packages/business/staff-activity-code/staff-activity-code' });
    },

    openReschedule(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || !item.leadId || !item.appointmentId) return;
      wx.navigateTo({
        url: `/packages/business/appointment-detail/appointment-detail?leadId=${encodeURIComponent(item.leadId)}&appointmentId=${encodeURIComponent(item.appointmentId)}`,
      });
    },

    openBooking(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || !item.leadId) return;
      wx.navigateTo({
        url: `/packages/business/appointment-booking/appointment-booking?leadId=${encodeURIComponent(item.leadId)}${this.properties.role === 'customer' ? '&mode=customer' : ''}`,
      });
    },

    openAppointment(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || !item.leadId || !item.appointmentId) return;
      wx.navigateTo({
        url: `/packages/business/appointment-detail/appointment-detail?leadId=${encodeURIComponent(item.leadId)}&appointmentId=${encodeURIComponent(item.appointmentId)}`,
      });
    },

    openSurvey(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || !item.leadId) return;
      openSurveyingEditor({
        leadId: item.leadId,
        floorPlanId: item.floorPlanId || '',
        communityName: item.communityName || '',
      });
    },

    openNewSurvey(event) {
      const item = event.currentTarget.dataset.item;
      if (!item || !item.leadId) return;
      openSurveyingEditor({
        leadId: item.leadId,
        startNewSurvey: true,
        communityName: item.communityName || '',
      });
    },

    openCustomers() {
      wx.switchTab({ url: '/pages/leads-management/leads-management' });
    },

    openAIDesign() {
      wx.switchTab({ url: '/pages/ai-design/ai-design' });
    },

    openCalendar() {
      wx.navigateTo({ url: '/packages/business/measurer-calendar/measurer-calendar' });
    },

    openUnavailability() {
      wx.navigateTo({ url: '/packages/business/measurer-unavailability/measurer-unavailability' });
    },

    callCustomer(event) {
      const item = event.currentTarget.dataset.item;
      const phone = item && String(item.customerPhone || item.phone || item.leadPhone || '').trim();
      if (!phone) {
        wx.showToast({ title: '暂未提供客户电话', icon: 'none' });
        return;
      }
      wx.makePhoneCall({ phoneNumber: phone });
    },

    openNavigation(event) {
      const item = event.currentTarget.dataset.item;
      const latitude = Number(item && item.latitude);
      const longitude = Number(item && item.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        wx.showToast({ title: '暂未记录地图位置，请联系补充', icon: 'none' });
        return;
      }
      wx.openLocation({
        latitude,
        longitude,
        name: item.locationName || item.community || item.address || '量房地点',
        address: item.address || '',
        scale: 18,
      });
    },

    syncBleConnectionState() {
      const connected = !!(getApp().globalData && getApp().globalData.bleConnected);
      if (connected === this.data.bleConnected) return;
      this.setData({ bleConnected: connected });
    },

    trySilentBleReconnect() {
      const role = this.properties.role;
      if (!['measurer', 'designer', 'enterprise_admin'].includes(role)) return;
      if (this.data.bleConnected || this._bleSilentReconnecting) return;

      const app = getApp();
      if (app.globalData && app.globalData.bleConnected) {
        this.setData({ bleConnected: true });
        return;
      }

      const bluetooth = require('../../utils/bluetooth.js');
      if (bluetooth.isSessionConnected && bluetooth.isSessionConnected()) {
        if (app.globalData) app.globalData.bleConnected = true;
        this.setData({ bleConnected: true });
        return;
      }
      if (!bluetooth.hasRememberedDevice || !bluetooth.hasRememberedDevice()) return;

      this._bleSilentReconnecting = true;
      bluetooth.autoConnectBLE(
        function () {},
        (success) => {
          this._bleSilentReconnecting = false;
          if (app.globalData) app.globalData.bleConnected = !!success;
          if (success) {
            this.setData({ bleConnected: true, showBLEConnector: false });
          }
        },
        () => {
          this._bleSilentReconnecting = false;
          this.onBleDisconnect();
        },
        true
      );
    },

    openBleConnector() {
      this.setData({ showBLEConnector: true });
    },

    onCloseBleConnector() {
      this.setData({ showBLEConnector: false });
    },

    onBleSuccess() {
      if (getApp().globalData) {
        getApp().globalData.bleConnected = true;
      }
      this.setData({ bleConnected: true, showBLEConnector: false });
    },

    onBleDisconnect() {
      if (getApp().globalData) {
        getApp().globalData.bleConnected = false;
      }
      this.setData({ bleConnected: false });
    },

    noop() {},
  },
});
