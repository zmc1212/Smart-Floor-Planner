var util = require('../../utils/util.js');
const api = require('../../utils/api.js');
const templateUtils = require('../../utils/templates.js');
const { openSurveyingEditor } = require('../../utils/surveyNavigation.js');
const { openAIDesignEntry } = require('../../utils/aiDesignNavigation.js');
const { canAccessAIDesign } = require('../../utils/aiDesignAccess.js');
const { roleForIdentity, getRoleLanding } = require('../../utils/identity-navigation.js');

const QUICK_TOOLS = [
  {
    key: 'guide',
    title: '新手引导',
    subtitle: '3 分钟学会使用',
    glyph: '导',
    tone: 'green',
  },
  {
    key: 'help',
    title: '帮助中心',
    subtitle: '常见问题解答',
    glyph: '助',
    tone: 'blue',
  },
  {
    key: 'support',
    title: '联系客服',
    subtitle: '专业顾问服务',
    glyph: '服',
    tone: 'orange',
  },
];

function buildDashboardStats(stats) {
  return [
    { key: 'plans', label: '已保存方案', value: stats.savedPlans || 0, unit: '个', glyph: '档', tone: 'green' },
    { key: 'ai', label: 'AI 生成案例', value: stats.aiGeneratedCases || 0, unit: '个', glyph: 'AI', tone: 'yellow' },
    { key: 'records', label: '量房记录', value: stats.measurementRecords || 0, unit: '次', glyph: '图', tone: 'blue' },
    { key: 'leads', label: '客户线索', value: stats.leadCount || 0, unit: '条', glyph: '客', tone: 'purple' },
  ];
}

function formatDateLabel(value) {
  if (!value) {
    return '最近创建';
  }

  const text = String(value).replace('T', ' ');
  return text.slice(0, 16);
}

function getRecentPlanStatus(status) {
  if (status === 'completed') {
    return { label: '已完成', className: 'status-completed' };
  }

  if (status === 'designing') {
    return { label: '方案深化中', className: 'status-designing' };
  }

  return { label: '编辑中', className: 'status-draft' };
}

function normalizeProjectLabel(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function buildRecentPlans(plans) {
  return (plans || []).slice(0, 3).map((plan, index) => {
    const statusMeta = getRecentPlanStatus(plan.status);
    const roomCount = Number(plan.roomCount);
    const area = Number(plan.area);
    const customerName = normalizeProjectLabel(plan.customerName);
    const communityName = normalizeProjectLabel(plan.communityName);
    const display = plan && typeof plan.display === 'object' ? plan.display : null;
    const fallbackName = normalizeProjectLabel(plan.name) || '未命名方案';
    const displayName = normalizeProjectLabel(display && display.projectTitle)
      || communityName
      || customerName
      || fallbackName;
    const projectSubtitle = normalizeProjectLabel(display && display.projectSubtitle)
      || [customerName && customerName !== displayName ? customerName : '', '量房记录']
        .filter(Boolean)
        .join(' · ');
    const updatedLabel = formatDateLabel(plan.updatedAt || plan.createdAt);
    const progressLabel = Number.isFinite(area) && area > 0
      ? `${area}㎡`
      : Number.isFinite(roomCount) && roomCount > 0
        ? `${roomCount} 个已闭合空间`
        : `更新于 ${updatedLabel}`;
    return {
      _id: plan.id || plan._id,
      name: fallbackName,
      displayName,
      customerName,
      communityName,
      meta: updatedLabel,
      updatedLabel: `更新于 ${updatedLabel}`,
      progressLabel,
      measureSubtitle: projectSubtitle,
      statusLabel: statusMeta.label,
      statusClass: statusMeta.className,
      roomCount: Number.isFinite(roomCount) && roomCount > 0 ? roomCount : 0,
      areaLabel: Number.isFinite(area) && area > 0 ? `${area}㎡` : '',
      thumbVariant: ['a', 'b', 'c'][index] || 'a',
    };
  });
}

Page({
  data: {
    bleConnected: false,
    layoutTemplates: templateUtils.templates,
    plannedRooms: [],
    showLeadModal: false,
    myCloudFloorPlans: [],
    statusBarHeight: 0,
    navBarHeightTotal: 0,
    capsulePadding: 0,
    windowWidth: 375,
    windowHeight: 600,
    branding: null,
    isStaff: false,
    canUseAIDesign: false,
    showBLEConnector: false,
    currentCity: '',
    bleStatusText: '未连接设备',
    homeLeadCount: 0,
    homeAiCaseCount: 0,
    dashboardStats: [],
    recentPlans: [],
    quickTools: QUICK_TOOLS,
    homeTemplates: [],
    homeDashboard: null,
    activeProjectTitle: '当前量房项目',
    bleAutoConnecting: false,
    roleWorkbenchRole: '',
    redirectingSalesperson: false,
  },

  syncTabBar() {
    const tabBar = typeof this.getTabBar === 'function' && this.getTabBar();
    if (tabBar && typeof tabBar.syncSelected === 'function') {
      tabBar.syncSelected();
    }
  },

  showGuestServiceHome() {
    this.setData({ roleWorkbenchRole: 'customer' });
    this.syncTabBar();
  },

  getRoleWorkbenchRole() {
    const globalData = getApp().globalData;
    const bootstrap = globalData.bootstrap;
    const role = (bootstrap && bootstrap.current && bootstrap.current.role)
      || roleForIdentity(globalData.userInfo);
    return ['customer', 'designer', 'measurer', 'enterprise_admin', 'platform_admin'].includes(role) ? role : '';
  },

  redirectSalespersonAwayFromHome() {
    const globalData = getApp().globalData;
    const identity = {
      ...(globalData.userInfo || {}),
      ...((globalData.bootstrap && globalData.bootstrap.current) || {}),
    };
    if (roleForIdentity(identity) !== 'salesperson') return false;
    if (this.data.redirectingSalesperson) return true;
    const url = getRoleLanding(identity)
      || '/packages/business/promotion-records/promotion-records';
    this.setData({ redirectingSalesperson: true });
    wx.reLaunch({
      url,
      fail: () => this.setData({ redirectingSalesperson: false }),
    });
    return true;
  },

  onLoad: function () {
    if (!this.isLoggedIn()) {
      this.showGuestServiceHome();
      return;
    }

    if (this.redirectSalespersonAwayFromHome()) return;

    var sysInfo = wx.getSystemInfoSync();
    var menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    var navBarContentHeight = (menuButtonInfo.top - sysInfo.statusBarHeight) * 2 + menuButtonInfo.height;
    var navBarHeightTotal = sysInfo.statusBarHeight + navBarContentHeight;
    var app = getApp();
    var userInfo = app.globalData.userInfo || null;

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      navBarHeightTotal: navBarHeightTotal,
      capsulePadding: sysInfo.windowWidth - menuButtonInfo.left,
      windowWidth: sysInfo.windowWidth,
      windowHeight: sysInfo.windowHeight,
      bleConnected: app.globalData.bleConnected || false,
      userInfo: userInfo,
      openid: app.globalData.openid || '',
      isStaff: (userInfo && userInfo.role === 'staff'),
      canUseAIDesign: canAccessAIDesign(userInfo),
      currentCity: this.deriveCurrentCity(userInfo) || this.data.currentCity,
      homeTemplates: (this.data.layoutTemplates || []).slice(0, 4),
      quickTools: QUICK_TOOLS,
      roleWorkbenchRole: this.getRoleWorkbenchRole(),
    }, () => {
      if (this.data.roleWorkbenchRole) return;
      this.syncHomeDashboard();
      this.fetchHomeDashboard();
    });
  },

  onShow: async function () {
    if (!this.isLoggedIn()) {
      this.showGuestServiceHome();
      return;
    }

    if (this.redirectSalespersonAwayFromHome()) return;

    this.syncTabBar();

    const app = getApp();
    const userInfo = app.globalData.userInfo || null;

    const roleWorkbenchRole = this.getRoleWorkbenchRole();
    if (roleWorkbenchRole) {
      this.setData({ roleWorkbenchRole, userInfo, isStaff: roleWorkbenchRole !== 'customer' });
      return;
    }

    if (app.globalData.requireLeadFirst) {
      app.globalData.requireLeadFirst = false;
      wx.navigateTo({
        url: '/packages/business/lead-form/lead-form',
      });
    } else if (!this.data.currentProject_id) {
      await this.fetchCloudPlans();
      this.setData({ isStaff: false });
    }

    this.setData({
      bleConnected: app.globalData.bleConnected || false,
      branding: app.globalData.branding || null,
      isStaff: (userInfo && userInfo.role === 'staff'),
      canUseAIDesign: canAccessAIDesign(userInfo),
      userInfo: userInfo,
      openid: app.globalData.openid || '',
      currentCity: this.deriveCurrentCity(userInfo) || this.data.currentCity,
      homeTemplates: (this.data.layoutTemplates || []).slice(0, 4),
      quickTools: QUICK_TOOLS,
      roleWorkbenchRole,
    }, () => {
      if (this.data.roleWorkbenchRole) return;
      this.syncHomeDashboard();
      this.fetchHomeDashboard();
      this.handleBluetoothAfterLogin();
    });
  },

  isLoggedIn: function () {
    const app = getApp();
    return !!(
      (app.globalData && (app.globalData.token || (app.globalData.openid && app.globalData.userInfo))) ||
      wx.getStorageSync('token')
    );
  },

  hasRememberedBLEDevice: function () {
    const bluetooth = require('../../utils/bluetooth.js');
    return !!(bluetooth.hasRememberedDevice && bluetooth.hasRememberedDevice());
  },

  handleBluetoothAfterLogin: function () {
    const app = getApp();
    if (!this.isLoggedIn() || this.data.bleConnected || this.data.bleAutoConnecting) {
      return;
    }

    const pendingBluetoothTap = !!app.globalData.pendingBluetoothAutoConnect;
    const shouldConnectAfterLogin = !!(pendingBluetoothTap || app.globalData.justLoggedIn);
    if (!shouldConnectAfterLogin) {
      return;
    }

    app.globalData.pendingBluetoothAutoConnect = false;
    app.globalData.justLoggedIn = false;

    if (this.hasRememberedBLEDevice()) {
      this.autoConnectRememberedBLE(false);
      return;
    }

    if (pendingBluetoothTap) {
      this.setData({ showBLEConnector: true });
      wx.showToast({ title: '请手动连接蓝牙设备', icon: 'none' });
    }
  },

  deriveCurrentCity: function (userInfo) {
    const communityName = userInfo && userInfo.communityName ? String(userInfo.communityName) : '';
    const cityMatch = communityName.match(/([\u4e00-\u9fa5]+(?:市|区|县))/);
    return cityMatch && cityMatch[1] ? cityMatch[1] : '';
  },

  parseLayoutData: function (layoutData) {
    if (!layoutData) {
      return [];
    }

    if (typeof layoutData === 'string') {
      try {
        return JSON.parse(layoutData) || [];
      } catch (e) {
        return [];
      }
    }

    return Array.isArray(layoutData) ? layoutData : [];
  },

  formatPlanMeta: function (plan) {
    const rooms = this.parseLayoutData(plan.layoutData);
    return {
      roomCount: rooms.length,
      meta: formatDateLabel(plan.updatedAt || plan.createdAt),
    };
  },

  syncHomeDashboard: function () {
    // The server dashboard is the authoritative, role-scoped list of formal
    // plans. A local unfinished draft must not hide recently saved cloud plans.
    if (this.data.homeDashboard) {
      const stats = this.data.homeDashboard.stats || {};
      const bluetooth = this.data.homeDashboard.bluetooth || {};

      this.setData({
        bleStatusText: this.data.bleConnected
          ? (bluetooth.deviceCode ? '已连接 ' + bluetooth.deviceCode : '蓝牙已连接')
          : (bluetooth.connectedLabel || '未连接设备'),
        homeLeadCount: stats.leadCount || 0,
        homeAiCaseCount: stats.aiGeneratedCases || 0,
        dashboardStats: buildDashboardStats(stats),
        recentPlans: buildRecentPlans(this.data.homeDashboard.recentPlans || []),
      });
      return;
    }

    const cloudPlans = this.data.myCloudFloorPlans || [];
    const plannedRooms = this.data.plannedRooms || [];
    const totalMeasuredRooms = cloudPlans.reduce((sum, plan) => {
      return sum + this.parseLayoutData(plan.layoutData).filter(function (room) {
        return !!room.measured;
      }).length;
    }, 0);
    const totalRooms = cloudPlans.reduce((sum, plan) => {
      return sum + this.parseLayoutData(plan.layoutData).length;
    }, 0);

    this.setData({
      bleStatusText: this.data.bleConnected ? '已连接 LM-100' : '未连接设备',
      homeLeadCount: plannedRooms.length || totalRooms,
      homeAiCaseCount: (this.data.layoutTemplates || []).length,
      activeProjectTitle: this.data.currentProject_id ? '当前量房项目' : '新建量房项目',
      dashboardStats: [
        { key: 'plans', label: '已保存方案', value: cloudPlans.length, unit: '个', glyph: '档', tone: 'green' },
        { key: 'templates', label: 'AI 生成案例', value: (this.data.layoutTemplates || []).length, unit: '个', glyph: 'AI', tone: 'yellow' },
        { key: 'records', label: '量房记录', value: totalMeasuredRooms, unit: '次', glyph: '图', tone: 'blue' },
        { key: 'rooms', label: '客户线索', value: plannedRooms.length || totalRooms, unit: '条', glyph: '客', tone: 'purple' },
      ],
      recentPlans: buildRecentPlans(cloudPlans.map((plan) => {
        const metaInfo = this.formatPlanMeta(plan);
        return {
          _id: plan._id,
          id: plan._id,
          name: plan.name || '未命名方案',
          updatedAt: metaInfo.meta,
          status: plan.status || 'draft',
        };
      })),
    });
  },

  onLeadSuccess: function (e) {
    this.setData({
      showLeadModal: false,
      plannedRooms: [],
      currentProject_id: null,
      recentPlans: [],
    }, () => {
      this.syncHomeDashboard();
    });

    const leadId = e.detail ? e.detail._id : null;
    if (leadId) {
      wx.navigateTo({
        url: `/packages/business/lead-detail/lead-detail?id=${leadId}`,
      });
    } else {
      wx.showToast({ title: '线索创建成功', icon: 'success' });
    }
  },

  onPrimaryMeasureTap: function () {
    const recentPlan = (this.data.recentPlans || [])[0];
    if (recentPlan && recentPlan._id) {
      openSurveyingEditor({ floorPlanId: recentPlan._id });
      return;
    }

    // 已有进行中的项目 → 继续量房
    if (this.data.plannedRooms && this.data.plannedRooms.length > 0) {
      this.onContinueProjectTap();
      return;
    }

    // 没有项目 → 先收集客户线索，量房数据自动绑定线索
    wx.navigateTo({
      url: '/packages/business/lead-form/lead-form',
    });
  },

  onOpenCustomerArchive: function () {
    const app = getApp();
    const leadId = (app.globalData && app.globalData.activeLeadId)
      || (this.data.homeDashboard && this.data.homeDashboard.activeLeadId)
      || '';
    if (leadId) {
      wx.navigateTo({
        url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}`,
      });
      return;
    }
    wx.showToast({ title: '暂无服务档案', icon: 'none' });
  },

  onOpenAppointmentBooking: function () {
    wx.navigateTo({
      url: '/packages/business/appointment-booking/appointment-booking?mode=customer',
    });
  },

  onOpenDesignScheme: function () {
    const app = getApp();
    const leadId = (app.globalData && app.globalData.activeLeadId)
      || (this.data.homeDashboard && this.data.homeDashboard.activeLeadId)
      || '';
    if (leadId) {
      wx.navigateTo({
        url: `/packages/business/customer-project/customer-project?leadId=${encodeURIComponent(leadId)}`,
      });
      return;
    }
    this.onOpenAIDesign();
  },

  onQuickBluetoothTap: function () {
    if (this.data.bleConnected) {
      wx.showToast({ title: '设备已连接', icon: 'none' });
      return;
    }

    const app = getApp();
    if (!this.isLoggedIn()) {
      app.globalData.pendingBluetoothAutoConnect = true;
      wx.navigateTo({ url: '/packages/business/login/login' });
      return;
    }

    if (this.hasRememberedBLEDevice()) {
      this.autoConnectRememberedBLE(false);
      return;
    }

    this.setData({ showBLEConnector: true });
  },

  onOpenAIDesign: function () {
    if (!this.isLoggedIn()) {
      wx.navigateTo({ url: '/packages/business/login/login' });
      return;
    }

    const floorPlanId = this.data.currentProject_id;
    const leadId = (getApp().globalData && getApp().globalData.activeLeadId) || '';
    openAIDesignEntry({
      ...(leadId ? { leadId } : {}),
      ...(floorPlanId ? { floorPlanId } : {}),
    });
  },

  onOpenLeads: function () {
    wx.switchTab({
      url: '/pages/leads-management/leads-management',
    });
  },

  onQuickToolTap: function (e) {
    const action = e.currentTarget.dataset.action;

    if (action === 'guide') {
      wx.showModal({
        title: '新手引导',
        content: '先连接蓝牙设备，再创建量房方案，进入房间即可开始测量与出图。',
        showCancel: false,
        confirmText: '知道了',
      });
      return;
    }

    if (action === 'support') {
      wx.showModal({
        title: '联系客服',
        content: '如需企业顾问或设备支持，请联系管理员或销售顾问。',
        showCancel: false,
        confirmText: '我知道了',
      });
      return;
    }

    wx.showToast({ title: '帮助中心即将上线', icon: 'none' });
  },

  onOpenAllPlans: function () {
    wx.switchTab({
      url: '/pages/mine/mine',
    });
  },

  onTapRecentPlan: function (e) {
    const planId = e.currentTarget.dataset.id;
    if (!planId) {
      wx.showToast({ title: '方案不存在', icon: 'none' });
      return;
    }

    // Recent cards are supplied by /miniprogram/home, so they can be opened
    // directly even while the legacy cloud-plan list has not finished loading.
    openSurveyingEditor({ floorPlanId: planId });
  },

  onContinueProjectTap: function () {
    const nextRoom = (this.data.plannedRooms || []).find(function (room) {
      return !room.measured;
    }) || (this.data.plannedRooms || [])[0];

    if (!nextRoom) {
      wx.showToast({ title: '暂无可进入的房间', icon: 'none' });
      return;
    }

    this.onEnterRoom({ detail: { id: nextRoom.id } });
  },

  onSelectLayout: async function (e) {
    openSurveyingEditor({ leadId: getApp().globalData.activeLeadId || '' });
    return;
    var templateId = e.detail.id || e.currentTarget.dataset.id;
    var roomsData = templateUtils.generateTemplateRooms(templateId);

    this.setData({
      plannedRooms: roomsData,
    }, () => {
      this.syncHomeDashboard();
    });

    wx.showLoading({ title: '创建项目...' });
    const app = getApp();
    try {
      const payload = {
        openid: app.globalData.openid,
        name: '量房项目 - ' + util.formatTime(new Date()).split(' ')[0].replace(/\//g, ''),
        layoutData: roomsData,
        status: 'draft',
      };
      const res = await api.request('/floorplans', 'POST', payload);
      if (res.success && res.data) {
        this.setData({ currentProject_id: res.data._id }, () => {
          this.syncHomeDashboard();
        });

        if (app.globalData.activeLeadId) {
          await api.request(`/leads/${app.globalData.activeLeadId}`, 'PUT', {
            floorPlanId: res.data._id,
          });
          app.globalData.activeLeadId = null;
        }

        await this.fetchCloudPlans();
      }
    } catch (err) {
      console.error(err);
    } finally {
      wx.hideLoading();
    }
  },

  onOpenCloudPlan: function (e) {
    const fp = e.detail.fp;
    if (fp && fp._id) openSurveyingEditor({ floorPlanId: fp._id });
  },

  async fetchCloudPlans() {
    const app = getApp();
    const openid = app.globalData.openid;
    if (!openid) {
      this.syncHomeDashboard();
      return;
    }

    try {
      const res = await api.request('/floorplans', 'GET');
      if (res.success && res.data) {
        this.setData({ myCloudFloorPlans: res.data }, () => {
          this.syncHomeDashboard();
        });
      }
    } catch (err) {
      console.error('Fetch cloud plans failed', err);
    }
  },

  async fetchHomeDashboard() {
    const app = getApp();
    const openid = app.globalData.openid;
    if (!openid) {
      return;
    }

    try {
      const res = await api.request('/miniprogram/home', 'GET');
      if (res.success && res.data) {
        this.setData({
          homeDashboard: res.data,
          currentCity: res.data.user && res.data.user.city ? res.data.user.city : this.data.currentCity,
          branding: res.data.user ? res.data.user.branding || this.data.branding : this.data.branding,
        }, () => {
          this.syncHomeDashboard();
        });
      }
    } catch (err) {
      console.error('Fetch home dashboard failed', err);
    }
  },

  onResetLayout: function () {
    this.setData({ plannedRooms: [], currentProject_id: null }, () => {
      this.syncHomeDashboard();
    });
  },

  onAddRoom: function () {
    const plannedRooms = this.data.plannedRooms || [];
    plannedRooms.push({
      id: util.generateUUID(),
      name: '新增房间',
      measured: false,
      color: 'rgba(255, 255, 255, 0.8)',
      defaultWidth: 40,
      defaultHeight: 40,
    });
    this.setData({ plannedRooms }, () => {
      this.syncHomeDashboard();
    });
    this.saveCurrentHubState();
  },

  saveCurrentHubState: async function () {
    return;
    if (!this.data.currentProject_id) return;
    const app = getApp();
    await api.request(`/floorplans/${this.data.currentProject_id}`, 'PUT', {
      openid: app.globalData.openid,
      layoutData: this.data.plannedRooms,
    });
  },

  onEnterRoom: function (e) {
    var roomId = e.detail.id || e.currentTarget.dataset.id;
    var roomData = null;
    for (var i = 0; i < this.data.plannedRooms.length; i++) {
      if (this.data.plannedRooms[i].id === roomId) {
        roomData = this.data.plannedRooms[i];
        break;
      }
    }
    if (!roomData) return;

    var fpData = {
      _id: this.data.currentProject_id,
      roomId: roomId,
      roomName: roomData.name,
      layoutData: this.data.plannedRooms,
      guidedMode: true,
      showMeasurePrompt: !roomData.measured,
      activeTool: 'SELECT',
      selectedIds: [roomId],
      showPropertyPanel: false,
    };

    openSurveyingEditor({ floorPlanId: fpData._id || '' });
  },

  onAIGen: function (e) {
    var roomId = e.detail.id;
    var room = this.data.plannedRooms.find(function (r) { return r.id === roomId; });
    if (room) {
      var leadId = (getApp().globalData && getApp().globalData.activeLeadId) || '';
      openAIDesignEntry({
        ...(leadId ? { leadId } : {}),
        floorPlanId: this.data.currentProject_id,
        roomId,
      });
    } else {
      wx.showToast({ title: '无法找到房间数据', icon: 'none' });
    }
  },

  onAutoConnectBLE: function () {
    if (!this.isLoggedIn()) {
      getApp().globalData.pendingBluetoothAutoConnect = true;
      wx.navigateTo({ url: '/packages/business/login/login' });
      return;
    }

    if (this.hasRememberedBLEDevice()) {
      this.autoConnectRememberedBLE(false);
      return;
    }

    this.setData({ showBLEConnector: true });
  },

  autoConnectRememberedBLE: function (silent) {
    if (this.data.bleAutoConnecting) return;

    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    this.setData({ bleAutoConnecting: true });
    bluetooth.autoConnectBLE(function () {
    }, function (isConnected) {
      that.setData({
        bleConnected: isConnected,
        bleAutoConnecting: false,
        showBLEConnector: isConnected ? false : that.data.showBLEConnector,
      }, function () {
        that.syncHomeDashboard();
      });
      getApp().globalData.bleConnected = isConnected;
    }, function () {
      that.setData({ bleAutoConnecting: false });
      that.onBluetoothDisconnect();
    }, !!silent);
  },

  onConnectBLE: function () {
    if (!this.isLoggedIn()) {
      getApp().globalData.pendingBluetoothAutoConnect = true;
      wx.navigateTo({ url: '/packages/business/login/login' });
      return;
    }

    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    bluetooth.initBLE(function () {
    }, function (isConnected) {
      that.setData({ bleConnected: isConnected }, function () {
        that.syncHomeDashboard();
      });
      getApp().globalData.bleConnected = isConnected;
    }, function () {
      that.onBluetoothDisconnect();
    });
  },

  onBluetoothDisconnect: function () {
    this.setData({ bleConnected: false }, () => {
      this.syncHomeDashboard();
    });
    getApp().globalData.bleConnected = false;
  },

  onOpenLeadModal: function () {
    if (!this.data.bleConnected) {
      this.setData({ showBLEConnector: true });
      return;
    }
    wx.navigateTo({
      url: '/packages/business/lead-form/lead-form',
    });
  },

  onCloseLeadModal: function () {
    this.setData({ showLeadModal: false });
  },

  onCloseBLEConnector: function () {
    this.setData({ showBLEConnector: false });
  },

  onBLESuccess: function () {
    this.setData({ bleConnected: true, showBLEConnector: false }, () => {
      this.syncHomeDashboard();
    });
    getApp().globalData.bleConnected = true;
  },

  onShareAppMessage: function () {
    return {
      title: '智能量房大师 - 专业 AR 量房设计工具',
      path: '/pages/index/index',
    };
  },
});
