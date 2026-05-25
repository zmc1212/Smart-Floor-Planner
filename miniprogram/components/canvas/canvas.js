var util = require('../../utils/util.js');
var ToolType = util.ToolType;
var openingGeometry = require('../../utils/openingGeometry.js');
var GRID_SIZE = 20;
var SCALE_FACTOR = 10; // 1px = 10cm

Component({
  properties: {
    activeTool: { type: String, value: 'SELECT' },
    rooms: { type: Array, value: [] },
    selectedIds: { type: Array, value: [] },
    currentRoomType: { type: String, value: '客厅' },
    highlightedOpeningId: { type: String, value: '' },
    selectedEdge: { type: String, value: '' },
    guidedMode: { type: Boolean, value: false },
    currentGuidedRoomId: { type: String, value: '' },
    guidedEdgeIndex: { type: Number, value: -1 },
    lastMeasuredDirection: { type: String, value: '' },
    pendingDirection: { type: String, value: '' },
    measurePoints: { type: Array, value: [] },
    measurementMode: { type: String, value: 'room' },
    wholeHomeStage: { type: String, value: '' },
    homeOutline: { type: Object, value: null },
    partitions: { type: Array, value: [] }
  },

  data: {
    canvasWidth: 0,
    canvasHeight: 0,
    // 视口变换
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    // 绘制中的新房间/内墙
    newRoom: null,
    newPartition: null,
    // 触摸状态
    touchStartPos: null,
    lastTouchDist: 0,
    isDraggingStage: false,
    isDraggingRoom: false,
    dragRoomId: null,
    dragStartRoomPos: null,
    dragDx: 0,
    dragDy: 0,
    // 测量提示闪烁状态
    isBlinkOn: false,
    animTick: 0
  },

  lifetimes: {
    ready: function () {
      this.refreshSize();

      // 闪烁与动画定时器 (50ms 保证呼吸灯平滑)
      var that = this;
      this._blinkTimer = setInterval(function () {
        var now = Date.now();
        var isBlinkOn = Math.floor(now / 500) % 2 === 0;
        that.setData({ 
          isBlinkOn: isBlinkOn,
          animTick: now
        });
      }, 50);
    },
    detached: function () {
      if (this._blinkTimer) {
        clearInterval(this._blinkTimer);
      }
    }
  },

  observers: {
    'rooms, selectedIds, highlightedOpeningId, selectedEdge, scale, offsetX, offsetY, guidedMode, currentGuidedRoomId, measurePoints, lastMeasuredDirection, pendingDirection, measurementMode, wholeHomeStage, homeOutline, partitions, isBlinkOn': function () {
      this.drawCanvas();
    }
  },

  methods: {
    refreshSize: function (retries = 3) {
      var that = this;
      var query = this.createSelectorQuery();
      query.select('#canvas-container').boundingClientRect(function (rect) {
        if (rect && rect.width > 0) {
          console.log('[Canvas] Container size acquired:', rect.width, rect.height);
          that.setData({
            canvasWidth: rect.width,
            canvasHeight: rect.height
          }, function() {
            that.initCanvas();
          });
        } else if (retries > 0) {
          console.warn('[Canvas] Failed to get size, retrying...', retries);
          setTimeout(() => that.refreshSize(retries - 1), 200);
        } else {
          console.error('[Canvas] Failed to get container size after retries');
        }
      }).exec();
    },

    /**
     * 归一化房间数据：兼容 w/h、width/height、defaultWidth/defaultHeight，
     * 并为缺失坐标的房间分配默认位置
     */
    normalizeRooms: function (rooms) {
      if (!rooms || !Array.isArray(rooms)) return [];
      var canvasW = this.data.canvasWidth || 390;
      var canvasH = this.data.canvasHeight || 600;

      return rooms.map(function (r, idx) {
        var room = Object.assign({}, r);

        // 宽高归一化: w -> width, h -> height, defaultWidth -> width
        if (room.width === undefined || room.width === null) {
          room.width = parseFloat(room.w) || parseFloat(room.defaultWidth) || 40;
        }
        if (room.height === undefined || room.height === null) {
          room.height = parseFloat(room.h) || parseFloat(room.defaultHeight) || 40;
        }
        room.width = parseFloat(room.width) || 40;
        room.height = parseFloat(room.height) || 40;

        // 坐标归一化: 缺失 x/y 时，居中排列
        if (room.x === undefined || room.x === null || isNaN(parseFloat(room.x))) {
          // 将房间排列在画布中心区域
          var cols = Math.ceil(Math.sqrt(rooms.length));
          var col = idx % cols;
          var row = Math.floor(idx / cols);
          room.x = col * (room.width + 5);
          room.y = row * (room.height + 5);
        } else {
          room.x = parseFloat(room.x);
          room.y = parseFloat(room.y) || 0;
        }

        return room;
      });
    },

    initCanvas: function () {
      var that = this;
      var query = this.createSelectorQuery();
      query.select('#floor-canvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
          if (!res || !res[0]) {
            console.error('[Canvas] Failed to find #floor-canvas');
            return;
          }
          var canvas = res[0].node;
          if (!canvas) {
            console.error('[Canvas] Canvas node is null');
            return;
          }
          var ctx = canvas.getContext('2d');
          
          // 设置 Canvas 大小（适配高清屏）
          // 兼容性修复: 优先使用 getWindowInfo，兜底使用 getSystemInfoSync
          var dpr = 1;
          try {
            if (wx.getWindowInfo) {
              dpr = wx.getWindowInfo().pixelRatio;
            } else {
              dpr = wx.getSystemInfoSync().pixelRatio;
            }
          } catch (e) {
            dpr = wx.getSystemInfoSync().pixelRatio || 1;
          }
          
          var w = that.data.canvasWidth || res[0].width;
          var h = that.data.canvasHeight || res[0].height;

          if (!w || !h) {
            console.warn('[Canvas] Canvas size is 0, retrying init in 100ms');
            setTimeout(() => that.initCanvas(), 100);
            return;
          }

          canvas.width = w * dpr;
          canvas.height = h * dpr;
          // 注意：此处不再调用 ctx.scale，统一由 drawCanvas 中的 setTransform 管理
          
          that._canvas = canvas;
          that._ctx = ctx;
          that._dpr = dpr;
          console.log('[Canvas] Initialized:', w, 'x', h, 'dpr:', dpr);
          that.drawCanvas();
        });
    },

    /**
     * 将所有房间居中并缩放到合适大小
     */
    fitToView: function () {
      var rooms = this.normalizeRooms(this.properties.rooms);
      if (this.properties.currentGuidedRoomId) {
        rooms = rooms.filter(r => r.id === this.properties.currentGuidedRoomId);
      }
      var outline = this.properties.homeOutline;
      var boundsRooms = rooms.slice();
      if (outline && outline.polygon && outline.polygon.length) {
        boundsRooms.push(outline);
      }
      if (!boundsRooms || boundsRooms.length === 0) return;

      // 1. 计算所有房间的包围盒
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      boundsRooms.forEach(function (r) {
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

      // 3. 计算缩放比例 (留出边距)
      var padding = 60;
      var availableWidth = canvasWidth - padding * 2;
      var availableHeight = canvasHeight - padding * 2;

      var scaleX = availableWidth / (contentWidth || 1);
      var scaleY = availableHeight / (contentHeight || 1);
      var newScale = Math.min(scaleX, scaleY);
      newScale = Math.max(0.2, Math.min(newScale, 3.0));

      // 4. 计算偏移量使中心对齐
      var newOX = (canvasWidth / 2) - centerX * newScale;
      var newOY = (canvasHeight / 2) - centerY * newScale;

      this.setData({
        scale: newScale,
        offsetX: newOX,
        offsetY: newOY
      });
    },

    drawCanvas: function () {
      var ctx = this._ctx;
      if (!ctx) return;

      var w = this.data.canvasWidth;
      var h = this.data.canvasHeight;
      var scale = this.data.scale;
      var ox = this.data.offsetX;
      var oy = this.data.offsetY;
      var dpr = this._dpr || 1;

      // 归一化房间数据
      var rooms = this.normalizeRooms(this.properties.rooms);
      if (this.properties.currentGuidedRoomId) {
        rooms = rooms.filter(r => r.id === this.properties.currentGuidedRoomId);
      }
      var selectedIds = this.properties.selectedIds;
      var highlightedOpeningId = this.properties.highlightedOpeningId;
      var newRoom = this.data.newRoom;
      var newPartition = this.data.newPartition;

      // 防止 NaN 导致的渲染崩溃
      if (isNaN(ox)) ox = 0;
      if (isNaN(oy)) oy = 0;
      if (isNaN(scale) || scale <= 0) scale = 1;

      // 重置变换矩阵并应用 DPR 缩放
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 清空画布
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);

      // 绘制网格
      this.drawGrid(ctx, w, h, scale, ox, oy);

      if (this.properties.measurementMode === 'whole_home' && this.properties.homeOutline) {
        this.drawHomeOutline(ctx, this.properties.homeOutline);
      }

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

      this.drawPartitions(ctx, this.properties.partitions || []);

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

      if (newPartition) {
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 4;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(newPartition.start.x, newPartition.start.y);
        ctx.lineTo(newPartition.end.x, newPartition.end.y);
        ctx.stroke();
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

      ctx.strokeStyle = '#d1d5db'; // 更清晰的网格颜色
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

    drawHomeOutline: function (ctx, outline) {
      if (!outline || !outline.polygon || outline.polygon.length < 2) return;
      var pts = outline.polygon;
      var ox = parseFloat(outline.x) || 0;
      var oy = parseFloat(outline.y) || 0;

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(ox + pts[0].x, oy + pts[0].y);
      for (var i = 1; i < pts.length; i++) {
        ctx.lineTo(ox + pts[i].x, oy + pts[i].y);
      }
      if (outline.polygonClosed && pts.length >= 3) {
        ctx.closePath();
        ctx.fillStyle = outline.color || 'rgba(219, 234, 254, 0.22)';
        ctx.fill();
      }
      ctx.strokeStyle = '#0f766e';
      ctx.lineWidth = outline.polygonClosed ? 4 : 3;
      ctx.setLineDash(outline.polygonClosed ? [] : [8, 8]);
      ctx.stroke();
      ctx.setLineDash([]);

      if (pts.length) {
        ctx.fillStyle = '#0f766e';
        ctx.beginPath();
        ctx.arc(ox + pts[0].x, oy + pts[0].y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    },

    drawPartitions: function (ctx, partitions) {
      if (!partitions || !partitions.length) return;
      ctx.save();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 3;
      partitions.forEach(function (partition) {
        var pts = partition.points || [];
        if (pts.length < 2) return;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.stroke();
      });
      ctx.restore();
    },

    drawRoom: function (ctx, room, selectedIds, highlightedOpeningId) {
      var isSelected = selectedIds.indexOf(room.id) !== -1;
      var hasPolygon = room.polygon && room.polygon.length >= 1;

      ctx.save();

      if (hasPolygon) {
        // ── 多边形路径绘制 ──
        var poly = room.polygon;
        
        // 1. 填充多边形 (仅当顶点>=3时有意义)
        if (poly.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(room.x + poly[0].x, room.y + poly[0].y);
          for (var pi = 1; pi < poly.length; pi++) {
            ctx.lineTo(room.x + poly[pi].x, room.y + poly[pi].y);
          }
          if (room.polygonClosed) ctx.closePath();
          ctx.fillStyle = room.color || 'rgba(255,255,255,0.8)';
          ctx.fill();
        }

        var isGuidedActive = this.properties.guidedMode && !room.polygonClosed && isSelected;

        // 如果只有一个点（刚测完层高，准备测第一条边）
        if (poly.length === 1 && isGuidedActive) {
          var t = this.data.animTick || Date.now();
          var breathing = 0.5 + 0.5 * Math.sin(t / 300); // 呼吸周期约1.8秒
          
          ctx.beginPath();
          ctx.arc(room.x + poly[0].x, room.y + poly[0].y, 4 + 2 * breathing, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(16, 185, 129, ' + (0.4 + 0.6 * breathing) + ')'; // 绿色呼吸灯
          ctx.fill();
          
          // 呼吸外圈
          ctx.beginPath();
          ctx.arc(room.x + poly[0].x, room.y + poly[0].y, 8 + 4 * breathing, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(59, 130, 246, ' + (0.2 * breathing) + ')';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // 2. 绘制普通边框 (除了最新的一条不绘制，如果是引导模式)
        if (poly.length >= 2) {
          var normalEdgesEnd = isGuidedActive ? poly.length - 2 : poly.length - 1;
          if (normalEdgesEnd < 0) normalEdgesEnd = 0;
          
          ctx.beginPath();
          ctx.moveTo(room.x + poly[0].x, room.y + poly[0].y);
          for (var pi = 1; pi <= normalEdgesEnd; pi++) {
            ctx.lineTo(room.x + poly[pi].x, room.y + poly[pi].y);
          }
          if (room.polygonClosed && poly.length >= 3) ctx.closePath();
          
          ctx.strokeStyle = isSelected ? '#3b82f6' : '#141414';
          ctx.lineWidth = isSelected ? 3 : 2;
          ctx.stroke();

          // 3. 绘制最新一条边（如果还在测量中，则闪烁）
          if (isGuidedActive) {
            var pA = poly[poly.length - 2];
            var pB = poly[poly.length - 1];
            ctx.beginPath();
            ctx.moveTo(room.x + pA.x, room.y + pA.y);
            ctx.lineTo(room.x + pB.x, room.y + pB.y);
            
            if (this.data.isBlinkOn) {
              ctx.strokeStyle = '#10b981'; // 绿色高亮
              ctx.lineWidth = 6;
            } else {
              ctx.strokeStyle = '#3b82f6'; // 蓝色
              ctx.lineWidth = 4;
            }
            ctx.stroke();

            // 4. 绘制下一条边的可能方向箭头
            var hintDir = this.properties.lastMeasuredDirection;
            // 如果刚测完第一条边，lastMeasuredDirection 会被设为该边方向
            this.drawNextDirectionHint(ctx, room.x + pB.x, room.y + pB.y, hintDir);
          }

          // 5. 未闭合时绘制最后一段回到起点的连线为虚线预览
          if (!room.polygonClosed) {
            ctx.beginPath();
            ctx.setLineDash([8, 8]);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 2;
            ctx.moveTo(room.x + poly[poly.length - 1].x, room.y + poly[poly.length - 1].y);
            ctx.lineTo(room.x + poly[0].x, room.y + poly[0].y);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      } else if (room.measured !== false) {
        // ── 矩形回退（向后兼容）──
        ctx.fillStyle = room.color || 'rgba(255,255,255,0.8)';
        ctx.fillRect(room.x, room.y, room.width, room.height);
        ctx.strokeStyle = isSelected ? '#3b82f6' : '#141414';
        ctx.lineWidth = isSelected ? 3 : 2;
        ctx.strokeRect(room.x, room.y, room.width, room.height);

        // 非多边形模式：高亮选中边（激光测距用）
        if (isSelected && this.properties.selectedEdge) {
          var edge = this.properties.selectedEdge;
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 4;
          ctx.beginPath();
          if (edge === 'top') { ctx.moveTo(room.x, room.y); ctx.lineTo(room.x + room.width, room.y); }
          else if (edge === 'bottom') { ctx.moveTo(room.x, room.y + room.height); ctx.lineTo(room.x + room.width, room.y + room.height); }
          else if (edge === 'left') { ctx.moveTo(room.x, room.y); ctx.lineTo(room.x, room.y + room.height); }
          else if (edge === 'right') { ctx.moveTo(room.x + room.width, room.y); ctx.lineTo(room.x + room.width, room.y + room.height); }
          ctx.stroke();
        }
      }

      ctx.restore();

      // 门窗要在未闭合/未完成测量的房间里也可见。
      var openings = room.openings || [];
      for (var j = 0; j < openings.length; j++) {
        this.drawOpening(ctx, room, openings[j], highlightedOpeningId);
      }

      // ── 文字标注 ──
      // 如果房间尚未测量，不显示任何文字标注
      if (room.measured === false) return;

      var minSide = Math.min(room.width, room.height);
      var baseFontSize = Math.max(1.5, Math.min(4, minSide / 10));
      var nameFontSize = baseFontSize * 1.2;
      var dimFontSize = baseFontSize;

      var centerX = room.x + room.width / 2;
      var centerY = room.y + room.height / 2;

      // 计算面积
      var areaM2;
      if (hasPolygon && room.polygonClosed) {
        // Shoelace 公式（坐标单位 px，1px=10cm，100px²=1m²）
        var poly2 = room.polygon;
        var areaRaw = 0;
        for (var ai = 0; ai < poly2.length; ai++) {
          var aj = (ai + 1) % poly2.length;
          areaRaw += poly2[ai].x * poly2[aj].y - poly2[aj].x * poly2[ai].y;
        }
        areaM2 = (Math.abs(areaRaw) / 2 / 100).toFixed(2);
      } else {
        areaM2 = (room.width * room.height / 100).toFixed(2);
      }

      ctx.fillStyle = '#141414';
      ctx.font = nameFontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.name, centerX, centerY - nameFontSize * 0.8);

      ctx.font = dimFontSize + 'px sans-serif';
      ctx.fillStyle = '#666666';
      ctx.fillText(areaM2 + ' m²', centerX, centerY + dimFontSize * 0.8);

      // 外部尺寸标注（包围盒宽×高）
      var labelOffset = dimFontSize * 0.4;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText((room.width / 10).toFixed(2) + 'm', centerX, room.y - labelOffset);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText((room.height / 10).toFixed(2) + 'm', room.x + room.width + labelOffset, centerY);

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

      ctx.rotate(openingGeometry.getOpeningAngleRad(opening));

      var width = Math.max(4, parseFloat(opening.width) || 0);
      var half = width / 2;
      var cutThickness = Math.max(6, Math.min(12, width * 0.18));

      if (isHighlighted) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.18)';
        ctx.fillRect(-half - 5, -width - 6, width + 10, width + 12);
      }

      // Make the wall break obvious even when the opening sits on a thick colored wall.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(-half - 1, -cutThickness / 2, width + 2, cutThickness);

      if (opening.type === 'DOOR') {
        var doorColor = '#f59e0b';
        var leaf = Math.max(width, 8);

        ctx.strokeStyle = doorColor;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(-half, -leaf);
        ctx.stroke();

        ctx.strokeStyle = doorColor;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(-half, 0, leaf, -Math.PI / 2, 0);
        ctx.stroke();

        ctx.fillStyle = doorColor;
        ctx.fillRect(-half, -cutThickness / 2, width, cutThickness);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(-half + 2, -cutThickness / 2 + 2, Math.max(1, width - 4), Math.max(1, cutThickness - 4));
      } else {
        var windowColor = '#2563eb';

        ctx.fillStyle = '#dbeafe';
        ctx.fillRect(-half, -cutThickness / 2, width, cutThickness);
        ctx.strokeStyle = windowColor;
        ctx.lineWidth = 2;
        ctx.strokeRect(-half, -cutThickness / 2, width, cutThickness);
        ctx.beginPath();
        ctx.moveTo(-half, 0);
        ctx.lineTo(half, 0);
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
      if (this.properties.currentGuidedRoomId) {
        rooms = rooms.filter(r => r.id === this.properties.currentGuidedRoomId);
      }
      for (var i = rooms.length - 1; i >= 0; i--) {
        var r = rooms[i];
        if (r.polygon && r.polygon.length >= 3 && r.polygonClosed) {
          var absPoly = r.polygon.map(p => ({ x: r.x + p.x, y: r.y + p.y }));
          if (util.isPointInPolygon(absPoly, pos.x, pos.y)) return r.id;
        } else {
          if (pos.x >= r.x && pos.x <= r.x + r.width && pos.y >= r.y && pos.y <= r.y + r.height) return r.id;
        }
      }
      return null;
    },

    findEdgeAtPos: function (pos) {
      var rooms = this.properties.rooms;
      if (this.properties.currentGuidedRoomId) {
        rooms = rooms.filter(r => r.id === this.properties.currentGuidedRoomId);
      }
      var tolerance = 10; // 触摸容差

      for (var i = rooms.length - 1; i >= 0; i--) {
        var r = rooms[i];
        if (r.polygon && r.polygon.length >= 2) {
          var poly = r.polygon;
          for (var j = 0; j < poly.length; j++) {
            var k = (j + 1) % poly.length;
            var x1 = r.x + poly[j].x, y1 = r.y + poly[j].y;
            var x2 = r.x + poly[k].x, y2 = r.y + poly[k].y;
            if (util.isPointOnSegment(pos.x, pos.y, x1, y1, x2, y2, tolerance)) {
              return { roomId: r.id, type: 'polygon', index: j };
            }
          }
        } else {
          // 矩形边
          var x = r.x, y = r.y, w = r.width, h = r.height;
          if (util.isPointOnSegment(pos.x, pos.y, x, y, x + w, y, tolerance)) return { roomId: r.id, type: 'rect', side: 'top' };
          if (util.isPointOnSegment(pos.x, pos.y, x, y + h, x + w, y + h, tolerance)) return { roomId: r.id, type: 'rect', side: 'bottom' };
          if (util.isPointOnSegment(pos.x, pos.y, x, y, x, y + h, tolerance)) return { roomId: r.id, type: 'rect', side: 'left' };
          if (util.isPointOnSegment(pos.x, pos.y, x + w, y, x + w, y + h, tolerance)) return { roomId: r.id, type: 'rect', side: 'right' };
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
        var edge = this.findEdgeAtPos(pos);
        if (edge) {
          this.triggerEvent('edgeselect', edge);
          return;
        }
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
      } else if (activeTool === 'PARTITION') {
        this.setData({
          newPartition: {
            start: snappedPos,
            end: snappedPos
          }
        });
      } else if (activeTool === 'DOOR' || activeTool === 'WINDOW') {
        this.selectOpeningWall(pos, activeTool);
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
      } else if (this.data.newPartition && this.properties.activeTool === 'PARTITION') {
        var partitionPos = this.getCanvasPos(touch);
        var snappedPartitionPos = {
          x: util.snapToGrid(partitionPos.x, GRID_SIZE),
          y: util.snapToGrid(partitionPos.y, GRID_SIZE)
        };
        this.setData({
          newPartition: {
            start: this.data.newPartition.start,
            end: snappedPartitionPos
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

      if (this.data.newPartition && this.properties.activeTool === 'PARTITION') {
        var partition = this.data.newPartition;
        var pdx = partition.end.x - partition.start.x;
        var pdy = partition.end.y - partition.start.y;
        if (Math.sqrt(pdx * pdx + pdy * pdy) >= GRID_SIZE) {
          this.triggerEvent('partitionadd', {
            points: [partition.start, partition.end]
          });
        }
        this.setData({ newPartition: null });
        this.drawCanvas();
      }

      this.setData({ touchStartPos: null, lastTouchDist: 0 });
    },

    placeOpening: function (pos, toolType) {
      var rooms = this.properties.rooms;
      var foundWall = false;
      var updatedRooms = [];
      var wallHit = openingGeometry.findNearestWall(
        rooms,
        pos,
        this.properties.currentGuidedRoomId,
        15
      );

      if (!wallHit) return;

      for (var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        if (room.id === wallHit.room.id && !foundWall) {
          foundWall = true;
          var opening = openingGeometry.buildOpeningAtPoint(
            room,
            wallHit.wall,
            pos,
            toolType,
            util.generateUUID()
          );
          if (!opening) {
            updatedRooms.push(room);
            continue;
          }
          var newOpenings = (room.openings || []).concat([opening]);
          updatedRooms.push(Object.assign({}, room, { openings: newOpenings }));
          continue;
        }
        updatedRooms.push(room);
      }

      if (foundWall) {
        this.triggerEvent('change', { rooms: updatedRooms });
      }
    },

    selectOpeningWall: function (pos, toolType) {
      var hit = openingGeometry.findNearestWall(
        this.properties.rooms,
        pos,
        this.properties.currentGuidedRoomId,
        15
      );

      if (!hit) {
        wx.showToast({ title: '\u8bf7\u70b9\u51fb\u95e8\u7a97\u6240\u5728\u7684\u5899\u8fb9', icon: 'none' });
        return;
      }

      this.triggerEvent('openingwallselect', {
        toolType: toolType,
        roomId: hit.room.id,
        wall: hit.wall,
        point: hit.point,
        along: hit.along,
        reference: hit.reference,
        touchPoint: pos
      });
    },

    eraseAt: function (pos) {
      var rooms = this.properties.rooms;
      var threshold = 10;
      var erased = false;
      var newRooms = [];

      for (var i = 0; i < rooms.length; i++) {
        var room = rooms[i];
        if (this.properties.currentGuidedRoomId && room.id !== this.properties.currentGuidedRoomId) {
          newRooms.push(room);
          continue;
        }
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
        var isInside = false;
        if (room.polygon && room.polygon.length >= 3) {
          isInside = util.isPointInPolygon(room.polygon, pos.x - room.x, pos.y - room.y);
        } else {
          isInside = pos.x >= room.x && pos.x <= room.x + room.width &&
                     pos.y >= room.y && pos.y <= room.y + room.height;
        }

        if (isInside) {
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

    drawNextDirectionHint: function(ctx, x, y, lastDir) {
      if (!lastDir) return;
      var arrowLen = 30; // 相对于画布的缩放，实际上可以视作物理坐标
      var dirs = [];
      
      if (lastDir === 'E' || lastDir === 'W') {
        dirs = [{ dx: 0, dy: arrowLen, label: '南' }, { dx: 0, dy: -arrowLen, label: '北' }];
      } else if (lastDir === 'S' || lastDir === 'N') {
        dirs = [{ dx: arrowLen, dy: 0, label: '东' }, { dx: -arrowLen, dy: 0, label: '西' }];
      }

      ctx.save();
      if (this.data.isBlinkOn) {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.9)'; // 红色高亮箭头
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
      } else {
        ctx.fillStyle = 'rgba(239, 68, 68, 0.4)';
        ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
      }
      
      ctx.lineWidth = 2;
      // 在 Canvas Transform 缩放下，文字不要被缩放那么小，我们反算一个字号
      var scale = this.data.scale || 1;
      var fontSize = 12 / scale;
      ctx.font = 'bold ' + fontSize + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      
      for (var i = 0; i < dirs.length; i++) {
        var d = dirs[i];
        
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + d.dx, y + d.dy);
        ctx.stroke();
        
        // 箭头头部
        var headLen = 6 / scale;
        var angle = Math.atan2(d.dy, d.dx);
        ctx.beginPath();
        ctx.moveTo(x + d.dx, y + d.dy);
        ctx.lineTo(x + d.dx - headLen * Math.cos(angle - Math.PI / 6), y + d.dy - headLen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(x + d.dx - headLen * Math.cos(angle + Math.PI / 6), y + d.dy - headLen * Math.sin(angle + Math.PI / 6));
        ctx.lineTo(x + d.dx, y + d.dy);
        ctx.fill();
        
        var textOffset = 16 / scale;
        ctx.fillText(d.label, x + d.dx + Math.cos(angle) * textOffset, y + d.dy + Math.sin(angle) * textOffset);
      }
      ctx.restore();
    },

    onStartRemeasure: function () {
      this.triggerEvent('startremeasure');
    },

    onFitToView: function () {
      this.fitToView();
    }
  }
});
