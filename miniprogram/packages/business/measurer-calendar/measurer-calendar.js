const api = require('../../../utils/api');
const { openSurveyingEditor } = require('../../../utils/surveyNavigation.js');
const { formatAppointmentDisplay } = require('../../../utils/appointmentTimeRange.js');

function navigationMetrics() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  let menuRect = null;
  try { menuRect = wx.getMenuButtonBoundingClientRect(); } catch (error) { menuRect = null; }
  const menuLeft = Number(menuRect && menuRect.left || windowInfo.windowWidth - 94);
  return {
    navigationTop: Number(menuRect && menuRect.top || windowInfo.statusBarHeight || 24),
    navigationHeight: Number(menuRect && menuRect.height || 32),
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
  const display = formatAppointmentDisplay(range);
  return {
    time: display.time,
    dateKey: display.dateKey,
    dateLabel: display.dateLabel,
    startHour: display.startHour,
  };
}

Page({
  data: {
    navigationTop: 24,
    navigationHeight: 32,
    navigationRight: 96,
    loading: true,
    error: '',
    showBack: true,
    currentMonthText: '',
    selectedDateKey: '',
    selectedDateTitle: '今日待上门任务',
    todayDateKey: '',
    weekDays: [],
    allAppointments: [],
    selectedAppointments: [],
    confirmed: [],
    history: [],
    todayCount: 0,
    weekCount: 0,
    completedCount: 0,
  },

  onLoad() {
    const pages = getCurrentPages();
    const now = new Date();
    const todayKey = formatDateKey(now);
    const monthText = `${now.getFullYear()}年${now.getMonth() + 1}月`;
    this.setData({
      ...navigationMetrics(),
      showBack: Boolean(pages && pages.length > 1),
      currentMonthText: monthText,
      todayDateKey: todayKey,
      selectedDateKey: todayKey,
    });
  },

  onShow() {
    this.load();
  },

  buildWeekDays(refDate, appointments) {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const current = new Date(refDate);
    const day = current.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(current);
    monday.setDate(current.getDate() + diffToMonday);

    const todayKey = formatDateKey(new Date());
    const days = [];
    const taskCountMap = {};

    (appointments || []).forEach((item) => {
      if (item.dateKey && item.status === 'confirmed') {
        taskCountMap[item.dateKey] = (taskCountMap[item.dateKey] || 0) + 1;
      }
    });

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = formatDateKey(d);
      const isToday = key === todayKey;
      const dayName = isToday ? '今天' : dayNames[d.getDay()];
      const taskCount = taskCountMap[key] || 0;

      days.push({
        key,
        dayName,
        dateLabel: `${d.getMonth() + 1}/${d.getDate()}`,
        isToday,
        hasTask: taskCount > 0,
        taskCount,
      });
    }

    return days;
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const r = await api.request('/appointments', 'GET');
      const items = (r.data || []).map((x) => {
        const parsed = parseSlot(x.timeRange);
        return {
          ...x,
          ...parsed,
          statusLabel: x.status === 'expired' ? '已过期' : x.status === 'confirmed' ? '待上门' : x.status === 'completed' ? '已完成' : x.status || '待上门',
          customerName: x.customerName || x.leadName || '客户',
          customerPhone: x.customerPhone || x.phone || x.leadPhone || '',
          designerName: x.designerName || '专属家装设计顾问',
          community: x.community || x.address || '量房预约',
        };
      });

      const confirmed = items.filter((item) => item.status === 'confirmed');
      const history = items.filter((item) => item.status !== 'confirmed');

      const now = new Date();
      const todayKey = this.data.todayDateKey || formatDateKey(now);
      const weekDays = this.buildWeekDays(now, items);

      // Counts calculation
      const todayCount = confirmed.filter((item) => item.dateKey === todayKey).length;
      const weekDateKeys = new Set(weekDays.map((w) => w.key));
      const weekCount = confirmed.filter((item) => weekDateKeys.has(item.dateKey)).length;
      const completedCount = items.filter((item) => item.status === 'completed').length || history.length;

      const selectedKey = this.data.selectedDateKey || todayKey;
      let selectedList = confirmed.filter((item) => item.dateKey === selectedKey);
      if (!selectedList.length && selectedKey === todayKey) {
        selectedList = confirmed.filter((item) => !item.dateKey || item.dateKey === todayKey);
      }

      const isTodaySelected = selectedKey === todayKey;
      const selectedDayObj = weekDays.find((d) => d.key === selectedKey);
      const selectedDateTitle = isTodaySelected
        ? `今日待上门任务 (${selectedDayObj ? selectedDayObj.dateLabel : ''})`
        : `${selectedDayObj ? selectedDayObj.dateLabel + ' ' + selectedDayObj.dayName : selectedKey} 待上门任务`;

      this.setData({
        allAppointments: items,
        confirmed: items.filter((item) => item.status === 'confirmed'),
        history: items.filter((item) => item.status !== 'confirmed'),
        weekDays,
        todayCount,
        weekCount,
        completedCount,
        selectedAppointments: selectedList,
        selectedDateTitle,
      });
    } catch (e) {
      this.setData({ error: e.message || '日程加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  selectDay(event) {
    const key = event.currentTarget.dataset.date;
    if (!key) return;

    const { confirmed, todayDateKey, weekDays } = this.data;
    const isTodaySelected = key === todayDateKey;
    const selectedDayObj = weekDays.find((d) => d.key === key);
    const selectedDateTitle = isTodaySelected
      ? `今日待上门任务 (${selectedDayObj ? selectedDayObj.dateLabel : ''})`
      : `${selectedDayObj ? selectedDayObj.dateLabel + ' ' + selectedDayObj.dayName : key} 待上门任务`;

    let selectedList = confirmed.filter((item) => item.dateKey === key);
    if (!selectedList.length && isTodaySelected) {
      selectedList = confirmed.filter((item) => !item.dateKey || item.dateKey === key);
    }

    this.setData({
      selectedDateKey: key,
      selectedAppointments: selectedList,
      selectedDateTitle,
    });
  },

  openAppointment(event) {
    const item = event.currentTarget.dataset.item;
    const id = item && (item.id || item._id);
    if (!id) return;
    const leadId = item && item.leadId;
    const query = [`id=${encodeURIComponent(id)}`];
    if (leadId) query.push(`leadId=${encodeURIComponent(leadId)}`);
    wx.navigateTo({
      url: `/packages/business/appointment-detail/appointment-detail?${query.join('&')}`,
    });
  },

  startSurvey(event) {
    const item = event.currentTarget.dataset.item;
    if (!item) return;
    const leadId = item.leadId || item.id || item._id;
    const floorPlanId = item.floorPlanId;
    openSurveyingEditor({
      leadId,
      floorPlanId,
    });
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

  manageUnavailability() {
    wx.navigateTo({
      url: '/packages/business/measurer-unavailability/measurer-unavailability',
    });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages && pages.length > 1) {
      wx.navigateBack({ delta: 1 });
    } else {
      wx.switchTab({ url: '/pages/index/index' });
    }
  },
});
