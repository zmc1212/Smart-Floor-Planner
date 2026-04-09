var util = require('../../utils/util.js');
var ToolType = util.ToolType;

Page({
  data: {
    bleConnected: false,
    viewMode: 'LIBRARY',
    is3DView: false,
    layoutTemplates: require('../../utils/templates.js').templates,
    plannedRooms: [],
    guidedMode: false,
    showMeasurePrompt: false,
    guidedEdgeIndex: -1,
    currentGuidedRoomId: '',
    currentGuidedRoomName: '',
    measurePoints: [],       // [{x,y}] 构建中的多边形顶点（测量空间坐标）
    pendingDirection: '',    // 'E'|'S'|'W'|'N' 本次待测边的方向
    canFinishPolygon: false, // 已测 ≥2 条边时可完成轮廓
    activeTool: 'SELECT',
    currentRoomType: '客厅',
    rooms: [],
    history: [[]],
    historyIndex: 0,
    selectedIds: [],
    selectedRooms: [],
    showPropertyPanel: false, // 显式开关：控制属性面板弹出
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
      windowHeight: sysInfo.windowHeight,
      myCloudFloorPlans: []
    });

    // 注入演示用的测试数据
    // this.loadTestData();
  },

  onShow: function() {
    const app = getApp();
    if (app.globalData.restoreFloorPlan) {
      // 恢复打开特定户型
      const fp = app.globalData.restoreFloorPlan;
      app.globalData.restoreFloorPlan = null;
      
      this.setData({
        viewMode: 'CANVAS',
        rooms: fp.layoutData,
        plannedRooms: fp.layoutData, // Keep it simple and sync
        guidedMode: false,
        showMeasurePrompt: false,
        activeTool: 'SELECT',
        selectedIds: [],
        showPropertyPanel: false
      });
      // Initial history push
      this.setData({ history: [], historyIndex: -1 });
      this.pushToHistory(fp.layoutData);
      
      setTimeout(() => {
        const canvas = this.selectComponent('#floorCanvas');
        if (canvas) canvas.fitToView();
      }, 400);
    } else if (this.data.viewMode === 'LIBRARY') {
      this.fetchCloudPlans();
    }
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

  loadTestData: function() {
    const testRoom = {
      id: "test-room-dev",
      name: "测试样板间",
      x: 100,
      y: 100,
      width: 40,  // 4.0m
      height: 30, // 3.0m
      measured: true,
      color: "rgba(99, 102, 241, 0.2)",
      openings: [
        {
          id: "test-door-1",
          type: "DOOR",
          x: 10,      // 1.0m 偏移 (从左侧算起)
          y: 30,      // 位于底墙 (y = height)
          rotation: 0,
          width: 9,   // 0.9m 宽
          height: 20
        },
        {
          id: "test-window-1",
          type: "WINDOW",
          x: 25,      // 2.5m 偏移 (从左侧算起)
          y: 0,       // 位于顶墙 (y = 0)
          rotation: 0,
          width: 12,  // 1.2m 宽
          height: 12
        }
      ]
    };
    
    this.setData({
      rooms: [testRoom],
      plannedRooms: [Object.assign({}, testRoom, { measured: true })]
    });
    this.pushToHistory([testRoom]);
  },

  // === 户型库及引导测量交互 ===
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
    this.setData({
      viewMode: 'CANVAS',
      rooms: fp.layoutData,
      plannedRooms: fp.layoutData,
      guidedMode: false,
      showMeasurePrompt: false,
      activeTool: 'SELECT',
      selectedIds: [],
      showPropertyPanel: false
    });
    this.setData({ history: [], historyIndex: -1 });
    this.pushToHistory(fp.layoutData);
    
    setTimeout(() => {
      const canvas = this.selectComponent('#floorCanvas');
      if (canvas) canvas.fitToView();
    }, 400);
  },

  onResetLayout: function () {
    this.setData({ plannedRooms: [] });
  },

  onEnterRoom: function (e) {
    var roomId = e.detail.id;

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
        showPropertyPanel: true, // 再次进入已量过尺寸的房间，可以显示面板
        guidedMode: false // 再次进入默认不开启引导，除非点击“重新测量”
      });
      // 自动聚焦新房间
      setTimeout(() => {
        const canvas = this.selectComponent('#floorCanvas');
        if (canvas) canvas.fitToView();
      }, 300);
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
      measurePoints: isMeasured ? [] : [{ x: 0, y: 0 }],
      pendingDirection: '',
      canFinishPolygon: false,
      activeTool: 'SELECT',
      selectedEdge: '',
      showMeasurePrompt: !isMeasured,
      showPropertyPanel: false // 开启引导或进入新房间时，强制隐藏面板
    });
    this.pushToHistory(newRooms);
    this.setData({ selectedIds: [roomId] });

    // 自动聚焦
    setTimeout(() => {
      const canvas = this.selectComponent('#floorCanvas');
      if (canvas) canvas.fitToView();
    }, 400);

    if (!isMeasured) {
      this.openLaser();
    }
  },

  onAIGen: function (e) {
    var roomId = e.detail.id;
    var room = this.data.rooms.find(function (r) { return r.id === roomId; });
    
    if (room) {
      getApp().globalData.currentAIGenRoom = room;
      wx.navigateTo({
        url: '/pages/ai-gen/ai-gen'
      });
    } else {
      wx.showToast({ title: '找不房间数据', icon: 'none' });
    }
  },

  onStartRemeasure: function () {
    this.setData({
      guidedMode: true,
      guidedEdgeIndex: 0,
      measurePoints: [{ x: 0, y: 0 }],
      pendingDirection: '',
      canFinishPolygon: false,
      selectedEdge: '',
      showMeasurePrompt: true,
      showPropertyPanel: false
    });
    this.openLaser();
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

  onConfirmMeasure: function (e) {
    var direction = (e && e.detail && e.detail.direction) ? e.detail.direction : 'E';
    this.setData({ showMeasurePrompt: false, pendingDirection: direction });
    this.triggerBluetoothMeasure();
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
    this.setData({
      selectedEdge: e.detail.edge,
      showPropertyPanel: false
    });
    this.triggerBluetoothMeasure();
  },

  onToggle3D: function() {
    var newMode = !this.data.is3DView;
    this.setData({ is3DView: newMode });
    if (newMode) {
      this.initThreejs();
    }
  },

  initThreejs: function() {
    var that = this;
    wx.createSelectorQuery()
      .select('#webgl')
      .node()
      .exec((res) => {
        if (!res[0]) return;
        const canvas = res[0].node;
        const { createScopedThreejs } = require('threejs-miniprogram');
        const THREE = createScopedThreejs(canvas);

        that.render3DScene(THREE, canvas);
      });
  },

  render3DScene: function(THREE, canvas) {
    const width = canvas._width || canvas.width;
    const height = canvas._height || canvas.height;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    this.threeScene = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    this.threeCamera = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(width, height);
    this.threeRenderer = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const container = new THREE.Group();
    this.threeContainer = container;
    scene.add(container);

    const buildWall = (length, wallHeight, openings, type) => {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.lineTo(length, 0);
      shape.lineTo(length, wallHeight);
      shape.lineTo(0, wallHeight);
      shape.lineTo(0, 0);

      openings.forEach(op => {
        let ox = 0;
        if (type === 'top') { ox = op.x; }
        else if (type === 'bottom') { ox = length - (op.x + op.width); }
        else if (type === 'left') { ox = length - (op.y + op.width); }
        else if (type === 'right') { ox = op.y; }

        const ow = op.width;
        let oh = op.type === 'DOOR' ? 20 : 12;
        let oy = op.type === 'DOOR' ? 0 : 9;

        const hole = new THREE.Path();
        hole.moveTo(ox, oy);
        hole.lineTo(ox + ow, oy);
        hole.lineTo(ox + ow, oy + oh);
        hole.lineTo(ox, oy + oh);
        hole.lineTo(ox, oy);
        shape.holes.push(hole);
      });

      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
      return new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    };

    const rooms = this.data.rooms;
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;

    if (!rooms || rooms.length === 0) {
      minX = 0; minZ = 0; maxX = 100; maxZ = 100;
    } else {
      rooms.forEach(room => {
        const rX = room.x;
        const rY = room.y;
        const rWidth = room.width || 1;
        const rHeight = room.height || 1; 
        const wallHeight = room.height3D || 28;
        
        minX = Math.min(minX, rX);
        minZ = Math.min(minZ, rY);
        maxX = Math.max(maxX, rX + rWidth);
        maxZ = Math.max(maxZ, rY + rHeight);

        const roomGroup = new THREE.Group();

        // Draw floor
        const floorGeo = new THREE.PlaneGeometry(rWidth, rHeight);
        const floorMat = new THREE.MeshStandardMaterial({ color: 0xe0e0e0, side: THREE.DoubleSide });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        roomGroup.add(floor);

        // Draw walls with openings
        const topOpenings = (room.openings || []).filter(op => op.rotation === 0 && op.y < rHeight / 2);
        const bottomOpenings = (room.openings || []).filter(op => op.rotation === 0 && op.y >= rHeight / 2);
        const leftOpenings = (room.openings || []).filter(op => op.rotation === 90 && op.x < rWidth / 2);
        const rightOpenings = (room.openings || []).filter(op => op.rotation === 90 && op.x >= rWidth / 2);

        const topWall = buildWall(rWidth, wallHeight, topOpenings, 'top');
        topWall.position.set(-rWidth/2, 0, -rHeight/2);
        roomGroup.add(topWall);

        const bottomWall = buildWall(rWidth, wallHeight, bottomOpenings, 'bottom');
        bottomWall.position.set(rWidth/2, 0, rHeight/2);
        bottomWall.rotation.y = Math.PI;
        roomGroup.add(bottomWall);

        const leftWall = buildWall(rHeight, wallHeight, leftOpenings, 'left');
        leftWall.position.set(-rWidth/2, 0, rHeight/2);
        leftWall.rotation.y = Math.PI / 2;
        roomGroup.add(leftWall);

        const rightWall = buildWall(rHeight, wallHeight, rightOpenings, 'right');
        rightWall.position.set(rWidth/2, 0, -rHeight/2);
        rightWall.rotation.y = -Math.PI / 2;
        roomGroup.add(rightWall);

        roomGroup.position.set(rX + rWidth/2, 0, rY + rHeight/2);
        container.add(roomGroup);
      });
    }

    // Center container
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    container.position.set(-cx, 0, -cz);

    // Auto scale camera
    const sizeX = maxX - minX;
    const sizeZ = maxZ - minZ;
    const maxSize = Math.max(sizeX || 100, sizeZ || 100);
    const camDist = maxSize * 1.5;
    
    camera.position.set(0, camDist, camDist);
    camera.lookAt(0, 0, 0);

    // Custom OrbitControls substitute
    this.orbit = {
      spherical: new THREE.Spherical().setFromVector3(camera.position),
      target: new THREE.Vector3(0, 0, 0),
      THREE: THREE
    };

    const animate = function() {
      if (!that.data.is3DView) return; 
      canvas.requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    
    var that = this;
    animate();
  },

  onTouchStart3D: function(e) {
    if (e.touches.length === 1) {
      this.touch3D = {
        mode: 'rotate',
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      this.touch3D = {
        mode: 'zoom_pan',
        dist: Math.sqrt(dx * dx + dy * dy),
        cx: cx,
        cy: cy
      };
    }
  },

  onTouchMove3D: function(e) {
    if (!this.touch3D || !this.orbit || !this.threeCamera) return;
    
    if (e.touches.length === 1 && this.touch3D.mode === 'rotate') {
      const dx = e.touches[0].clientX - this.touch3D.x;
      const dy = e.touches[0].clientY - this.touch3D.y;
      
      this.orbit.spherical.theta -= dx * 0.01;
      this.orbit.spherical.phi -= dy * 0.01;
      
      // restrict phi (do not allow going below ground)
      this.orbit.spherical.phi = Math.max(0.1, Math.min(Math.PI / 2, this.orbit.spherical.phi));
      
      this.threeCamera.position.setFromSpherical(this.orbit.spherical).add(this.orbit.target);
      this.threeCamera.lookAt(this.orbit.target);
      
      this.touch3D.x = e.touches[0].clientX;
      this.touch3D.y = e.touches[0].clientY;
      
    } else if (e.touches.length === 2 && this.touch3D.mode === 'zoom_pan') {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      
      // Zoom
      if (dist > 0 && this.touch3D.dist > 0) {
        const scale = this.touch3D.dist / dist;
        this.orbit.spherical.radius *= scale;
        // restrict radius
        this.orbit.spherical.radius = Math.max(10, Math.min(1000, this.orbit.spherical.radius));
      }
      
      // Pan
      const panX = cx - this.touch3D.cx;
      const panY = cy - this.touch3D.cy;
      
      const panSpeed = this.orbit.spherical.radius * 0.002;
      
      const right = new this.orbit.THREE.Vector3();
      right.setFromMatrixColumn(this.threeCamera.matrix, 0);
      
      const forward = new this.orbit.THREE.Vector3();
      forward.setFromMatrixColumn(this.threeCamera.matrix, 2);
      forward.y = 0;
      if (forward.lengthSq() > 0) forward.normalize();
      
      this.orbit.target.addScaledVector(right, -panX * panSpeed);
      this.orbit.target.addScaledVector(forward, -panY * panSpeed);
      
      this.threeCamera.position.setFromSpherical(this.orbit.spherical).add(this.orbit.target);
      this.threeCamera.lookAt(this.orbit.target);
      
      this.touch3D.dist = dist;
      this.touch3D.cx = cx;
      this.touch3D.cy = cy;
    }
  },

  onTouchEnd3D: function(e) {
    this.touch3D = null;
  },

  onChangeView3D: function(e) {
    if (!this.orbit || !this.threeCamera) return;
    const view = e.currentTarget.dataset.view;
    let targetTheta = this.orbit.spherical.theta;
    let targetPhi = this.orbit.spherical.phi;
    
    if (view === 'default') { 
      targetTheta = 0; 
      targetPhi = Math.PI / 4; 
      this.orbit.target.set(0,0,0);
    }
    if (view === 'top') { targetPhi = 0.01; }
    if (view === 'front') { targetTheta = 0; targetPhi = Math.PI / 2.1; }
    if (view === 'left') { targetTheta = Math.PI / 2; targetPhi = Math.PI / 2.1; }
    if (view === 'right') { targetTheta = -Math.PI / 2; targetPhi = Math.PI / 2.1; }
    
    this.orbit.spherical.theta = targetTheta;
    this.orbit.spherical.phi = targetPhi;
    this.threeCamera.position.setFromSpherical(this.orbit.spherical).add(this.orbit.target);
    this.threeCamera.lookAt(this.orbit.target);
  },

  onBluetoothMeasure: function (distanceInMeters) {
    if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
    if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }

    // 引导模式下优先使用 currentGuidedRoomId，否则使用选中房间
    var isGuided = this.data.guidedMode;
    var roomId = isGuided ? this.data.currentGuidedRoomId : (this.data.selectedIds[0] || '');
    if (!roomId) return;

    var room = null;
    for (var i = 0; i < this.data.rooms.length; i++) {
      if (this.data.rooms[i].id === roomId) { room = this.data.rooms[i]; break; }
    }
    if (!room) return;

    // 处理测量失败
    if (distanceInMeters === null || distanceInMeters <= 0) {
      wx.showToast({ title: '测量失败，请重试', icon: 'none', duration: 2000 });
      if (isGuided) { this.setData({ showMeasurePrompt: true }); this.openLaser(); }
      return;
    }

    var newLength = distanceInMeters * 10; // 10px = 1m

    if (isGuided) {
      if (this.data.guidedEdgeIndex === -1) {
        // 这是层高测量
        var newRooms = this.data.rooms.map(function (r) {
          if (r.id === roomId) {
            return Object.assign({}, r, { height3D: newLength });
          }
          return r;
        });

        wx.showToast({ title: '层高 ' + distanceInMeters + 'm ✓', icon: 'success' });

        this.pushToHistory(newRooms, {
          guidedEdgeIndex: 0, // 进入第0边（即第一条边）测量
          showMeasurePrompt: true // 继续提示测量边
        });

        this.openLaser();
        return;
      }

      // === 引导多边形模式 ===
      var direction = this.data.pendingDirection || 'E';
      var pts = this.data.measurePoints;
      var lastPt = pts[pts.length - 1] || { x: 0, y: 0 };

      var dx = 0, dy = 0;
      if (direction === 'E') dx = newLength;
      else if (direction === 'S') dy = newLength;
      else if (direction === 'W') dx = -newLength;
      else if (direction === 'N') dy = -newLength;

      var newPt = { x: lastPt.x + dx, y: lastPt.y + dy };
      var newMeasurePoints = pts.concat([newPt]);

      // 归一化多边形：平移到 (0,0) 起点
      var utilLib = require('../../utils/util.js');
      var bbox = utilLib.polygonBoundingBox(newMeasurePoints);
      var normalized = newMeasurePoints.map(function (p) {
        return { x: p.x - bbox.minX, y: p.y - bbox.minY };
      });

      var newEdgeIndex = newMeasurePoints.length - 1; // 已完成的边数
      var canFinish = newEdgeIndex >= 2;

      var newRooms = this.data.rooms.map(function (r) {
        if (r.id === roomId) {
          return Object.assign({}, r, {
            width: Math.max(1, bbox.width),
            height: Math.max(1, bbox.height),
            polygon: normalized,
            polygonClosed: false
          });
        }
        return r;
      });

      wx.showToast({ title: '第' + newEdgeIndex + '边 ' + distanceInMeters + 'm ✓', icon: 'success' });

      this.pushToHistory(newRooms, {
        measurePoints: newMeasurePoints,
        guidedEdgeIndex: newEdgeIndex,
        canFinishPolygon: canFinish,
        pendingDirection: '',
        showMeasurePrompt: false
      });

      setTimeout(function () {
        var canvas = this.selectComponent('#floorCanvas');
        if (canvas) canvas.fitToView();
      }.bind(this), 400);

    } else {
      // === 非引导模式：用 selectedEdge 决定方向（向后兼容）===
      var selectedEdge = this.data.selectedEdge;
      if (!selectedEdge) return;

      var updates = {};
      if (selectedEdge === 'top' || selectedEdge === 'bottom') updates.width = newLength;
      else if (selectedEdge === 'left' || selectedEdge === 'right') updates.height = newLength;

      var newRooms2 = this.data.rooms.map(function (r) {
        return r.id === roomId ? Object.assign({}, r, updates) : r;
      });
      this.pushToHistory(newRooms2);
      wx.showToast({ title: '测量成功: ' + distanceInMeters + 'm', icon: 'success' });
    }
  },

  // 用户点击"+ 添加边"按钮
  onAddMeasureEdge: function () {
    this.setData({ showMeasurePrompt: true });
    this.openLaser();
  },

  // 用户点击"✅ 完成轮廓"按钮
  onFinishPolygon: function () {
    var pts = this.data.measurePoints;
    if (pts.length < 3) {
      wx.showToast({ title: '至少需要测量 2 条边', icon: 'none' });
      return;
    }

    var utilLib = require('../../utils/util.js');
    var finishedPts = pts.slice();

    // 仅2边时自动补全矩形（推算剩余两个顶点）
    if (finishedPts.length === 3) {
      var edge1 = { x: finishedPts[1].x - finishedPts[0].x, y: finishedPts[1].y - finishedPts[0].y };
      var pt3 = { x: finishedPts[2].x - edge1.x, y: finishedPts[2].y - edge1.y };
      finishedPts = finishedPts.concat([pt3]);
    }

    var bbox = utilLib.polygonBoundingBox(finishedPts);
    var normalized = finishedPts.map(function (p) {
      return { x: p.x - bbox.minX, y: p.y - bbox.minY };
    });

    var roomId = this.data.currentGuidedRoomId;
    var newRooms = this.data.rooms.map(function (r) {
      if (r.id === roomId) {
        return Object.assign({}, r, {
          width: Math.max(1, bbox.width),
          height: Math.max(1, bbox.height),
          polygon: normalized,
          polygonClosed: true
        });
      }
      return r;
    });

    var newPlannedRooms = this.data.plannedRooms.map(function (pr) {
      return pr.id === roomId ? Object.assign({}, pr, { measured: true }) : pr;
    });

    wx.showToast({ title: '房间轮廓已完成！', icon: 'success' });

    this.pushToHistory(newRooms, {
      plannedRooms: newPlannedRooms,
      guidedMode: false,
      showMeasurePrompt: false,
      selectedEdge: '',
      selectedIds: [roomId],
      measurePoints: [],
      canFinishPolygon: false,
      pendingDirection: ''
    });

    setTimeout(function () {
      var canvas = this.selectComponent('#floorCanvas');
      if (canvas) canvas.fitToView();
    }.bind(this), 500);
  },

  triggerBluetoothMeasure: function () {
    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    
    if (this.measureTimer) {
      clearTimeout(this.measureTimer);
    }
    if (this.failTimer) {
      clearTimeout(this.failTimer);
    }
    
    console.log('发送测量指令 ATK001#');
    bluetooth.sendBLECommand('ATK001#');
    
    // 设置超时计时器 (2.5秒)，如果没收到 ATD 则主动查一下
    this.measureTimer = setTimeout(function () {
      console.log('测量超时，尝试主动查询数据 ATD001#');
      bluetooth.sendBLECommand('ATD001#');
      
      // 再给仪表 2 秒时间响应查询，如果不响应或距离仍不可用，彻底触发失败回调
      that.failTimer = setTimeout(function () {
        console.log('主动查询后仍无数据返回，彻底认定失败');
        that.onBluetoothMeasure(null);
      }, 2000);
    }, 2500);
  },

  openLaser: function() {
    console.log('提前开启激光辅助对准...');
    var bluetooth = require('../../utils/bluetooth.js');
    bluetooth.sendBLECommand('ATK001#');
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
  pushToHistory: function (newRooms, extraData) {
    var history = this.data.history.slice(0, this.data.historyIndex + 1);
    history.push(newRooms);
    if (history.length > 50) history.shift();
    var total = 0;
    for (var i = 0; i < newRooms.length; i++) {
      var r = newRooms[i];
      if (r.polygon && r.polygon.length >= 3 && r.polygonClosed) {
        // Shoelace 公式计算多边形面积（px² → m²: /100）
        var poly = r.polygon;
        var areaRaw = 0;
        for (var k = 0; k < poly.length; k++) {
          var kn = (k + 1) % poly.length;
          areaRaw += poly[k].x * poly[kn].y - poly[kn].x * poly[k].y;
        }
        total += Math.abs(areaRaw) / 2;
      } else {
        total += r.width * r.height;
      }
    }

    var selectedIds = this.data.selectedIds;
    var selectedRooms = newRooms.filter(function (r) {
      return selectedIds.indexOf(r.id) !== -1;
    });

    var setDataObj = Object.assign({
      history: history,
      historyIndex: history.length - 1,
      rooms: newRooms,
      selectedRooms: selectedRooms, // 直接在此处完成更新，实现真正的原子化
      totalArea: (total / 100).toFixed(2)
    }, extraData || {});

    this.setData(setDataObj);
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
    this.setData({ 
      selectedIds: [id],
      selectedEdge: '', 
      showPropertyPanel: true // 只有手动点击房间，才允许弹出属性面板
    });
    this.updateSelectedRooms(this.data.rooms);
  },

  onClearSelection: function () {
    this.setData({ selectedIds: [], selectedRooms: [], showPropertyPanel: false });
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
    this.setData({ selectedIds: [], selectedRooms: [], showPropertyPanel: false });
  },

  onHighlightOpening: function (e) {
    this.setData({ highlightedOpeningId: e.detail.id });
  },

  /**
   * 供外部页面（如AI生成页）同步房间数据更新
   */
  updateRoomData: function (roomId, updates) {
    var newRooms = this.data.rooms.map(function (r) {
      if (r.id === roomId) {
        return Object.assign({}, r, updates);
      }
      return r;
    });
    this.pushToHistory(newRooms);
  },

  // === 导出 ===
  onExport: async function () {
    var rooms = this.data.rooms;
    var dataStr = JSON.stringify(rooms, null, 2);

    const app = getApp();
    const openid = app.globalData.openid;

    if (!openid) {
      wx.showToast({ title: '尚未登录', icon: 'none' });
      // 小程序不支持直接下载文件，备用：使用剪贴板
      wx.setClipboardData({
        data: dataStr,
        success: function () {
          wx.showToast({ title: '未登录，仅复制到剪贴板', icon: 'none', duration: 2000 });
        }
      });
      return;
    }

    wx.showLoading({ title: '正在云端保存' });
    const api = require('../../utils/api.js');
    try {
      await api.request('/floorplans', 'POST', {
        openid: openid,
        name: rooms[0]?.name || '默认户型-' + new Date().getTime(),
        layoutData: rooms
      });
      wx.hideLoading();
      wx.showToast({ title: '云端保存成功！', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Save to cloud failed:', err);
      // fallback to clipboard
      wx.setClipboardData({
        data: dataStr,
        success: function () {
          wx.showToast({ title: '保存失败，已复制到剪贴板', icon: 'none', duration: 2000 });
        }
      });
    }
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
