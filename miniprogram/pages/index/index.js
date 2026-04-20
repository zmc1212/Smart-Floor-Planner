var util = require('../../utils/util.js');

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
    branding: null
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

  onShow: function() {
    this.fetchCloudPlans();
    this.setData({
      bleConnected: getApp().globalData.bleConnected || false,
      branding: getApp().globalData.branding || null
    });
  },

  onBrandingReady: function (branding) {
    this.setData({ branding });
  },

  fetchCloudPlans: async function() {
    const app = getApp();
    if (!app.globalData.openid) return;
    const api = require('../../utils/api.js');
    try {
      const res = await api.request(`/floorplans?openid=${app.globalData.openid}`, 'GET');
      if (res.success && res.data) {
        this.setData({ myCloudFloorPlans: res.data });
      }
    } catch(err) {
      console.error('Failed to fetch library floorplans:', err);
    }
  },

  onSelectLayout: function (e) {
    var templateId = e.detail.id;
    var templatesUtil = require('../../utils/templates.js');
    var roomsData = templatesUtil.generateTemplateRooms(templateId);
    this.setData({
      plannedRooms: roomsData
    });
  },

  onOpenCloudPlan: function(e) {
    const fp = e.detail.fp;
    
    getApp().globalData.restoreFloorPlan = Object.assign({}, fp, { isRestore: true });
    
    wx.navigateTo({
      url: '/pages/editor/editor'
    });
  },

  onResetLayout: function () {
    this.setData({ plannedRooms: [] });
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

    var canvasWidth = this.data.windowWidth;
    var canvasHeight = this.data.windowHeight - 150; 
    var roomW = roomData.defaultWidth || 40;
    var roomH = roomData.defaultHeight || 40;

    var newRoom = {
      id: roomData.id,
      name: roomData.name,
      x: (canvasWidth / 2) - (roomW / 2),
      y: (canvasHeight / 2) - (roomH / 2) + 20,
      width: roomW,
      height: roomH,
      color: roomData.color || 'rgba(255, 255, 255, 0.8)',
      openings: []
    };

    var fpData = {
      roomId: roomId,
      roomName: newRoom.name,
      layoutData: [newRoom],
      guidedMode: true,
      showMeasurePrompt: true,
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
    var room = this.data.plannedRooms.find(function(r) { return r.id === roomId; });
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
    this.setData({ showLeadModal: true });
  },

  onCloseLeadModal: function () {
    this.setData({ showLeadModal: false });
  },

  onLeadSuccess: function () {
    this.setData({ showLeadModal: false });
  },
  
  onShareAppMessage: function () {
    return {
      title: '智能量房大师 - 专业AR量房设计工具',
      path: '/pages/index/index'
    }
  }
});
