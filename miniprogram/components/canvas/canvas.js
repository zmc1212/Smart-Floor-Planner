var util = require('../../utils/util.js');
var ToolType = util.ToolType;
var GRID_SIZE = 20;
var SCALE_FACTOR = 10; // 1px = 10cm

Component({
  properties: {
    activeTool: { type: String, value: 'SELECT' },
    rooms: { type: Array, value: [] },
    selectedIds: { type: Array, value: [] },
    currentRoomType: { type: String, value: '客厅' },
    highlightedOpeningId: { type: String, value: '' },
    selectedEdge: { type: String, value: '' }
  },

  data: {
    canvasWidth: 0,
    canvasHeight: 0,
    // 视口变换
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    // 绘制中的新房间
    newRoom: null,
    // 触摸状态
    touchStartPos: null,
    lastTouchDist: 0,
    isDraggingStage: false,
    isDraggingRoom: false,
    dragRoomId: null,
    dragStartRoomPos: null,
    dragDx: 0,
    dragDy: 0,
    // 浮动菜单
    menuPos: null
  },

  lifetimes: {
    ready: function () {
      var that = this;
      // 获取容器尺寸
      var query = this.createSelectorQuery();
      query.select('#canvas-container').boundingClientRect(function (rect) {
        if (rect) {
          that.setData({
            canvasWidth: rect.width,
            canvasHeight: rect.height
          }, function() {
              // Wait for setData to finish before initCanvas
              that.initCanvas();
          });
        }
      }).exec();
    }
  },

  observers: {
    'rooms, selectedIds, highlightedOpeningId, selectedEdge, scale, offsetX, offsetY': function () {
      this.drawCanvas();
      this.updateMenuPos();
    }
  },

  methods: {
    initCanvas: function () {
      var that = this;
      var query = this.createSelectorQuery();
      query.select('#floor-canvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
          if (!res || !res[0]) return;
          var canvas = res[0].node;
          var ctx = canvas.getContext('2d');
          
          // 设置 Canvas 大小（适配高清屏）
          var dpr = wx.getWindowInfo().pixelRatio;
          canvas.width = that.data.canvasWidth * dpr;
          canvas.height = that.data.canvasHeight * dpr;
          ctx.scale(dpr, dpr);
          
          that._canvas = canvas;
          that._ctx = ctx;
          that._dpr = dpr;
          that.drawCanvas();
        });
    },

    /**
     * 将所有房间居中并缩放到合适大小
     */
    fitToView: function () {
      var rooms = this.properties.rooms;
      if (!rooms || rooms.length === 0) return;

      // 1. 计算所有房间的包围盒 (World units)
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      rooms.forEach(function (r) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
      });

      var contentWidth = maxX - minX;
      var contentHeight = maxY - minY;
      var centerX = (minX + maxX) / 2;
      var centerY = (minY + maxY) / 2;

      // 2. 获取画布尺寸
      var canvasWidth = this.data.canvasWidth;
      var canvasHeight = this.data.canvasHeight;
      if (!canvasWidth || !canvasHeight) return;

      // 3. 计算缩放比例 (留出 20% 的边距)
      var padding = 60; // 像素边距
      var availableWidth = canvasWidth - padding * 2;
      var availableHeight = canvasHeight - padding * 2;

      var scaleX = availableWidth / (contentWidth || 1);
      var scaleY = availableHeight / (contentHeight || 1);
      var newScale = Math.min(scaleX, scaleY);
      
      // 限制缩放范围
      newScale = Math.max(0.2, Math.min(newScale, 3.0));

      // 4. 计算偏移量使中心对齐
      // 公式: screenPos = worldPos * scale + offset => offset = screenPos - worldPos * scale
      var newOX = (canvasWidth / 2) - centerX * newScale;
      var newOY = (canvasHeight / 2) - centerY * newScale;

      this.setData({
        scale: newScale,
        offsetX: newOX,
        offsetY: newOY
      });
      this.drawCanvas();
    },

    drawCanvas: function () {
      var ctx = this._ctx;
      if (!ctx) return;

      var w = this.data.canvasWidth;
      var h = this.data.canvasHeight;
      var scale = this.data.scale;
      var ox = this.data.offsetX;
      var oy = this.data.offsetY;
      var rooms = this.properties.rooms;
      var selectedIds = this.properties.selectedIds;
      var highlightedOpeningId = this.properties.highlightedOpeningId;
      var newRoom = this.data.newRoom;

      // 清空画布
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      // 绘制网格
      this.drawGrid(ctx, w, h, scale, ox, oy);

      // 绘制房间
      for (var i = 0; i < rooms.length; i++) {
        var r = rooms[i];
        if (this.data.isDraggingRoom && this.data.dragRoomId === r.id) {
          var rx = util.snapToGrid(this.data.dragStartRoomPos.x + this.data.dragDx, GRID_SIZE);
          var ry = util.snapToGrid(this.data.dragStartRoomPos.y + this.data.dragDy, GRID_SIZE);
          this.drawRoom(ctx, Object.assign({}, r, {x: rx, y: ry}), selectedIds, highlightedOpeningId);
        } else {
          this.drawRoom(ctx, r, selectedIds, highlightedOpeningId);
        }
      }

      // 绘制中的预览
      if (newRoom) {
        var nx = newRoom.width > 0 ? newRoom.x : newRoom.x + newRoom.width;
        var ny = newRoom.height > 0 ? newRoom.y : newRoom.y + newRoom.height;
        var nw = Math.abs(newRoom.width);
        var nh = Math.abs(newRoom.height);

        ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
        ctx.fillRect(nx, ny, nw, nh);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(nx, ny, nw, nh);
        ctx.setLineDash([]);
      }

      ctx.restore();

      // 比例尺文字
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(10, h - 30, 200, 22);
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, h - 30, 200, 22);
      ctx.fillStyle = '#6b7280';
      ctx.font = '10px monospace';
      ctx.fillText('比例尺: 1:10 (10px=1m) | 网格: 0.2m', 16, h - 15);
    },

    drawGrid: function (ctx, w, h, scale, ox, oy) {
      // 计算可见范围内的网格
      var startX = Math.floor(-ox / scale / GRID_SIZE) * GRID_SIZE;
      var startY = Math.floor(-oy / scale / GRID_SIZE) * GRID_SIZE;
      var endX = startX + Math.ceil(w / scale / GRID_SIZE + 2) * GRID_SIZE;
      var endY = startY + Math.ceil(h / scale / GRID_SIZE + 2) * GRID_SIZE;

      ctx.strokeStyle = '#e0e0e0';
      ctx.lineWidth = 0.5 / scale;

      ctx.beginPath();
      for (var x = startX; x <= endX; x += GRID_SIZE) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (var y = startY; y <= endY; y += GRID_SIZE) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();
    },

    drawRoom: function (ctx, room, selectedIds, highlightedOpeningId) {
      var isSelected = selectedIds.indexOf(room.id) !== -1;

      // 房间背景
      ctx.fillStyle = room.color || 'rgba(255,255,255,0.8)';
      ctx.fillRect(room.x, room.y, room.width, room.height);

      // 房间边框
      ctx.strokeStyle = isSelected ? '#3b82f6' : '#141414';
      ctx.lineWidth = isSelected ? 3 : 2;
      ctx.strokeRect(room.x, room.y, room.width, room.height);

      // 房间名称和尺寸 - 根据房间大小动态调整字号 (单位为世界坐标，1px=10cm)
      // 计算一个合适的字号：大约是最小边长的 1/10，但不小于 1.5 (15cm)，不大于 4 (40cm)
      var baseFontSize = Math.max(1.5, Math.min(4, Math.min(room.width, room.height) / 10));
      var nameFontSize = baseFontSize * 1.2; // 标题稍大
      var dimFontSize = baseFontSize;

      ctx.fillStyle = '#141414';
      ctx.font = nameFontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var centerX = room.x + room.width / 2;
      var centerY = room.y + room.height / 2;
      ctx.fillText(room.name, centerX, centerY - nameFontSize * 0.7);
      
      ctx.font = dimFontSize + 'px sans-serif';
      ctx.fillStyle = '#666666';
      ctx.fillText(
        (room.width / 10).toFixed(2) + 'm × ' + (room.height / 10).toFixed(2) + 'm',
        centerX, centerY + dimFontSize * 0.7
      );

      // 高亮绘制选中的边 (激光测距用)
      if (isSelected && this.properties.selectedEdge) {
        var edge = this.properties.selectedEdge;
        ctx.strokeStyle = '#ef4444'; // Red thick line
        ctx.lineWidth = 4;
        ctx.beginPath();
        if (edge === 'top') {
          ctx.moveTo(room.x, room.y);
          ctx.lineTo(room.x + room.width, room.y);
        } else if (edge === 'bottom') {
           ctx.moveTo(room.x, room.y + room.height);
           ctx.lineTo(room.x + room.width, room.y + room.height);
        } else if (edge === 'left') {
           ctx.moveTo(room.x, room.y);
           ctx.lineTo(room.x, room.y + room.height);
        } else if (edge === 'right') {
           ctx.moveTo(room.x + room.width, room.y);
           ctx.lineTo(room.x + room.width, room.y + room.height);
        }
        ctx.stroke();
      }

      // 尺寸标注 (外部) - 同样使用动态字号
      ctx.fillStyle = '#666666';
      ctx.font = dimFontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      // 动态偏移：根据字号大小调整距离墙体的间距
      var labelOffset = dimFontSize * 0.4; 
      ctx.fillText((room.width / 10).toFixed(2) + 'm', centerX, room.y - labelOffset);
      
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        (room.height / 10).toFixed(2) + 'm',
        room.x + room.width + labelOffset,
        room.y + room.height / 2
      );

      // 门窗
      var openings = room.openings || [];
      for (var j = 0; j < openings.length; j++) {
        this.drawOpening(ctx, room, openings[j], highlightedOpeningId);
      }

      // 重置对齐
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    },

    drawOpening: function (ctx, room, opening, highlightedOpeningId) {
      var absX = room.x + opening.x;
      var absY = room.y + opening.y;
      var isHighlighted = highlightedOpeningId === opening.id;

      ctx.save();
      ctx.translate(absX, absY);

      if (opening.rotation === 90) {
        ctx.rotate(Math.PI / 2);
      }

      if (opening.type === 'DOOR') {
        // 高亮背景
        if (isHighlighted) {
          ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          ctx.fillRect(-opening.width / 2 - 4, -opening.width - 4, opening.width + 8, opening.width + 8);
        }
        // 开口间隙（白色覆盖墙线）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-opening.width / 2, -1.5, opening.width, 3);
        // 门扇
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-opening.width / 2, 0);
        ctx.lineTo(-opening.width / 2, -opening.width);
        ctx.stroke();
        // 门弧线
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(-opening.width / 2, -opening.width);
        ctx.lineTo(opening.width / 2, 0);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // 窗户
        if (isHighlighted) {
          ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
          ctx.fillRect(-opening.width / 2 - 4, -6, opening.width + 8, 12);
        }
        // 窗框
        ctx.fillStyle = '#93c5fd';
        ctx.fillRect(-opening.width / 2, -2, opening.width, 4);
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1;
        ctx.strokeRect(-opening.width / 2, -2, opening.width, 4);
        // 中线
        ctx.beginPath();
        ctx.moveTo(-opening.width / 2, 0);
        ctx.lineTo(opening.width / 2, 0);
        ctx.stroke();
      }

      ctx.restore();
    },

    // === 触摸交互 ===

    getCanvasPos: function (touch) {
      // 将屏幕触摸坐标转为 Canvas 坐标
      var that = this;
      var rect = this._canvasRect;
      if (!rect) return { x: 0, y: 0 };
      var cx = touch.clientX - rect.left;
      var cy = touch.clientY - rect.top;
      // 转为世界坐标
      var wx = (cx - that.data.offsetX) / that.data.scale;
      var wy = (cy - that.data.offsetY) / that.data.scale;
      return { x: wx, y: wy };
    },

    findRoomAtPos: function (pos) {
      var rooms = this.properties.rooms;
      // 从后往前查找（后绘制的在上面）
      for (var i = rooms.length - 1; i >= 0; i--) {
        var r = rooms[i];
        if (pos.x >= r.x && pos.x <= r.x + r.width &&
            pos.y >= r.y && pos.y <= r.y + r.height) {
          return r;
        }
      }
      return null;
    },

    onTouchStart: function (e) {
      var that = this;
      
      // 缓存 Canvas 位置
      if (!this._canvasRect) {
        var query = this.createSelectorQuery();
        query.select('#canvas-container').boundingClientRect(function (rect) {
          that._canvasRect = rect;
          that._handleTouchStart(e);
        }).exec();
      } else {
        this._handleTouchStart(e);
      }
    },

    _handleTouchStart: function (e) {
      var touches = e.touches;

      // 双指缩放
      if (touches.length === 2) {
        var dx = touches[0].clientX - touches[1].clientX;
        var dy = touches[0].clientY - touches[1].clientY;
        this.setData({ lastTouchDist: Math.sqrt(dx * dx + dy * dy) });
        return;
      }

      var touch = touches[0];
      var pos = this.getCanvasPos(touch);
      var snappedPos = {
        x: util.snapToGrid(pos.x, GRID_SIZE),
        y: util.snapToGrid(pos.y, GRID_SIZE)
      };

      this.setData({
        touchStartPos: { clientX: touch.clientX, clientY: touch.clientY }
      });

      var activeTool = this.properties.activeTool;

      if (activeTool === 'SELECT') {
        // 检查是否点击了房间
        var room = this.findRoomAtPos(pos);
        if (room) {
          this.triggerEvent('select', { id: room.id });
          this.setData({
            isDraggingRoom: true,
            dragRoomId: room.id,
            dragStartRoomPos: { x: room.x, y: room.y },
            dragDx: 0,
            dragDy: 0,
            touchStartPos: { clientX: touch.clientX, clientY: touch.clientY }
          });
        } else {
          this.triggerEvent('unselect');
          this.setData({ isDraggingStage: true });
        }
      } else if (activeTool === 'ROOM') {
        var room = this.findRoomAtPos(pos);
        if (room) {
          this.triggerEvent('select', { id: room.id });
        } else {
          this.setData({
            newRoom: { x: snappedPos.x, y: snappedPos.y, width: 0, height: 0 }
          });
        }
      } else if (activeTool === 'DOOR' || activeTool === 'WINDOW') {
        this.placeOpening(pos, activeTool);
      } else if (activeTool === 'ERASER') {
        this.eraseAt(pos);
      }
    },

    onTouchMove: function (e) {
      var touches = e.touches;

      // 双指缩放
      if (touches.length === 2 && this._canvasRect) {
        var rect = this._canvasRect;
        var p1 = { x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top };
        var p2 = { x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top };
        
        var dx = p1.x - p2.x;
        var dy = p1.y - p2.y;
        var dist = Math.sqrt(dx * dx + dy * dy);
        
        var lastDist = this.data.lastTouchDist;
        if (lastDist > 0) {
          var ratio = dist / lastDist;
          var oldScale = this.data.scale;
          var newScale = Math.max(0.3, Math.min(oldScale * ratio, 5)); // 增加缩放上限到5倍
          
          if (newScale !== oldScale) {
            // 计算缩放中心点（两指中点）
            var midX = (p1.x + p2.x) / 2;
            var midY = (p1.y + p2.y) / 2;
            
            // 核心逻辑：调整偏移量，使缩放中心点保持在屏幕相同位置
            var oldOX = this.data.offsetX;
            var oldOY = this.data.offsetY;
            
            var newOX = midX - (midX - oldOX) * (newScale / oldScale);
            var newOY = midY - (midY - oldOY) * (newScale / oldScale);
            
            this.setData({
              scale: newScale,
              offsetX: newOX,
              offsetY: newOY,
              lastTouchDist: dist
            });
          }
        } else {
          this.setData({ lastTouchDist: dist });
        }
        return;
      }

      var touch = touches[0];
      var startPos = this.data.touchStartPos;
      if (!startPos) return;

      var dx = touch.clientX - startPos.clientX;
      var dy = touch.clientY - startPos.clientY;

      if (this.data.isDraggingStage) {
        this.setData({
          offsetX: this.data.offsetX + dx,
          offsetY: this.data.offsetY + dy,
          touchStartPos: { clientX: touch.clientX, clientY: touch.clientY }
        });
      } else if (this.data.isDraggingRoom && this.data.dragRoomId) {
        var scale = this.data.scale;
        this.setData({
          dragDx: dx / scale,
          dragDy: dy / scale
        });
        this.drawCanvas();
      } else if (this.data.newRoom && this.properties.activeTool === 'ROOM') {
        var pos = this.getCanvasPos(touch);
        var nr = this.data.newRoom;
        
        // 使用实际坐标，只在手指移开时进行吸附，这样拖拽预览时会非常丝滑，解决小幅拖拽看不到痕迹的问题
        this.setData({
          newRoom: {
            x: nr.x,
            y: nr.y,
            width: pos.x - nr.x,
            height: pos.y - nr.y
          }
        });
        this.drawCanvas();
      }
    },

    onTouchEnd: function (e) {
      if (this.data.isDraggingRoom) {
        var startRoomPos = this.data.dragStartRoomPos;
        var dx = this.data.dragDx;
        var dy = this.data.dragDy;
        var newX = util.snapToGrid(startRoomPos.x + dx, GRID_SIZE);
        var newY = util.snapToGrid(startRoomPos.y + dy, GRID_SIZE);

        if (newX !== startRoomPos.x || newY !== startRoomPos.y) {
          this.triggerEvent('move', {
            id: this.data.dragRoomId,
            x: newX,
            y: newY
          });
        }

        this.setData({
          isDraggingRoom: false,
          dragRoomId: null,
          dragStartRoomPos: null,
          dragDx: 0,
          dragDy: 0
        });
        this.drawCanvas();
      }

      if (this.data.isDraggingStage) {
        this.setData({ isDraggingStage: false });
      }

      if (this.data.newRoom && this.properties.activeTool === 'ROOM') {
        var nr = this.data.newRoom;
        var endX = util.snapToGrid(nr.x + nr.width, GRID_SIZE);
        var endY = util.snapToGrid(nr.y + nr.height, GRID_SIZE);
        var snappedWidth = endX - nr.x;
        var snappedHeight = endY - nr.y;

        if (Math.abs(snappedWidth) >= GRID_SIZE && Math.abs(snappedHeight) >= GRID_SIZE) {
          var room = {
            id: util.generateUUID(),
            x: snappedWidth > 0 ? nr.x : nr.x + snappedWidth,
            y: snappedHeight > 0 ? nr.y : nr.y + snappedHeight,
            width: Math.abs(snappedWidth),
            height: Math.abs(snappedHeight),
            name: this.properties.currentRoomType,
            color: 'rgba(255, 255, 255, 0.8)'
          };
          this.triggerEvent('add', { room: room });
        }
        this.setData({ newRoom: null });
        this.drawCanvas();
      }

      this.setData({ touchStartPos: null, lastTouchDist: 0 });
    },

    placeOpening: function (pos, toolType) {
      var rooms = this.properties.rooms;
      var threshold = 15;
      var foundWall = false;
      var updatedRooms = [];

      for (var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        if (foundWall) {
          updatedRooms.push(room);
          continue;
        }

        var walls = [
          { side: 'top', dist: Math.abs(pos.y - room.y), x: pos.x, y: room.y, rotation: 0 },
          { side: 'bottom', dist: Math.abs(pos.y - (room.y + room.height)), x: pos.x, y: room.y + room.height, rotation: 0 },
          { side: 'left', dist: Math.abs(pos.x - room.x), x: room.x, y: pos.y, rotation: 90 },
          { side: 'right', dist: Math.abs(pos.x - (room.x + room.width)), x: room.x + room.width, y: pos.y, rotation: 90 }
        ];

        var nearestWall = walls[0];
        for (var j = 1; j < walls.length; j++) {
          if (walls[j].dist < nearestWall.dist) nearestWall = walls[j];
        }

        if (nearestWall.dist < threshold) {
          var isWithinLength = nearestWall.rotation === 0
            ? (pos.x >= room.x && pos.x <= room.x + room.width)
            : (pos.y >= room.y && pos.y <= room.y + room.height);

          if (isWithinLength) {
            foundWall = true;
            var openingWidth = toolType === 'DOOR' ? 10 : 15;
            var openingHeight = toolType === 'DOOR' ? 20 : 12;
            var opening = {
              id: util.generateUUID(),
              type: toolType === 'DOOR' ? 'DOOR' : 'WINDOW',
              x: (nearestWall.rotation === 0 ? Math.round(pos.x / 5) * 5 : nearestWall.x) - room.x,
              y: (nearestWall.rotation === 90 ? Math.round(pos.y / 5) * 5 : nearestWall.y) - room.y,
              rotation: nearestWall.rotation,
              width: openingWidth,
              height: openingHeight
            };
            var newOpenings = (room.openings || []).concat([opening]);
            updatedRooms.push(Object.assign({}, room, { openings: newOpenings }));
            continue;
          }
        }
        updatedRooms.push(room);
      }

      if (foundWall) {
        this.triggerEvent('change', { rooms: updatedRooms });
      }
    },

    eraseAt: function (pos) {
      var rooms = this.properties.rooms;
      var threshold = 10;
      var erased = false;
      var newRooms = [];

      for (var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        if (erased) {
          newRooms.push(room);
          continue;
        }

        // 检查门窗
        var openings = room.openings || [];
        var remaining = [];
        var openingErased = false;
        for (var j = 0; j < openings.length; j++) {
          var o = openings[j];
          var absX = room.x + o.x;
          var absY = room.y + o.y;
          var dist = Math.sqrt(Math.pow(pos.x - absX, 2) + Math.pow(pos.y - absY, 2));
          if (dist < threshold && !openingErased) {
            openingErased = true;
            erased = true;
          } else {
            remaining.push(o);
          }
        }

        if (openingErased) {
          newRooms.push(Object.assign({}, room, { openings: remaining }));
          continue;
        }

        // 检查房间
        if (pos.x >= room.x && pos.x <= room.x + room.width &&
            pos.y >= room.y && pos.y <= room.y + room.height) {
          erased = true;
          continue; // 不加入，即删除
        }

        newRooms.push(room);
      }

      if (erased) {
        this.triggerEvent('change', { rooms: newRooms });
        this.triggerEvent('unselect');
      }
    },

    updateMenuPos: function () {
      var selectedIds = this.properties.selectedIds;
      var rooms = this.properties.rooms;
      if (selectedIds.length === 1) {
        var room = null;
        for (var i = 0; i < rooms.length; i++) {
          if (rooms[i].id === selectedIds[0]) { room = rooms[i]; break; }
        }
        if (room) {
          var scale = this.data.scale;
          var ox = this.data.offsetX;
          var oy = this.data.offsetY;
          this.setData({
            menuPos: {
              x: ox + (room.x + room.width / 2) * scale,
              y: oy + room.y * scale - 10
            },
            menuRoomName: room.name
          });
          return;
        }
      }
      this.setData({ menuPos: null, menuRoomName: '' });
    },

    onDeleteFromMenu: function () {
      var id = this.properties.selectedIds[0];
      if (id) {
        this.triggerEvent('delete', { id: id });
      }
    },

    onStartRemeasure: function () {
      this.triggerEvent('startremeasure');
    },

    onFitToView: function () {
      this.fitToView();
    },

    onPropsFromMenu: function () {
      this.triggerEvent('showprops');
    }
  }
});
