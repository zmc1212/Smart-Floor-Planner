var util = require('../../utils/util.js');
const api = require('../../utils/api.js');

Page({
  data: {
    bleConnected: false,
    layoutTemplates: require('../../utils/templates.js').templates,
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
    showBLEConnector: false,
    currentCity: '上海市',
    bleStatusText: '未连接设备',
    dashboardStats: [],
    recentPlans: [],
    homeTemplates: [],
    activeProjectTitle: '当前量房项目'
  },

  onLoad: function () {
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
      isStaff: !!(userInfo && userInfo.role === 'staff'),
      currentCity: this.deriveCurrentCity(userInfo),
      homeTemplates: (this.data.layoutTemplates || []).slice(0, 4)
    }, () => {
      this.syncHomeDashboard();
    });
  },

  onShow: async function () {
    const app = getApp();
    const userInfo = app.globalData.userInfo || null;
    const isStaffUser = !!(userInfo && userInfo.role === 'staff');

    if (app.globalData.requireLeadFirst) {
      app.globalData.requireLeadFirst = false;
      this.setData({
        showLeadModal: true,
        plannedRooms: [],
        currentProject_id: null,
        isStaff: isStaffUser
      });
    } else if (app.globalData.restoreFloorPlan) {
      const fp = app.globalData.restoreFloorPlan;
      app.globalData.restoreFloorPlan = null;

      let rooms = fp.layoutData;
      if (typeof rooms === 'string') {
        try {
          rooms = JSON.parse(rooms);
        } catch (e) {}
      }

      this.setData({
        plannedRooms: rooms || [],
        currentProject_id: fp._id || null,
        showLeadModal: false,
        isStaff: isStaffUser
      });
    } else if (!this.data.currentProject_id) {
      await this.fetchCloudPlans();
      this.setData({ isStaff: isStaffUser });
    }

    this.setData({
      bleConnected: app.globalData.bleConnected || false,
      branding: app.globalData.branding || null,
      isStaff: isStaffUser,
      userInfo: userInfo,
      openid: app.globalData.openid || '',
      currentCity: this.deriveCurrentCity(userInfo),
      homeTemplates: (this.data.layoutTemplates || []).slice(0, 4)
    }, () => {
      this.syncHomeDashboard();
    });
  },

  deriveCurrentCity: function (userInfo) {
    const communityName = userInfo && userInfo.communityName ? String(userInfo.communityName) : '';
    const cityMatch = communityName.match(/([\u4e00-\u9fa5]+(?:市|区|县))/);
    return cityMatch && cityMatch[1] ? cityMatch[1] : '上海市';
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
    const roomCount = rooms.length;
    const createdAt = plan.updatedAt || plan.createdAt || '';
    const dateLabel = createdAt ? String(createdAt).replace('T', ' ').slice(0, 16) : '最近创建';
    return {
      roomCount: roomCount,
      meta: dateLabel + ' · ' + roomCount + '个空间'
    };
  },

  syncHomeDashboard: function () {
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
    const activeProjectTitle = this.data.currentProject_id ? '当前量房项目' : '新建量房项目';
    const recentPlans = cloudPlans.slice(0, 3).map((plan) => {
      const metaInfo = this.formatPlanMeta(plan);
      return {
        _id: plan._id,
        name: plan.name || '未命名方案',
        meta: metaInfo.meta,
        statusLabel: plan.status === 'completed' ? '已完成' : '编辑中'
      };
    });

    this.setData({
      bleStatusText: this.data.bleConnected ? '已连接 LM-100' : '未连接设备',
      activeProjectTitle: activeProjectTitle,
      dashboardStats: [
        { key: 'plans', label: '已保存方案', value: cloudPlans.length, unit: '个', icon: '⌂', tone: 'green' },
        { key: 'templates', label: '标准模板', value: (this.data.layoutTemplates || []).length, unit: '种', icon: '▣', tone: 'yellow' },
        { key: 'records', label: '量房记录', value: totalMeasuredRooms, unit: '次', icon: '≣', tone: 'blue' },
        { key: 'rooms', label: '空间数量', value: plannedRooms.length || totalRooms, unit: '间', icon: '◌', tone: 'pink' }
      ],
      recentPlans: recentPlans
    });
  },

  onLeadSuccess: function (e) {
    this.setData({
      showLeadModal: false,
      plannedRooms: [],
      currentProject_id: null
    }, () => {
      this.syncHomeDashboard();
    });

    const leadId = e.detail ? e.detail._id : null;
    if (leadId) {
      wx.navigateTo({
        url: `/pages/lead-detail/lead-detail?id=${leadId}`
      });
    } else {
      wx.showToast({ title: '线索创建成功', icon: 'success' });
    }
  },

  onPrimaryMeasureTap: function () {
    if (this.data.plannedRooms && this.data.plannedRooms.length > 0) {
      this.onContinueProjectTap();
      return;
    }

    const firstTemplate = this.data.homeTemplates && this.data.homeTemplates[0];
    if (!firstTemplate) {
      wx.showToast({ title: '暂无可用模板', icon: 'none' });
      return;
    }

    this.onSelectLayout({ detail: { id: firstTemplate.id } });
  },

  onQuickBluetoothTap: function () {
    if (this.data.bleConnected) {
      wx.showToast({ title: '蓝牙设备已连接', icon: 'none' });
      return;
    }
    this.onConnectBLE();
  },

  onQuickQuoteTap: function () {
    this.setData({ showLeadModal: true });
  },

  onOpenAllPlans: function () {
    wx.switchTab({
      url: '/pages/mine/mine'
    });
  },

  onTapRecentPlan: function (e) {
    const planId = e.currentTarget.dataset.id;
    const plan = (this.data.myCloudFloorPlans || []).find(function (item) {
      return item._id === planId;
    });

    if (!plan) {
      wx.showToast({ title: '方案不存在', icon: 'none' });
      return;
    }

    this.onOpenCloudPlan({ detail: { fp: plan } });
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
    var templateId = e.detail.id || e.currentTarget.dataset.id;
    var templatesUtil = require('../../utils/templates.js');
    var roomsData = templatesUtil.generateTemplateRooms(templateId);

    this.setData({
      plannedRooms: roomsData
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
        status: 'draft'
      };
      const res = await api.request('/floorplans', 'POST', payload);
      if (res.success && res.data) {
        this.setData({ currentProject_id: res.data._id }, () => {
          this.syncHomeDashboard();
        });

        if (app.globalData.activeLeadId) {
          await api.request(`/leads/${app.globalData.activeLeadId}`, 'PUT', {
            floorPlanId: res.data._id
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
    getApp().globalData.restoreFloorPlan = Object.assign({}, fp, { isRestore: true });
    this.onShow();
  },

  async fetchCloudPlans() {
    const app = getApp();
    const openid = app.globalData.openid;
    if (!openid) {
      this.syncHomeDashboard();
      return;
    }

    try {
      const res = await api.request(`/floorplans?openid=${openid}`, 'GET');
      if (res.success && res.data) {
        this.setData({ myCloudFloorPlans: res.data }, () => {
          this.syncHomeDashboard();
        });
      }
    } catch (err) {
      console.error('Fetch cloud plans failed', err);
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
      defaultHeight: 40
    });
    this.setData({ plannedRooms }, () => {
      this.syncHomeDashboard();
    });
    this.saveCurrentHubState();
  },

  saveCurrentHubState: async function () {
    if (!this.data.currentProject_id) return;
    const app = getApp();
    await api.request(`/floorplans/${this.data.currentProject_id}`, 'PUT', {
      openid: app.globalData.openid,
      layoutData: this.data.plannedRooms
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
      showPropertyPanel: false
    };

    getApp().globalData.restoreFloorPlan = fpData;

    wx.navigateTo({
      url: '/pages/editor/editor'
    });
  },

  onAIGen: function (e) {
    var roomId = e.detail.id;
    var room = this.data.plannedRooms.find(function (r) { return r.id === roomId; });
    if (room) {
      getApp().globalData.currentAIGenRoom = room;
      wx.navigateTo({ url: '/pages/ai-gen/ai-gen' });
    } else {
      wx.showToast({ title: '无法找到房间数据', icon: 'none' });
    }
  },

  onAutoConnectBLE: function () {
    this.onConnectBLE();
  },

  onConnectBLE: function () {
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
    this.setData({ showLeadModal: true });
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
      path: '/pages/index/index'
    };
  }
});
