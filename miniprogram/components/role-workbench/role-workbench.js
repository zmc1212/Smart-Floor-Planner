const api = require('../../utils/api.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
const { formatAppointmentDisplay } = require('../../utils/appointmentTimeRange.js');
const { openRoleGuide, hasSeenRoleGuide } = require('../../utils/roleGuide.js');

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

function resolveStaffName(userInfo) {
  const info = userInfo || {};
  return String(info.nickname || info.displayName || info.name || '').trim();
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

function normalizeWorkbenchCodeActions(payload) {
  const rawActivity = payload && payload.activityCode;
  let rawJoin = payload && payload.joinCode;
  const rawRoster = payload && payload.referrerRoster;
  let activity = rawActivity;

  // Keep the owner home usable while the Mini Program and API deploy independently.
  if (rawActivity && rawActivity.target === 'join-codes') {
    rawJoin = rawJoin || rawActivity;
    activity = null;
  }

  return {
    activityCode: activity && activity.target === 'activity-code'
      ? {
          ...activity,
          label: '分享活动码',
          detail: activity.detail || '发给客户 · 扫码留资',
        }
      : null,
    joinCode: rawJoin && rawJoin.target === 'join-codes'
      ? {
          ...rawJoin,
          label: '邀请入驻',
          detail: rawJoin.detail || (payload.role === 'enterprise_admin' ? '员工 · 推荐人' : '仅推荐人'),
        }
      : null,
    referrerRoster: rawRoster && rawRoster.target === 'referrers'
      ? {
          ...rawRoster,
          label: rawRoster.label || (payload.role === 'enterprise_admin' ? '查看推广人' : '我的推广人'),
          detail: rawRoster.detail || (payload.role === 'enterprise_admin' ? '全店推广网络' : '仅查看本人网络'),
        }
      : null,
  };
}

function normalizePersonalDashboard(rows, role) {
  const dashboardByKey = new Map((rows || []).map((item) => [item.key, item]));
  const definitions = role === 'measurer'
    ? [
        { key: 'newLeads', flowLabel: '客户接收' },
        { key: 'completedSurveys', flowLabel: '上门量房' },
        { key: 'schemeDelivery', flowLabel: '户型交接' },
        { key: 'signedCount', flowLabel: '签约' },
      ]
    : [
        { key: 'newLeads', flowLabel: '客户跟进' },
        { key: 'completedSurveys', flowLabel: '量房协作' },
        { key: 'schemeDelivery', flowLabel: '方案交付' },
        { key: 'signedCount', flowLabel: '签约' },
      ];
  return definitions.map((definition) => ({
    ...definition,
    ...(dashboardByKey.get(definition.key) || {}),
  }));
}

function normalizeContractAmountTrend(input, periodKind) {
  const raw = input || {};
  const labels = Array.isArray(raw.labels) ? raw.labels.map((item) => String(item || '')) : [];
  const toWan = (values) => (Array.isArray(values) ? values : []).map((value) => {
    const amount = Number(value || 0);
    return Number.isFinite(amount) && amount > 0 ? amount / 10000 : 0;
  });
  const current = toWan(raw.current);
  const previous = toWan(raw.previous);
  const hasData = Boolean(raw.hasData) && current.length === labels.length;
  const axisLabels = [];
  if (labels.length) {
    const labelCount = Math.min(6, labels.length);
    for (let index = 0; index < labelCount; index += 1) {
      const sourceIndex = labelCount === 1
        ? 0
        : Math.round((index * (labels.length - 1)) / (labelCount - 1));
      if (axisLabels[axisLabels.length - 1] !== labels[sourceIndex]) axisLabels.push(labels[sourceIndex]);
    }
  }
  const periodLabels = periodKind === 'week'
    ? { currentLabel: '本周', previousLabel: '上周' }
    : periodKind === 'year'
      ? { currentLabel: '本年', previousLabel: '上年' }
      : periodKind === 'custom'
        ? { currentLabel: '本期', previousLabel: '上期' }
        : { currentLabel: '本月', previousLabel: '上月' };
  return { hasData, current, previous, axisLabels, ...periodLabels };
}

function formatContractAmountTrendLabel(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  const precision = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return String(Number(amount.toFixed(precision)));
}

function normalizeEnterpriseDashboard(rows, contractAmountSum) {
  const dashboardByKey = new Map((rows || []).map((item) => [item.key, item]));
  const stageKeys = ['newLeads', 'completedSurveys', 'signedCount'];
  const efficiencyKeys = ['schemeDelivery', 'signingRate'];
  const normalizedItem = (key, index) => {
    const item = dashboardByKey.get(key) || {
      key,
      label: '',
      value: '—',
      unit: '',
      detail: '',
      tone: 'green',
    };
    const numericValue = Number(item.value);
    const legacyClosureDetail = key === 'completedSurveys'
      && /闭合率/.test(String(item.detail || ''));
    return {
      ...item,
      detail: legacyClosureDetail ? '方案同步中' : item.detail,
      ordinal: index + 1,
      state: Number.isFinite(numericValue) && numericValue > 0 ? 'active' : 'idle',
    };
  };

  const dashboardStages = stageKeys.map((key, index) => ({
    ...normalizedItem(key, index),
    flowLabel: ['线索获取', '方案交付', '签约成交'][index],
    flowDetail: ['获取客户线索', '完成方案交付', '签约并收款'][index],
  }));
  return {
    dashboardStages,
    dashboardEfficiencies: efficiencyKeys.map(normalizedItem),
    enterpriseHeroKpis: [
      dashboardStages[0],
      dashboardStages[1],
      dashboardStages[2],
      {
        key: 'contractAmount',
        label: '签约金额',
        value: contractAmountSum,
        unit: '',
        detail: '',
        tone: 'green',
      },
    ],
  };
}

function buildEnterpriseReminder(rows) {
  const dashboardByKey = new Map((rows || []).map((item) => [item.key, item]));
  return [
    { key: 'newLeads', label: '本期新增线索' },
    { key: 'signedCount', label: '本期已签约' },
  ].map(({ key, label }) => {
    const item = dashboardByKey.get(key);
    if (!item) return null;
    return {
      key,
      label,
      value: item.value === undefined || item.value === null ? '--' : item.value,
      unit: item.unit || '',
    };
  }).filter(Boolean);
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
    appointmentCount: 0,
    activityCode: null,
    joinCode: null,
    referrerRoster: null,
    dashboard: [],
    personalDashboardStages: [],
    enterpriseReminder: [],
    dashboardStages: [],
    dashboardEfficiencies: [],
    enterpriseHeroKpis: [],
    contractAmountTrend: { hasData: false, current: [], previous: [], axisLabels: [], currentLabel: '本月', previousLabel: '上月' },
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
    enterpriseName: '',
    staffName: '',
    claimPoolSummary: null,
    withdrawalNotices: [],
  },

  observers: {
    role(role) {
      if (role === 'designer') this.scheduleWechatProfilePrompt();
      this.scheduleEnterpriseRoleGuide();
      this.scheduleDesignerRoleGuide();
      this.scheduleMeasurerRoleGuide();
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
      this.scheduleEnterpriseRoleGuide();
      this.scheduleDesignerRoleGuide();
      this.scheduleMeasurerRoleGuide();
    },
  },

  pageLifetimes: {
    show() {
      this.syncBleConnectionState();
      this.trySilentBleReconnect();
      if (this._pageVisible) {
        this.scheduleWechatProfilePrompt();
        this.scheduleDesignerRoleGuide();
        this.scheduleMeasurerRoleGuide();
        return;
      }
      this._pageVisible = true;
      this._wechatProfilePromptShownThisVisit = false;
      this.load();
      this.scheduleWechatProfilePrompt();
      this.scheduleDesignerRoleGuide();
      this.scheduleMeasurerRoleGuide();
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

    scheduleEnterpriseRoleGuide() {
      const role = this.properties.role || this.data.role;
      const focus = this.properties.focus || this.data.focus || 'overview';
      if (role !== 'enterprise_admin' || focus !== 'overview') return;
      if (this._enterpriseGuidePromptShown || hasSeenRoleGuide('enterprise_admin')) return;
      this._enterpriseGuidePromptShown = true;
      setTimeout(() => {
        openRoleGuide('enterprise_admin', { automatic: true, source: 'first-entry' });
      }, 0);
    },

    scheduleDesignerRoleGuide() {
      const role = this.properties.role || this.data.role;
      const focus = this.properties.focus || this.data.focus || 'overview';
      if (role !== 'designer' || focus !== 'overview') return;
      if (this._designerGuidePromptShown || hasSeenRoleGuide('designer')) return;
      this._designerGuidePromptShown = true;
      setTimeout(() => {
        openRoleGuide('designer', { automatic: true, source: 'first-entry' });
      }, 0);
    },

    scheduleMeasurerRoleGuide() {
      const role = this.properties.role || this.data.role;
      const focus = this.properties.focus || this.data.focus || 'overview';
      if (role !== 'measurer' || focus !== 'overview') return;
      if (this._measurerGuidePromptShown || hasSeenRoleGuide('measurer')) return;
      this._measurerGuidePromptShown = true;
      setTimeout(() => {
        openRoleGuide('measurer', { automatic: true, source: 'first-entry' });
      }, 0);
    },

    scheduleWechatProfilePrompt() {
      if (!this.isDesignerContext()) return;
      // The role guide gets first-run priority; profile completion can resume after it closes.
      if (!hasSeenRoleGuide('designer')) return;
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
              : item.canCompleteSurvey
              ? '确认完成量房'
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
        const enterpriseName = (bootstrap.enterprise && bootstrap.enterprise.name) || userInfo.enterpriseName || '';
        const staffName = resolveStaffName(userInfo);
        const periodPayload = payload.period || {};
        const dashboardPeriod = {
          kind: periodPayload.kind || this.data.dashboardPeriod.kind || 'month',
          label: periodPayload.label || this.data.dashboardPeriod.label || '本月',
          subtitle: periodPayload.subtitle || '',
          from: periodPayload.from || this.data.dashboardPeriod.from || '',
          to: periodPayload.to || this.data.dashboardPeriod.to || '',
        };
        const codeActions = normalizeWorkbenchCodeActions(payload);
        const enterpriseDashboard = payload.role === 'enterprise_admin'
          ? normalizeEnterpriseDashboard(payload.dashboard, payload.contractAmountSum)
          : { dashboardStages: [], dashboardEfficiencies: [], enterpriseHeroKpis: [] };
        const enterpriseReminder = payload.role === 'enterprise_admin'
          ? buildEnterpriseReminder(payload.dashboard)
          : [];
        const contractAmountTrend = payload.role === 'enterprise_admin'
          ? normalizeContractAmountTrend(payload.contractAmountTrend, dashboardPeriod.kind)
          : { hasData: false, current: [], previous: [], axisLabels: [], currentLabel: '本月', previousLabel: '上月' };

        this.setData({
          title: payload.title || '工作台',
          subtitle: payload.subtitle || '',
          summary: payload.summary || [],
          items,
          emptyCopy,
          secondary: payload.secondary || null,
          appointmentCount: Array.isArray(payload.appointments) ? payload.appointments.length : 0,
          activityCode: codeActions.activityCode,
          joinCode: codeActions.joinCode,
          referrerRoster: codeActions.referrerRoster,
          dashboard: payload.dashboard || [],
          personalDashboardStages: payload.role === 'designer' || payload.role === 'measurer'
            ? normalizePersonalDashboard(payload.dashboard, payload.role)
            : [],
          enterpriseReminder,
          dashboardStages: enterpriseDashboard.dashboardStages,
          dashboardEfficiencies: enterpriseDashboard.dashboardEfficiencies,
          enterpriseHeroKpis: enterpriseDashboard.enterpriseHeroKpis,
          contractAmountTrend,
          quickNav: payload.quickNav || [],
          dashboardPeriod,
          enterpriseName,
          staffName,
          withdrawalNotices: payload.withdrawalNotices || [],
          loading: false,
        }, () => this.renderContractAmountTrend());
        if (payload.role === 'designer') this.loadClaimPoolSummary();
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

    renderContractAmountTrend() {
      const trend = this.data.contractAmountTrend || {};
      const focus = this.properties.focus || this.data.focus;
      if (this.properties.role !== 'enterprise_admin' || focus !== 'operations' || !trend.hasData) return;
      wx.nextTick(() => {
        this.createSelectorQuery()
          .select('#operations-trend-canvas')
          .fields({ node: true, size: true })
          .exec((result) => {
            const canvasInfo = result && result[0];
            if (!canvasInfo || !canvasInfo.node || !canvasInfo.width || !canvasInfo.height) return;
            const canvas = canvasInfo.node;
            const context = canvas.getContext('2d');
            const pixelRatio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio || 1;
            const width = canvasInfo.width;
            const height = canvasInfo.height;
            canvas.width = width * pixelRatio;
            canvas.height = height * pixelRatio;
            context.scale(pixelRatio, pixelRatio);
            context.clearRect(0, 0, width, height);
            const current = trend.current || [];
            const previous = trend.previous || [];
            const values = current.concat(previous).map((value) => Number(value || 0));
            const maxValue = Math.max(...values, 1);
            // Reserve a dedicated lane above the line so point labels never clip at a peak.
            const padding = { top: 28, right: 8, bottom: 12, left: 8 };
            const chartWidth = Math.max(1, width - padding.left - padding.right);
            const chartHeight = Math.max(1, height - padding.top - padding.bottom);
            const pointFor = (value, index, length) => ({
              x: padding.left + (length <= 1 ? chartWidth / 2 : (chartWidth * index) / (length - 1)),
              y: padding.top + chartHeight - (Math.max(0, Number(value || 0)) / maxValue) * chartHeight,
            });
            const drawLine = (valuesToDraw, color, dashed) => {
              if (!valuesToDraw.length) return;
              context.save();
              context.beginPath();
              if (dashed && context.setLineDash) context.setLineDash([4, 4]);
              valuesToDraw.forEach((value, index) => {
                const point = pointFor(value, index, valuesToDraw.length);
                if (index === 0) context.moveTo(point.x, point.y);
                else context.lineTo(point.x, point.y);
              });
              context.strokeStyle = color;
              context.lineWidth = dashed ? 1.5 : 2;
              context.stroke();
              context.restore();
            };
            const annotationIndexes = (valuesToDraw) => {
              const positive = valuesToDraw
                .map((value, index) => (Number(value || 0) > 0 ? index : -1))
                .filter((index) => index >= 0);
              const maxLabels = Math.max(1, Math.floor(chartWidth / 56));
              if (positive.length <= maxLabels) return positive;
              const highest = positive.reduce((selected, index) => (
                Number(valuesToDraw[index] || 0) > Number(valuesToDraw[selected] || 0) ? index : selected
              ), positive[0]);
              if (maxLabels === 1) return [highest];
              const selected = new Set([highest]);
              [positive[0], positive[positive.length - 1]].forEach((index) => {
                if (selected.size < maxLabels) selected.add(index);
              });
              for (let index = 1; selected.size < maxLabels && index < positive.length - 1; index += 1) {
                selected.add(positive[Math.round((index * (positive.length - 1)) / (maxLabels - 1))]);
              }
              return Array.from(selected).sort((left, right) => left - right);
            };
            const drawValueLabel = (value, index, valuesToDraw, color, offset) => {
              const label = formatContractAmountTrendLabel(value);
              if (!label) return;
              const point = pointFor(value, index, valuesToDraw.length);
              context.save();
              context.font = '600 10px sans-serif';
              context.textAlign = 'center';
              context.textBaseline = 'middle';
              const horizontalPadding = 5;
              const labelWidth = context.measureText(label).width + horizontalPadding * 2;
              const labelHeight = 18;
              const centerX = Math.max(labelWidth / 2, Math.min(width - labelWidth / 2, point.x));
              const centerY = Math.max(labelHeight / 2, point.y - 11 - offset);
              const left = centerX - labelWidth / 2;
              const top = centerY - labelHeight / 2;
              const radius = Math.min(9, labelWidth / 2, labelHeight / 2);
              context.fillStyle = color;
              context.beginPath();
              context.moveTo(left + radius, top);
              context.lineTo(left + labelWidth - radius, top);
              context.quadraticCurveTo(left + labelWidth, top, left + labelWidth, top + radius);
              context.lineTo(left + labelWidth, top + labelHeight - radius);
              context.quadraticCurveTo(left + labelWidth, top + labelHeight, left + labelWidth - radius, top + labelHeight);
              context.lineTo(left + radius, top + labelHeight);
              context.quadraticCurveTo(left, top + labelHeight, left, top + labelHeight - radius);
              context.lineTo(left, top + radius);
              context.quadraticCurveTo(left, top, left + radius, top);
              context.fill();
              context.fillStyle = '#ffffff';
              context.fillText(label, centerX, centerY + 0.5);
              context.restore();
            };
            drawLine(previous, '#aab7b0', true);
            drawLine(current, '#04b960', false);
            annotationIndexes(previous).forEach((index) => drawValueLabel(previous[index], index, previous, '#8b9891', 6));
            annotationIndexes(current).forEach((index) => drawValueLabel(current[index], index, current, '#04b960', 0));
            current.forEach((value, index) => {
              const point = pointFor(value, index, current.length);
              context.beginPath();
              context.arc(point.x, point.y, 2.8, 0, Math.PI * 2);
              context.fillStyle = '#ffffff';
              context.fill();
              context.lineWidth = 1.8;
              context.strokeStyle = '#04b960';
              context.stroke();
            });
          });
      });
    },

    async acknowledgeWithdrawal(event) {
      const id = event.currentTarget.dataset.id;
      if (!id) return;
      try {
        await api.request('/miniprogram/notifications', 'POST', { ids: [id] });
        this.setData({ withdrawalNotices: (this.data.withdrawalNotices || []).filter((item) => item.id !== id) });
        wx.showToast({ title: '已确认', icon: 'success' });
      } catch (error) {
        wx.showToast({ title: error.message || '确认失败', icon: 'none' });
      }
    },

    async loadClaimPoolSummary() {
      try {
        const result = await api.request('/lead-claim-pool', 'GET');
        const rows = (result && result.data) || [];
        const openRows = rows.filter((item) => item && item.canClaim);
        const nearest = openRows.slice().sort((left, right) => Number(left.remainingSeconds || 0) - Number(right.remainingSeconds || 0))[0];
        this.setData({
          claimPoolSummary: {
            count: openRows.length,
            remainingSeconds: nearest ? Number(nearest.remainingSeconds || 0) : 0,
            capacityAvailable: !result.capacity || result.capacity.available !== false,
          },
        });
      } catch (error) {
        this.setData({ claimPoolSummary: null });
      }
    },

    openClaimPool() {
      wx.navigateTo({ url: '/packages/business/lead-claim-pool/lead-claim-pool' });
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
        survey_ready: 2,
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
      // Published overview cards open the delivered schemes even when an older
      // appointment or survey action is still present in the workbench payload.
      if (this.properties.role === 'designer' && this.properties.focus === 'overview'
        && item.serviceStage === 'design_published' && item.leadId) {
        wx.navigateTo({
          url: `/packages/business/customer-ai-schemes/customer-ai-schemes?leadId=${encodeURIComponent(item.leadId)}&mode=staff`,
        });
        return;
      }
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
        wx.navigateTo({ url: '/packages/business/enterprise-appointments/enterprise-appointments' });
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

    openOperations() {
      wx.switchTab({ url: '/pages/enterprise-operations/enterprise-operations' });
    },

    openActivityCode() {
      const target = this.data.activityCode && this.data.activityCode.target;
      if (target === 'join-codes') {
        this.openJoinCodes();
        return;
      }
      wx.navigateTo({ url: '/packages/business/staff-activity-code/staff-activity-code' });
    },

    openJoinCodes() {
      wx.navigateTo({ url: '/packages/business/enterprise-join-codes/enterprise-join-codes' });
    },

    openReferrerRoster() {
      wx.navigateTo({ url: '/packages/business/enterprise-referrers/enterprise-referrers' });
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
