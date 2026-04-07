var util = require('../../utils/util.js');
var ToolType = util.ToolType;

Page({
  data: {
    activeTool: 'SELECT',
    currentRoomType: '客厅',
    rooms: [],
    history: [[]],
    historyIndex: 0,
    selectedIds: [],
    selectedRooms: [],
    highlightedOpeningId: '',
    statusBarHeight: 0,
    showDrawingIndicator: false,
    totalArea: '0.00'
  },

  onLoad: function () {
    var that = this;
    // 获取状态栏高度
    var sysInfo = wx.getWindowInfo();
    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 20
    });
  },

  // === 工具切换 ===
  onToolChange: function (e) {
    var tool = e.detail.tool;
    this.setData({
      activeTool: tool,
      showDrawingIndicator: tool !== 'SELECT'
    });
  },

  onRoomTypeChange: function (e) {
    this.setData({ currentRoomType: e.detail.type });
  },

  onCancelDrawing: function () {
    this.setData({
      activeTool: 'SELECT',
      showDrawingIndicator: false
    });
  },

  onConnectBLE: function () {
    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    bluetooth.initBLE(function (distanceInMeters) {
       that.onBluetoothMeasure(distanceInMeters);
    });
  },

  onEdgeSelect: function (e) {
    this.setData({ selectedEdge: e.detail.edge });
    // 根据 api.txt，APP端控制仪器测量应发送 ATK001#。第一次发打开激光，第二次发执行测量并返回 ATD 数据。
    var bluetooth = require('../../utils/bluetooth.js');
    bluetooth.sendBLECommand('ATK001#');
  },

  onBluetoothMeasure: function (distanceInMeters) {
    var selectedIds = this.data.selectedIds;
    var selectedEdge = this.data.selectedEdge;
    if (selectedIds.length !== 1 || !selectedEdge) return;

    var roomId = selectedIds[0];
    var room = null;
    for (var i = 0; i < this.data.rooms.length; i++) {
       if (this.data.rooms[i].id === roomId) { room = this.data.rooms[i]; break; }
    }
    if (!room) return;

    // 10px = 1m
    var newLength = distanceInMeters * 10;
    var updates = {};

    if (selectedEdge === 'right') {
       updates.width = newLength;
    } else if (selectedEdge === 'bottom') {
       updates.height = newLength;
    } else if (selectedEdge === 'left') {
       var diffX = newLength - room.width;
       updates.x = room.x - diffX;
       updates.width = newLength;
    } else if (selectedEdge === 'top') {
       var diffY = newLength - room.height;
       updates.y = room.y - diffY;
       updates.height = newLength;
    }

    var newRooms = this.data.rooms.map(function (r) {
       return r.id === roomId ? Object.assign({}, r, updates) : r;
    });
    this.pushToHistory(newRooms);
    
    wx.showToast({ title: '测量成功: ' + distanceInMeters + 'm', icon: 'success' });
  },

  onAddTemplate: function (e) {
    var templateId = e.detail.templateId;
    var templatesUtil = require('../../utils/templates.js');
    var newLayoutRooms = templatesUtil.generateTemplate(templateId, 50, 50); // Provide default offset 50,50
    if (newLayoutRooms && newLayoutRooms.length > 0) {
      var newRooms = this.data.rooms.concat(newLayoutRooms);
      this.pushToHistory(newRooms);
    }
  },

  // === 历史管理 ===
  pushToHistory: function (newRooms) {
    var history = this.data.history.slice(0, this.data.historyIndex + 1);
    history.push(newRooms);
    if (history.length > 50) history.shift();
    var total = 0;
    for (var i = 0; i < newRooms.length; i++) {
      total += newRooms[i].width * newRooms[i].height;
    }
    this.setData({
      history: history,
      historyIndex: history.length - 1,
      rooms: newRooms,
      totalArea: (total / 100).toFixed(2)
    });
    this.updateSelectedRooms(newRooms);
  },

  onUndo: function () {
    if (this.data.historyIndex > 0) {
      var newIndex = this.data.historyIndex - 1;
      this.setData({
        historyIndex: newIndex,
        rooms: this.data.history[newIndex],
        selectedIds: [],
        selectedRooms: []
      });
    }
  },

  onRedo: function () {
    if (this.data.historyIndex < this.data.history.length - 1) {
      var newIndex = this.data.historyIndex + 1;
      this.setData({
        historyIndex: newIndex,
        rooms: this.data.history[newIndex],
        selectedIds: [],
        selectedRooms: []
      });
    }
  },

  // === 房间操作（来自 Canvas 组件事件） ===
  onAddRoom: function (e) {
    var room = e.detail.room;
    var newRooms = this.data.rooms.concat([room]);
    this.pushToHistory(newRooms);
    this.setData({ selectedIds: [room.id] });
    this.updateSelectedRooms(newRooms);
  },

  onSelectRoom: function (e) {
    var id = e.detail.id;
    this.setData({ selectedIds: [id] });
    this.updateSelectedRooms(this.data.rooms);
  },

  onClearSelection: function () {
    this.setData({ selectedIds: [], selectedRooms: [] });
  },

  onMoveRoom: function (e) {
    var id = e.detail.id;
    var x = e.detail.x;
    var y = e.detail.y;
    var newRooms = this.data.rooms.map(function (r) {
      return r.id === id ? Object.assign({}, r, { x: x, y: y }) : r;
    });
    this.pushToHistory(newRooms);
  },

  onRoomsChange: function (e) {
    var newRooms = e.detail.rooms;
    this.pushToHistory(newRooms);
  },

  onDeleteRoom: function (e) {
    var id = e.detail.id;
    var newRooms = this.data.rooms.filter(function (r) { return r.id !== id; });
    this.pushToHistory(newRooms);
    this.setData({ selectedIds: [], selectedRooms: [] });
  },

  // === Properties 组件事件 ===
  onUpdateRoom: function (e) {
    var id = e.detail.id;
    var updates = e.detail.updates;
    var newRooms = this.data.rooms.map(function (r) {
      return r.id === id ? Object.assign({}, r, updates) : r;
    });
    this.pushToHistory(newRooms);
  },

  onDeleteRooms: function () {
    var selectedIds = this.data.selectedIds;
    var newRooms = this.data.rooms.filter(function (r) {
      return selectedIds.indexOf(r.id) === -1;
    });
    this.pushToHistory(newRooms);
    this.setData({ selectedIds: [], selectedRooms: [] });
  },

  onMergeRooms: function () {
    var selectedRooms = this.data.selectedRooms;
    if (selectedRooms.length < 2) return;

    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < selectedRooms.length; i++) {
      var r = selectedRooms[i];
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }

    var mergedRoom = {
      id: util.generateUUID(),
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      name: selectedRooms[0].name + ' (合并)',
      color: selectedRooms[0].color
    };

    var selectedIds = this.data.selectedIds;
    var newRooms = this.data.rooms.filter(function (r) {
      return selectedIds.indexOf(r.id) === -1;
    });
    newRooms.push(mergedRoom);

    this.pushToHistory(newRooms);
    this.setData({ selectedIds: [mergedRoom.id] });
    this.updateSelectedRooms(newRooms);
  },

  onCloseProperties: function () {
    this.setData({ selectedIds: [], selectedRooms: [] });
  },

  onHighlightOpening: function (e) {
    this.setData({ highlightedOpeningId: e.detail.id || '' });
  },

  // === 导出 ===
  onExport: function () {
    var rooms = this.data.rooms;
    var dataStr = JSON.stringify(rooms, null, 2);

    // 小程序不支持直接下载文件，使用剪贴板
    wx.setClipboardData({
      data: dataStr,
      success: function () {
        wx.showToast({ title: '户型数据已复制到剪贴板', icon: 'none', duration: 2000 });
      }
    });
  },

  // === 辅助方法 ===
  updateSelectedRooms: function (rooms) {
    var selectedIds = this.data.selectedIds;
    var selectedRooms = rooms.filter(function (r) {
      return selectedIds.indexOf(r.id) !== -1;
    });
    this.setData({ selectedRooms: selectedRooms });
  },

  // 计算总面积
  getTotalArea: function () {
    var rooms = this.data.rooms;
    var total = 0;
    for (var i = 0; i < rooms.length; i++) {
      total += rooms[i].width * rooms[i].height;
    }
    return (total / 100).toFixed(2);
  }
});
