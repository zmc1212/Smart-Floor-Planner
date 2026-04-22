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
    showBLEConnector: false
  },

  onLoad: function () {
    var sysInfo = wx.getSystemInfoSync();
    var menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    var navBarContentHeight = (menuButtonInfo.top - sysInfo.statusBarHeight) * 2 + menuButtonInfo.height;
    var navBarHeightTotal = sysInfo.statusBarHeight + navBarContentHeight;

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      navBarHeightTotal: navBarHeightTotal,
      capsulePadding: sysInfo.windowWidth - menuButtonInfo.left,
      windowWidth: sysInfo.windowWidth,
      windowHeight: sysInfo.windowHeight,
      bleConnected: getApp().globalData.bleConnected || false
    });
  },

  onShow: function () {
    const app = getApp();
    const isStaffUser = !!(app.globalData.userInfo && app.globalData.userInfo.role === 'staff');
    console.log('userInfo', app.globalData.userInfo)
    if (app.globalData.requireLeadFirst) {
      app.globalData.requireLeadFirst = false;
      this.setData({ showLeadModal: true, plannedRooms: [], currentProject_id: null, isStaff: isStaffUser });
    } else if (app.globalData.restoreFloorPlan) {
      const fp = app.globalData.restoreFloorPlan;
      app.globalData.restoreFloorPlan = null;

      let rooms = fp.layoutData;
      if (typeof rooms === 'string') {
        try { rooms = JSON.parse(rooms); } catch (e) { }
      }

      this.setData({
        plannedRooms: rooms || [],
        currentProject_id: fp._id || null,
        showLeadModal: false,
        isStaff: isStaffUser
      });
    } else if (!this.data.currentProject_id) {
      this.fetchCloudPlans();
      this.setData({ isStaff: isStaffUser });
    }

    this.setData({
      bleConnected: getApp().globalData.bleConnected || false,
      branding: getApp().globalData.branding || null,
      isStaff: isStaffUser,
      userInfo: app.globalData.userInfo || null
    });
  },

  onLeadSuccess: function (e) {
    this.setData({ 
      showLeadModal: false,
      plannedRooms: [], 
      currentProject_id: null 
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
  onSelectLayout: async function (e) {
    var templateId = e.detail.id;
    var templatesUtil = require('../../utils/templates.js');
    var roomsData = templatesUtil.generateTemplateRooms(templateId);

    this.setData({
      plannedRooms: roomsData
    });

    // Create the FloorPlan immediately
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
        this.setData({ currentProject_id: res.data._id });

        // If there's an active lead, bind this floor plan to it
        if (app.globalData.activeLeadId) {
          await api.request(`/leads/${app.globalData.activeLeadId}`, 'PUT', {
            floorPlanId: res.data._id // Backend will append this to floorPlanIds
          });
          app.globalData.activeLeadId = null; // Clear it
        }
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
    this.onShow(); // Reload local state
  },

  async fetchCloudPlans() {
    const app = getApp();
    const openid = app.globalData.openid;
    if (!openid) return;
    try {
      const res = await api.request(`/floorplans?openid=${openid}`, 'GET');
      if (res.success && res.data) {
        this.setData({ myCloudFloorPlans: res.data });
      }
    } catch (err) {
      console.error('Fetch cloud plans failed', err);
    }
  },

  onResetLayout: function () {
    this.setData({ plannedRooms: [], currentProject_id: null });
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
    this.setData({ plannedRooms });
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
    var roomId = e.detail.id;
    var roomData = null;
    for (var i = 0; i < this.data.plannedRooms.length; i++) {
      if (this.data.plannedRooms[i].id === roomId) {
        roomData = this.data.plannedRooms[i];
        break;
      }
    }
    if (!roomData) return;

    // We pass the full array to editor, so it can update it
    var fpData = {
      _id: this.data.currentProject_id,
      roomId: roomId,
      roomName: roomData.name,
      layoutData: this.data.plannedRooms, // Pass ALL rooms
      guidedMode: true,
      showMeasurePrompt: !roomData.measured, // Only prompt if unmeasured
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
    bluetooth.initBLE(function (distanceInMeters) {
      // 这里的回调主要给首页测试用，或者只做连接处理
      // 实际测量交由 editor 页面接管
    }, function (isConnected) {
      that.setData({ bleConnected: isConnected });
      getApp().globalData.bleConnected = isConnected;
    }, function () {
      that.onBluetoothDisconnect();
    });
  },

  onBluetoothDisconnect: function () {
    this.setData({ bleConnected: false });
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
    this.setData({ bleConnected: true, showBLEConnector: false });
    getApp().globalData.bleConnected = true;
  },

  onShareAppMessage: function () {    return {
      title: '智能量房大师 - 专业AR量房设计工具',
      path: '/pages/index/index'
    }
  }
});
