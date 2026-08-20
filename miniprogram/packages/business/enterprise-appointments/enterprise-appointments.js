const api = require('../../../utils/api');

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

function formatDateKey(d) {
  return `${d.getFullYear()}-${padZero(d.getMonth() + 1)}-${padZero(d.getDate())}`;
}

function parseSlot(range) {
  const match = String(range || '').match(/[[(]([^,]+),([^\])]+)[\])]/);
  if (!match) {
    return { time: '时间待确认', dateKey: '', startMs: 0 };
  }
  const start = new Date(match[1].replaceAll('"', ''));
  const end = new Date(match[2].replaceAll('"', ''));
  if (Number.isNaN(start.getTime())) {
    return { time: '时间待确认', dateKey: '', startMs: 0 };
  }
  const endLabel = Number.isNaN(end.getTime())
    ? ''
    : ` - ${padZero(end.getHours())}:${padZero(end.getMinutes())}`;
  return {
    time: `${padZero(start.getHours())}:${padZero(start.getMinutes())}${endLabel}`,
    dateKey: formatDateKey(start),
    startMs: start.getTime(),
  };
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
    allAppointments: [],
    selectedAppointments: [],
  },

  onLoad() {
    const todayKey = formatDateKey(new Date());
    this.setData({
      ...navigationMetrics(),
      todayDateKey: todayKey,
      selectedDateKey: todayKey,
    });
  },

  onShow() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar) tabBar.syncSelected();
    this.load();
  },

  buildWeekDays(refDate, appointments) {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const todayKey = formatDateKey(new Date());
    const days = [];
    const taskCountMap = {};

    (appointments || []).forEach((item) => {
      if (item.dateKey) {
        taskCountMap[item.dateKey] = (taskCountMap[item.dateKey] || 0) + 1;
      }
    });

    for (let i = 0; i < 7; i += 1) {
      const day = new Date(refDate);
      day.setHours(0, 0, 0, 0);
      day.setDate(refDate.getDate() + i);
      const key = formatDateKey(day);
      const isToday = key === todayKey;
      days.push({
        key,
        dayName: isToday ? '今日' : dayNames[day.getDay()],
        dateLabel: String(day.getDate()),
        isToday,
        hasTask: (taskCountMap[key] || 0) > 0,
      });
    }
    return days;
  },

  applySelection(selectedKey, appointments, weekDays) {
    const todayKey = this.data.todayDateKey || formatDateKey(new Date());
    const selected = appointments
      .filter((item) => item.dateKey === selectedKey || (!item.dateKey && selectedKey === todayKey))
      .sort((left, right) => left.startMs - right.startMs);
    const selectedDay = (weekDays || []).find((day) => day.key === selectedKey);
    const selectedDateTitle = selectedKey === todayKey
      ? '今日预约排期'
      : `${(selectedDay && selectedDay.dayName) || '当日'}预约排期`;
    this.setData({
      selectedDateKey: selectedKey,
      selectedAppointments: selected,
      selectedDateTitle,
    });
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await api.request('/miniprogram/workbench', 'GET');
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
        });
        return;
      }

      const appointments = (payload.appointments || [])
        .filter((item) => item.status === 'confirmed' || item.status === 'expired')
        .map(mapAppointment);

      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const weekDays = this.buildWeekDays(now, appointments);
      const weekKeys = new Set(weekDays.map((day) => day.key));
      const weekCount = appointments.filter((item) => weekKeys.has(item.dateKey)).length;
      const selectedKey = this.data.selectedDateKey || formatDateKey(now);

      this.setData({
        loading: false,
        allAppointments: appointments,
        weekDays,
        weekCount,
        weekSubtitle: `本周 ${weekCount} 单预约`,
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
        weekSubtitle: '本周 0 单预约',
      });
    }
  },

  selectDay(event) {
    const key = event.currentTarget.dataset.date;
    if (!key) return;
    this.applySelection(key, this.data.allAppointments || [], this.data.weekDays || []);
  },

  openAppointment(event) {
    const item = event.currentTarget.dataset.item;
    if (!item || !item.openable || !item.leadId || !item.appointmentId) return;
    wx.navigateTo({
      url: `/packages/business/appointment-detail/appointment-detail?leadId=${encodeURIComponent(item.leadId)}&appointmentId=${encodeURIComponent(item.appointmentId)}`,
    });
  },
});
