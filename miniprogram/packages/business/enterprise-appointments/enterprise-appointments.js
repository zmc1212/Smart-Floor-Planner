const api = require('../../../utils/api');
const { formatAppointmentDisplay } = require('../../../utils/appointmentTimeRange.js');

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_CUSTOM_DAYS = 366;
const PERIOD_CHIPS = [
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' },
  { key: 'year', label: '本年' },
];

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

function padZero(num) {
  return String(num).padStart(2, '0');
}

function shanghaiDateKey(date = new Date()) {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${padZero(shifted.getUTCMonth() + 1)}-${padZero(shifted.getUTCDate())}`;
}

function addCalendarDateKey(key, days) {
  const [year, month, day] = String(key).split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return `${utc.getUTCFullYear()}-${padZero(utc.getUTCMonth() + 1)}-${padZero(utc.getUTCDate())}`;
}

function inclusiveDayCount(fromKey, toKey) {
  const [fromYear, fromMonth, fromDay] = String(fromKey).split('-').map(Number);
  const [toYear, toMonth, toDay] = String(toKey).split('-').map(Number);
  const fromUtc = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const toUtc = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((toUtc - fromUtc) / (24 * 60 * 60 * 1000)) + 1;
}

function enumerateDateKeys(fromKey, toKey) {
  const keys = [];
  let key = fromKey;
  let guard = 0;
  while (key <= toKey && guard < 370) {
    keys.push(key);
    key = addCalendarDateKey(key, 1);
    guard += 1;
  }
  return keys;
}

function parseSlot(range) {
  const display = formatAppointmentDisplay(range);
  return {
    time: display.time,
    dateKey: display.dateKey,
    startMs: display.startMs,
  };
}

function isOverdueCoordination(item, todayKey) {
  if (!item || !item.dateKey || item.dateKey >= todayKey) return false;
  if (item.serviceStage === 'converted' || item.serviceStage === 'closed') return false;
  return item.status === 'expired'
    || item.serviceStage === 'appointment_expired'
    || item.serviceStage === 'awaiting_rebooking';
}

function statusPresentation(item) {
  const serviceStage = String(item.serviceStage || '');
  // Signed/closed ends the lead on this platform — no schedule coordination actions.
  if (serviceStage === 'converted' || serviceStage === 'closed') {
    return {
      tone: 'green',
      statusLabel: serviceStage === 'converted' ? '已签约' : '已关闭',
      footerText: item.nextAction
        || (serviceStage === 'converted' ? '已签约，无需继续推进' : '该线索已关闭'),
      showRescheduleCta: false,
      ctaLabel: '',
      openable: false,
    };
  }
  if (item.status === 'expired') {
    return {
      tone: 'orange',
      statusLabel: '需协调改期',
      footerText: item.nextAction || '预约已过期，请进入详情协调改期或重新预约',
      showRescheduleCta: true,
      ctaLabel: '查看预约',
      openable: true,
    };
  }
  const badge = String(item.statusBadge || '').trim();
  const statusLabel = badge === '待上门'
    ? '已排期·待量房'
    : badge || item.metaLabel || '已排期';
  return {
    tone: 'green',
    statusLabel,
    footerText: item.nextAction || item.metaLabel || '已确认预约，待准时上门',
    showRescheduleCta: false,
    ctaLabel: '',
    openable: true,
  };
}

function mapAppointment(item) {
  const parsed = parseSlot(item.timeRange || item.meta);
  const presentation = statusPresentation(item);
  const place = item.subtitle || item.communityName || '地址待确认';
  return {
    ...item,
    ...parsed,
    ...presentation,
    placeLabel: place,
    customerLine: `客户：${item.title || '客户'}`,
    headerLine: `${parsed.time}  |  ${place}`,
  };
}

function periodLabelText(period) {
  if (period.kind === 'custom') return '自定义';
  if (period.kind === 'week') return '本周';
  if (period.kind === 'year') return '本年';
  if (period.kind === 'month') return '本月';
  return period.label || '本周';
}

function formatCustomRangeLabel(fromKey, toKey) {
  const fromMatch = String(fromKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const toMatch = String(toKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!fromMatch || !toMatch) return '';
  const fromMonth = Number(fromMatch[2]);
  const fromDay = Number(fromMatch[3]);
  const toMonth = Number(toMatch[2]);
  const toDay = Number(toMatch[3]);
  if (fromMatch[1] === toMatch[1]) {
    return `${fromMonth}/${fromDay} ~ ${toMonth}/${toDay}`;
  }
  return `${Number(fromMatch[1])}/${fromMonth}/${fromDay} ~ ${Number(toMatch[1])}/${toMonth}/${toDay}`;
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    weekCount: 0,
    weekSubtitle: '本周 0 单预约',
    weekDays: [],
    todayDateKey: '',
    selectedDateKey: '',
    selectedDateTitle: '今日预约排期',
    dayScrollIntoView: '',
    allAppointments: [],
    selectedAppointments: [],
    schedulePeriod: {
      kind: 'week',
      label: '本周',
      from: '',
      to: '',
    },
    periodChips: PERIOD_CHIPS,
    periodSheetVisible: false,
    periodSheetOpen: false,
    customFrom: '',
    customTo: '',
    customRangeLabel: '',
  },

  onLoad() {
    const todayKey = shanghaiDateKey();
    this.setData({
      ...navigationMetrics(),
      todayDateKey: todayKey,
      selectedDateKey: todayKey,
    });
  },

  onShow() {
    this.load();
  },

  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/index/index' }) });
  },

  noop() {},

  scheduleQuery() {
    const period = this.data.schedulePeriod || {};
    const query = {
      period: period.kind || 'week',
      schedule: '1',
    };
    if (period.kind === 'custom' && period.from && period.to) {
      query.from = period.from;
      query.to = period.to;
    }
    return query;
  },

  defaultCustomRange() {
    const todayKey = shanghaiDateKey();
    const fromKey = `${todayKey.slice(0, 8)}01`;
    return {
      customFrom: fromKey,
      customTo: todayKey,
    };
  },

  buildPeriodDays(fromKey, toKey, appointments) {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const todayKey = shanghaiDateKey();
    const compact = inclusiveDayCount(fromKey, toKey) > 31;
    const taskCountMap = {};
    (appointments || []).forEach((item) => {
      if (item.dateKey) {
        taskCountMap[item.dateKey] = (taskCountMap[item.dateKey] || 0) + 1;
      }
    });
    const overdueOnToday = (appointments || []).some((item) => isOverdueCoordination(item, todayKey));
    return enumerateDateKeys(fromKey, toKey).map((key) => {
      const [year, month, day] = key.split('-').map(Number);
      const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const isToday = key === todayKey;
      return {
        key,
        dayId: `day-${key}`,
        dayName: isToday ? '今日' : dayNames[weekday],
        dateLabel: compact ? `${month}/${day}` : String(day),
        compact,
        isToday,
        hasTask: (taskCountMap[key] || 0) > 0 || (isToday && overdueOnToday),
      };
    });
  },

  applySelection(selectedKey, appointments, weekDays) {
    const todayKey = this.data.todayDateKey || shanghaiDateKey();
    const selected = appointments
      .filter((item) => item.dateKey === selectedKey
        || (!item.dateKey && selectedKey === todayKey)
        || (selectedKey === todayKey && isOverdueCoordination(item, todayKey)))
      .sort((left, right) => left.startMs - right.startMs);
    const selectedDay = (weekDays || []).find((day) => day.key === selectedKey);
    let selectedDateTitle = '当日预约排期';
    if (selectedKey === todayKey) {
      selectedDateTitle = '今日预约排期';
    } else if (selectedDay && selectedDay.compact) {
      const parts = String(selectedKey).split('-');
      selectedDateTitle = `${Number(parts[1])}月${Number(parts[2])}日预约排期`;
    } else if (selectedDay) {
      selectedDateTitle = `${selectedDay.dayName}预约排期`;
    }
    this.setData({
      selectedDateKey: selectedKey,
      selectedAppointments: selected,
      selectedDateTitle,
      dayScrollIntoView: '',
    }, () => {
      this.setData({ dayScrollIntoView: `day-${selectedKey}` });
    });
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/workbench', 'GET', this.scheduleQuery());
      const payload = result.data || {};
      if (payload.role && payload.role !== 'enterprise_admin') {
        this.setData({
          loading: false,
          error: '当前身份没有企业预约调度权限',
          allAppointments: [],
          selectedAppointments: [],
          weekDays: [],
          weekCount: 0,
          weekSubtitle: '本周 0 单预约',
          customRangeLabel: '',
        });
        return;
      }

      const appointments = (payload.appointments || [])
        .filter((item) => item.status === 'confirmed' || item.status === 'expired')
        .map(mapAppointment);

      const todayKey = shanghaiDateKey();
      const periodPayload = payload.period || {};
      const currentPeriod = this.data.schedulePeriod || {};
      const fromKey = periodPayload.from || currentPeriod.from || todayKey;
      const toKey = periodPayload.to || currentPeriod.to || addCalendarDateKey(fromKey, 6);
      const weekDays = this.buildPeriodDays(fromKey, toKey, appointments);
      const weekKeys = new Set(weekDays.map((day) => day.key));
      const weekCount = appointments.filter((item) => weekKeys.has(item.dateKey)
        || (weekKeys.has(todayKey) && isOverdueCoordination(item, todayKey))).length;
      const kind = periodPayload.kind || currentPeriod.kind || 'week';
      const label = periodLabelText({ kind, label: periodPayload.label || currentPeriod.label });
      let selectedKey = this.data.selectedDateKey || todayKey;
      if (!weekKeys.has(selectedKey)) {
        selectedKey = weekKeys.has(todayKey) ? todayKey : fromKey;
      }

      this.setData({
        loading: false,
        todayDateKey: todayKey,
        allAppointments: appointments,
        weekDays,
        weekCount,
        weekSubtitle: `${label} ${weekCount} 单预约`,
        customRangeLabel: kind === 'custom' ? formatCustomRangeLabel(fromKey, toKey) : '',
        schedulePeriod: {
          kind,
          label: periodPayload.label || currentPeriod.label || '本周',
          from: fromKey,
          to: toKey,
        },
      });
      this.applySelection(selectedKey, appointments, weekDays);
    } catch (error) {
      this.setData({
        loading: false,
        error: error.error || error.message || '预约列表加载失败，请检查网络后重试',
        allAppointments: [],
        selectedAppointments: [],
        weekDays: [],
        weekCount: 0,
        weekSubtitle: `${periodLabelText(this.data.schedulePeriod || {})} 0 单预约`,
        customRangeLabel: '',
      });
    }
  },

  selectPeriodChip(event) {
    const kind = event.currentTarget.dataset.kind;
    if (!kind || kind === this.data.schedulePeriod.kind) return;
    this.setData({
      schedulePeriod: {
        kind,
        label: kind === 'week' ? '本周' : kind === 'year' ? '本年' : '本月',
        from: '',
        to: '',
      },
      periodSheetVisible: false,
      periodSheetOpen: false,
    }, () => this.load());
  },

  openPeriodSheet() {
    const defaults = this.defaultCustomRange();
    const period = this.data.schedulePeriod || {};
    this.setData({
      periodSheetVisible: true,
      periodSheetOpen: false,
      customFrom: period.kind === 'custom' && period.from ? period.from : defaults.customFrom,
      customTo: period.kind === 'custom' && period.to ? period.to : defaults.customTo,
    });
    setTimeout(() => this.setData({ periodSheetOpen: true }), 20);
  },

  closePeriodSheet() {
    this.setData({ periodSheetOpen: false });
    setTimeout(() => this.setData({ periodSheetVisible: false }), 260);
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
    if (inclusiveDayCount(from, to) > MAX_CUSTOM_DAYS) {
      wx.showToast({ title: '自定义跨度不能超过一年', icon: 'none' });
      return;
    }
    this.setData({
      periodSheetOpen: false,
      schedulePeriod: {
        kind: 'custom',
        label: '自定义',
        from,
        to,
      },
    });
    setTimeout(() => {
      this.setData({ periodSheetVisible: false });
      this.load();
    }, 260);
  },

  selectDay(event) {
    const key = event.currentTarget.dataset.date;
    if (!key) return;
    this.applySelection(key, this.data.allAppointments || [], this.data.weekDays || []);
  },

  openAppointment(event) {
    const dataset = event.currentTarget.dataset || {};
    const openable = dataset.openable === true || dataset.openable === 'true';
    const leadId = dataset.leadId;
    const appointmentId = dataset.appointmentId;
    if (!openable || !leadId || !appointmentId) return;
    wx.navigateTo({
      url: `/packages/business/appointment-detail/appointment-detail?leadId=${encodeURIComponent(leadId)}&appointmentId=${encodeURIComponent(appointmentId)}`,
    });
  },
});
