var util = require('../../utils/util.js');
var ToolType = util.ToolType;

Page({
  data: {
    bleConnected: false,
    is3DView: false,
    guidedMode: false,
    showMeasurePrompt: false,
    showLeadModal: false,
    guidedEdgeIndex: -1,
    currentGuidedRoomId: '',
    currentGuidedRoomName: '',
    currentProject_id: '',
    isLaserOpen: false,      
    measurePoints: [],       
    pendingDirection: '',    
    canFinishPolygon: false, 
    activeTool: 'SELECT',
    currentRoomType: '客厅',
    rooms: [],
    history: [[]],
    historyIndex: 0,
    selectedIds: [],
    selectedRooms: [],
    showPropertyPanel: false,
    highlightedOpeningId: '',
    lastMeasuredDirection: '',
    statusBarHeight: 0,
    showDrawingIndicator: false,
    totalArea: '0.00',
    windowWidth: 375,
    windowHeight: 600,
    showAngleMeasure: false,
    angleMeasureWallA: 0,
    showTechnicalReport: false,
    showBLEConnector: false
  },

  onLoad: function (options) {
    var that = this;
    this.isMeasuring = false; 
    this._lastMeasureTime = 0;
    this._lastMeasureDist = 0;
    var sysInfo = wx.getSystemInfoSync();
    var menuButtonInfo = wx.getMenuButtonBoundingClientRect();

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

  onShow: function() {
    const app = getApp();
    const bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    
    // 重新绑定蓝牙回调到当前页面
    if (app.globalData.bleConnected) {
      bluetooth.setCallbacks(
        function (dist) { that.onBluetoothMeasure(dist); },
        function (isConn) { 
          that.setData({ bleConnected: isConn }); 
          app.globalData.bleConnected = isConn;
          if (!isConn) that.onBluetoothDisconnect();
        },
        function () { that.onBluetoothDisconnect(); }
      );
      this.setData({ bleConnected: true });
    } else {
      this.setData({ bleConnected: false });
    }

    if (app.globalData.restoreFloorPlan) {
      var fp = app.globalData.restoreFloorPlan;
      app.globalData.restoreFloorPlan = null;
      
      let rooms = fp.layoutData;
      let draftState = null;
      
      // Parse layoutData if it's an object with draftState
      if (rooms && typeof rooms === 'object' && !Array.isArray(rooms)) {
        draftState = rooms.draftState;
        rooms = rooms.rooms;
      } else if (typeof rooms === 'string') {
        try {
          const parsed = JSON.parse(rooms);
          if (parsed && parsed.rooms) {
            rooms = parsed.rooms;
            draftState = parsed.draftState;
          } else {
            rooms = parsed;
          }
        } catch (e) {}
      }

      // 提取目标房间ID（优先使用明确传入的 roomId）
      const targetRoomId = fp.roomId || fp.currentGuidedRoomId || (draftState ? draftState.currentGuidedRoomId : '') || '';
      const targetRoomName = fp.roomName || fp.currentGuidedRoomName || '';

      // Find the target room to check its measurement status
      let targetRoom = null;
      if (targetRoomId && rooms) {
        targetRoom = rooms.find(r => r.id === targetRoomId);
      }

      var extraData = {
        currentProject_id: fp._id || '',
        guidedMode: fp.guidedMode || (!!draftState),
        currentGuidedRoomId: targetRoomId,
        currentGuidedRoomName: targetRoomName,
        showMeasurePrompt: fp.showMeasurePrompt !== undefined ? fp.showMeasurePrompt : (!!targetRoomId && !targetRoom?.measured),
        activeTool: fp.activeTool || 'SELECT',
        selectedIds: targetRoomId ? [targetRoomId] : (fp.selectedIds || []),
        showPropertyPanel: false
      };

      // Detect if layer height is already measured for this room to skip prompt
      if (targetRoomId && rooms) {
        if (targetRoom && targetRoom.height3D > 0) {
          // If height is measured but we haven't started walls, set index to 0
          if (!draftState || draftState.currentGuidedRoomId !== targetRoomId) {
            extraData.guidedEdgeIndex = 0;
            extraData.pendingDirection = 'E';
          }
        }
      }

      // Restore Draft Measurement State (Only if it matches the target room)
      if (draftState && draftState.currentGuidedRoomId === targetRoomId) {
        Object.assign(extraData, {
          measurePoints: draftState.measurePoints || [{ x: 0, y: 0 }],
          guidedEdgeIndex: draftState.guidedEdgeIndex !== undefined ? draftState.guidedEdgeIndex : -1,
          pendingDirection: draftState.pendingDirection || '',
          lastMeasuredDirection: draftState.lastMeasuredDirection || ''
        });
      } else if (extraData.guidedMode) {
        // Fresh guided mode for this specific room
        extraData.measurePoints = [{ x: 0, y: 0 }];
        extraData.guidedEdgeIndex = -1;
      }

      this.pushToHistory(rooms, extraData);
      this.updateSelectedRooms(rooms);
      
      setTimeout(() => {
        const canvas = this.selectComponent('#floorCanvas');
        if (canvas) {
          canvas.fitToView();
          if (fp.isRestore) {
            wx.showToast({ title: draftState ? '已恢复测量进度' : '已恢复布局', icon: 'success' });
          }
        }
      }, 800);

      // Final check: Never open laser if the room is already measured
      const shouldOpenLaser = !!(extraData.guidedMode && extraData.showMeasurePrompt && targetRoom && !targetRoom.measured);
      
      if (shouldOpenLaser) {
        console.log('[Editor] Auto-opening laser for unmeasured room');
        this.openLaser();
      } else {
        console.log('[Editor] Staying quiet for measured room or non-guided mode');
      }
    }
  },

  onUnload: function() {
    this.isMeasuring = false;
    if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
    if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }
  },

  onBack: function() {
    this.onExitToLibrary();
  },

  onExitToLibrary: function () {
    this.isMeasuring = false;
    if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
    if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }
    
    wx.navigateBack();
  },

  onSubmitFloorPlan: async function () {
    const success = await this.saveToCloudInternal();
    if (success) {
      this.isMeasuring = false;
      if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
      if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }
      
      // Navigate to Mine tab directly to see the saved floor plan
      wx.switchTab({
        url: '/pages/mine/mine'
      });
    }
  },

  onExitGuide: function () {
    this.isMeasuring = false;
    if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
    if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }
    this.setData({ guidedMode: false, selectedEdge: '' });
  },

  // === 工具切换 ===
  onToolChange: function (e) {
    var tool = e.detail.tool;
    if (tool === 'SHAPE') {
      this.onShowShapePicker();
      return;
    }
    this.setData({
      activeTool: tool,
      showDrawingIndicator: tool !== 'SELECT' && tool !== 'SHAPE'
    });
  },

  onShowShapePicker: function () {
    var templates = require('../../utils/templates.js');
    var shapes = templates.shapeTemplates;
    var that = this;
    
    wx.showActionSheet({
      itemList: shapes.map(s => s.name),
      success: (res) => {
        var shape = shapes[res.tapIndex];
        that.insertShapeRoom(shape.id);
      }
    });
  },

  insertShapeRoom: function (shapeId) {
    var templates = require('../../utils/templates.js');
    var canvasWidth = this.data.windowWidth;
    var canvasHeight = this.data.windowHeight - 150;

    var newRoom = templates.generateShapeRoom(
      shapeId, 
      this.data.currentRoomType || '客厅',
      canvasWidth / 2 - 20, 
      canvasHeight / 2 - 20
    );

    if (newRoom) {
      var newRooms = this.data.rooms.concat([newRoom]);
      this.pushToHistory(newRooms);
      this.setData({ 
        selectedIds: [newRoom.id], 
        activeTool: 'SELECT',
        showPropertyPanel: true 
      });
      this.updateSelectedRooms(newRooms);
      
      wx.showToast({ title: '已插入形状', icon: 'none' });
    }
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

  onCancelMeasure: function () {
    this.isMeasuring = false;
    if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
    if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }
    this.setData({ showMeasurePrompt: false });
  },

  onConfirmMeasure: function (e) {
    var direction = (e && e.detail && e.detail.direction) ? e.detail.direction : 'E';
    this.setData({ showMeasurePrompt: false, pendingDirection: direction });
    this.triggerBluetoothMeasure();
  },

  onConnectBLE: function () {
    this.setData({ showBLEConnector: true });
  },

  onBluetoothDisconnect: function () {
    this.setData({ bleConnected: false, isLaserOpen: false });
    wx.showModal({
      title: '蓝牙断开',
      content: '与测距仪的蓝牙连接已断开，请检查设备是否正常并尝试重新连接。',
      showCancel: false,
      confirmText: '我知道了'
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
    var that = this;
    const width = canvas._width || canvas.width;
    const height = canvas._height || canvas.height;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);
    this.threeScene = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    this.threeCamera = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(wx.getSystemInfoSync().pixelRatio);
    renderer.shadowMap.enabled = true; // CRITICAL: Fix for missing shadows
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.threeRenderer = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Reduced for more contrast
    scene.add(ambientLight);
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight1.position.set(200, 400, 200);
    dirLight1.castShadow = true;
    // Optimize shadow camera for typical floor plan size
    dirLight1.shadow.camera.left = -1000;
    dirLight1.shadow.camera.right = 1000;
    dirLight1.shadow.camera.top = 1000;
    dirLight1.shadow.camera.bottom = -1000;
    dirLight1.shadow.camera.near = 0.5;
    dirLight1.shadow.camera.far = 2000;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xffffff, 0.3);
    dirLight2.position.set(-200, 200, -200);
    scene.add(dirLight2);

    const gridHelper = new THREE.GridHelper(2000, 100, 0xcccccc, 0xeeeeee);
    gridHelper.position.y = -0.1;
    scene.add(gridHelper);

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

      const mat = new THREE.MeshStandardMaterial({ 
        color: 0xeeeeee, // Softer gray-white for better visual depth
        side: THREE.DoubleSide,
        roughness: 0.7, // More rough to show light gradients
        metalness: 0.1
      });
      // Admin parity: Use ExtrudeGeometry for thickness (2 units = ~20cm)
      const extrudeSettings = { depth: 2, bevelEnabled: false };
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, extrudeSettings), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      return mesh;
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
        const floorMat = new THREE.MeshStandardMaterial({ 
          color: room.color || 0xfafafa, // Sync with Admin layout: use room color
          side: THREE.DoubleSide,
          roughness: 0.9,
          metalness: 0
        });

        if (room.polygon && room.polygon.length >= 3) {
          const shape = new THREE.Shape();
          const pts = room.polygon;
          
          shape.moveTo(pts[0].x - rWidth/2, -(pts[0].y - rHeight/2));
          for (let i = 1; i < pts.length; i++) {
            shape.lineTo(pts[i].x - rWidth/2, -(pts[i].y - rHeight/2));
          }
          if (room.polygonClosed) {
            shape.closePath();
          }

          const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), floorMat);
          floor.rotation.x = -Math.PI / 2;
          floor.position.y = 0.05;
          floor.receiveShadow = true;
          roomGroup.add(floor);

          for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i];
            const p2 = pts[(i + 1) % pts.length];
            
            if (i === pts.length - 1 && !room.polygonClosed) continue;

            const dx = p2.x - p1.x;
            const dy = p2.y - p1.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);

            const wall = buildWall(length, wallHeight, [], 'top');
            
            wall.position.set(p1.x - rWidth/2, 0, p1.y - rHeight/2);
            wall.rotation.y = -angle;
            roomGroup.add(wall);
          }
        } else {
          const floorGeo = new THREE.PlaneGeometry(rWidth, rHeight);
          const floor = new THREE.Mesh(floorGeo, floorMat);
          floor.rotation.x = -Math.PI / 2;
          floor.position.y = 0.05;
          floor.receiveShadow = true;
          roomGroup.add(floor);

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
        }

        // Add Openings (Doors/Windows) logic to match Admin visuals
        (room.openings || []).forEach(op => {
          const isTop = op.rotation === 0 && op.y < rHeight / 2;
          const isBottom = op.rotation === 0 && op.y >= rHeight / 2;
          const isLeft = op.rotation === 90 && op.x < rWidth / 2;
          const isRight = op.rotation === 90 && op.x >= rWidth / 2;

          let opX = 0, opZ = 0;
          let opW = op.width, opD = 4; // Slightly wider than wall for visibility
          const wallThickness = 2;

          if (isTop || isBottom) {
            opX = -rWidth/2 + op.x + op.width/2;
            opZ = isTop ? (-rHeight/2 + wallThickness/2) : (rHeight/2 - wallThickness/2);
          } else {
            opZ = -rHeight/2 + op.y + op.width/2;
            opX = isLeft ? (-rWidth/2 + wallThickness/2) : (rWidth/2 - wallThickness/2);
            opW = 4; 
            opD = op.width;
          }

          const color = op.type === 'DOOR' ? 0xf59e0b : 0x3b82f6;
          const h = op.type === 'DOOR' ? 20 : 12;
          const yPos = op.type === 'DOOR' ? h/2 : 9 + h/2;

          const opGeo = new THREE.BoxGeometry(opW, h, opD);
          const opMat = new THREE.MeshStandardMaterial({ color: color, transparent: true, opacity: 0.8 });
          const opMesh = new THREE.Mesh(opGeo, opMat);
          opMesh.position.set(opX, yPos, opZ);
          roomGroup.add(opMesh);
        });

        roomGroup.position.set(rX + rWidth/2, 0, rY + rHeight/2);
        container.add(roomGroup);
      });
    }

    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    container.position.set(-cx, 0, -cz);

    const sizeX = maxX - minX;
    const sizeZ = maxZ - minZ;
    const maxSize = Math.max(sizeX || 100, sizeZ || 100);
    
    // Fit to view calculation: d = (max_size/2) / tan(fov/2 * aspect)
    const aspect = width / height;
    const fovRad = (camera.fov * Math.PI) / 180;
    // For vertical clipping
    const distV = (sizeZ / 2) / Math.tan(fovRad / 2);
    // For horizontal clipping (accounting for aspect ratio)
    const distH = (sizeX / 2) / (Math.tan(fovRad / 2) * aspect);
    const camDist = Math.max(distV, distH, 100) * 1.2; // 1.2 for comfortable margin
    
    this.defaultDist = camDist;
    
    camera.position.set(0, camDist, camDist);
    camera.lookAt(0, 0, 0);

    this.orbit = {
      spherical: new THREE.Spherical().setFromVector3(camera.position),
      target: new THREE.Vector3(0, 0, 0),
      lerpTarget: new THREE.Vector3(0, 0, 0),
      lerpSpherical: new THREE.Spherical().setFromVector3(camera.position),
      isLerping: false,
      THREE: THREE
    };

    const animate = function() {
      if (!that.data.is3DView) return; 
      canvas.requestAnimationFrame(animate);

      if (that.orbit.isLerping) {
        const factor = 0.08;
        
        // Shortest path rotation for Theta (wrapping around 0/360)
        let thetaDiff = that.orbit.lerpSpherical.theta - that.orbit.spherical.theta;
        while (thetaDiff > Math.PI) thetaDiff -= 2 * Math.PI;
        while (thetaDiff < -Math.PI) thetaDiff += 2 * Math.PI;
        that.orbit.spherical.theta += thetaDiff * factor;

        // Phi and Radius don't need wrapping
        that.orbit.spherical.phi += (that.orbit.lerpSpherical.phi - that.orbit.spherical.phi) * factor;
        that.orbit.spherical.radius += (that.orbit.lerpSpherical.radius - that.orbit.spherical.radius) * factor;
        that.orbit.target.lerp(that.orbit.lerpTarget, factor);

        if (Math.abs(that.orbit.spherical.theta - that.orbit.lerpSpherical.theta) < 0.001 &&
            Math.abs(that.orbit.spherical.phi - that.orbit.lerpSpherical.phi) < 0.001 &&
            that.orbit.target.distanceTo(that.orbit.lerpTarget) < 0.1) {
          that.orbit.isLerping = false;
        }
        
        camera.position.setFromSpherical(that.orbit.spherical).add(that.orbit.target);
        camera.lookAt(that.orbit.target);
      }

      renderer.render(scene, camera);
    };
    
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
      
      if (dist > 0 && this.touch3D.dist > 0) {
        const scale = this.touch3D.dist / dist;
        this.orbit.spherical.radius *= scale;
        this.orbit.spherical.radius = Math.max(10, Math.min(1000, this.orbit.spherical.radius));
      }
      
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
    let targetRadius = this.defaultDist || 150;
    let targetPos = new this.orbit.THREE.Vector3(0, 0, 0);
    
    if (view === 'default') { 
      targetTheta = 0; 
      targetPhi = Math.PI / 4; 
    } else if (view === 'top') { 
      targetPhi = 0.01; 
      targetTheta = 0;
    } else if (view === 'front') { 
      targetTheta = 0; 
      targetPhi = Math.PI / 2.1; 
    } else if (view === 'left') { 
      targetTheta = Math.PI / 2; 
      targetPhi = Math.PI / 2.1; 
    } else if (view === 'right') { 
      targetTheta = -Math.PI / 2; 
      targetPhi = Math.PI / 2.1; 
    }
    
    this.orbit.lerpSpherical.theta = targetTheta;
    this.orbit.lerpSpherical.phi = targetPhi;
    this.orbit.lerpSpherical.radius = targetRadius;
    this.orbit.lerpTarget.copy(targetPos);
    this.orbit.isLerping = true;
  },

  onBluetoothMeasure: function (distanceInMeters) {
    // 只要收到任何蓝牙反馈（无论是测量成功、失败、还是报错超时），物理激光灯都会熄灭，因此第一步强制重置状态
    this.setData({ isLaserOpen: false });

    if (!this.isMeasuring && !this.data.showMeasurePrompt) {
      return;
    }

    if (!this.isMeasuring && this.data.showMeasurePrompt) {
      this.setData({ showMeasurePrompt: false });
    }

    // 增加软件层面的防抖：过滤掉 800ms 内数值完全相同的脉冲信号（针对某些连发两包的硬件）
    const now = Date.now();
    if (distanceInMeters !== null && distanceInMeters === this._lastMeasureDist && now - this._lastMeasureTime < 800) {
      console.log('检测到短期内内容重复的信号脉冲，已过滤:', distanceInMeters);
      return;
    }
    this._lastMeasureTime = now;
    this._lastMeasureDist = distanceInMeters;
    
    this.isMeasuring = false; 
    this.setData({ isLaserOpen: false, showMeasurePrompt: false });

    if (this.measureTimer) { clearTimeout(this.measureTimer); this.measureTimer = null; }
    if (this.failTimer) { clearTimeout(this.failTimer); this.failTimer = null; }

    var isGuided = this.data.guidedMode;
    var roomId = isGuided ? this.data.currentGuidedRoomId : (this.data.selectedIds[0] || '');
    if (!roomId) return;

    var room = null;
    for (var i = 0; i < this.data.rooms.length; i++) {
      if (this.data.rooms[i].id === roomId) { room = this.data.rooms[i]; break; }
    }
    if (!room) return;

    if (distanceInMeters === null || distanceInMeters <= 0) {
      wx.showToast({ title: '测量失败，请重试', icon: 'none', duration: 2000 });
      if (isGuided) { 
        this.setData({ showMeasurePrompt: true }); 
        setTimeout(() => {
          this.openLaser(); 
        }, 800);
      }
      return;
    }

    var newLength = distanceInMeters * 10; 

    if (isGuided) {
      if (this.data.guidedEdgeIndex === -1) {
        var newRooms = this.data.rooms.map(function (r) {
          if (r.id === roomId) {
            return Object.assign({}, r, { height3D: newLength });
          }
          return r;
        });

        wx.showToast({ title: '层高 ' + distanceInMeters + 'm ✓', icon: 'success' });

        this.pushToHistory(newRooms, {
          guidedEdgeIndex: 0, 
          lastMeasuredDirection: '',
          pendingDirection: 'E',
          showMeasurePrompt: false 
        });

        this.reportMeasurement({
          type: 'height',
          value: distanceInMeters,
          direction: 'H',
          roomId: roomId,
          roomName: room.name
        });

        setTimeout(() => {
          this.openLaser();
        }, 500);

        setTimeout(() => {
          this.setData({ showMeasurePrompt: true });
        }, 900);
        return;
      }

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

      var utilLib = require('../../utils/util.js');
      var bbox = utilLib.polygonBoundingBox(newMeasurePoints);
      var normalized = newMeasurePoints.map(function (p) {
        return { x: p.x - bbox.minX, y: p.y - bbox.minY };
      });

      var newEdgeIndex = newMeasurePoints.length - 1; 
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

      let nextDirection = '';
      if (newEdgeIndex === 1) nextDirection = 'S'; 
      else if (newEdgeIndex === 2) nextDirection = 'W'; 
      else if (newEdgeIndex === 3) nextDirection = 'N';

      this.pushToHistory(newRooms, {
        measurePoints: newMeasurePoints,
        guidedEdgeIndex: newEdgeIndex,
        canFinishPolygon: canFinish,
        lastMeasuredDirection: direction, 
        pendingDirection: nextDirection 
      });

      this.reportMeasurement({
        type: 'length',
        value: distanceInMeters,
        direction: direction,
        roomId: roomId,
        roomName: room.name
      });

      setTimeout(() => {
        this.openLaser();
      }, 500);

      setTimeout(() => {
        this.setData({ showMeasurePrompt: true });
      }, 900);

      setTimeout(function () {
        var canvas = this.selectComponent('#floorCanvas');
        if (canvas) canvas.fitToView();
      }.bind(this), 400);

    } else {
      var edgeInfo = this.data.selectedEdgeInfo;
      if (!edgeInfo) return;

      var roomId = edgeInfo.roomId;
      var newLength = distanceInMeters * 10;
      var newRooms = this.data.rooms.map((r) => {
        if (r.id !== roomId) return r;

        if (edgeInfo.type === 'rect') {
          // 矩形模式
          var updates = {};
          if (edgeInfo.side === 'top' || edgeInfo.side === 'bottom') updates.width = newLength;
          else if (edgeInfo.side === 'left' || edgeInfo.side === 'right') updates.height = newLength;
          return Object.assign({}, r, updates);
        } else if (edgeInfo.type === 'polygon' && r.polygon) {
          // 多边形边复测逻辑 (简化版：保持方向，推移顶点)
          var poly = JSON.parse(JSON.stringify(r.polygon));
          var idx = edgeInfo.index;
          var nextIdx = (idx + 1) % poly.length;
          
          var p1 = poly[idx];
          var p2 = poly[nextIdx];
          
          var currentDist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
          if (currentDist === 0) return r;
          
          var ratio = newLength / currentDist;
          var dx = (p2.x - p1.x) * (ratio - 1);
          var dy = (p2.y - p1.y) * (ratio - 1);
          
          // 将后续所有点平移，保持后续形状不变
          for (var k = nextIdx; k < poly.length; k++) {
            poly[k].x += dx;
            poly[k].y += dy;
          }
          
          // 如果多边形已闭合，且我们移动了点，可能需要特殊处理最后一个点
          // 这里采用简单的链式平移，适合 L 型或 U 型连续测量修正
          
          return Object.assign({}, r, { polygon: poly });
        }
        return r;
      });

      this.pushToHistory(newRooms, { selectedEdgeInfo: null, selectedEdge: '' });
      this.reportMeasurement({
        type: 'length',
        value: distanceInMeters,
        direction: edgeInfo.side || String(edgeInfo.index || ''),
        roomId: roomId,
        roomName: room.name
      });
      wx.showToast({ title: '墙体已更新: ' + distanceInMeters + 'm', icon: 'success' });
    }
  },

  reportMeasurement: async function (record) {
    const app = getApp();
    const projectId = this.data.currentProject_id;
    if (!app.globalData.openid || !projectId || !record || !record.value) {
      return;
    }

    try {
      const api = require('../../utils/api.js');
      const bluetooth = require('../../utils/bluetooth.js');
      const deviceInfo = bluetooth.getCurrentDeviceInfo ? bluetooth.getCurrentDeviceInfo() : {};
      await api.request('/measurements', 'POST', {
        openid: app.globalData.openid,
        floorPlanId: projectId,
        roomId: record.roomId || this.data.currentGuidedRoomId,
        roomName: record.roomName || this.data.currentGuidedRoomName,
        deviceId: deviceInfo.deviceId || deviceInfo.name || '',
        value: record.value,
        unit: record.unit || 'meters',
        type: record.type || 'length',
        direction: record.direction || '',
        source: 'ble',
        measuredAt: new Date().toISOString()
      });
    } catch (err) {
      console.error('Report measurement failed', err);
    }
  },

  // === 角度测量流程 ===
  onStartAngleMeasure: function () {
    var pts = this.data.measurePoints;
    var wallALen = 0;
    if (pts.length >= 2) {
      var p1 = pts[pts.length - 2];
      var p2 = pts[pts.length - 1];
      var dx = p2.x - p1.x;
      var dy = p2.y - p1.y;
      wallALen = Math.round(Math.sqrt(dx * dx + dy * dy) / 10 * 1000) / 1000;
    }
    this.setData({
      showMeasurePrompt: false,
      showAngleMeasure: true,
      angleMeasureWallA: wallALen
    });
  },

  onAngleMeasureConfirm: function (e) {
    var angle = e.detail.angle;
    var wallLength = e.detail.wallLength;

    this.setData({ showAngleMeasure: false });

    var pts = this.data.measurePoints;
    if (pts.length < 2) {
      wx.showToast({ title: '请先测量至少一条边', icon: 'none' });
      return;
    }

    var roomId = this.data.currentGuidedRoomId;
    if (!roomId) return;

    var newEdgeLenPx = wallLength * 10;
    var angleRad = angle * (Math.PI / 180);

    var p1 = pts[pts.length - 2];
    var p2 = pts[pts.length - 1];
    var prevAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    var newAbsAngle = prevAngle + (Math.PI - angleRad);

    var lastPt = pts[pts.length - 1];
    var newPt = {
      x: Math.round((lastPt.x + newEdgeLenPx * Math.cos(newAbsAngle)) * 100) / 100,
      y: Math.round((lastPt.y + newEdgeLenPx * Math.sin(newAbsAngle)) * 100) / 100
    };

    var newMeasurePoints = pts.concat([newPt]);

    var utilLib = require('../../utils/util.js');
    var bbox = utilLib.polygonBoundingBox(newMeasurePoints);
    var normalized = newMeasurePoints.map(function (p) {
      return { x: p.x - bbox.minX, y: p.y - bbox.minY };
    });

    var newEdgeIndex = newMeasurePoints.length - 1;
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

    wx.showToast({ title: '斜角 ' + angle + '° 边' + newEdgeIndex + ' ✓', icon: 'success' });

    this.pushToHistory(newRooms, {
      measurePoints: newMeasurePoints,
      guidedEdgeIndex: newEdgeIndex,
      canFinishPolygon: canFinish,
      lastMeasuredDirection: 'ANGLE',
      pendingDirection: ''
    });

    const room = (this.data.rooms || []).find(function (item) { return item.id === roomId; });
    this.reportMeasurement({
      type: 'angle',
      value: wallLength,
      direction: 'ANGLE',
      roomId: roomId,
      roomName: room ? room.name : this.data.currentGuidedRoomName
    });

    var that = this;
    setTimeout(function () { that.openLaser(); }, 500);
    setTimeout(function () { that.setData({ showMeasurePrompt: true }); }, 900);
    setTimeout(function () {
      var canvas = that.selectComponent('#floorCanvas');
      if (canvas) canvas.fitToView();
    }, 400);
  },

  onCloseAngleMeasure: function () {
    this.setData({ showAngleMeasure: false, showMeasurePrompt: true });
  },

  onAddMeasureEdge: function () {
    if (!this.data.bleConnected) {
      wx.showToast({ title: '请先连接测距仪', icon: 'none' });
      this.setData({ showBLEConnector: true });
      return;
    }
    this.openLaser();
    setTimeout(() => {
      this.setData({ showMeasurePrompt: true });
    }, 500);
  },

  onCloseBLEConnector: function () {
    this.setData({ showBLEConnector: false });
  },

  onBLESuccess: function () {
    this.setData({ bleConnected: true, showBLEConnector: false });
    getApp().globalData.bleConnected = true;
    
    // Auto trigger laser if we were in the middle of something
    if (this.data.currentGuidedRoomId) {
      this.openLaser();
    }
  },

  onFinishPolygon: function () {
    var pts = this.data.measurePoints;
    if (pts.length < 3) {
      wx.showToast({ title: '至少需要测量 2 条边', icon: 'none' });
      return;
    }

    var utilLib = require('../../utils/util.js');
    var finishedPts = pts.slice();

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
          polygonClosed: true,
          measured: true
        });
      }
      return r;
    });

    wx.showToast({ title: '房间轮廓已完成！', icon: 'success' });

    this.pushToHistory(newRooms, {
      guidedMode: false,
      showMeasurePrompt: false,
      selectedEdge: '',
      selectedIds: [roomId],
      measurePoints: [],
      canFinishPolygon: false,
      pendingDirection: '',
      lastMeasuredDirection: '' 
    });

    setTimeout(function () {
      var canvas = this.selectComponent('#floorCanvas');
      if (canvas) canvas.fitToView();
    }.bind(this), 500);
  },

  triggerBluetoothMeasure: function () {
    var bluetooth = require('../../utils/bluetooth.js');
    var that = this;
    
    this.isMeasuring = true; 
    
    if (this.measureTimer) {
      clearTimeout(this.measureTimer);
    }
    if (this.failTimer) {
      clearTimeout(this.failTimer);
    }
    
    console.log('发送测量指令 ATK001#');
    bluetooth.sendBLECommand('ATK001#');
    
    this.measureTimer = setTimeout(function () {
      console.log('测量超时，尝试主动查询数据 ATD001#');
      bluetooth.sendBLECommand('ATD001#');
      
      that.failTimer = setTimeout(function () {
        console.log('主动查询后仍无数据返回，彻底认定失败');
        that.onBluetoothMeasure(null);
      }, 4000);
    }, 3500);
  },

  openLaser: function() {
    if (this.data.isLaserOpen) {
      console.log('激光已经在开启状态，跳过重复发送指令以免提前触发测量...');
      return;
    }
    console.log('提前开启激光辅助对准...');
    var bluetooth = require('../../utils/bluetooth.js');
    bluetooth.sendBLECommand('ATK001#');
    this.setData({ isLaserOpen: true });
  },

  onBluetoothDisconnect: function () {
    this.setData({ bleConnected: false, isLaserOpen: false });
    getApp().globalData.bleConnected = false;
    wx.showModal({
      title: '蓝牙断开',
      content: '与测距仪的蓝牙连接已断开，请检查设备。',
      showCancel: false
    });
  },

  onAddTemplate: function (e) {
    var templateId = e.detail.templateId;
    var templatesUtil = require('../../utils/templates.js');
    var newLayoutRooms = templatesUtil.generateTemplate(templateId, 50, 50); 
    if (newLayoutRooms && newLayoutRooms.length > 0) {
      var newRooms = this.data.rooms.concat(newLayoutRooms);
      this.pushToHistory(newRooms);
    }
  },

  pushToHistory: function (newRooms, extraData) {
    var history = this.data.history.slice(0, this.data.historyIndex + 1);
    history.push(newRooms);
    if (history.length > 50) history.shift();
    var total = 0;
    for (var i = 0; i < newRooms.length; i++) {
      var r = newRooms[i];
      if (r.polygon && r.polygon.length >= 3 && r.polygonClosed) {
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
      selectedRooms: selectedRooms,
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

  onClearCanvas: function () {
    var that = this;
    wx.showModal({
      title: '清空画布',
      content: '确定要清空当前所在房间的测量数据吗？此操作不可直接撤销。',
      confirmText: '确定清空',
      confirmColor: '#ff4d4f',
      success: (res) => {
        if (res.confirm) {
          const isGuided = !!this.data.currentGuidedRoomId;
          let newRooms = [];
          
          if (isGuided) {
            // 在多房间模式下，只重置当前引导的房间，保留其他房间
            newRooms = this.data.rooms.map(r => {
              if (r.id === this.data.currentGuidedRoomId) {
                return {
                  id: r.id,
                  name: r.name || '新增房间',
                  x: r.x || 50,
                  y: r.y || 50,
                  width: 1,
                  height: 1,
                  color: '#f0f0f0',
                  measured: false,
                  openings: [],
                  polygon: [],
                  polygonClosed: false,
                  height3D: 28
                };
              }
              return r;
            });
          } else {
             // 非引导模式，直接清空全部
             newRooms = [];
          }

          this.setData({
            rooms: newRooms,
            history: [newRooms],
            historyIndex: 0,
            selectedIds: isGuided ? [this.data.currentGuidedRoomId] : [],
            selectedRooms: isGuided ? newRooms.filter(r => r.id === this.data.currentGuidedRoomId) : [],
            totalArea: '0.00',
            showPropertyPanel: false,
            guidedMode: isGuided,
            showMeasurePrompt: false,
            measurePoints: isGuided ? [{ x: 0, y: 0 }] : [],
            guidedEdgeIndex: -1,
            pendingDirection: '',
            lastMeasuredDirection: '',
            canFinishPolygon: false
          });
          
          wx.showToast({ title: '已重置该房间', icon: 'success' });
        }
      }
    });
  },

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
      showPropertyPanel: true
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

  onStartRemeasure: function () {
    const roomId = this.data.currentGuidedRoomId;
    let rooms = this.data.rooms || [];
    
    // 检查当前引导房间是否还存在（可能被清空画布了）
    const roomExists = rooms.some(r => r.id === roomId);
    
    if (!roomExists && roomId) {
      console.log('[Editor] 画布已清空，正在为重测重新创建房间对象:', roomId);
      const newRoom = {
        id: roomId,
        name: this.data.currentGuidedRoomName || '客厅',
        x: 50,
        y: 50,
        width: 1,
        height: 1,
        color: '#f0f0f0',
        measured: false,
        openings: [],
        polygon: [],
        polygonClosed: false,
        height3D: 28
      };
      rooms = [...rooms, newRoom]; // 追加房间，不要覆盖其他房间
    }

    this.setData({
      rooms: rooms,
      guidedMode: true,
      guidedEdgeIndex: -1, 
      measurePoints: [{ x: 0, y: 0 }],
      lastMeasuredDirection: '',
      pendingDirection: '',
      canFinishPolygon: false,
      selectedEdge: '',
      selectedEdgeInfo: null, 
      showMeasurePrompt: false,
      showPropertyPanel: false,
      is3DView: false,
      selectedIds: roomId ? [roomId] : []
    });
    this.openLaser();
    setTimeout(() => {
      this.setData({ showMeasurePrompt: true });
    }, 500);
  },

  updateSelectedRooms: function (rooms) {
    var selectedIds = this.data.selectedIds;
    var selectedRooms = rooms.filter(function (r) {
      return selectedIds.indexOf(r.id) !== -1;
    });
    this.setData({ selectedRooms: selectedRooms });
  },

  // === 导出 ===
  onExport: function () {
    const that = this;
    const rooms = this.data.rooms;
    if (!rooms || rooms.length === 0) {
      wx.showToast({ title: '无数据操作', icon: 'none' });
      return;
    }

    wx.showActionSheet({
      itemList: ['保存并返回', '导出为 CAD 文件', '导出量房报告'],
      success: async (res) => {
        if (res.tapIndex === 0) {
          const success = await that.saveToCloudInternal('completed');
          if (success) {
            // Return to previous page (lead-detail)
            setTimeout(() => { wx.navigateBack(); }, 1500);
          }
        } else if (res.tapIndex === 1) {
          that.exportDXF();
        } else if (res.tapIndex === 2) {
          that.exportReportImage();
        }
      }
    });
  },

  onCloseLeadModal: function() {
    this.setData({ showLeadModal: false });
  },

  onLeadSuccess: function() {
    wx.showToast({ title: '已成功绑定并推送线索', icon: 'success' });
  },

  exportDXF: function () {
    const exportService = require('../../utils/exportService.js');
    const dxfContent = exportService.generateDXF(this.data.rooms);
    const fs = wx.getFileSystemManager();
    const fileName = `floorplan_${Date.now()}.dxf`;
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;

    wx.showLoading({ title: '生成中...' });

    fs.writeFile({
      filePath: filePath,
      data: dxfContent,
      encoding: 'utf8',
      success: () => {
        wx.hideLoading();
        wx.openDocument({
          filePath: filePath,
          showMenu: true,
          success: () => console.log('DXF opened'),
          fail: (err) => {
            wx.showToast({ title: '打开失败，请重试', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        wx.hideLoading();
        wx.showToast({ title: '保存文件失败', icon: 'none' });
      }
    });
  },

  exportReportImage: function () {
    wx.showToast({ title: '准备报告中...', icon: 'loading' });
    setTimeout(() => {
      const canvas = this.selectComponent('#floorCanvas');
      if (canvas && canvas.exportImage) {
        canvas.exportImage((path) => {
          wx.previewImage({ urls: [path] });
        });
      } else {
        wx.showToast({ title: '组件不支持图片生成', icon: 'none' });
      }
    }, 500);
  },

  saveToCloud: async function () {
    await this.saveToCloudInternal('completed');
  },

  onSaveDraft: async function() {
    await this.saveToCloudInternal('draft');
    
    // Support Local Backup
    try {
      const backup = {
        rooms: this.data.rooms,
        points: this.data.measurePoints,
        index: this.data.guidedEdgeIndex,
        time: Date.now()
      };
      wx.setStorageSync('last_draft_backup', backup);
    } catch (e) {}
  },

  saveToCloudInternal: async function (status = 'completed') {
    const app = getApp();
    const openid = app.globalData.openid;
    const rooms = this.data.rooms;
    const projectId = this.data.currentProject_id;

    if (!openid) {
      wx.showToast({ title: '请登录后再试', icon: 'none' });
      return false;
    }

    wx.showLoading({ title: status === 'draft' ? '保存草稿...' : '同步中...' });
    const api = require('../../utils/api.js');

    // Prepare Layout Data (Enhanced for Drafts)
    let layoutData = rooms;
    if (status === 'draft') {
      layoutData = {
        rooms: rooms,
        draftState: {
          measurePoints: this.data.measurePoints,
          guidedEdgeIndex: this.data.guidedEdgeIndex,
          currentGuidedRoomId: this.data.currentGuidedRoomId,
          pendingDirection: this.data.pendingDirection,
          lastMeasuredDirection: this.data.lastMeasuredDirection
        }
      };
    }

    try {
      let res;
      const payload = {
        openid: openid,
        name: (rooms[0]?.name || '量房数据') + (status === 'draft' ? '-草稿' : '') + '-' + util.formatTime(new Date()).split(' ')[0].replace(/\//g, ''),
        layoutData: layoutData,
        status: status
      };

      if (projectId) {
        // Update existing
        res = await api.request(`/floorplans/${projectId}`, 'PUT', payload);
      } else {
        // Create new
        res = await api.request('/floorplans', 'POST', payload);
        if (res.success && res.data?._id) {
          this.setData({ currentProject_id: res.data._id });
        }
      }

      wx.hideLoading();
      wx.showToast({ title: status === 'draft' ? '已保存草稿' : '已完成同步' });
      return true;
    } catch (err) {
      wx.hideLoading();
      console.error('Save to cloud failed:', err);
      wx.showToast({ title: '保存失败', icon: 'none' });
      return false;
    }
  },

  onEdgeSelect: function (e) {
    console.log('选中边:', e.detail);
    this.setData({
      selectedEdge: 'OVERRIDE', // 特殊标识，表示当前正选中一个具体的边用于复测
      selectedEdgeInfo: e.detail,
      selectedIds: [e.detail.roomId],
      showPropertyPanel: false
    });
    this.updateSelectedRooms(this.data.rooms);
    
    // 选中边后，如果蓝牙已连接，提示可以测量
    if (this.data.bleConnected) {
      wx.showToast({ title: '已选中墙体，可直接测量', icon: 'none' });
      this.openLaser();
    }
  },

  onOpenTechnicalReport() {
    this.setData({ showTechnicalReport: true });
  },

  onCloseTechnicalReport() {
    this.setData({ showTechnicalReport: false });
  },

});
