const app = getApp();
const surveyGraph = require('../../utils/surveyWallGraph.js');

const RESERVED_TOOLS = [
  { key: 'settings', label: '设置' },
  { key: 'reference', label: '参照' },
  { key: 'lock', label: '锁层' },
  { key: 'area', label: '面积' },
  { key: 'cad', label: 'CAD' },
  { key: 'more', label: '更多' }
];

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '退格'];
const TOUCH_SLOP_PX = 8;
const WALL_HIT_HALF_PX = 40;
const MIN_SCALE = 0.05;
const MAX_SCALE = 0.36;
const MAX_HISTORY = 40;
const MEASURE_LINE_TOP_PX = 40;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPx(value) {
  return Math.round(value * 10) / 10;
}

function formatMm(value) {
  return `${Math.round(value || 0)} mm`;
}

function normalizeAngleDiff(currentAngle, previousAngle) {
  const diff = Math.abs(((currentAngle - previousAngle + 540) % 360) - 180);
  return Math.round(diff);
}

function buildCoreTools(activeTool, thicknessMm) {
  return [
    { key: 'straight', label: '直线', helper: '正交吸附', enabled: true, active: activeTool === 'straight' },
    { key: 'diagonal', label: '斜线', helper: '自由角度', enabled: true, active: activeTool === 'diagonal' },
    { key: 'thickness', label: '墙厚', helper: formatMm(thicknessMm), enabled: true, active: false },
    { key: 'input', label: '输入', helper: '手输 mm', enabled: true, active: false },
    { key: 'reset', label: '重置', helper: '光标', enabled: true, active: false }
  ];
}

function distancePx(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function buildLineRange(startPx, endPx, fallbackWidth) {
  if (!isFinite(startPx) || !isFinite(endPx)) {
    return { left: 0, width: fallbackWidth };
  }

  return {
    left: Math.min(startPx, endPx),
    width: Math.abs(endPx - startPx)
  };
}

function getTouchPoint(touch) {
  return { x: touch.clientX, y: touch.clientY };
}

Page({
  data: {
    statusBarHeight: 0,
    navigationSafeTop: 0,
    bottomSafeArea: 0,
    leadId: '',
    title: '新版测绘体验',
    activeView: '2D',
    activeTool: 'straight',
    measurementSide: 'left',
    thicknessMm: 200,
    prototypeNotice: '体验版不会同步正式户型数据',
    coreTools: buildCoreTools('straight', 200),
    reservedTools: RESERVED_TOOLS,
    renderWalls: [],
    previewWall: null,
    cursorStyle: '',
    cursorHorizontalGuideStyle: '',
    cursorVerticalGuideStyle: '',
    cursorVisible: false,
    guideVisible: false,
    topMetricVisible: false,
    topMetricLength: '',
    topMetricAngle: '',
    measurePositionVisible: false,
    measurePositionStyle: '',
    measurePositionButtonLabel: '↓',
    closureGuideVisible: false,
    closureGuideStyle: '',
    closeActionVisible: false,
    closeActionStyle: '',
    measurementTitle: '准备测墙',
    measurementValue: '从橙色光标拖出墙体方向',
    closeHintVisible: false,
    closeHintText: '',
    closeHintActionVisible: false,
    selectedWall: null,
    spaceSummary: null,
    numberPadVisible: false,
    numberPadTitle: '输入长度',
    numberPadSubtitle: '单位：mm',
    numberInput: '',
    numberKeys: NUMBER_KEYS,
    historySummary: {
      undo: 0,
      redo: 0
    }
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const context = app.globalData.surveyingPrototypeContext || {};
    const screenHeight = sysInfo.screenHeight || sysInfo.windowHeight || 0;
    const safeAreaBottom = sysInfo.safeArea && screenHeight
      ? Math.max(0, screenHeight - sysInfo.safeArea.bottom)
      : 0;
    const capsuleBottom = menuButtonInfo.bottom || (sysInfo.statusBarHeight || 0);

    this.draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
    this.history = { undo: [], redo: [] };
    this.touchState = null;
    this.canvasRect = null;

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 0,
      navigationSafeTop: capsuleBottom + 6,
      bottomSafeArea: safeAreaBottom,
      leadId: options.leadId || context.leadId || '',
      title: context.leadName ? `${context.leadName} · 新版测绘` : '新版测绘体验'
    });
    this.syncFromDraft();
  },

  onReady() {
    this.refreshCanvasRect();
  },

  onShow() {
    this.refreshCanvasRect();
  },

  onUnload() {
    app.globalData.surveyingPrototypeContext = null;
  },

  refreshCanvasRect() {
    wx.createSelectorQuery()
      .in(this)
      .select('.grid-canvas')
      .boundingClientRect((rect) => {
        if (rect && rect.width && rect.height) {
          this.canvasRect = rect;
          this.syncFromDraft();
        }
      })
      .exec();
  },

  syncFromDraft(extraData) {
    if (!this.draft) return;

    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const selectedWall = this.buildSelectedWall(floor, session.selectedWallId);
    const stageMessage = this.buildStageMessage(floor, session, selectedWall);
    const renderData = this.buildCanvasRenderData(floor, session);

    this.setData(Object.assign({
      activeTool: session.mode,
      measurementSide: session.measurementSide,
      thicknessMm: session.thicknessMm,
      coreTools: buildCoreTools(session.mode, session.thicknessMm),
      renderWalls: renderData.renderWalls,
      previewWall: renderData.previewWall,
      cursorStyle: renderData.cursorStyle,
      cursorHorizontalGuideStyle: renderData.cursorHorizontalGuideStyle,
      cursorVerticalGuideStyle: renderData.cursorVerticalGuideStyle,
      cursorVisible: renderData.cursorVisible,
      guideVisible: renderData.guideVisible,
      topMetricVisible: renderData.topMetricVisible,
      topMetricLength: renderData.topMetricLength,
      topMetricAngle: renderData.topMetricAngle,
      measurePositionVisible: renderData.measurePositionVisible,
      measurePositionStyle: renderData.measurePositionStyle,
      measurePositionButtonLabel: renderData.measurePositionButtonLabel,
      closureGuideVisible: renderData.closureGuideVisible,
      closureGuideStyle: renderData.closureGuideStyle,
      closeActionVisible: renderData.closeActionVisible,
      closeActionStyle: renderData.closeActionStyle,
      closeHintVisible: renderData.closeHintVisible,
      closeHintText: renderData.closeHintText,
      closeHintActionVisible: session.state === 'closing',
      selectedWall,
      spaceSummary: this.buildSpaceSummary(),
      measurementTitle: stageMessage.title,
      measurementValue: stageMessage.value,
      historySummary: {
        undo: this.history.undo.length,
        redo: this.history.redo.length
      }
    }, extraData || {}));
  },

  buildCanvasRenderData(floor, session) {
    const renderWalls = floor.walls.map((wall, index) => this.buildWallRender(floor, wall, false, index));
    let previewWall = null;
    let cursorVisible = false;
    let guideVisible = false;
    let cursorStyle = '';
    let cursorHorizontalGuideStyle = '';
    let cursorVerticalGuideStyle = '';
    let closeHintVisible = false;
    let closeHintText = '';

    if (session.previewPoint) {
      previewWall = this.buildPreviewRender(floor, session);
      closeHintVisible = !!session.closeCandidateNodeId;
      closeHintText = closeHintVisible ? '预览端点已接近起点，确认长度后可闭合' : '';
    }

    if (session.state === 'closing') {
      closeHintVisible = true;
      closeHintText = '当前端点已接近起点，可闭合单空间';
    }

    if (session.anchorNodeId && session.state !== 'spaceClosed' && session.state !== 'wallSelected' && session.state !== 'remeasureAwaitingInput') {
      const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
      if (anchor) {
        const cursorPoint = session.previewPoint || anchor;
        const cursorScreenPoint = this.mmToCanvasPoint(cursorPoint);
        cursorVisible = true;
        cursorStyle = `left:${roundPx(cursorScreenPoint.x - 24)}px; top:${roundPx(cursorScreenPoint.y - 24)}px;`;

        if (floor.walls.length > 0) {
          const anchorScreenPoint = this.mmToCanvasPoint(anchor);
          guideVisible = true;
          cursorHorizontalGuideStyle = `top:${roundPx(anchorScreenPoint.y)}px;`;
          cursorVerticalGuideStyle = `left:${roundPx(anchorScreenPoint.x)}px;`;
        }
      }
    }

    const activeSegment = previewWall || renderWalls[renderWalls.length - 1] || null;
    const topMetric = this.buildTopMetric(activeSegment);
    const measurePosition = this.buildMeasurePosition(activeSegment, session);
    const closure = this.buildClosureRender(floor, session);

    return {
      renderWalls,
      previewWall,
      cursorVisible,
      guideVisible,
      cursorStyle,
      cursorHorizontalGuideStyle,
      cursorVerticalGuideStyle,
      topMetricVisible: topMetric.visible,
      topMetricLength: topMetric.length,
      topMetricAngle: topMetric.angle,
      measurePositionVisible: measurePosition.visible,
      measurePositionStyle: measurePosition.style,
      measurePositionButtonLabel: measurePosition.buttonLabel,
      closureGuideVisible: closure.guideVisible,
      closureGuideStyle: closure.guideStyle,
      closeActionVisible: closure.actionVisible,
      closeActionStyle: closure.actionStyle,
      closeHintVisible,
      closeHintText
    };
  },

  buildWallRender(floor, wall, isPreview, index) {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    if (!start || !end) return null;
    const previousWall = index > 0 ? floor.walls[index - 1] : null;
    const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
    return this.buildSegmentRender(start, end, wall, isPreview, previousWall, geometry);
  },

  buildPreviewRender(floor, session) {
    const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
    if (!anchor || !session.previewPoint) return null;
    const previousWall = floor.walls[floor.walls.length - 1] || null;
    const previewWall = {
      id: 'preview-wall',
      mode: session.mode,
      lengthMm: session.previewLengthMm,
      angleDeg: session.previewAngleDeg,
      thicknessMm: session.thicknessMm,
      measurementSide: session.measurementSide,
      status: 'preview'
    };
    const geometry = surveyGraph.buildWallRenderGeometry(floor, previewWall, {
      startPoint: anchor,
      endPoint: session.previewPoint,
      previousWall,
      nextWall: null
    });
    const render = this.buildSegmentRender(anchor, session.previewPoint, previewWall, true, previousWall, geometry);
    if (!render) return null;
    render.lineOnly = session.state === 'wallPreview';
    render.showDimension = !render.lineOnly;
    return render;
  },

  buildSegmentRender(start, end, wall, isPreview, previousWall, geometry) {
    const startPoint = this.mmToCanvasPoint(start);
    const endPoint = this.mmToCanvasPoint(end);
    const width = distancePx(startPoint, endPoint);
    const viewport = this.getViewport();
    const thicknessPx = Math.max(8, Math.round((wall.thicknessMm || 200) * viewport.scale));
    const bodyOffset = wall.measurementSide === 'left' ? MEASURE_LINE_TOP_PX - thicknessPx : MEASURE_LINE_TOP_PX;
    const bodyEdgeStart = Math.min(bodyOffset, MEASURE_LINE_TOP_PX);
    const outlineTop = wall.measurementSide === 'left' ? bodyOffset : MEASURE_LINE_TOP_PX + thicknessPx;
    const dimensionOffset = wall.measurementSide === 'left'
      ? MEASURE_LINE_TOP_PX + 28
      : MEASURE_LINE_TOP_PX - 72;
    const selected = !isPreview && this.draft && surveyGraph.getActiveFloor(this.draft).session.selectedWallId === wall.id;
    const relativeAngle = previousWall ? normalizeAngleDiff(wall.angleDeg, previousWall.angleDeg) : null;
    const outerStartPx = geometry ? geometry.outerStartAlongMm * viewport.scale : 0;
    const outerEndPx = geometry ? geometry.outerEndAlongMm * viewport.scale : width;
    const outerLine = buildLineRange(outerStartPx, outerEndPx, width);

    return {
      id: wall.id,
      startPoint,
      endPoint,
      width,
      angleDeg: wall.angleDeg,
      lengthMm: wall.lengthMm,
      relativeAngle,
      style: `left:${roundPx(startPoint.x)}px; top:${roundPx(startPoint.y - WALL_HIT_HALF_PX)}px; width:${roundPx(width)}px; transform:rotate(${wall.angleDeg}deg);`,
      bodyStyle: `left:0; width:${roundPx(width)}px; height:${thicknessPx}px; top:${roundPx(bodyOffset)}px;`,
      outerLineStyle: `left:${roundPx(outerLine.left)}px; width:${roundPx(outerLine.width)}px; top:${roundPx(outlineTop)}px;`,
      startCapVisible: geometry ? geometry.startOpen : !previousWall,
      endCapVisible: geometry ? geometry.endOpen : true,
      startCapStyle: `left:-1px; top:${roundPx(bodyEdgeStart)}px; height:${roundPx(thicknessPx)}px;`,
      endCapStyle: `left:${roundPx(width - 1)}px; top:${roundPx(bodyEdgeStart)}px; height:${roundPx(thicknessPx)}px;`,
      dimensionStyle: `top:${roundPx(dimensionOffset)}px;`,
      dimensionLabel: `${Math.round(wall.lengthMm || 0)}`,
      showDimension: true,
      label: this.formatWallLabel(wall),
      sideLabel: wall.measurementSide === 'left' ? '左侧' : '右侧',
      modeLabel: wall.mode === 'diagonal' ? '斜墙' : '直墙',
      selected,
      preview: isPreview
    };
  },

  buildTopMetric(segment) {
    if (!segment || !segment.lengthMm) {
      return { visible: false, length: '', angle: '' };
    }

    return {
      visible: true,
      length: `L ${Math.round(segment.lengthMm)}`,
      angle: segment.relativeAngle ? `∠ ${segment.relativeAngle}°` : ''
    };
  },

  buildMeasurePosition(segment, session) {
    if (!segment || segment.lineOnly || !segment.startPoint || !segment.endPoint) {
      return { visible: false, style: '', buttonLabel: '↓' };
    }

    const midX = (segment.startPoint.x + segment.endPoint.x) / 2;
    const midY = (segment.startPoint.y + segment.endPoint.y) / 2;
    return {
      visible: session.state !== 'spaceClosed' && session.state !== 'wallSelected' && session.state !== 'remeasureAwaitingInput',
      style: `left:${roundPx(midX - 70)}px; top:${roundPx(midY + 96)}px;`,
      buttonLabel: session.measurementSide === 'left' ? '↑' : '↓'
    };
  },

  buildClosureRender(floor, session) {
    if (!session.closeCandidateNodeId || (!session.previewPoint && !session.anchorNodeId)) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const targetNode = surveyGraph.getNode(floor, session.closeCandidateNodeId);
    let currentNode = null;
    if (session.previewPoint) {
      currentNode = session.previewPoint;
    } else if (session.anchorNodeId) {
      currentNode = surveyGraph.getNode(floor, session.anchorNodeId);
    }
    if (!targetNode || !currentNode) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const startPoint = this.mmToCanvasPoint(currentNode);
    const endPoint = this.mmToCanvasPoint(targetNode);
    const rawWidth = distancePx(startPoint, endPoint);
    const lastWall = floor.walls[floor.walls.length - 1] || null;
    const width = session.state === 'closing' ? Math.max(rawWidth, 72) : rawWidth;
    const angleDeg = rawWidth > 1
      ? Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x) * 180 / Math.PI
      : (lastWall ? lastWall.angleDeg : 0);
    const midX = (startPoint.x + endPoint.x) / 2;
    const midY = (startPoint.y + endPoint.y) / 2;

    return {
      guideVisible: width > 1,
      guideStyle: `left:${roundPx(startPoint.x)}px; top:${roundPx(startPoint.y)}px; width:${roundPx(width)}px; transform:rotate(${roundPx(angleDeg)}deg);`,
      actionVisible: session.state === 'closing',
      actionStyle: `left:${roundPx(midX - 34)}px; top:${roundPx(midY - 34)}px;`
    };
  },

  formatWallLabel(wall) {
    const lengthLabel = formatMm(wall.lengthMm);
    if (wall.mode === 'diagonal') {
      return `${lengthLabel} · ${Math.round(wall.angleDeg)}°`;
    }
    return lengthLabel;
  },

  buildSelectedWall(floor, wallId) {
    if (!wallId) return null;
    const wall = surveyGraph.getWall(floor, wallId);
    if (!wall) return null;

    return {
      id: wall.id,
      length: formatMm(wall.lengthMm),
      angle: `${Math.round(wall.angleDeg)}°`,
      thickness: formatMm(wall.thicknessMm),
      side: wall.measurementSide === 'left' ? '左侧' : '右侧',
      mode: wall.mode === 'diagonal' ? '斜墙' : '直墙'
    };
  },

  buildSpaceSummary() {
    const areaMm2 = surveyGraph.calculateSpaceAreaMm2(this.draft);
    if (!areaMm2) return null;
    return {
      area: `${(areaMm2 / 1000000).toFixed(2)} m²`,
      label: '单空间已闭合'
    };
  },

  buildStageMessage(floor, session, selectedWall) {
    if (session.state === 'idle') {
      return { title: '准备测墙', value: '重置光标后，从橙色光标拖出墙体方向' };
    }
    if (session.state === 'cursorPlaced') {
      return { title: '光标已放置', value: '从光标拖出墙体方向' };
    }
    if (session.state === 'wallPreview') {
      return { title: '当前墙段', value: '释放后输入毫米长度' };
    }
    if (session.state === 'awaitingLength') {
      return { title: '等待长度', value: `点击“输入”并录入 ${formatMm(session.previewLengthMm)} 附近的实测值` };
    }
    if (session.state === 'wallCommitted') {
      return { title: '墙体已确认', value: '继续从光标拖出下一面墙' };
    }
    if (session.state === 'closing') {
      return { title: '可闭合空间', value: '端点已接近起点，确认后吸附闭合' };
    }
    if (session.state === 'spaceClosed') {
      return { title: '单空间已闭合', value: '点击墙体可复尺、改墙侧或墙厚' };
    }
    if (session.state === 'wallSelected' && selectedWall) {
      return { title: '已选墙体', value: `${selectedWall.length} · ${selectedWall.side} · ${selectedWall.thickness}` };
    }
    if (session.state === 'remeasureAwaitingInput' && selectedWall) {
      return { title: '复尺中', value: `请输入 ${selectedWall.mode} 的新毫米长度` };
    }
    return { title: '测绘原型', value: `${floor.walls.length} 面墙` };
  },

  getViewport() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    return floor.viewport || { scale: surveyGraph.DEFAULT_SCALE, offsetX: 0, offsetY: 0 };
  },

  mmToCanvasPoint(point) {
    const rect = this.canvasRect || { width: 0, height: 0 };
    const viewport = this.getViewport();
    return {
      x: rect.width / 2 + viewport.offsetX + point.xMm * viewport.scale,
      y: rect.height / 2 + viewport.offsetY + point.yMm * viewport.scale
    };
  },

  canvasPointToMm(point) {
    const rect = this.canvasRect || { left: 0, top: 0, width: 0, height: 0 };
    const viewport = this.getViewport();
    return {
      xMm: Math.round((point.x - rect.left - rect.width / 2 - viewport.offsetX) / viewport.scale),
      yMm: Math.round((point.y - rect.top - rect.height / 2 - viewport.offsetY) / viewport.scale)
    };
  },

  isCursorTouchTarget(e) {
    const dataset = e && e.target && e.target.dataset;
    if (!dataset) return false;
    return dataset.cursorHit === true || dataset.cursorHit === 'true';
  },

  applyDraft(nextDraft, options) {
    const opts = options || {};
    if (opts.recordHistory) {
      this.history.undo.push(surveyGraph.cloneDraft(this.draft));
      if (this.history.undo.length > MAX_HISTORY) {
        this.history.undo.shift();
      }
      this.history.redo = [];
    }
    this.draft = nextDraft;
    this.syncFromDraft(opts.extraData);
  },

  onBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({ url: '/pages/index/index' });
      }
    });
  },

  onViewTap(e) {
    const view = e.currentTarget.dataset.view;
    if (view === '2D') {
      this.setData({ activeView: view });
      return;
    }

    this.showPlannedToast();
  },

  onToolTap(e) {
    const tool = e.currentTarget.dataset.tool;

    if (tool === 'straight' || tool === 'diagonal') {
      this.draft = surveyGraph.setMode(this.draft, tool);
      this.syncFromDraft();
      return;
    }

    if (tool === 'thickness') {
      this.openNumberPad('thickness');
      return;
    }

    if (tool === 'input') {
      this.openLengthPad();
      return;
    }

    if (tool === 'reset') {
      this.draft = surveyGraph.resetCursor(this.draft);
      this.syncFromDraft();
      wx.showToast({ title: '光标已重置', icon: 'none' });
    }
  },

  onToggleSide() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const nextSide = session.measurementSide === 'right' ? 'left' : 'right';
    const selectedWallId = session.selectedWallId;
    const nextDraft = surveyGraph.setMeasurementSide(this.draft, nextSide, selectedWallId);
    this.applyDraft(nextDraft, {
      recordHistory: !!selectedWallId,
      extraData: { numberPadVisible: this.data.numberPadVisible }
    });
    wx.showToast({ title: selectedWallId ? '墙侧已更新' : '后续墙侧已切换', icon: 'none' });
  },

  onDisabledTap() {
    this.showPlannedToast();
  },

  onBottomAction(e) {
    const action = e.currentTarget.dataset.action;

    if (action === 'manual') {
      this.openLengthPad();
      return;
    }

    if (action === 'cursor') {
      this.draft = surveyGraph.resetCursor(this.draft);
      this.syncFromDraft();
      wx.showToast({ title: '光标已重置', icon: 'none' });
      return;
    }

    const labels = {
      bluetooth: '蓝牙测距将在 Phase 3 开放',
      add: '构件和素材后续开放'
    };

    wx.showToast({ title: labels[action] || '功能规划中', icon: 'none' });
  },

  onCanvasTouchStart(e) {
    if (this.data.numberPadVisible || !this.canvasRect) return;
    const touches = e.touches || [];

    if (touches.length >= 2) {
      const first = getTouchPoint(touches[0]);
      const second = getTouchPoint(touches[1]);
      const viewport = this.getViewport();
      this.touchState = {
        mode: 'pinch',
        startDistance: distancePx(first, second),
        startScale: viewport.scale
      };
      return;
    }

    if (!touches.length) return;

    const point = getTouchPoint(touches[0]);
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const nearCursor = this.isCursorTouchTarget(e);
    const viewport = this.getViewport();

    this.touchState = {
      mode: 'pending',
      startPoint: point,
      lastPoint: point,
      nearCursor,
      sessionState: session.state,
      startViewport: {
        scale: viewport.scale,
        offsetX: viewport.offsetX,
        offsetY: viewport.offsetY
      }
    };
  },

  onCanvasTouchMove(e) {
    if (!this.touchState || !this.canvasRect) return;
    const touches = e.touches || [];

    if (this.touchState.mode === 'pinch' && touches.length >= 2) {
      const first = getTouchPoint(touches[0]);
      const second = getTouchPoint(touches[1]);
      const nextDistance = distancePx(first, second);
      if (!this.touchState.startDistance) return;
      const scale = clamp(this.touchState.startScale * (nextDistance / this.touchState.startDistance), MIN_SCALE, MAX_SCALE);
      this.draft = surveyGraph.updateViewport(this.draft, { scale });
      this.syncFromDraft();
      return;
    }

    if (!touches.length) return;

    const point = getTouchPoint(touches[0]);
    const dx = point.x - this.touchState.startPoint.x;
    const dy = point.y - this.touchState.startPoint.y;
    const moved = Math.sqrt(dx * dx + dy * dy);
    const currentMm = this.canvasPointToMm(point);

    if (this.touchState.mode === 'pending') {
      if (moved < TOUCH_SLOP_PX) return;

      if (this.touchState.nearCursor && (this.touchState.sessionState === 'cursorPlaced' || this.touchState.sessionState === 'wallCommitted')) {
        this.draft = surveyGraph.startPreview(this.draft, currentMm);
        this.touchState.mode = 'wall';
      } else {
        this.touchState.mode = 'pan';
      }
    }

    if (this.touchState.mode === 'wall') {
      this.draft = surveyGraph.startPreview(this.draft, currentMm);
      this.syncFromDraft();
      return;
    }

    if (this.touchState.mode === 'pan') {
      const startViewport = this.touchState.startViewport;
      this.draft = surveyGraph.updateViewport(this.draft, {
        offsetX: startViewport.offsetX + dx,
        offsetY: startViewport.offsetY + dy
      });
      this.syncFromDraft();
    }
  },

  onCanvasTouchEnd() {
    if (!this.touchState) return;

    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const movedWall = this.touchState.mode === 'wall';

    this.touchState = null;

    if (movedWall) {
      if (session.previewLengthMm >= surveyGraph.MIN_WALL_LENGTH_MM) {
        this.draft = surveyGraph.holdPreviewForInput(this.draft);
        this.syncFromDraft();
      } else {
        this.draft = surveyGraph.cancelPending(this.draft);
        this.syncFromDraft();
      }
      return;
    }
  },

  onWallTap(e) {
    const wallId = e.currentTarget.dataset.id;
    this.draft = surveyGraph.selectWall(this.draft, wallId);
    this.syncFromDraft({ numberPadVisible: false });
  },

  onExitWallSelection() {
    this.draft = surveyGraph.cancelPending(this.draft);
    this.syncFromDraft();
  },

  onStartRemeasure() {
    this.draft = surveyGraph.startRemeasure(this.draft);
    this.syncFromDraft();
    this.openNumberPad('length');
  },

  onConfirmClose() {
    const session = surveyGraph.getActiveFloor(this.draft).session;
    if (session.state !== 'closing') return;

    try {
      const nextDraft = surveyGraph.confirmClosure(this.draft);
      this.applyDraft(nextDraft, { recordHistory: true });
      wx.showToast({ title: '单空间已闭合', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '闭合失败，请重新测量', icon: 'none' });
    }
  },

  onUndo() {
    if (!this.history.undo.length) return;
    this.history.redo.push(surveyGraph.cloneDraft(this.draft));
    this.draft = this.history.undo.pop();
    this.syncFromDraft({ numberPadVisible: false });
  },

  onRedo() {
    if (!this.history.redo.length) return;
    this.history.undo.push(surveyGraph.cloneDraft(this.draft));
    this.draft = this.history.redo.pop();
    this.syncFromDraft({ numberPadVisible: false });
  },

  openLengthPad() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    let inputValue = '';

    if (session.state === 'wallPreview') {
      this.draft = surveyGraph.holdPreviewForInput(this.draft);
      inputValue = session.previewLengthMm ? String(session.previewLengthMm) : '';
    } else if (session.state === 'awaitingLength') {
      inputValue = session.previewLengthMm ? String(session.previewLengthMm) : '';
    } else if (session.state === 'wallSelected') {
      this.draft = surveyGraph.startRemeasure(this.draft);
      const wall = surveyGraph.getWall(floor, session.selectedWallId);
      inputValue = wall ? String(wall.lengthMm) : '';
    } else if (session.state === 'remeasureAwaitingInput') {
      const wall = surveyGraph.getWall(floor, session.selectedWallId);
      inputValue = wall ? String(wall.lengthMm) : '';
    } else {
      wx.showToast({ title: '请先拖出待测墙体或选择墙复尺', icon: 'none' });
      return;
    }

    this.numberPadMode = 'length';
    this.syncFromDraft({
      numberPadVisible: true,
      numberPadTitle: session.state === 'wallSelected' || session.state === 'remeasureAwaitingInput' ? '输入复尺长度' : '输入当前墙长',
      numberPadSubtitle: '单位：mm，确认后落图',
      numberInput: inputValue
    });
  },

  openNumberPad(mode) {
    if (mode === 'length') {
      this.openLengthPad();
      return;
    }

    if (mode === 'thickness') {
      const floor = surveyGraph.getActiveFloor(this.draft);
      const session = floor.session;
      const selectedWall = surveyGraph.getWall(floor, session.selectedWallId);
      this.setData({
        numberPadVisible: true,
        numberPadTitle: selectedWall ? '修改当前墙厚' : '设置后续墙厚',
        numberPadSubtitle: '单位：mm，不改变红线长度',
        numberInput: String(selectedWall ? selectedWall.thicknessMm : session.thicknessMm)
      });
      this.numberPadMode = 'thickness';
      return;
    }
  },

  onNumberKey(e) {
    const key = e.currentTarget.dataset.key;
    let value = this.data.numberInput || '';

    if (key === '清空') {
      value = '';
    } else if (key === '退格') {
      value = value.slice(0, -1);
    } else if (/^\d$/.test(key)) {
      value = value === '0' ? key : `${value}${key}`;
    }

    this.setData({ numberInput: value });
  },

  onNumberConfirm() {
    const value = parseInt(this.data.numberInput, 10);
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;

    try {
      if (this.numberPadMode === 'thickness') {
        const selectedWallId = session.selectedWallId;
        const nextDraft = surveyGraph.setThickness(this.draft, value, selectedWallId);
        this.numberPadMode = '';
        this.applyDraft(nextDraft, {
          recordHistory: !!selectedWallId,
          extraData: { numberPadVisible: false, numberInput: '' }
        });
        wx.showToast({ title: selectedWallId ? '墙厚已更新' : '后续墙厚已设置', icon: 'none' });
        return;
      }

      if (session.state === 'awaitingLength' || session.state === 'wallPreview') {
        const nextDraft = surveyGraph.commitPreviewLength(this.draft, value, 'manual');
        const nextSession = surveyGraph.getActiveFloor(nextDraft).session;
        this.applyDraft(nextDraft, {
          recordHistory: true,
          extraData: { numberPadVisible: false, numberInput: '' }
        });
        wx.showToast({
          title: nextSession.state === 'closing' ? '接近起点，可闭合' : '墙体已确认',
          icon: 'none'
        });
        return;
      }

      if (session.state === 'remeasureAwaitingInput') {
        const wasClosed = floor.spaces.some((space) => space.closed);
        const nextDraft = surveyGraph.remeasureSelectedWall(this.draft, value, 'manual');
        this.applyDraft(nextDraft, {
          recordHistory: true,
          extraData: { numberPadVisible: false, numberInput: '' }
        });
        wx.showToast({ title: wasClosed ? '已联动相邻墙' : '复尺已更新', icon: 'none' });
        return;
      }

      wx.showToast({ title: '当前没有可输入的墙体', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '输入无效', icon: 'none' });
    }
  },

  onNumberClose() {
    this.numberPadMode = '';
    this.setData({ numberPadVisible: false, numberInput: '' });
  },

  showPlannedToast() {
    wx.showToast({ title: '该功能暂未开放', icon: 'none' });
  }
});
