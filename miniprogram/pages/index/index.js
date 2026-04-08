var util = require('../../utils/util.js');
var ToolType = util.ToolType;

Page({
  data: {
    bleConnected: false,
    viewMode: 'LIBRARY',
    layoutTemplates: require('../../utils/templates.js').templates,
    plannedRooms: [],
    guidedMode: false,
    showMeasurePrompt: false,
    guidedEdgeIndex: 0,
    currentGuidedRoomId: '',
    currentGuidedRoomName: '',
    edgeNames: ['上方', '右侧', '下方', '左侧'],
    edgesList: ['top', 'right', 'bottom', 'left'],
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
    totalArea: '0.00',
    windowWidth: 375,
    windowHeight: 600
  },

  onLoad: function () {
    var that = this;
    // 获取状态栏和胶囊按钮信息
    var sysInfo = wx.getSystemInfoSync();
    var menuButtonInfo = wx.getMenuButtonBoundingClientRect();

    // 标准公式：内容高度 = (胶囊顶部 - 状态栏) * 2 + 胶囊高度
    var navBarContentHeight = (menuButtonInfo.top - sysInfo.statusBarHeight) * 2 + menuButtonInfo.height;
    var navBarHeightTotal = sysInfo.statusBarHeight + navBarContentHeight;

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight,
      navBarHeightTotal: navBarHeightTotal,
      navBarContentHeight: navBarContentHeight,
      menuButtonLeft: menuButtonInfo.left,
      capsulePadding: sysInfo.windowWidth - menuButtonInfo.left,
      windowWidth: sysInfo.windowWidth,
      windowHeight: sysInfo.windowHeight
    });
  },

  // === 户型库及引导测量交互 ===
  onSelectLayout: function (e) {
    var templateId = e.currentTarget.dataset.id;
    var templatesUtil = require('../../utils/templates.js');
    var roomsData = templatesUtil.generateTemplateRooms(templateId);
    this.setData({
      plannedRooms: roomsData
    });
  },

  onResetLayout: function () {
    this.setData({ plannedRooms: [] });
  },

  onEnterRoom: function (e) {
    var roomId = e.currentTarget.dataset.id;

    // 1. 优先检查当前画布中是否已存在该房间
    var existingRoom = null;
    for (var i = 0; i < this.data.rooms.length; i++) {
      if (this.data.rooms[i].id === roomId) {
        existingRoom = this.data.rooms[i];
        break;
      }
    }

    // 如果房间已存在，直接进入画布，不重置尺寸
    if (existingRoom) {
      this.setData({
        viewMode: 'CANVAS',
        currentGuidedRoomId: roomId,
        currentGuidedRoomName: existingRoom.name,
        activeTool: 'SELECT',
        selectedIds: [roomId],
        guidedMode: false // 再次进入默认不开启引导，除非点击“重新测量”
      });
      return;
    }

    // 2. 如果是首次进入，则从户型库数据创建
    var roomData = null;
    for (var i = 0; i < this.data.plannedRooms.length; i++) {
      if (this.data.plannedRooms[i].id === roomId) {
        roomData = this.data.plannedRooms[i];
        break;
      }
    }
    if (!roomData) return;

    var canvasWidth = this.data.windowWidth;
    var rpxRatio = canvasWidth / 750;
    var navHeightPx = 88 * rpxRatio;
    var statusBarHeightPx = this.data.statusBarHeight;
    var bottomBarHeightPx = 88 * rpxRatio;
    var canvasHeight = this.data.windowHeight - statusBarHeightPx - navHeightPx - bottomBarHeightPx;

    // 初始尺寸可以稍微设小一点，或者保持 40
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

    var newRooms = [newRoom];
    var isMeasured = roomData.measured || false;

    this.setData({
      viewMode: 'CANVAS',
      guidedMode: !isMeasured,
      currentGuidedRoomId: roomId,
      currentGuidedRoomName: roomData.name,
      guidedEdgeIndex: 0,
      activeTool: 'SELECT',
      selectedEdge: isMeasured ? '' : 'top',
      showMeasurePrompt: !isMeasured
    });
    this.pushToHistory(newRooms);
    this.setData({ selectedIds: [roomId] });

    if (!isMeasured) {
      setTimeout(function () {
        var bluetooth = require('../../utils/bluetooth.js');
        bluetooth.sendBLECommand('ATK001#');
      }, 400);
    }
  },

  onStartRemeasure: function () {
    this.setData({
      guidedMode: true,
      guidedEdgeIndex: 0,
      selectedEdge: 'top',
      showMeasurePrompt: true
    });
    // 触发第一条边的蓝牙唤醒
    setTimeout(function () {
      var bluetooth = require('../../utils/bluetooth.js');
      bluetooth.sendBLECommand('ATK001#');
    }, 400);
  },

  onExitGuide: function () {
    this.setData({ guidedMode: false, selectedEdge: '' });
  },

  onExitToLibrary: function () {
    this.setData({ viewMode: 'LIBRARY', selectedIds: [], selectedEdge: '', guidedMode: false });
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

  onConfirmMeasure: function () {
    this.setData({ showMeasurePrompt: false });
    var bluetooth = require('../../utils/bluetooth.js');
    bluetooth.sendBLECommand('ATK001#');
  },

  onAutoConnectBLE: function () {
    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    bluetooth.autoConnectBLE(function (distanceInMeters) {
      that.onBluetoothMeasure(distanceInMeters);
    }, function (isConnected) {
      that.setData({ bleConnected: isConnected });
    });
  },

  onConnectBLE: function () {
    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    bluetooth.initBLE(function (distanceInMeters) {
      that.onBluetoothMeasure(distanceInMeters);
    }, function (isConnected) {
      that.setData({ bleConnected: isConnected });
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

    // 根据用户直觉重新映射映射关系：
    // 上(top)/下(bottom) 边对应测量其横向长度 -> 更新 width
    // 左(left)/右(right) 边对应测量其纵向长度 -> 更新 height
    if (selectedEdge === 'top' || selectedEdge === 'bottom') {
      updates.width = newLength;
    } else if (selectedEdge === 'left' || selectedEdge === 'right') {
      updates.height = newLength;
    }

    var newRooms = this.data.rooms.map(function (r) {
      return r.id === roomId ? Object.assign({}, r, updates) : r;
    });
    this.pushToHistory(newRooms);

    wx.showToast({ title: '测量成功: ' + distanceInMeters + 'm', icon: 'success' });

    // 如果在向导模式，自动流转到下一条边
    if (this.data.guidedMode && this.data.currentGuidedRoomId === roomId) {
      var newEdgeIndex = this.data.guidedEdgeIndex + 1;
      if (newEdgeIndex >= 4) {
        // 完成此房间所有的边
        wx.showToast({ title: '当前房间测量完毕', icon: 'success' });
        var newPlannedRooms = this.data.plannedRooms.map(function (pr) {
          return pr.id === roomId ? Object.assign({}, pr, { measured: true }) : pr;
        });
        var that = this;
        setTimeout(function () {
          that.setData({
            guidedMode: false,
            viewMode: 'LIBRARY',
            plannedRooms: newPlannedRooms,
            selectedEdge: '',
            selectedIds: []
          });
        }, 1500); // 稍微延迟一下回去，让用户看清更新的尺寸
      } else {
        var newEdge = this.data.edgesList[newEdgeIndex];
        this.setData({
          guidedEdgeIndex: newEdgeIndex,
          selectedEdge: newEdge,
          showMeasurePrompt: true
        });
        // 自动激发激光（亮红点供用户瞄准对位）
        setTimeout(function () {
          var bluetooth = require('../../utils/bluetooth.js');
          bluetooth.sendBLECommand('ATK001#');
        }, 400);
      }
    }
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
