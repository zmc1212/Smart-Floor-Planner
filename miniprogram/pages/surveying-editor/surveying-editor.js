const app = getApp();
const surveyGraph = require('../../utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../../utils/surveyCanvasRenderer.js');

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
const WALL_VISUAL_SCALE = 0.56;
const MIN_WALL_THICKNESS_PX = 10;
const MAX_WALL_THICKNESS_PX = 22;
const DIMENSION_LINE_CENTER_PX = 16;
const DIMENSION_LABEL_HEIGHT_PX = 24;
const DIMENSION_COLLISION_GAP_PX = 8;
const DIMENSION_PRIMARY_GAP_PX = 22;
const DIMENSION_OUTER_GAP_PX = 12;
const REDLINE_JOIN_TRIM_PX = 0;
const REDLINE_THICKNESS_PX = 3;
const REDLINE_OVERLAP_TOLERANCE_PX = 6;

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

function boxesOverlap(first, second, padding) {
  const gap = padding || 0;
  return !(
    first.right + gap < second.left ||
    first.left - gap > second.right ||
    first.bottom + gap < second.top ||
    first.top - gap > second.bottom
  );
}

function dimensionCollides(option, acceptedOption) {
  const angleDiff = normalizeAngleDiff(option.angleDeg, acceptedOption.angleDeg);
  const useBandBox = angleDiff <= 20 || angleDiff >= 160;
  const currentBox = useBandBox ? option.collisionBox : option.labelBox;
  const acceptedBox = useBandBox ? acceptedOption.collisionBox : acceptedOption.labelBox;
  return boxesOverlap(currentBox, acceptedBox, DIMENSION_COLLISION_GAP_PX);
}

function canvasPointLineDistance(point, start, direction) {
  return Math.abs((point.x - start.x) * direction.y - (point.y - start.y) * direction.x);
}

function getCanvasSegmentOverlapInterval(current, existing) {
  const length = current.width || distancePx(current.startPoint, current.endPoint);
  if (!length) return null;

  const direction = {
    x: (current.endPoint.x - current.startPoint.x) / length,
    y: (current.endPoint.y - current.startPoint.y) / length
  };

  if (
    canvasPointLineDistance(existing.startPoint, current.startPoint, direction) > REDLINE_OVERLAP_TOLERANCE_PX ||
    canvasPointLineDistance(existing.endPoint, current.startPoint, direction) > REDLINE_OVERLAP_TOLERANCE_PX
  ) {
    return null;
  }

  const existingStartAlong = (existing.startPoint.x - current.startPoint.x) * direction.x +
    (existing.startPoint.y - current.startPoint.y) * direction.y;
  const existingEndAlong = (existing.endPoint.x - current.startPoint.x) * direction.x +
    (existing.endPoint.y - current.startPoint.y) * direction.y;
  const overlapStart = Math.max(0, Math.min(existingStartAlong, existingEndAlong));
  const overlapEnd = Math.min(length, Math.max(existingStartAlong, existingEndAlong));
  if (overlapEnd - overlapStart <= 1) return null;
  return { start: overlapStart, end: overlapEnd };
}

function subtractInterval(intervals, cut) {
  if (!cut) return intervals;
  const result = [];
  intervals.forEach((interval) => {
    if (cut.end <= interval.start || cut.start >= interval.end) {
      result.push(interval);
      return;
    }
    if (cut.start > interval.start) {
      result.push({ start: interval.start, end: Math.min(cut.start, interval.end) });
    }
    if (cut.end < interval.end) {
      result.push({ start: Math.max(cut.end, interval.start), end: interval.end });
    }
  });
  return result.filter((interval) => interval.end - interval.start > 1);
}

function getTouchPoint(touch, rect) {
  if (!touch) return { x: 0, y: 0 };
  if (Number.isFinite(touch.clientX) && Number.isFinite(touch.clientY)) {
    return { x: touch.clientX, y: touch.clientY };
  }
  if (Number.isFinite(touch.pageX) && Number.isFinite(touch.pageY)) {
    return { x: touch.pageX, y: touch.pageY };
  }
  if (rect && Number.isFinite(touch.x) && Number.isFinite(touch.y)) {
    return { x: rect.left + touch.x, y: rect.top + touch.y };
  }
  return { x: Number(touch.x) || 0, y: Number(touch.y) || 0 };
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
    canvasWidth: 0,
    canvasHeight: 0,
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
    this.surveyCanvas = null;
    this.surveyCtx = null;
    this.surveyCanvasDpr = sysInfo.pixelRatio || 1;
    this.surveyRenderScene = null;
    this.canvasControls = {};

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
          this.setData({
            canvasWidth: rect.width,
            canvasHeight: rect.height
          }, () => {
            this.initSurveyCanvas();
            this.syncFromDraft();
          });
        }
      })
      .exec();
  },

  initSurveyCanvas() {
    if (!this.canvasRect || !this.canvasRect.width || !this.canvasRect.height) return;

    wx.createSelectorQuery()
      .in(this)
      .select('#survey-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        const target = res && res[0];
        const canvas = target && target.node;
        if (!canvas) return;

        let dpr = this.surveyCanvasDpr || 1;
        try {
          dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
        } catch (err) {
          dpr = this.surveyCanvasDpr || 1;
        }

        const width = this.canvasRect.width || target.width || 0;
        const height = this.canvasRect.height || target.height || 0;
        if (!width || !height) return;

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        this.surveyCanvas = canvas;
        this.surveyCtx = canvas.getContext('2d');
        this.surveyCanvasDpr = dpr || 1;
        this.drawSurveyCanvas();
      });
  },

  drawSurveyCanvas() {
    if (!this.surveyCtx || !this.surveyRenderScene) return;
    surveyCanvasRenderer.drawSurveyScene(this.surveyCtx, this.surveyRenderScene, {
      dpr: this.surveyCanvasDpr || 1
    });
    this.drawCanvasControls();
  },

  drawRoundRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  },

  drawCanvasControls() {
    const ctx = this.surveyCtx;
    const rect = this.canvasRect;
    if (!ctx || !rect || !rect.width || !rect.height) return;

    const dpr = this.surveyCanvasDpr || 1;
    const controls = this.canvasControls || {};
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (controls.closeAction) {
      const close = controls.closeAction;
      ctx.beginPath();
      ctx.fillStyle = '#f07a21';
      ctx.arc(close.cx, close.cy, close.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('合', close.cx, close.cy + 1);
    }

    if (controls.measurePosition) {
      const measure = controls.measurePosition;
      ctx.shadowColor = 'rgba(15, 23, 42, 0.16)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      this.drawRoundRect(ctx, measure.tip.x, measure.tip.y, measure.tip.width, measure.tip.height, 18);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = '#111827';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('当前测量位置', measure.tip.x + measure.tip.width / 2, measure.tip.y + measure.tip.height / 2);

      ctx.beginPath();
      ctx.fillStyle = 'rgba(65, 65, 69, 0.92)';
      ctx.arc(measure.button.cx, measure.button.cy, measure.button.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      this.drawRoundRect(ctx, measure.button.cx - 17, measure.button.cy - 10, 34, 6, 3);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(measure.label, measure.button.cx, measure.button.cy + 13);
    }

    if (controls.undoRedo) {
      ['undo', 'redo'].forEach((key) => {
        const button = controls.undoRedo[key];
        const enabled = button.count > 0;
        ctx.beginPath();
        ctx.fillStyle = enabled ? 'rgba(255, 255, 255, 0.94)' : 'rgba(255, 255, 255, 0.72)';
        ctx.arc(button.cx, button.cy, button.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = enabled ? '#4b5563' : '#9ca3af';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(button.label, button.cx, button.cy - 7);
        ctx.fillStyle = enabled ? '#17a14c' : '#9ca3af';
        ctx.font = 'bold 11px sans-serif';
        ctx.fillText(String(button.count), button.cx, button.cy + 10);
      });
    }

    ctx.restore();
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
    }, extraData || {}), () => {
      this.drawSurveyCanvas();
    });
  },

  buildCanvasRenderData(floor, session) {
    const scene = surveyCanvasRenderer.createSurveyRenderScene({
      floor,
      session,
      viewport: this.getViewport(),
      rect: this.canvasRect || { width: 0, height: 0 }
    });
    this.surveyRenderScene = scene;
    let cursorVisible = false;
    let guideVisible = false;
    let cursorStyle = '';
    let cursorHorizontalGuideStyle = '';
    let cursorVerticalGuideStyle = '';
    let closeHintVisible = false;
    let closeHintText = '';

    if (session.previewPoint) {
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

    const activeSegment = scene.activeSegment;
    const topMetric = this.buildTopMetric(activeSegment);
    const measurePosition = this.buildMeasurePosition(activeSegment, floor, session);
    const closure = this.buildClosureRender(floor, session);
    this.canvasControls = this.buildCanvasControls(measurePosition, closure);

    return {
      cursorVisible,
      guideVisible: false,
      cursorStyle,
      cursorHorizontalGuideStyle,
      cursorVerticalGuideStyle,
      topMetricVisible: topMetric.visible,
      topMetricLength: topMetric.length,
      topMetricAngle: topMetric.angle,
      measurePositionVisible: measurePosition.visible,
      measurePositionStyle: measurePosition.style,
      measurePositionButtonLabel: measurePosition.buttonLabel,
      closureGuideVisible: false,
      closureGuideStyle: '',
      closeActionVisible: closure.actionVisible,
      closeActionStyle: closure.actionStyle,
      closeHintVisible,
      closeHintText
    };
  },

  buildCanvasControls(measurePosition, closure) {
    const rect = this.canvasRect || { width: 0, height: 0 };
    const buttonSize = 46;
    const right = 16;
    const bottom = 16;
    const gap = 8;
    const redo = {
      key: 'redo',
      label: '重做',
      count: this.history.redo.length,
      cx: rect.width - right - buttonSize / 2,
      cy: rect.height - bottom - buttonSize / 2,
      radius: buttonSize / 2
    };
    const undo = {
      key: 'undo',
      label: '撤销',
      count: this.history.undo.length,
      cx: redo.cx,
      cy: redo.cy - buttonSize - gap,
      radius: buttonSize / 2
    };

    return {
      closeAction: closure && closure.action
        ? Object.assign({ key: 'close', radius: 34 }, closure.action)
        : null,
      measurePosition: measurePosition && measurePosition.control ? measurePosition.control : null,
      undoRedo: { undo, redo }
    };
  },

  buildRenderThicknessMmMap(floor) {
    const viewport = this.getViewport();
    const scale = viewport.scale || surveyGraph.DEFAULT_SCALE;
    const thicknessMap = {};
    floor.walls.forEach((wall) => {
      thicknessMap[wall.id] = this.getVisualThicknessPx(wall.thicknessMm) / scale;
    });
    return thicknessMap;
  },

  getVisualThicknessPx(thicknessMm) {
    const viewport = this.getViewport();
    const scale = viewport.scale || surveyGraph.DEFAULT_SCALE;
    const rawThickness = (thicknessMm || 200) * scale * WALL_VISUAL_SCALE;
    return Math.round(clamp(rawThickness, MIN_WALL_THICKNESS_PX, MAX_WALL_THICKNESS_PX));
  },

  getRenderThicknessMm(thicknessMm) {
    const viewport = this.getViewport();
    const scale = viewport.scale || surveyGraph.DEFAULT_SCALE;
    return this.getVisualThicknessPx(thicknessMm) / scale;
  },

  buildWallJoinFills(floor, renderThicknessMmMap) {
    return surveyGraph.buildWallJoinRenderGeometries(floor, { renderThicknessMmMap })
      .map((join) => {
        const points = join.points.map((point) => this.mmToCanvasPoint(point));
        const xs = points.map((point) => point.x);
        const ys = points.map((point) => point.y);
        const left = Math.min.apply(null, xs);
        const right = Math.max.apply(null, xs);
        const top = Math.min.apply(null, ys);
        const bottom = Math.max.apply(null, ys);

        return {
          id: join.id,
          style: `left:${roundPx(left)}px; top:${roundPx(top)}px; width:${roundPx(Math.max(1, right - left))}px; height:${roundPx(Math.max(1, bottom - top))}px;`
        };
      });
  },

  buildRedlineJoinFills(floor) {
    return surveyGraph.buildWallJoinRenderGeometries(floor)
      .map((join) => {
        const point = this.mmToCanvasPoint(join.joint);
        return {
          id: join.id,
          style: `left:${roundPx(point.x - REDLINE_THICKNESS_PX / 2)}px; top:${roundPx(point.y - REDLINE_THICKNESS_PX / 2)}px; width:${REDLINE_THICKNESS_PX}px; height:${REDLINE_THICKNESS_PX}px;`
        };
      });
  },

  buildWallRender(floor, wall, isPreview, index, renderThicknessMmMap) {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    if (!start || !end) return null;
    const previousWall = index > 0 ? floor.walls[index - 1] : null;
    const geometry = surveyGraph.buildWallRenderGeometry(floor, wall, { renderThicknessMmMap });
    return this.buildSegmentRender(start, end, wall, isPreview, previousWall, geometry);
  },

  buildPreviewRender(floor, session, renderThicknessMmMap) {
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
    const previewThicknessMap = Object.assign({}, renderThicknessMmMap, {
      [previewWall.id]: this.getRenderThicknessMm(previewWall.thicknessMm)
    });
    const geometry = surveyGraph.buildWallRenderGeometry(floor, previewWall, {
      startPoint: anchor,
      endPoint: session.previewPoint,
      previousWall,
      nextWall: null,
      renderThicknessMmMap: previewThicknessMap
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
    const thicknessPx = geometry
      ? Math.round(geometry.thicknessMm * viewport.scale)
      : this.getVisualThicknessPx(wall.thicknessMm);
    const bodyOffset = wall.measurementSide === 'left' ? MEASURE_LINE_TOP_PX - thicknessPx : MEASURE_LINE_TOP_PX;
    const bodyEdgeStart = Math.min(bodyOffset, MEASURE_LINE_TOP_PX);
    const outlineTop = wall.measurementSide === 'left' ? bodyOffset : MEASURE_LINE_TOP_PX + thicknessPx;
    const selected = !isPreview && this.draft && surveyGraph.getActiveFloor(this.draft).session.selectedWallId === wall.id;
    const relativeAngle = previousWall ? normalizeAngleDiff(wall.angleDeg, previousWall.angleDeg) : null;
    const outerStartPx = geometry ? geometry.outerStartAlongMm * viewport.scale : 0;
    const outerEndPx = geometry ? geometry.outerEndAlongMm * viewport.scale : width;
    const outerLine = buildLineRange(outerStartPx, outerEndPx, width);
    const bodyLeft = Math.min(0, outerStartPx, outerEndPx);
    const bodyRight = Math.max(width, outerStartPx, outerEndPx);
    const bodyLine = {
      left: bodyLeft,
      width: Math.max(1, bodyRight - bodyLeft)
    };

    return {
      id: wall.id,
      startPoint,
      endPoint,
      width,
      angleDeg: wall.angleDeg,
      lengthMm: wall.lengthMm,
      relativeAngle,
      measurementSide: wall.measurementSide,
      style: `left:${roundPx(startPoint.x)}px; top:${roundPx(startPoint.y - WALL_HIT_HALF_PX)}px; width:${roundPx(width)}px; transform:rotate(${wall.angleDeg}deg);`,
      bodyStyle: `left:${roundPx(bodyLine.left)}px; width:${roundPx(bodyLine.width)}px; height:${thicknessPx}px; top:${roundPx(bodyOffset)}px;`,
      outerLineStyle: `left:${roundPx(outerLine.left)}px; width:${roundPx(outerLine.width)}px; top:${roundPx(outlineTop)}px;`,
      startCapVisible: geometry ? geometry.startOpen : !previousWall,
      endCapVisible: geometry ? geometry.endOpen : true,
      startCapStyle: `left:${roundPx(bodyLine.left - 1)}px; top:${roundPx(bodyEdgeStart)}px; height:${roundPx(thicknessPx)}px;`,
      endCapStyle: `left:${roundPx(bodyLine.left + bodyLine.width - 1)}px; top:${roundPx(bodyEdgeStart)}px; height:${roundPx(thicknessPx)}px;`,
      dimensionOptions: this.buildDimensionOptions(startPoint, width, wall.angleDeg, wall, thicknessPx),
      dimensionLabel: `${Math.round(wall.lengthMm || 0)}`,
      showDimension: true,
      redlineVisible: true,
      redlineStartInsetPx: geometry && geometry.startJoined ? REDLINE_JOIN_TRIM_PX : 0,
      redlineEndInsetPx: geometry && geometry.endJoined ? REDLINE_JOIN_TRIM_PX : 0,
      redlineParts: [],
      label: this.formatWallLabel(wall),
      sideLabel: wall.measurementSide === 'left' ? '左侧' : '右侧',
      modeLabel: wall.mode === 'diagonal' ? '斜墙' : '直墙',
      selected,
      preview: isPreview
    };
  },

  buildDimensionOptions(startPoint, width, angleDeg, wall, thicknessPx) {
    const primaryCenter = wall.measurementSide === 'left'
      ? MEASURE_LINE_TOP_PX + DIMENSION_PRIMARY_GAP_PX
      : MEASURE_LINE_TOP_PX - DIMENSION_PRIMARY_GAP_PX;
    const fallbackCenter = wall.measurementSide === 'left'
      ? MEASURE_LINE_TOP_PX - thicknessPx - DIMENSION_OUTER_GAP_PX
      : MEASURE_LINE_TOP_PX + thicknessPx + DIMENSION_OUTER_GAP_PX;

    return [primaryCenter, fallbackCenter].map((lineCenter) => {
      const dimensionOffset = lineCenter - DIMENSION_LINE_CENTER_PX;
      return {
        style: `top:${roundPx(dimensionOffset)}px;`,
        angleDeg,
        labelBox: this.buildDimensionLabelBox(startPoint, width, angleDeg, dimensionOffset, wall.lengthMm),
        collisionBox: this.buildDimensionBandBox(startPoint, width, angleDeg, dimensionOffset)
      };
    });
  },

  buildDimensionLabelBox(startPoint, width, angleDeg, dimensionOffset, lengthMm) {
    const angleRad = angleDeg * Math.PI / 180;
    const localY = dimensionOffset + DIMENSION_LINE_CENTER_PX - WALL_HIT_HALF_PX;
    const centerX = startPoint.x + Math.cos(angleRad) * (width / 2) - Math.sin(angleRad) * localY;
    const centerY = startPoint.y + Math.sin(angleRad) * (width / 2) + Math.cos(angleRad) * localY;
    const label = `${Math.round(lengthMm || 0)}`;
    const labelWidth = Math.max(34, label.length * 9 + 20);
    const labelHeight = DIMENSION_LABEL_HEIGHT_PX;
    const vertical = Math.abs(Math.sin(angleRad)) > 0.7;
    const boxWidth = vertical ? labelHeight : labelWidth;
    const boxHeight = vertical ? labelWidth : labelHeight;

    return {
      left: centerX - boxWidth / 2,
      right: centerX + boxWidth / 2,
      top: centerY - boxHeight / 2,
      bottom: centerY + boxHeight / 2
    };
  },

  buildDimensionBandBox(startPoint, width, angleDeg, dimensionOffset) {
    const angleRad = angleDeg * Math.PI / 180;
    const localTop = dimensionOffset - WALL_HIT_HALF_PX;
    const localBottom = localTop + DIMENSION_LINE_CENTER_PX * 2;
    const corners = [
      { x: 0, y: localTop },
      { x: width, y: localTop },
      { x: width, y: localBottom },
      { x: 0, y: localBottom }
    ].map((point) => ({
      x: startPoint.x + Math.cos(angleRad) * point.x - Math.sin(angleRad) * point.y,
      y: startPoint.y + Math.sin(angleRad) * point.x + Math.cos(angleRad) * point.y
    }));
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);

    return {
      left: Math.min.apply(null, xs),
      right: Math.max.apply(null, xs),
      top: Math.min.apply(null, ys),
      bottom: Math.max.apply(null, ys)
    };
  },

  resolveDimensionVisibility(renderWalls, previewWall) {
    const candidates = [];

    renderWalls.forEach((wall, index) => {
      wall.showDimension = true;
      if (!wall.dimensionOptions || !wall.dimensionOptions.length) return;
      candidates.push({
        wall,
        priority: (wall.selected ? 900 : 0) + (index === renderWalls.length - 1 ? 500 : 0) + (index === 0 ? 250 : 0) + index
      });
    });

    if (previewWall && previewWall.showDimension && previewWall.dimensionOptions && previewWall.dimensionOptions.length) {
      candidates.push({ wall: previewWall, priority: 1000 });
    }

    candidates.sort((first, second) => second.priority - first.priority);
    const accepted = [];
    candidates.forEach((candidate) => {
      const options = candidate.wall.dimensionOptions;
      let selectedOption = options.find((option) => !accepted.some((acceptedOption) => dimensionCollides(option, acceptedOption)));
      if (!selectedOption && candidate.priority >= 750) {
        selectedOption = options[0];
      }

      candidate.wall.showDimension = !!selectedOption;
      if (selectedOption) {
        candidate.wall.dimensionStyle = selectedOption.style;
        accepted.push(selectedOption);
      }
    });
  },

  resolveRedlineVisibility(renderWalls, previewWall) {
    const accepted = [];
    renderWalls.forEach((wall) => {
      wall.redlineParts = this.buildRedlineParts(wall, accepted);
      wall.redlineVisible = wall.redlineParts.length > 0;
      accepted.push(wall);
    });

    if (previewWall) {
      previewWall.redlineParts = this.buildRedlineParts(previewWall, accepted);
      previewWall.redlineVisible = previewWall.redlineParts.length > 0;
    }
  },

  buildRedlineParts(segment, acceptedSegments) {
    const startInset = segment.redlineStartInsetPx || 0;
    const endInset = segment.redlineEndInsetPx || 0;
    const end = Math.max(startInset, segment.width - endInset);
    let intervals = [{ start: startInset, end }];

    acceptedSegments.forEach((acceptedSegment) => {
      intervals = subtractInterval(intervals, getCanvasSegmentOverlapInterval(segment, acceptedSegment));
    });

    return intervals.map((interval) => ({
      key: `${roundPx(interval.start)}-${roundPx(interval.end)}`,
      style: `left:${roundPx(interval.start)}px; width:${roundPx(interval.end - interval.start)}px;`
    }));
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

  isFirstMeasurePositionStage(floor, session) {
    if (!floor || !session) return false;
    if (session.state === 'spaceClosed' || session.state === 'wallSelected' || session.state === 'remeasureAwaitingInput') {
      return false;
    }
    if (floor.walls.length === 0 && session.previewPoint && (session.state === 'wallPreview' || session.state === 'awaitingLength')) {
      return true;
    }
    return floor.walls.length === 1 && session.state === 'wallCommitted' && !session.previewPoint;
  },

  buildMeasurePosition(segment, floor, session) {
    if (!this.isFirstMeasurePositionStage(floor, session) || !segment || !segment.startPoint || !segment.endPoint) {
      return { visible: false, style: '', buttonLabel: '↓', control: null };
    }

    const midX = (segment.startPoint.x + segment.endPoint.x) / 2;
    const midY = (segment.startPoint.y + segment.endPoint.y) / 2;
    const side = segment.measurementSide || session.measurementSide;
    const left = midX - 70;
    const top = midY + 96;
    const label = side === 'left' ? '↑' : '↓';
    return {
      visible: session.state !== 'spaceClosed' && session.state !== 'wallSelected' && session.state !== 'remeasureAwaitingInput',
      style: `left:${roundPx(left)}px; top:${roundPx(top)}px;`,
      buttonLabel: label,
      control: {
        key: 'measure-position',
        label,
        tip: { x: left + 4, y: top, width: 132, height: 36 },
        button: { cx: left + 70, cy: top + 86, radius: 38 }
      }
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
      actionStyle: `left:${roundPx(midX - 34)}px; top:${roundPx(midY - 34)}px;`,
      action: { cx: midX, cy: midY }
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

  isNearCursorPoint(clientPoint) {
    if (!this.canvasRect || !clientPoint || !this.draft) return false;
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    if (!session || !session.anchorNodeId) return false;
    if (session.state !== 'cursorPlaced' && session.state !== 'wallCommitted') return false;

    const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
    if (!anchor) return false;

    const cursorPoint = this.mmToCanvasPoint(anchor);
    const localPoint = {
      x: clientPoint.x - this.canvasRect.left,
      y: clientPoint.y - this.canvasRect.top
    };
    return distancePx(cursorPoint, localPoint) <= 44;
  },

  applyDraft(nextDraft, options) {
    const opts = options || {};
    if (opts.recordHistory) {
      this.history.undo.push(opts.historyDraft ? surveyGraph.cloneDraft(opts.historyDraft) : surveyGraph.cloneDraft(this.draft));
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

  onToggleSide(e) {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const dataset = e && e.currentTarget ? e.currentTarget.dataset : {};
    const source = dataset && dataset.source;
    const firstWall = floor.walls[0] || null;
    const activeWallId = source === 'measure-position'
      ? (this.isFirstMeasurePositionStage(floor, session) && firstWall ? firstWall.id : '')
      : session.selectedWallId;

    if (source === 'measure-position' && !this.isFirstMeasurePositionStage(floor, session)) {
      wx.showToast({ title: '测量位置仅在第一条边设置', icon: 'none' });
      return;
    }

    const activeWall = activeWallId ? surveyGraph.getWall(floor, activeWallId) : null;
    const currentSide = activeWall ? activeWall.measurementSide : session.measurementSide;
    const nextSide = currentSide === 'right' ? 'left' : 'right';
    const nextDraft = surveyGraph.setMeasurementSide(this.draft, nextSide, activeWallId);
    this.applyDraft(nextDraft, {
      recordHistory: !!activeWallId,
      extraData: { numberPadVisible: this.data.numberPadVisible }
    });
    wx.showToast({ title: source === 'measure-position' ? '测量位置已更新' : (activeWallId ? '墙侧已更新' : '后续墙侧已切换'), icon: 'none' });
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

  hitCircle(point, circle) {
    if (!point || !circle) return false;
    return distancePx(point, { x: circle.cx, y: circle.cy }) <= circle.radius;
  },

  hitTestCanvasControl(clientPoint) {
    if (!this.canvasRect || !clientPoint) return null;
    const localPoint = {
      x: clientPoint.x - this.canvasRect.left,
      y: clientPoint.y - this.canvasRect.top
    };
    const controls = this.canvasControls || {};

    if (controls.closeAction && this.hitCircle(localPoint, controls.closeAction)) {
      return { key: 'close' };
    }
    if (controls.measurePosition && this.hitCircle(localPoint, controls.measurePosition.button)) {
      return { key: 'measure-position' };
    }
    if (controls.undoRedo) {
      if (this.hitCircle(localPoint, controls.undoRedo.undo)) {
        return { key: 'undo' };
      }
      if (this.hitCircle(localPoint, controls.undoRedo.redo)) {
        return { key: 'redo' };
      }
    }
    return null;
  },

  handleCanvasControlTap(control) {
    if (!control) return false;
    if (control.key === 'close') {
      this.onConfirmClose();
      return true;
    }
    if (control.key === 'measure-position') {
      this.onToggleSide({ currentTarget: { dataset: { source: 'measure-position' } } });
      return true;
    }
    if (control.key === 'undo') {
      if (this.history.undo.length) this.onUndo();
      return true;
    }
    if (control.key === 'redo') {
      if (this.history.redo.length) this.onRedo();
      return true;
    }
    return false;
  },

  onCanvasTouchStart(e) {
    if (this.data.numberPadVisible || !this.canvasRect) return;
    const touches = e.touches || [];

    if (touches.length >= 2) {
      const first = getTouchPoint(touches[0], this.canvasRect);
      const second = getTouchPoint(touches[1], this.canvasRect);
      const viewport = this.getViewport();
      this.touchState = {
        mode: 'pinch',
        startDistance: distancePx(first, second),
        startScale: viewport.scale
      };
      return;
    }

    if (!touches.length) return;

    const point = getTouchPoint(touches[0], this.canvasRect);
    const controlHit = this.hitTestCanvasControl(point);
    if (controlHit) {
      this.touchState = {
        mode: 'control',
        control: controlHit,
        startPoint: point
      };
      return;
    }

    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const nearCursor = this.isCursorTouchTarget(e) || this.isNearCursorPoint(point);
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
      const first = getTouchPoint(touches[0], this.canvasRect);
      const second = getTouchPoint(touches[1], this.canvasRect);
      const nextDistance = distancePx(first, second);
      if (!this.touchState.startDistance) return;
      const scale = clamp(this.touchState.startScale * (nextDistance / this.touchState.startDistance), MIN_SCALE, MAX_SCALE);
      this.draft = surveyGraph.updateViewport(this.draft, { scale });
      this.syncFromDraft();
      return;
    }

    if (!touches.length) return;

    const point = getTouchPoint(touches[0], this.canvasRect);
    const dx = point.x - this.touchState.startPoint.x;
    const dy = point.y - this.touchState.startPoint.y;
    const moved = Math.sqrt(dx * dx + dy * dy);
    const currentMm = this.canvasPointToMm(point);

    if (this.touchState.mode === 'pending') {
      if (moved < TOUCH_SLOP_PX) return;

      if (this.touchState.nearCursor && (this.touchState.sessionState === 'cursorPlaced' || this.touchState.sessionState === 'wallCommitted')) {
        if (!this.touchState.historyDraft) {
          this.touchState.historyDraft = surveyGraph.cloneDraft(this.draft);
        }
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
    const touchState = this.touchState;
    const controlTap = touchState.mode === 'control';
    const movedWall = touchState.mode === 'wall';
    const wasTap = touchState.mode === 'pending';
    const historyDraft = touchState.historyDraft;

    this.touchState = null;

    if (controlTap) {
      this.handleCanvasControlTap(touchState.control);
      return;
    }

    if (wasTap && !touchState.nearCursor) {
      const wallHit = this.hitTestWallAtClientPoint(touchState.startPoint);
      if (wallHit && wallHit.wallId) {
        this.draft = surveyGraph.selectWall(this.draft, wallHit.wallId);
        this.syncFromDraft({ numberPadVisible: false });
      }
      return;
    }

    if (movedWall) {
      if (session.previewLengthMm >= surveyGraph.MIN_WALL_LENGTH_MM) {
        try {
          const nextDraft = surveyGraph.commitPreviewLength(this.draft, session.previewLengthMm, 'manual');
          this.applyDraft(nextDraft, { recordHistory: true, historyDraft });
        } catch (err) {
          wx.showToast({ title: err.message || '成墙失败，请重试', icon: 'none' });
          this.draft = surveyGraph.cancelPending(this.draft);
          this.syncFromDraft();
        }
      } else {
        this.draft = surveyGraph.cancelPending(this.draft);
        this.syncFromDraft();
      }
      return;
    }
  },

  hitTestWallAtClientPoint(point) {
    if (!this.canvasRect || !this.surveyRenderScene || !point) return null;
    return surveyCanvasRenderer.hitTestSurveyWall(this.surveyRenderScene, {
      x: point.x - this.canvasRect.left,
      y: point.y - this.canvasRect.top
    });
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
    const restoredDraft = this.history.undo.pop();
    const restoredSession = surveyGraph.getActiveFloor(restoredDraft).session;
    this.draft = (restoredSession.state === 'wallPreview' || restoredSession.state === 'awaitingLength')
      ? surveyGraph.cancelPending(restoredDraft)
      : restoredDraft;
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
