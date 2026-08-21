const app = getApp();
const surveyGraph = require('../../../utils/surveyWallGraph.js');
const surveySnapEngine = require('../../../utils/survey/snap/snap-engine.js');
const surveyCanvasRenderer = require('../utils/surveyCanvasRenderer.js');
const surveyViewportInteraction = require('../utils/surveyViewportInteraction.js');
const bluetooth = require('../../../utils/bluetooth.js');
const api = require('../../../utils/api.js');
const util = require('../../../utils/util.js');
const surveyLayout = require('../../../utils/surveyLayout.js');
const {
  resolveSurveyGuide,
  solveGuideLayout,
  wrapGuideBody,
  buildDirectGuideConnector
} = require('../utils/surveyGuide.js');

const RESERVED_TOOLS = [
  { key: 'settings', label: '设置' },
  { key: 'reference', label: '参考' },
  { key: 'lock', label: '锁定' },
  { key: 'area', label: '面积' },
  { key: 'cad', label: 'CAD' },
  { key: 'more', label: '更多' }
];
const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '退格'];
const FORMAL_DRAFT_KEY = 'surveying_draft_v1';
const FORMAL_DRAFT_BACKUP_KEY = 'surveying_last_draft_backup';
const FORMAL_SERVER_DRAFT_ID_KEY = 'surveying_floorplan_id';
const SURVEYING_GUIDE_ENABLED_KEY = 'surveying_editor_guide_enabled_v1';
const COMPONENT_SPEC_OPTIONS = {
  door: [
    { key: 'length', label: '门宽' },
    { key: 'height', label: '门高' },
    { key: 'depth', label: '墙厚' },
    { key: 'edge1', label: '距左' },
    { key: 'edge2', label: '距右' }
  ],
  window: [
    { key: 'length', label: '窗宽' },
    { key: 'height', label: '窗高' },
    { key: 'sill', label: '窗台高' },
    { key: 'depth', label: '墙厚' },
    { key: 'edge1', label: '距左' },
    { key: 'edge2', label: '距右' }
  ]
};
const COMPONENT_CATEGORY_OPTIONS = {
  door: [
    { key: 'single-door', label: '单开门' },
    { key: 'double-door', label: '双开门' },
    { key: 'sliding-door', label: '推拉门' },
    { key: 'entry-door', label: '入户门' }
  ],
  window: [
    { key: 'flat-window', label: '平开窗' },
    { key: 'floor-window', label: '落地窗' },
    { key: 'sliding-window', label: '推拉窗' },
    { key: 'bay-window', label: '飘窗' }
  ]
};
const COMPONENT_LIBRARY = {
  door: [
    { id: 'door-single-basic', category: 'single-door', materialId: 'warm-white', label: '素色单开门', swatch: '#eadfce' },
    { id: 'door-double-dark', category: 'double-door', materialId: 'dark-wood', label: '深色双开门', swatch: '#3f332a' },
    { id: 'door-sliding-glass', category: 'sliding-door', materialId: 'glass-gray', label: '玻璃推拉门', swatch: '#cfd8dc' },
    { id: 'door-entry-bronze', category: 'entry-door', materialId: 'bronze', label: '入户门', swatch: '#8b5e34' },
    { id: 'door-arch-light', category: 'single-door', materialId: 'warm-white', label: '拱形门', swatch: '#f1ede4' },
    { id: 'door-minimal-gray', category: 'single-door', materialId: 'dark-gray', label: '极简灰门', swatch: '#8a8f8d' }
  ],
  window: [
    { id: 'window-flat-basic', category: 'flat-window', materialId: 'dark-gray', label: '平开窗', swatch: '#4b5563' },
    { id: 'window-floor-basic', category: 'floor-window', materialId: 'glass-gray', label: '落地窗', swatch: '#dbeafe' },
    { id: 'window-sliding-dark', category: 'sliding-window', materialId: 'dark-gray', label: '推拉窗', swatch: '#374151' },
    { id: 'window-bay-light', category: 'bay-window', materialId: 'warm-white', label: '飘窗', swatch: '#f2e8d5' },
    { id: 'window-grid-bronze', category: 'flat-window', materialId: 'bronze', label: '格栅窗', swatch: '#9a7a4f' },
    { id: 'window-round-basic', category: 'flat-window', materialId: 'glass-gray', label: '圆窗', swatch: '#e0f2fe' }
  ]
};
const TOUCH_SLOP_PX = 8;
const WALL_HIT_HALF_PX = 40;
// Keep a very broad numeric safety range without turning it into a workspace
// boundary. Operators must be able to zoom far enough out to position an
// existing room anywhere on the infinite drafting plane, then zoom back in for
// millimetre-level work.
const MIN_SCALE = 0.002;
const MAX_SCALE = 4;
const MAX_HISTORY = 40;
const MEASURE_LINE_TOP_PX = 40;
const MIN_WALL_THICKNESS_PX = 1.5;
const WALL_TOOLBAR_ACTION_WIDTH_PX = 36;
const WALL_TOOLBAR_ACTION_GAP_PX = 8;
const WALL_TOOLBAR_HORIZONTAL_PADDING_PX = 16;
const WALL_TOOLBAR_BORDER_PX = 2;
const WALL_TOOLBAR_VISIBLE_ACTIONS = 5;
const DIMENSION_LINE_CENTER_PX = 16;
const DIMENSION_LABEL_HEIGHT_PX = 24;
const DIMENSION_COLLISION_GAP_PX = 8;
const DIMENSION_PRIMARY_GAP_PX = 22;
const CURSOR_LENS_SIZE_PX = 120;
const CURSOR_LENS_SCALE = 0.12;
const BLE_DUPLICATE_WINDOW_MS = 800;
const PHONE_LEVEL_TOLERANCE_DEG = 8;
const PHONE_HEADING_SAMPLE_COUNT = 9;
const DIMENSION_OUTER_GAP_PX = 12;
const REDLINE_JOIN_TRIM_PX = 0;
const REDLINE_THICKNESS_PX = 3;
const REDLINE_OVERLAP_TOLERANCE_PX = 6;
const BOTTOM_DOCK_GUIDE_GEOMETRY_RPX = Object.freeze({
  bottom: 64,
  height: 108,
  actionHeight: 82,
  cursorCenterOffsetX: 0.5,
  cursorWidth: 128,
  measureCenterOffsetX: 168.5,
  measureWidth: 192
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundPx(value) {
  return Math.round(value * 10) / 10;
}

function formatMm(value) {
  return `${Math.round(value || 0)} mm`;
}

function formatCompactMm(value) {
  return `${Math.round(value || 0)}mm`;
}

function normalizeAngleDiff(currentAngle, previousAngle) {
  const diff = Math.abs(((currentAngle - previousAngle + 540) % 360) - 180);
  return Math.round(diff);
}

function normalizeHeading(angle) {
  return ((Number(angle) % 360) + 360) % 360;
}

function headingDifference(first, second) {
  return Math.abs(((normalizeHeading(first) - normalizeHeading(second) + 540) % 360) - 180);
}

function median(values) {
  if (!values || !values.length) return null;
  const sorted = values.slice().sort((first, second) => first - second);
  return sorted[Math.floor(sorted.length / 2)];
}

function buildCoreTools(activeTool, thicknessMm) {
  return [
    { key: 'straight', label: '直线', helper: '正交吸附', icon: activeTool === 'straight' ? 'align-active' : 'align', enabled: true, active: activeTool === 'straight' },
    { key: 'diagonal', label: '斜线', helper: '自由角度', icon: activeTool === 'diagonal' ? 'annotation-active' : 'annotation', enabled: true, active: activeTool === 'diagonal' },
    { key: 'thickness', label: '墙厚', helper: formatMm(thicknessMm), icon: 'layers', enabled: true, active: false },
    { key: 'input', label: '输入', helper: '手输 mm', icon: 'display', enabled: true, active: false },
    { key: 'ble-measure', label: '测距', helper: '蓝牙读数', enabled: true, active: false },
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

function getMidPoint(first, second) {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function getPolylineMidpoint(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const lengths = points.slice(1).map((point, index) => distancePx(points[index], point));
  const halfLength = lengths.reduce((total, length) => total + length, 0) / 2;
  let traversed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const segmentLength = lengths[index];
    if (traversed + segmentLength >= halfLength) {
      const ratio = segmentLength > 0 ? (halfLength - traversed) / segmentLength : 0;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio
      };
    }
    traversed += segmentLength;
  }
  return points[points.length - 1];
}

function canStartWallDrag(state) {
  // Closing is a suggestion, not a modal state: users may keep measuring from this endpoint.
  return state === 'cursorPlaced' || state === 'wallCommitted' || state === 'awaitingLength' ||
    state === 'closing' || state === 'mergeClosing';
}

function shouldAutoConfirmSharedBoundaryClose(floor) {
  const session = floor && floor.session;
  if (!session || session.state !== 'closing' || session.closeCandidateType !== 'shared-wall') {
    return false;
  }
  const lastWall = (floor.walls || [])[floor.walls.length - 1];
  if (!lastWall) return false;
  const endNode = surveyGraph.getNode(floor, lastWall.endNodeId);
  const target = session.closeCandidatePoint || surveyGraph.getNode(floor, session.closeCandidateNodeId);
  return !!(
    endNode &&
    target &&
    surveyGraph.distanceMm(endNode, target) <= surveyGraph.CLOSE_TOLERANCE_MM
  );
}

function maybeAutoConfirmSharedBoundaryClose(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  if (!shouldAutoConfirmSharedBoundaryClose(floor)) return draft;
  return surveyGraph.confirmClosure(draft);
}

function isRestorableSurveyDraft(draft) {
  if (!draft || draft.kind !== 'survey-wall-graph' || draft.source !== 'surveying-editor') return false;
  if (!Array.isArray(draft.floors) || !draft.floors.length) return false;
  const floor = draft.floors.find((item) => item.id === draft.activeFloorId) || draft.floors[0];
  return !!(floor && Array.isArray(floor.nodes) && Array.isArray(floor.walls) && floor.session);
}

Page({
  data: {
    statusBarHeight: 0,
    navigationSafeTop: 0,
    overlayContentTop: 0,
    rightRailTop: 0,
    rightRailBottom: 0,
    bottomSafeArea: 0,
    leadId: '',
    communityName: '',
    title: '未填写小区',
    bleConnected: !!app.globalData.bleConnected,
    activeView: '2D',
    activeTool: 'straight',
    measurementSide: 'left',
    thicknessMm: 200,
    formalNotice: '正式量房草稿',
    floorPlanStatus: '',
    showFormalExtras: false,
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
    measurePositionButtonLabel: '',
    closureGuideVisible: false,
    closureGuideStyle: '',
    closeActionVisible: false,
    closeActionStyle: '',
    measurementTitle: '准备测墙',
    measurementValue: '从橙色光标拖出墙体方向',
    isSurveyEmpty: true,
    guideEnabled: true,
    surveyGuideVisible: false,
    surveyGuideTarget: '',
    modePillText: '测墙模式',
    manualActionActive: false,
    manualActionSubtitle: '输入当前墙',
    cursorActionSubtitle: '保留已测墙',
    cursorPlacementState: 'placed',
    cursorLensActive: false,
    dragCursorX: 0,
    dragCursorY: 0,
    cursorLensVisible: false,
    cursorLensXLabel: 'X 0',
    cursorLensYLabel: 'Y 0',
    cursorLensSnapLabel: '网格吸附',
    cursorLensSnapType: 'none',
    selectedWall: null,
    selectedOpening: null,
    canResumeWallDrawing: false,
    spaceSummary: null,
    numberPadVisible: false,
    numberPadTitle: '输入长度',
    numberPadSubtitle: '单位：mm',
    numberInput: '',
    numberUnit: 'mm',
    numberKeys: NUMBER_KEYS,
    angleActionAvailable: false,
    angleMeasureVisible: false,
    angleMeasureTab: 'phone',
    angleManualInputVisible: false,
    angleMeasureStatus: '请先将手机水平放置',
    anglePhoneLevelReady: false,
    anglePhoneReferenceReady: false,
    anglePhoneDialStyle: 'transform: rotate(0deg);',
    anglePhoneLiveValue: '0',
    angleTriangleA: '',
    angleTriangleB: '',
    angleTriangleD: '',
    angleTriangleAmm: '',
    angleTriangleBmm: '',
    angleTriangleDmm: '',
    angleTriangleMeasuringSide: '',
    angleTriangleResult: '',
    angleTriangleError: '',
    historySummary: {
      undo: 0,
      redo: 0
    },
    componentEditorVisible: false,
    componentPanelMode: 'spec',
    componentSpecMode: 'length',
    componentSyncWallThickness: false,
    componentSpecOptions: [],
    componentSpecLabel: '门宽',
    componentTypeLabel: '门',
    componentEditorTitle: '编辑门窗',
    componentSpecValue: '0',
    componentSpecInput: '0',
    componentSelectedOpening: null
  },

  onLoad(options) {
    const sysInfo = wx.getSystemInfoSync();
    const menuButtonInfo = wx.getMenuButtonBoundingClientRect();
    const context = app.globalData.surveyingEditorContext || {};
    const screenHeight = sysInfo.screenHeight || sysInfo.windowHeight || 0;
    const safeAreaBottom = sysInfo.safeArea && screenHeight
      ? Math.max(0, screenHeight - sysInfo.safeArea.bottom)
      : 0;
    const capsuleBottom = menuButtonInfo.bottom || (sysInfo.statusBarHeight || 0);
    const navigationSafeTop = capsuleBottom + 6;
    const rpxScale = (sysInfo.windowWidth || 375) / 750;
    const headerBottom = (sysInfo.statusBarHeight || 0) + 160 * rpxScale;
    // The reference shell is 80px tall at 390px. Canvas controls start below
    // that fixed shell instead of inheriting device-specific capsule height.
    const overlayContentTop = Math.max(navigationSafeTop + 12, headerBottom + 8 * rpxScale);

    const leadId = options.leadId || context.leadId || '';
    const contextFloorPlanId = options.floorPlanId || context.floorPlanId || '';
    const startNewSurvey = options.newSurvey === '1' || !!context.startNewSurvey;
    const newSurveyKey = options.newSurveyKey || context.newSurveyKey || '';
    const newSurveyDraftScope = startNewSurvey ? `new_${newSurveyKey || Date.now()}` : '';
    this.isNewSurveySession = startNewSurvey;
    this.formalDraftKey = this.getFormalDraftKey(leadId, newSurveyDraftScope);
    this.serverDraftId = startNewSurvey ? '' : (contextFloorPlanId || this.getStoredServerDraftId(leadId));
    const restoredDraft = startNewSurvey
      ? null
      : this.loadFormalDraft(leadId, context.surveyGraph, this.formalDraftKey);
    this.draft = restoredDraft || surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
    const initialFloor = surveyGraph.getActiveFloor(this.draft);
    this.cursorPlacementState = initialFloor && initialFloor.session && initialFloor.session.state === 'wallSnapPending'
      ? 'awaitingWallDrop'
      : 'placed';
    this.history = { undo: [], redo: [] };
    this.pendingMeasurementRecords = [];
    this.reportedMeasurementKeys = Object.create(null);
    this.touchState = null;
    this.canvasRect = null;
    this.surveyCanvas = null;
    this.surveyCtx = null;
    this.cursorDragCanvas = null;
    this.cursorDragCtx = null;
    this.cursorDragCanvasDpr = sysInfo.pixelRatio || 1;
    this.cursorDragCanvasPoint = null;
    this.cursorDragCanvasShowCursor = true;
    this.cursorDragClientPoint = null;
    this.cursorDragCandidate = null;
    this.cursorDragStartPoint = null;
    this.cursorDragAnimationFrame = null;
    this.transientCanvasMode = null;
    this.viewportInteraction = null;
    this.viewportInteractionFrameQueue = null;
    this.viewportInteractionAwaitingHandoff = false;
    this.cursorLensLastUpdateAt = 0;
    this.cursorLensScene = null;
    this.cursorLensMeta = null;
    this.canvasCursorLensActive = false;
    this.rpxScale = rpxScale;
    this.cursorLensRect = {
      left: 24 * rpxScale + 8,
      top: 176 * rpxScale + 8,
      size: CURSOR_LENS_SIZE_PX
    };
    this.componentCanvas = null;
    this.componentRenderer = null;
    this.componentScene = null;
    this.componentCamera = null;
    this.componentOrbit = null;
    this.componentOrbitOpeningId = '';
    this.componentTouch = null;
    this.componentAnimationRunning = false;
    this.surveyCanvasDpr = sysInfo.pixelRatio || 1;
    this.surveyRenderScene = null;
    this.surveySceneRevision = 0;
    this.surveyCanvasInitRevision = 0;
    this.cursorCanvasInitRevision = 0;
    this.canvasRectRevision = 0;
    this.formalCanvasDrawPending = false;
    this.surveyCanvasDisposed = false;
    this.cursorDragPending = false;
    this.cursorDragTouchId = null;
    this.cursorControlRect = null;
    this.canvasControls = {};
    this.surveyGuideCanvasModel = null;
    this.surveyGuideImageCache = {};
    this._lastBleNumberDist = null;
    this._lastBleNumberTime = 0;
    this.bleMeasureTimer = null;
    this.bleFailTimer = null;
    this.angleMeasurementSource = 'manual';
    this.anglePhoneHeading = null;
    this.anglePhoneBaseline = null;
    this.anglePhoneSamples = [];
    this.deviceMotionListening = false;
    this.deviceMotionHandler = this.onDeviceMotionChange.bind(this);
    this.angleRemeasureOriginalDraft = null;
    this.angleRemeasureHistoryDraft = null;
    this.guideEnabled = this.loadGuideEnabled();
    this.guideSessionCompleted = false;
    this._bindBluetoothCallbacks();

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 0,
      navigationSafeTop,
      overlayContentTop,
      rightRailTop: headerBottom + 48 * rpxScale,
      rightRailBottom: safeAreaBottom + 154,
      bottomSafeArea: safeAreaBottom,
      leadId,
      communityName: context.communityName || '',
      serverDraftId: this.serverDraftId || '',
      title: context.communityName || '未填写小区',
      formalNotice: restoredDraft ? '已恢复本地草稿' : '新建正式量房',
      guideEnabled: this.guideEnabled
    });
    this.syncFromDraft();
    if (this.serverDraftId) this.loadFormalFloorPlan(this.serverDraftId);
    else if (leadId && !startNewSurvey) this.resolveLeadFloorPlan(leadId);
  },

  onReady() {
    this.refreshCanvasRect();
    this.refreshCursorControlRect();
  },

  onShow() {
    this.refreshCanvasRect();
    if (this.data.angleMeasureVisible && this.data.angleMeasureTab === 'phone') {
      this.startPhoneAngleMeasurement();
    }
  },

  onHide() {
    this.finishViewportInteraction({ sync: true, persist: false });
    this.stopPhoneAngleMeasurement();
  },

  onUnload() {
    this.surveyCanvasDisposed = true;
    this.canvasRectRevision += 1;
    this.surveyCanvasInitRevision += 1;
    this.cursorCanvasInitRevision += 1;
    app.globalData.surveyingEditorContext = null;
    this.finishViewportInteraction({ sync: false, persist: false });
    this.clearCursorDragCanvas({ force: true });
    this.clearBleMeasureTimers();
    this.stopPhoneAngleMeasurement();
    this.persistFormalDraft();
    this.destroyComponentScene();
  },

  getFormalDraftKey(leadId, scope) {
    return `${FORMAL_DRAFT_KEY}_${leadId || 'standalone'}${scope ? `_${scope}` : ''}`;
  },

  loadGuideEnabled() {
    try {
      const stored = wx.getStorageSync(SURVEYING_GUIDE_ENABLED_KEY);
      return stored === '' || typeof stored === 'undefined' ? true : stored !== false;
    } catch (err) {
      return true;
    }
  },

  persistGuideEnabled(enabled) {
    try {
      wx.setStorageSync(SURVEYING_GUIDE_ENABLED_KEY, !!enabled);
    } catch (err) {
      // Guide preferences never block formal surveying.
    }
  },

  onGuideToggle() {
    this.guideEnabled = !this.guideEnabled;
    this.persistGuideEnabled(this.guideEnabled);
    this.setData({ guideEnabled: this.guideEnabled }, () => this.syncFromDraft());
    wx.showToast({
      title: this.guideEnabled ? '引导已开启' : '引导已关闭',
      icon: 'none'
    });
  },

  normalizeRestoredFormalDraft(draft) {
    if (!isRestorableSurveyDraft(draft)) return null;
    const restored = surveyGraph.cloneDraft(draft);
    const floor = surveyGraph.getActiveFloor(restored);
    const session = floor.session || {};
    if (session.state === 'wallPreview' || session.state === 'awaitingLength' || session.state === 'remeasureAwaitingInput') {
      return surveyGraph.repairCollinearDegree2Walls(surveyGraph.cancelPending(restored));
    }
    return surveyGraph.repairCollinearDegree2Walls(restored);
  },

  loadFormalDraft(leadId, serverDraft, draftKey) {
    try {
      const draft = wx.getStorageSync(draftKey || this.getFormalDraftKey(leadId));
      const localDraft = this.normalizeRestoredFormalDraft(draft);
      if (localDraft) return localDraft;
      return this.normalizeRestoredFormalDraft(serverDraft);
    } catch (err) {
      return this.normalizeRestoredFormalDraft(serverDraft);
    }
  },

  persistFormalDraft() {
    if (!this.draft) return false;
    try {
      wx.setStorageSync(this.formalDraftKey || this.getFormalDraftKey(this.data.leadId || ''), surveyGraph.cloneDraft(this.draft));
      return true;
    } catch (err) {
      // 本地草稿持久化失败不应阻塞量房。
      return false;
    }
  },

  getStoredServerDraftId(leadId) {
    const suffix = leadId || 'standalone';
    try {
      return wx.getStorageSync(`${FORMAL_SERVER_DRAFT_ID_KEY}_${suffix}`) || '';
    } catch (err) {
      return '';
    }
  },

  readLeadFloorPlanId(lead) {
    if (!lead || typeof lead !== 'object') return '';
    const primary = lead.primaryFloorPlanId;
    if (primary && typeof primary === 'object' && primary._id) return String(primary._id);
    if (primary) return String(primary);
    const plans = Array.isArray(lead.floorPlanIds) ? lead.floorPlanIds : [];
    const first = plans.find((plan) => plan && plan._id);
    return first ? String(first._id) : '';
  },

  async resolveLeadFloorPlan(leadId) {
    if (!leadId || this.isNewSurveySession) return;
    try {
      const res = await api.request(`/leads/${leadId}`, 'GET');
      const floorPlanId = this.readLeadFloorPlanId(res && res.data);
      if (!floorPlanId) return;
      await this.loadFormalFloorPlan(floorPlanId);
    } catch (err) {
      wx.showToast({ title: (err && err.error) || err.message || '户型加载失败', icon: 'none' });
    }
  },

  clearStoredServerDraftId(leadId) {
    const suffix = leadId || 'standalone';
    this.serverDraftId = '';
    try {
      wx.removeStorageSync(`${FORMAL_SERVER_DRAFT_ID_KEY}_${suffix}`);
    } catch (err) {
      // 清理本地服务端草稿 ID 失败不阻塞后续重新创建。
    }
    this.setData({ serverDraftId: '' });
  },

  persistServerDraftId(leadId, floorPlanId) {
    if (!floorPlanId) return;
    const suffix = leadId || 'standalone';
    this.serverDraftId = floorPlanId;
    try {
      wx.setStorageSync(`${FORMAL_SERVER_DRAFT_ID_KEY}_${suffix}`, floorPlanId);
    } catch (err) {
      // 服务端草稿 ID 本地缓存失败不影响本次保存结果。
    }
    this.setData({ serverDraftId: floorPlanId });
  },

  getCurrentOpenid() {
    const userInfo = app.globalData.userInfo || wx.getStorageSync('userInfo') || {};
    return app.globalData.openid || wx.getStorageSync('openid') || userInfo.openid || '';
  },

  getCurrentToken() {
    return app.globalData.token || wx.getStorageSync('token') || '';
  },

  getSurveyGraphStats(draft) {
    if (!draft || !Array.isArray(draft.floors) || !draft.floors.length) {
      return { wallCount: 0, spaceCount: 0, openingCount: 0 };
    }

    const floor = surveyGraph.getActiveFloor(draft);
    const walls = Array.isArray(floor.walls) ? floor.walls : [];
    const spaces = Array.isArray(floor.spaces) ? floor.spaces : [];
    const openings = Array.isArray(floor.openings) ? floor.openings : [];

    return {
      wallCount: walls.length,
      spaceCount: spaces.filter((space) => space && space.closed).length,
      openingCount: openings.length
    };
  },

  buildFormalCloudLayoutData(status) {
    if (status === 'completed') {
      const validation = surveyGraph.validateSurveyDraft(this.draft, { mode: 'full' });
      if (!validation.valid) {
        const first = validation.errors[0];
        const error = new Error(first ? first.message : '正式量房墙图未通过完整校验');
        error.code = first ? first.code : 'SURVEY_VALIDATION_FAILED';
        error.validation = validation;
        throw error;
      }
    }
    return surveyLayout.createFormalSurveyLayout(this.draft, status);
  },

  async loadFormalFloorPlan(floorPlanId) {
    try {
      const res = await api.request(`/floorplans/${floorPlanId}`, 'GET');
      const layout = res && res.data ? surveyLayout.parseFormalSurveyLayout(res.data.layoutData) : null;
      if (!layout) throw new Error('该旧版户型已下线，请新建正式量房');
      const restored = this.normalizeRestoredFormalDraft(layout.surveyGraph);
      if (!restored) throw new Error('正式量房墙图无效');
      this.serverDraftId = res.data._id;
      this.draft = restored;
      this.persistServerDraftId(this.data.leadId || '', res.data._id);
      const communityName = (res.data.lead && res.data.lead.communityName)
        || res.data.communityName
        || (res.data.externalSource && res.data.externalSource.communityName)
        || (res.data.creator && res.data.creator.communityName)
        || this.data.communityName
        || '';
      this.setData({
        communityName,
        title: communityName || '未填写小区',
        floorPlanStatus: res.data.status || 'draft',
        formalNotice: res.data.status === 'completed' ? '已完成量房' : '已恢复正式草稿'
      });
      this.syncFromDraft();
    } catch (err) {
      wx.showToast({ title: (err && err.error) || err.message || '户型加载失败', icon: 'none' });
    }
  },

  async saveFormalFloorPlan(status) {
    const leadId = this.data.leadId || '';
    const openid = this.getCurrentOpenid();
    const token = this.getCurrentToken();

    if (!openid && !token) {
      throw new Error('Please log in before saving the surveying draft');
    }

    const layoutData = this.buildFormalCloudLayoutData(status);
    const stats = this.getSurveyGraphStats(layoutData.surveyGraph);
    const nameDate = util.formatTime(new Date()).split(' ')[0].replace(/\//g, '');
    const payload = {
      openid,
      leadId,
      name: `正式量房-${nameDate}`,
      layoutData,
      source: 'manual',
      status: status === 'completed' ? 'completed' : 'draft'
    };

    const currentDraftId = this.isNewSurveySession
      ? ''
      : (this.serverDraftId || this.data.serverDraftId || this.getStoredServerDraftId(leadId));
    console.info('[surveying-editor] Saving formal survey plan to cloud', {
      leadId,
      floorPlanId: currentDraftId || '(new)',
      stats
    });

    let res;
    if (currentDraftId) {
      try {
        res = await api.request(`/floorplans/${currentDraftId}`, 'PUT', payload);
      } catch (err) {
        console.warn('Update surveying draft failed, creating a new draft:', err);
        res = null;
        this.clearStoredServerDraftId(leadId);
      }
    }

    if (!res) {
      res = await api.request('/floorplans', 'POST', payload);
    }

    if (res && res.success && res.data && res.data._id) {
      this.persistServerDraftId(leadId, res.data._id);
      this.isNewSurveySession = false;
      if (leadId) {
        await api.request(`/leads/${leadId}`, 'PUT', {
          openid,
          floorPlanId: res.data._id
        });
      }
      await this.flushPendingMeasurements(res.data._id);
      console.info('[surveying-editor] Formal survey plan saved to cloud', {
        leadId,
        floorPlanId: res.data._id,
        stats
      });
      return res;
    }

    throw new Error('Cloud save did not return a floorPlanId');
  },

  scheduleFormalPersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persistFormalDraft();
    }, 300);
  },

  _bindBluetoothCallbacks() {
    bluetooth.setCallbacks(
      (distanceInMeters) => {
        this.onBluetoothMeasure(distanceInMeters);
      },
      (isConnected) => {
        this.updateBleConnected(isConnected);
      },
      () => {
        this.updateBleConnected(false);
      }
    );
  },

  updateBleConnected(isConnected) {
    const connected = !!isConnected;
    app.globalData.bleConnected = connected;
    this.setData({ bleConnected: connected }, () => {
      if (this.draft) this.syncFromDraft();
    });
  },

  requestBluetoothConnection() {
    wx.showModal({
      title: '未连接测距仪',
      content: '连接设备后可读取实时距离，是否前往连接？',
      cancelText: '暂不连接',
      confirmText: '去连接',
      success: (result) => {
        if (!result.confirm) return;
        this.connectBluetoothForMeasurement();
      }
    });
  },

  connectBluetoothForMeasurement() {
    bluetooth.initBLE(
      (distanceInMeters) => {
        this.onBluetoothMeasure(distanceInMeters);
      },
      (isConnected) => {
        this.updateBleConnected(isConnected);
      },
      () => {
        this.updateBleConnected(false);
      }
    );
  },

  clearBleMeasureTimers() {
    if (this.blePrimeTimer) {
      clearTimeout(this.blePrimeTimer);
      this.blePrimeTimer = null;
    }
    if (this.bleMeasureTimer) {
      clearTimeout(this.bleMeasureTimer);
      this.bleMeasureTimer = null;
    }
    if (this.bleFailTimer) {
      clearTimeout(this.bleFailTimer);
      this.bleFailTimer = null;
    }
  },

  onBluetoothMeasure(distanceInMeters) {
    this.clearBleMeasureTimers();
    const target = this.bleMeasureTarget || 'numberPad';
    this.bleMeasureTarget = '';
    if (target === 'ignore') return;
    const isAngleTriangleTarget = target.indexOf('angleTriangle') === 0;
    if (distanceInMeters && distanceInMeters > 0) {
      const floor = this.draft ? surveyGraph.getActiveFloor(this.draft) : null;
      const session = floor && floor.session ? floor.session : {};
      const opening = floor && session.selectedOpeningId ? surveyGraph.getOpening(floor, session.selectedOpeningId) : null;
      this.reportMeasurement({
        value: distanceInMeters,
        type: isAngleTriangleTarget ? 'angle_triangle_side' :
          (target === 'componentSpec' ? (opening ? 'opening_width' : 'length') : 'length'),
        direction: session.selectedWallId || (opening && opening.wallId) ||
          ((isAngleTriangleTarget || target === 'pendingWall') ? session.anchorNodeId || '' : ''),
        metadata: {
          target,
          wallId: session.selectedWallId || (target === 'pendingWall' ? session.pendingWallId || '' : ''),
          openingId: opening ? opening.id : '',
          angleSide: isAngleTriangleTarget ? target.replace('angleTriangle', '').toLowerCase() : ''
        }
      });
    }
    if (isAngleTriangleTarget) {
      this.applyBleReadingToAngleTriangle(target, distanceInMeters);
      return;
    }
    if (target === 'componentSpec') {
      this.applyBleReadingToComponentSpec(distanceInMeters);
      return;
    }
    if (target === 'selectedWall') {
      this.applyBleReadingToSelectedWall(distanceInMeters);
      return;
    }
    if (target === 'pendingWall') {
      this.applyBleReadingToPendingWall(distanceInMeters);
      return;
    }
    this.applyBleReadingToNumberPad(distanceInMeters);
  },

  triggerBluetoothNumberMeasure() {
    if (!this.data.numberPadVisible || !this.numberPadMode) {
      wx.showToast({ title: '请先打开数字修改', icon: 'none' });
      return;
    }

    if (!app.globalData.bleConnected) {
      this.requestBluetoothConnection();
      return;
    }

    this.startBluetoothMeasure('numberPad');
  },

  triggerComponentSpecBluetoothMeasure() {
    const floor = this.draft ? surveyGraph.getActiveFloor(this.draft) : null;
    const openingId = floor && floor.session ? floor.session.selectedOpeningId : '';
    if (!this.data.componentEditorVisible || this.data.componentPanelMode !== 'spec' || !openingId) {
      wx.showToast({ title: '请先选择门窗参数', icon: 'none' });
      return;
    }

    if (!app.globalData.bleConnected) {
      this.requestBluetoothConnection();
      return;
    }

    this.startBluetoothMeasure('componentSpec');
  },

  startBluetoothMeasure(target) {
    this.bleMeasureTarget = target || 'numberPad';
    this.clearBleMeasureTimers();
    wx.showToast({ title: '正在测距...', icon: 'none' });
    bluetooth.sendBLECommand('ATK001#');

    this.blePrimeTimer = setTimeout(() => {
      this.blePrimeTimer = null;
      bluetooth.sendBLECommand('ATK001#');

      this.bleMeasureTimer = setTimeout(() => {
        bluetooth.sendBLECommand('ATD001#');
        this.bleFailTimer = setTimeout(() => {
          this.onBluetoothMeasure(null);
        }, 4000);
      }, 3500);
    }, 260);
  },

  shouldIgnoreDuplicateBleReading(distanceInMeters) {
    const now = Date.now();
    if (distanceInMeters === this._lastBleNumberDist && now - this._lastBleNumberTime < BLE_DUPLICATE_WINDOW_MS) {
      return true;
    }
    this._lastBleNumberDist = distanceInMeters;
    this._lastBleNumberTime = now;
    return false;
  },

  applyBleReadingToNumberPad(distanceInMeters) {
    if (!this.data.numberPadVisible || !this.numberPadMode) {
      return;
    }

    if (distanceInMeters === null || distanceInMeters <= 0) {
      wx.showToast({ title: '测量失败，请重试', icon: 'none' });
      return;
    }

    if (this.shouldIgnoreDuplicateBleReading(distanceInMeters)) {
      return;
    }

    const valueMm = Math.round(distanceInMeters * 1000);
    const inputValue = String(valueMm);
    this.setData({ numberInput: inputValue }, () => {
      wx.showToast({ title: '已填入测距结果', icon: 'none' });
    });
  },

  applyBleReadingToSelectedWall(distanceInMeters) {
    const historyDraft = this.bleMeasureHistoryDraft;
    this.bleMeasureHistoryDraft = null;
    const historyUndoLength = this.history.undo.length;
    const historyRedo = this.history.redo.slice();
    const restoreMeasurementDraft = () => {
      if (!historyDraft) return;
      this.history.undo.splice(historyUndoLength);
      this.history.redo = historyRedo;
      this.draft = surveyGraph.cloneDraft(historyDraft);
      try {
        this.syncFromDraft({ numberPadVisible: false });
      } catch (restoreErr) {
        console.error('[surveying-editor] Failed to redraw the BLE remeasure rollback draft', restoreErr);
      }
    };

    if (distanceInMeters === null || distanceInMeters <= 0) {
      restoreMeasurementDraft();
      wx.showToast({ title: '测量失败，请重试', icon: 'none' });
      return;
    }

    if (this.shouldIgnoreDuplicateBleReading(distanceInMeters)) {
      restoreMeasurementDraft();
      return;
    }

    const valueMm = Math.round(distanceInMeters * 1000);
    try {
      const nextDraft = surveyGraph.remeasureSelectedWall(this.draft, valueMm, 'ble');
      this.applyDraft(nextDraft, {
        recordHistory: true,
        historyDraft
      });
      wx.showToast({ title: '已更新当前墙体', icon: 'success' });
    } catch (err) {
      restoreMeasurementDraft();
      wx.showToast({ title: err.message || '更新墙体失败', icon: 'none' });
    }
  },

  applyBleReadingToPendingWall(distanceInMeters) {
    if (distanceInMeters === null || distanceInMeters <= 0) {
      wx.showToast({ title: '测量失败，请重试', icon: 'none' });
      return;
    }

    if (this.shouldIgnoreDuplicateBleReading(distanceInMeters)) {
      return;
    }

    const valueMm = Math.round(distanceInMeters * 1000);
    try {
      const nextDraft = maybeAutoConfirmSharedBoundaryClose(
        surveyGraph.commitPreviewLength(this.draft, valueMm, 'ble')
      );
      const nextSession = surveyGraph.getActiveFloor(nextDraft).session;
      this.applyDraft(this.enterResetCursorAfterClose(nextDraft), { recordHistory: true });
      wx.showToast({
        title: nextSession.state === 'spaceClosed' ? '已吸附闭合点并闭合' : '已更新当前墙体',
        icon: 'success'
      });
    } catch (err) {
      wx.showToast({ title: err.message || '更新墙体失败', icon: 'none' });
    }
  },

  applyBleReadingToComponentSpec(distanceInMeters) {
    if (!this.data.componentEditorVisible || this.data.componentPanelMode !== 'spec') {
      return;
    }

    if (distanceInMeters === null || distanceInMeters <= 0) {
      wx.showToast({ title: '测量失败，请重试', icon: 'none' });
      return;
    }

    if (this.shouldIgnoreDuplicateBleReading(distanceInMeters)) {
      return;
    }

    const valueMm = Math.round(distanceInMeters * 1000);
    const inputValue = String(valueMm);
    const floor = surveyGraph.getActiveFloor(this.draft);
    const openingId = floor.session.selectedOpeningId;
    const specMode = this.data.componentSpecMode || 'length';

    try {
      const nextDraft = this.updateComponentSpecValue(this.draft, openingId, specMode, valueMm);
      this.draft = nextDraft;
      this.syncFromDraft({
        componentEditorVisible: true,
        componentPanelMode: 'spec',
        componentSpecMode: specMode,
        componentSpecInput: inputValue
      });
      this.scheduleFormalPersist();
      wx.showToast({ title: '已填入测距结果', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: err.message || '输入无效', icon: 'none' });
    }
  },

  canRemeasureLastDiagonalAngle(floor, session) {
    const lastWall = floor && floor.walls && floor.walls[floor.walls.length - 1];
    return !!lastWall && floor.walls.length >= 2 && lastWall.mode === 'diagonal' &&
      session && session.state === 'wallCommitted' && !session.previewPoint &&
      !(floor.openings || []).some((opening) => opening.wallId === lastWall.id);
  },

  openAngleMeasurement() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const canRemeasureLastWall = this.canRemeasureLastDiagonalAngle(floor, session);
    if ((!session.previewPoint || session.mode !== 'diagonal') && !canRemeasureLastWall) {
      wx.showToast({ title: '请先拖出与上一面墙相连的斜线', icon: 'none' });
      return;
    }

    if (canRemeasureLastWall) {
      this.angleRemeasureOriginalDraft = surveyGraph.cloneDraft(this.draft);
      this.draft = surveyGraph.reopenLastDiagonalWallForAngle(this.draft);
    }

    this.draft = surveyGraph.holdPreviewForInput(this.draft);
    this.numberPadMode = 'angle';
    this.angleMeasurementSource = 'manual';
    this.resetAngleTriangle();
    this.resetPhoneAngleState();
    this.syncFromDraft({
      numberPadVisible: true,
      numberPadTitle: '测量角度',
      numberPadSubtitle: '确认后锁定斜线方向，再测量墙长',
      numberInput: '',
      numberUnit: '°',
      angleMeasureVisible: true,
      angleMeasureTab: 'phone',
      angleManualInputVisible: false,
      angleMeasureStatus: '将手机水平贴合上一面墙后设为基准',
      anglePhoneLevelReady: false,
      anglePhoneReferenceReady: false,
      anglePhoneDialStyle: 'transform: rotate(0deg);',
      anglePhoneLiveValue: '0'
    });
    this.startPhoneAngleMeasurement();
  },

  resetPhoneAngleState() {
    this.anglePhoneHeading = null;
    this.anglePhoneBaseline = null;
    this.anglePhoneSamples = [];
  },

  startPhoneAngleMeasurement() {
    this.stopPhoneAngleMeasurement();
    this.resetPhoneAngleState();
    this.setData({
      anglePhoneLevelReady: false,
      anglePhoneReferenceReady: false,
      anglePhoneDialStyle: 'transform: rotate(0deg);',
      anglePhoneLiveValue: '0',
      angleMeasureStatus: '将手机水平贴合上一面墙后设为基准',
      numberInput: ''
    });
    if (!wx.startDeviceMotionListening || !wx.onDeviceMotionChange) {
      this.setData({ angleMeasureStatus: '当前设备不支持手机姿态测角' });
      return;
    }

    wx.onDeviceMotionChange(this.deviceMotionHandler);
    wx.startDeviceMotionListening({
      interval: 'game',
      success: () => {
        this.deviceMotionListening = true;
      },
      fail: () => {
        if (wx.offDeviceMotionChange) wx.offDeviceMotionChange(this.deviceMotionHandler);
        this.setData({ angleMeasureStatus: '无法启用手机姿态传感器，请手输或使用勾股定理测量' });
      }
    });
  },

  stopPhoneAngleMeasurement() {
    if (wx.offDeviceMotionChange && this.deviceMotionHandler) {
      wx.offDeviceMotionChange(this.deviceMotionHandler);
    }
    if (this.deviceMotionListening && wx.stopDeviceMotionListening) {
      wx.stopDeviceMotionListening({ fail: () => {} });
    }
    this.deviceMotionListening = false;
  },

  onDeviceMotionChange(event) {
    if (!this.data.angleMeasureVisible || this.data.angleMeasureTab !== 'phone') return;
    const heading = Number(event && event.alpha);
    if (!Number.isFinite(heading)) return;

    const pitch = Math.abs(Number(event.beta) || 0);
    const roll = Math.abs(Number(event.gamma) || 0);
    const levelReady = pitch <= PHONE_LEVEL_TOLERANCE_DEG && roll <= PHONE_LEVEL_TOLERANCE_DEG;
    this.anglePhoneHeading = normalizeHeading(heading);
    if (!levelReady) {
      this.setData({
        anglePhoneLevelReady: false,
        angleMeasureStatus: '请保持手机水平，圆盘稳定后再设基准',
        numberInput: ''
      });
      return;
    }

    this.anglePhoneSamples.push(this.anglePhoneHeading);
    if (this.anglePhoneSamples.length > PHONE_HEADING_SAMPLE_COUNT) this.anglePhoneSamples.shift();
    const stableHeading = median(this.anglePhoneSamples);
    if (stableHeading === null) return;
    this.anglePhoneHeading = stableHeading;

    if (!Number.isFinite(this.anglePhoneBaseline)) {
      this.setData({
        anglePhoneLevelReady: true,
        angleMeasureStatus: '手机已水平，请设为基准墙方向'
      });
      return;
    }

    const angle = Math.round(headingDifference(this.anglePhoneHeading, this.anglePhoneBaseline) * 10) / 10;
    this.angleMeasurementSource = 'phone-motion';
    this.setData({
      anglePhoneLevelReady: true,
      anglePhoneReferenceReady: true,
      anglePhoneLiveValue: String(angle),
      anglePhoneDialStyle: `transform: rotate(${angle}deg);`,
      angleMeasureStatus: '将手机对齐当前斜墙，确认实时角度',
      numberInput: String(angle)
    });
  },

  onPhoneSetAngleBaseline() {
    if (!this.data.anglePhoneLevelReady || !Number.isFinite(this.anglePhoneHeading)) {
      wx.showToast({ title: '请先将手机水平放稳', icon: 'none' });
      return;
    }
    this.anglePhoneBaseline = this.anglePhoneHeading;
    this.anglePhoneSamples = [];
    this.setData({
      anglePhoneReferenceReady: true,
      anglePhoneLiveValue: '0',
      anglePhoneDialStyle: 'transform: rotate(0deg);',
      angleMeasureStatus: '基准已设定，请将手机转向当前斜墙',
      numberInput: ''
    });
  },

  onAngleMeasureTab(e) {
    const tab = e.currentTarget.dataset.tab === 'pythagorean' ? 'pythagorean' : 'phone';
    if (this.data.angleTriangleMeasuringSide) {
      this.clearBleMeasureTimers();
      this.bleMeasureTarget = 'ignore';
    }
    const triangleInput = this.data.angleTriangleResult
      ? this.data.angleTriangleResult.replace('°', '')
      : '';
    this.setData({
      angleMeasureTab: tab,
      angleManualInputVisible: false,
      angleTriangleMeasuringSide: '',
      numberInput: tab === 'pythagorean'
        ? triangleInput
        : (this.data.anglePhoneReferenceReady ? this.data.anglePhoneLiveValue : '')
    });
    if (tab === 'phone') {
      this.startPhoneAngleMeasurement();
    } else {
      this.stopPhoneAngleMeasurement();
    }
  },

  onAngleManualInput() {
    this.stopPhoneAngleMeasurement();
    this.angleMeasurementSource = 'manual';
    this.setData({
      angleManualInputVisible: true,
      numberInput: ''
    });
  },

  onAngleManualInputBack() {
    this.setData({
      angleManualInputVisible: false,
      numberInput: ''
    });
    if (this.data.angleMeasureTab === 'phone') {
      this.startPhoneAngleMeasurement();
    }
  },

  resetAngleTriangle() {
    this.angleTriangle = { a: null, b: null, d: null };
  },

  onResetAngleTriangle() {
    if (this.data.angleTriangleMeasuringSide) {
      this.clearBleMeasureTimers();
      this.bleMeasureTarget = 'ignore';
    }
    this.resetAngleTriangle();
    this.angleMeasurementSource = 'manual';
    this.setData({
      angleTriangleA: '',
      angleTriangleB: '',
      angleTriangleD: '',
      angleTriangleAmm: '',
      angleTriangleBmm: '',
      angleTriangleDmm: '',
      angleTriangleMeasuringSide: '',
      angleTriangleResult: '',
      angleTriangleError: '',
      numberInput: ''
    });
  },

  onTriangleMeasure(e) {
    if (this.data.angleTriangleMeasuringSide) return;
    if (!app.globalData.bleConnected) {
      this.requestBluetoothConnection();
      return;
    }
    const side = e.currentTarget.dataset.side || 'a';
    const targetMap = { a: 'angleTriangleA', b: 'angleTriangleB', d: 'angleTriangleD' };
    const target = targetMap[side];
    if (!target) return;
    this.setData({ angleTriangleMeasuringSide: side });
    this.startBluetoothMeasure(target);
  },

  applyBleReadingToAngleTriangle(target, distanceInMeters) {
    if (!this.data.angleMeasureVisible || this.data.angleMeasureTab !== 'pythagorean') return;
    if (distanceInMeters === null || distanceInMeters <= 0) {
      this.setData({ angleTriangleMeasuringSide: '' });
      wx.showToast({ title: '测量失败，请重试', icon: 'none' });
      return;
    }
    if (this.shouldIgnoreDuplicateBleReading(distanceInMeters)) {
      this.setData({ angleTriangleMeasuringSide: '' });
      return;
    }

    const side = target.replace('angleTriangle', '').toLowerCase();
    const nextTriangle = Object.assign({}, this.angleTriangle || {});
    nextTriangle[side] = distanceInMeters;
    this.angleTriangle = nextTriangle;
    const patch = {
      angleTriangleA: nextTriangle.a ? nextTriangle.a.toFixed(3) : '',
      angleTriangleB: nextTriangle.b ? nextTriangle.b.toFixed(3) : '',
      angleTriangleD: nextTriangle.d ? nextTriangle.d.toFixed(3) : '',
      angleTriangleAmm: nextTriangle.a ? String(Math.round(nextTriangle.a * 1000)) : '',
      angleTriangleBmm: nextTriangle.b ? String(Math.round(nextTriangle.b * 1000)) : '',
      angleTriangleDmm: nextTriangle.d ? String(Math.round(nextTriangle.d * 1000)) : '',
      angleTriangleMeasuringSide: '',
      angleTriangleError: ''
    };

    if (nextTriangle.a && nextTriangle.b && nextTriangle.d) {
      const angle = util.calculateAngle(nextTriangle.a, nextTriangle.b, nextTriangle.d);
      if (!Number.isFinite(angle)) {
        patch.angleTriangleError = '三边数据无法构成有效夹角，请重测';
        patch.angleTriangleResult = '';
      } else {
        const roundedAngle = Math.round(angle * 10) / 10;
        this.angleMeasurementSource = 'pythagorean';
        patch.angleTriangleResult = `${roundedAngle}°`;
        patch.numberInput = String(roundedAngle);
      }
    }
    this.setData(patch);
  },

  refreshCanvasRect() {
    const rectRevision = (this.canvasRectRevision || 0) + 1;
    this.canvasRectRevision = rectRevision;
    wx.createSelectorQuery()
      .in(this)
      .select('.grid-canvas')
      .boundingClientRect((rect) => {
        if (this.surveyCanvasDisposed || rectRevision !== this.canvasRectRevision) return;
        if (rect && rect.width && rect.height) {
          this.canvasRect = rect;
          this.setData({
            canvasWidth: rect.width,
            canvasHeight: rect.height
          }, () => {
            this.initSurveyCanvas();
            this.initCursorDragCanvas();
            this.syncFromDraft();
          });
        }
      })
      .exec();
  },

  initSurveyCanvas() {
    if (!this.canvasRect || !this.canvasRect.width || !this.canvasRect.height) return;
    const initRevision = (this.surveyCanvasInitRevision || 0) + 1;
    this.surveyCanvasInitRevision = initRevision;

    wx.createSelectorQuery()
      .in(this)
      .select('#survey-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (this.surveyCanvasDisposed || initRevision !== this.surveyCanvasInitRevision) return;
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
        console.info(
          `[surveying-editor] Canvas renderer ready ${surveyCanvasRenderer.RENDER_REVISION} scene=${this.surveySceneRevision || 0}`
        );
        if (this.viewportInteraction && this.transientCanvasMode === 'viewport') {
          this.drawViewportInteractionFrame(this.viewportInteraction.viewport);
        } else {
          this.drawSurveyCanvas();
        }
      });
  },

  initCursorDragCanvas() {
    if (!this.canvasRect || !this.canvasRect.width || !this.canvasRect.height) return;
    const initRevision = (this.cursorCanvasInitRevision || 0) + 1;
    this.cursorCanvasInitRevision = initRevision;

    wx.createSelectorQuery()
      .in(this)
      .select('#cursor-drag-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (this.surveyCanvasDisposed || initRevision !== this.cursorCanvasInitRevision) return;
        const target = res && res[0];
        const canvas = target && target.node;
        if (!canvas) return;

        let dpr = this.cursorDragCanvasDpr || 1;
        try {
          dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
        } catch (err) {
          dpr = this.cursorDragCanvasDpr || 1;
        }

        const width = this.canvasRect.width || target.width || 0;
        const height = this.canvasRect.height || target.height || 0;
        if (!width || !height) return;

        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        this.cursorDragCanvas = canvas;
        this.cursorDragCtx = canvas.getContext('2d');
        this.cursorDragCanvasDpr = dpr || 1;
        this.resetViewportInteractionFrameQueue();
        this.viewportInteractionFrameQueue = surveyViewportInteraction.createLatestFrameQueue({
          requestFrame: (callback) => (
            typeof canvas.requestAnimationFrame === 'function'
              ? canvas.requestAnimationFrame(callback)
              : setTimeout(callback, 16)
          ),
          cancelFrame: (frameId) => {
            if (typeof canvas.cancelAnimationFrame === 'function') {
              canvas.cancelAnimationFrame(frameId);
            } else {
              clearTimeout(frameId);
            }
          },
          onFrame: (viewport) => this.drawViewportInteractionFrame(viewport)
        });
        surveyCanvasRenderer.clearDraggingCursor(
          this.cursorDragCtx,
          { width, height },
          { dpr: this.cursorDragCanvasDpr }
        );
      });
  },

  resetViewportInteractionFrameQueue() {
    if (this.viewportInteractionFrameQueue) {
      this.viewportInteractionFrameQueue.cancel();
    }
    this.viewportInteractionFrameQueue = null;
  },

  queueCursorDragCanvas(point, options) {
    if (!point || !this.canvasRect) return;
    if (this.transientCanvasMode === 'viewport') return;
    this.transientCanvasMode = 'cursor';
    this.cursorDragCanvasPoint = {
      x: point.x - this.canvasRect.left,
      y: point.y - this.canvasRect.top
    };
    this.cursorDragCanvasShowCursor = !options || options.showCursor !== false;
    if (!this.cursorDragCanvas || !this.cursorDragCtx || this.cursorDragAnimationFrame !== null) return;

    const render = () => {
      this.cursorDragAnimationFrame = null;
      if (!this.cursorDragCanvasPoint || !this.isCursorLensActive()) return;
      surveyCanvasRenderer.drawDraggingCursor(
        this.cursorDragCtx,
        { width: this.canvasRect.width, height: this.canvasRect.height },
        this.cursorDragCanvasPoint,
        {
          dpr: this.cursorDragCanvasDpr || 1,
          showCursor: this.cursorDragCanvasShowCursor,
          lensScene: this.cursorLensScene,
          lensRect: this.cursorLensRect,
          lensMeta: this.cursorLensMeta,
          snapGuide: this.cursorDragSnapGuide,
          closeAction: this.canvasControls && this.canvasControls.closeAction
        }
      );
    };

    if (typeof this.cursorDragCanvas.requestAnimationFrame === 'function') {
      this.cursorDragAnimationFrame = this.cursorDragCanvas.requestAnimationFrame(render);
    } else {
      render();
    }
  },

  clearCursorDragCanvas(options) {
    const force = !!(options && options.force);
    if (!force && this.transientCanvasMode === 'viewport') return;
    if (this.cursorDragCanvas && this.cursorDragAnimationFrame !== null
      && typeof this.cursorDragCanvas.cancelAnimationFrame === 'function') {
      this.cursorDragCanvas.cancelAnimationFrame(this.cursorDragAnimationFrame);
    }
    this.cursorDragAnimationFrame = null;
    this.cursorDragCanvasPoint = null;
    this.cursorDragCanvasShowCursor = true;
    this.cursorDragClientPoint = null;
    this.cursorDragSnapGuide = null;
    this.cursorLensScene = null;
    this.cursorLensMeta = null;
    if (this.transientCanvasMode === 'cursor' || force) {
      this.transientCanvasMode = null;
    }
    if (!this.cursorDragCtx || !this.canvasRect) return;
    surveyCanvasRenderer.clearDraggingCursor(
      this.cursorDragCtx,
      { width: this.canvasRect.width, height: this.canvasRect.height },
      { dpr: this.cursorDragCanvasDpr || 1 }
    );
  },

  beginViewportInteraction(baseViewport) {
    if (this.viewportInteraction) return true;
    if (!this.cursorDragCtx || !this.canvasRect || !this.surveyRenderScene || !this.viewportInteractionFrameQueue) {
      return false;
    }

    this.clearCursorDragCanvas({ force: true });
    const viewport = Object.assign({}, baseViewport || this.getViewport());
    this.viewportInteraction = {
      baseScene: this.surveyRenderScene,
      baseViewport: viewport,
      viewport,
      dirty: false
    };
    this.transientCanvasMode = 'viewport';
    return true;
  },

  updateViewportInteraction(viewport) {
    if (!this.viewportInteraction || !viewport) return false;
    this.viewportInteraction.viewport = Object.assign({}, viewport);
    this.viewportInteraction.dirty = true;
    if (this.viewportInteractionFrameQueue) {
      this.viewportInteractionFrameQueue.queue(this.viewportInteraction.viewport);
    }
    return true;
  },

  drawViewportInteractionFrame(viewport) {
    const interaction = this.viewportInteraction;
    if (!interaction || this.transientCanvasMode !== 'viewport' || !viewport || !this.surveyCtx) return;
    surveyCanvasRenderer.drawSurveyInteractionScene(
      // Render the gesture frame on the primary canvas. Reusing the cursor
      // overlay here can make native Canvas composite a shared-wall room frame
      // with the previous formal frame after a cursor snap.
      this.surveyCtx,
      interaction.baseScene,
      {
        dpr: this.surveyCanvasDpr || 1,
        baseViewport: interaction.baseViewport,
        viewport
      }
    );
    this.drawViewportInteractionControls(viewport);
  },

  drawViewportInteractionControls(viewport) {
    const interaction = this.viewportInteraction;
    const close = this.canvasControls && this.canvasControls.closeAction;
    const ctx = this.surveyCtx;
    const rect = (interaction && interaction.baseScene && interaction.baseScene.rect) || this.canvasRect;
    if (!interaction || !close || !ctx || !rect) return;
    const transform = surveyCanvasRenderer.resolveViewportInteractionTransform(
      interaction.baseViewport,
      viewport,
      rect
    );
    const dpr = this.surveyCanvasDpr || 1;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    surveyCanvasRenderer.drawCloseAction(ctx, {
      cx: close.cx * transform.scale + transform.translateX,
      cy: close.cy * transform.scale + transform.translateY,
      radius: close.radius || 14
    });
    ctx.restore();
  },

  clearViewportInteractionCanvas() {
    if (this.viewportInteractionFrameQueue) {
      this.viewportInteractionFrameQueue.cancel();
    }
    if (this.transientCanvasMode === 'viewport') {
      this.transientCanvasMode = null;
    }
    if (!this.cursorDragCtx || !this.canvasRect) return;
    surveyCanvasRenderer.clearDraggingCursor(
      this.cursorDragCtx,
      { width: this.canvasRect.width, height: this.canvasRect.height },
      { dpr: this.cursorDragCanvasDpr || 1 }
    );
  },

  finishViewportInteraction(options) {
    const interaction = this.viewportInteraction;
    if (!interaction) return false;
    const opts = Object.assign({ sync: true, persist: true }, options || {});
    const dirty = interaction.dirty;
    const viewport = interaction.viewport;

    if (this.viewportInteractionFrameQueue) {
      this.viewportInteractionFrameQueue.cancel();
    }
    this.viewportInteraction = null;

    if (dirty && this.draft) {
      this.draft = surveyGraph.updateViewport(this.draft, viewport);
    }

    if (dirty && opts.sync) {
      this.viewportInteractionAwaitingHandoff = true;
      this.syncFromDraft();
    } else {
      this.viewportInteractionAwaitingHandoff = false;
      this.clearViewportInteractionCanvas();
      if (this.formalCanvasDrawPending) this.drawSurveyCanvas();
    }

    if (dirty && opts.persist) {
      this.scheduleFormalPersist();
    }
    return dirty;
  },

  drawSurveyCanvas(options) {
    if (!this.surveyCtx || !this.surveyRenderScene) return;
    const opts = options || {};
    const drawDecision = surveyViewportInteraction.resolveFormalDrawDecision({
      disposed: this.surveyCanvasDisposed,
      expectedRevision: opts.renderRevision,
      currentRevision: this.surveySceneRevision,
      viewportInteractionActive: !!(
        this.viewportInteraction && this.transientCanvasMode === 'viewport'
      )
    });
    if (drawDecision === 'drop' || drawDecision === 'stale') return false;
    // The primary canvas is also the owner of lightweight pan/pinch frames.
    // A delayed setData/image/init callback must not overwrite that frame with
    // a formal scene built for another viewport. Remember the request and let
    // finishViewportInteraction perform the single current-scene handoff.
    if (drawDecision === 'defer') {
      this.formalCanvasDrawPending = true;
      return false;
    }
    this.formalCanvasDrawPending = false;
    surveyCanvasRenderer.drawSurveyScene(this.surveyCtx, this.surveyRenderScene, {
      dpr: this.surveyCanvasDpr || 1
    });
    this.drawCanvasControls();
    this.drawSurveyGuideCanvas();
    if (this.viewportInteractionAwaitingHandoff) {
      this.viewportInteractionAwaitingHandoff = false;
      this.clearViewportInteractionCanvas();
    }
    return true;
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

    if (controls.closeAction && !this.isCursorLensActive()) {
      surveyCanvasRenderer.drawCloseAction(ctx, controls.closeAction);
    }

    if (controls.activeAngle) {
      const angle = controls.activeAngle;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(angle.anchor.x, angle.anchor.y, angle.arcRadius, angle.startAngle, angle.endAngle, angle.anticlockwise);
      ctx.stroke();

      ctx.shadowColor = 'rgba(249, 115, 22, 0.2)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.96)';
      this.drawRoundRect(ctx, angle.left, angle.top, angle.width, angle.height, 15);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.76)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#ea580c';
      ctx.font = '700 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(angle.text, angle.left + angle.width / 2, angle.top + angle.height / 2 + 1);
    }

    if (controls.measurePosition) {
      const measure = controls.measurePosition;
      const arrowAxis = measure.arrowAxis || { x: 1, y: 0 };
      const arrowAngle = Math.atan2(arrowAxis.y, arrowAxis.x);
      ctx.beginPath();
      ctx.fillStyle = 'rgba(65, 65, 69, 0.92)';
      ctx.arc(measure.button.cx, measure.button.cy, measure.button.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.save();
      ctx.translate(measure.button.cx, measure.button.cy);
      ctx.rotate(arrowAngle);
      ctx.fillStyle = '#ef4444';
      this.drawRoundRect(ctx, -12, -10, 4, 20, 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(-3, 0);
      ctx.lineTo(13, 0);
      ctx.moveTo(-3, 0);
      ctx.lineTo(2, -5);
      ctx.moveTo(-3, 0);
      ctx.lineTo(2, 5);
      ctx.moveTo(13, 0);
      ctx.lineTo(8, -5);
      ctx.moveTo(13, 0);
      ctx.lineTo(8, 5);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  },

  getSurveyGuideCanvasImage(src) {
    if (!src || !this.surveyCanvas || !this.surveyCanvas.createImage) return null;
    const cached = this.surveyGuideImageCache && this.surveyGuideImageCache[src];
    if (cached) return cached.loaded ? cached.image : null;

    const image = this.surveyCanvas.createImage();
    const entry = { image, loaded: false };
    this.surveyGuideImageCache[src] = entry;
    image.onload = () => {
      entry.loaded = true;
      this.drawSurveyCanvas();
    };
    image.onerror = () => {
      entry.failed = true;
    };
    image.src = src;
    return null;
  },

  wrapSurveyGuideCanvasBody(text, maxWidth, fontSize) {
    const content = String(text || '').trim();
    if (!content) return [''];
    const ctx = this.surveyCtx;
    const fallbackLimit = Math.max(8, Math.floor(maxWidth / Math.max(1, fontSize || 15)));
    if (!ctx || typeof ctx.measureText !== 'function') {
      return wrapGuideBody(content, fallbackLimit);
    }

    ctx.save();
    ctx.font = `500 ${fontSize}px sans-serif`;
    const lines = [];
    let line = '';
    Array.from(content).forEach((char) => {
      const nextLine = line + char;
      if (line && ctx.measureText(nextLine).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = nextLine;
      }
    });
    if (line) lines.push(line);
    ctx.restore();
    return lines;
  },

  drawSurveyGuideCanvas() {
    const ctx = this.surveyCtx;
    const model = this.surveyGuideCanvasModel;
    if (!ctx || !model || !model.card || !model.target || !model.character) return;

    const dpr = this.surveyCanvasDpr || 1;
    const { card, target, character, placement, connector, bodyLines, title, characterSrc, bodyFontSize, bodyLineHeight, scale } = model;
    const connectorTarget = connector && connector.target ? connector.target : target;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (!target.nativeOverlay) {
      ctx.beginPath();
      ctx.arc(target.x, target.y, Math.max(21, target.width * 0.48), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(234, 248, 236, 0.32)';
      ctx.fill();
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = 'rgba(34, 197, 94, 0.52)';
      ctx.stroke();
    }

    if (connector) {
      ctx.beginPath();
      ctx.moveTo(connector.start.x, connector.start.y);
      if (connector.type === 'polyline' && connector.points) {
        if (connector.points.length > 2) {
          for (let index = 1; index < connector.points.length - 1; index += 1) {
            const point = connector.points[index];
            const next = connector.points[index + 1];
            const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
            ctx.quadraticCurveTo(point.x, point.y, midpoint.x, midpoint.y);
          }
        }
        ctx.lineTo(connectorTarget.x, connectorTarget.y);
      } else {
        ctx.bezierCurveTo(
          connector.controlOne.x,
          connector.controlOne.y,
          connector.controlTwo.x,
          connector.controlTwo.y,
          connectorTarget.x,
          connectorTarget.y
        );
      }
      ctx.lineWidth = 1.25;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#00b94d';
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      const arrowFrom = connector.arrowFrom || connector.controlTwo;
      const tangentX = connectorTarget.x - arrowFrom.x;
      const tangentY = connectorTarget.y - arrowFrom.y;
      const arrowAngle = Math.atan2(tangentY, tangentX);
      const arrowSize = 8;
      ctx.beginPath();
      ctx.moveTo(connectorTarget.x, connectorTarget.y);
      ctx.lineTo(connectorTarget.x - arrowSize * Math.cos(arrowAngle - Math.PI / 5), connectorTarget.y - arrowSize * Math.sin(arrowAngle - Math.PI / 5));
      ctx.lineTo(connectorTarget.x - arrowSize * Math.cos(arrowAngle + Math.PI / 5), connectorTarget.y - arrowSize * Math.sin(arrowAngle + Math.PI / 5));
      ctx.closePath();
      ctx.fillStyle = '#00b94d';
      ctx.fill();
    }

    const mascot = this.getSurveyGuideCanvasImage(characterSrc);
    if (mascot) {
      ctx.drawImage(mascot, character.left, character.top, character.size, character.size);
    }

    ctx.shadowColor = 'rgba(24, 74, 45, 0.07)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    this.drawRoundRect(ctx, card.left, card.top, card.width, card.height, 18 * scale);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#b5efcb';
    ctx.lineWidth = 1.25 * scale;
    ctx.stroke();

    // Draw the tail after the card, overlapping its edge by one physical pixel
    // and stroking only the two sides. This yields one speech-bubble outline
    // instead of a triangle visibly stitched to a horizontal card border.
    const tailX = card.left + placement.pointerLeft;
    const tailHalfWidth = 8 * scale;
    const tailHeight = 8 * scale;
    const tailDown = placement.pointerDirection !== 'up';
    const edgeY = tailDown ? card.top + card.height : card.top;
    const baseY = edgeY + (tailDown ? -1 : 1);
    const tipY = edgeY + (tailDown ? tailHeight : -tailHeight);
    ctx.beginPath();
    ctx.moveTo(tailX - tailHalfWidth, baseY);
    ctx.lineTo(tailX + tailHalfWidth, baseY);
    ctx.lineTo(tailX, tipY);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(tailX - tailHalfWidth, baseY);
    ctx.lineTo(tailX, tipY);
    ctx.lineTo(tailX + tailHalfWidth, baseY);
    ctx.strokeStyle = '#b5efcb';
    ctx.lineWidth = 1.25 * scale;
    ctx.stroke();

    const labelWidth = 76 * scale;
    const labelHeight = 28 * scale;
    const labelX = card.left + 16 * scale;
    const labelY = card.top + 16 * scale;
    this.drawRoundRect(ctx, labelX, labelY, labelWidth, labelHeight, labelHeight / 2);
    ctx.fillStyle = '#c9f7d9';
    ctx.fill();
    ctx.fillStyle = '#00b94d';
    ctx.font = `600 ${14 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title || '小K提示', labelX + labelWidth / 2, labelY + labelHeight / 2 + 0.5);

    const sparkleX = labelX + labelWidth + 16 * scale;
    const sparkleY = labelY + labelHeight / 2;
    ctx.beginPath();
    ctx.moveTo(sparkleX, sparkleY - 8 * scale);
    ctx.lineTo(sparkleX + 2.5 * scale, sparkleY - 2.5 * scale);
    ctx.lineTo(sparkleX + 8 * scale, sparkleY);
    ctx.lineTo(sparkleX + 2.5 * scale, sparkleY + 2.5 * scale);
    ctx.lineTo(sparkleX, sparkleY + 8 * scale);
    ctx.lineTo(sparkleX - 2.5 * scale, sparkleY + 2.5 * scale);
    ctx.lineTo(sparkleX - 8 * scale, sparkleY);
    ctx.lineTo(sparkleX - 2.5 * scale, sparkleY - 2.5 * scale);
    ctx.closePath();
    ctx.fillStyle = '#00b94d';
    ctx.fill();

    ctx.fillStyle = '#1f2937';
    ctx.font = `500 ${bodyFontSize}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const lineHeight = bodyLineHeight;
    const bodyTop = labelY + labelHeight + 26 * scale;
    (bodyLines || []).forEach((line, index) => {
      ctx.fillText(line, card.left + 16 * scale, bodyTop + index * lineHeight);
    });
    ctx.restore();
  },

  getSurveyGuideTargetPoint(target, floor, session) {
    const rect = this.canvasRect || { width: 0, height: 0 };
    const rpx = this.rpxScale || ((rect.width || 375) / 750);
    const safeBottom = Number(this.data.bottomSafeArea || 0);
    if (!rect.width || !rect.height) return null;

    const dockCenterY = rect.height - safeBottom -
      (BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.bottom + BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.height / 2) * rpx;

    if (target === 'measure') {
      return {
        x: rect.width / 2 + BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.measureCenterOffsetX * rpx,
        y: dockCenterY,
        width: BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.measureWidth * rpx,
        height: BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.actionHeight * rpx,
        nativeOverlay: true
      };
    }
    if (target === 'dock-cursor') {
      return {
        x: rect.width / 2 + BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.cursorCenterOffsetX * rpx,
        y: dockCenterY,
        width: BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.cursorWidth * rpx,
        height: BOTTOM_DOCK_GUIDE_GEOMETRY_RPX.actionHeight * rpx,
        nativeOverlay: true
      };
    }
    if (target === 'finish') {
      return {
        x: rect.width - 54 * rpx,
        y: Number(this.data.statusBarHeight || 0) + 152 * rpx,
        width: 72 * rpx,
        height: 44 * rpx
      };
    }
    if (target === 'close' && this.canvasControls && this.canvasControls.closeAction) {
      const action = this.canvasControls.closeAction;
      return { x: action.cx, y: action.cy, width: 58, height: 42 };
    }
    if (target === 'measure-side' && this.canvasControls && this.canvasControls.measurePosition) {
      const button = this.canvasControls.measurePosition.button;
      return {
        x: button.cx,
        y: button.cy,
        width: button.radius * 2 + 16,
        height: button.radius * 2 + 16
      };
    }

    if (target === 'cursor' && session.anchorNodeId) {
      const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
      const cursorSource = surveyGraph.getCursorDisplayPoint(floor, session) || anchor;
      if (cursorSource) {
        const point = this.mmToCanvasPoint(cursorSource);
        return { x: point.x, y: point.y, width: 52, height: 52 };
      }
    }

    if (target === 'object') {
      const opening = session.selectedOpeningId
        ? surveyGraph.getOpening(floor, session.selectedOpeningId)
        : null;
      const wallId = session.selectedWallId || (opening && opening.wallId) || '';
      const wall = wallId ? surveyGraph.getWall(floor, wallId) : null;
      const start = wall && surveyGraph.getNode(floor, wall.startNodeId);
      const end = wall && surveyGraph.getNode(floor, wall.endNodeId);
      if (start && end) {
        const point = this.mmToCanvasPoint({
          xMm: (start.xMm + end.xMm) / 2,
          yMm: (start.yMm + end.yMm) / 2
        });
        return { x: point.x, y: point.y, width: 54, height: 54 };
      }
    }

    const guidePoint = target === 'preview' && session.previewPoint
      ? session.previewPoint
      : (session.anchorNodeId ? surveyGraph.getNode(floor, session.anchorNodeId) : null);
    if (!guidePoint) return null;
    const point = this.mmToCanvasPoint(guidePoint);
    return { x: point.x, y: point.y, width: 48, height: 48 };
  },

  getSurveyGuideObstacles() {
    const scene = this.surveyRenderScene || {};
    const controls = this.canvasControls || {};
    const obstacles = [];
    const append = (rect, config) => {
      if (!rect || ![rect.left, rect.right, rect.top, rect.bottom].every(Number.isFinite)) return;
      obstacles.push(Object.assign({}, rect, config || {}));
    };
    const boundsFromPoints = (points, padding) => {
      const valid = (points || []).filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y));
      if (!valid.length) return null;
      const gap = Number(padding) || 0;
      return {
        left: Math.min.apply(null, valid.map((point) => point.x)) - gap,
        right: Math.max.apply(null, valid.map((point) => point.x)) + gap,
        top: Math.min.apply(null, valid.map((point) => point.y)) - gap,
        bottom: Math.max.apply(null, valid.map((point) => point.y)) + gap
      };
    };
    const segmentBounds = (start, end, padding) => boundsFromPoints([start, end], padding);
    const measureWidth = (text, font) => {
      const ctx = this.surveyCtx;
      if (!ctx || typeof ctx.measureText !== 'function') return String(text || '').length * 8;
      ctx.save();
      ctx.font = font;
      const width = ctx.measureText(String(text || '')).width;
      ctx.restore();
      return width;
    };
    const rotatedLabelBounds = (center, width, height, angle) => {
      const cos = Math.cos(angle || 0);
      const sin = Math.sin(angle || 0);
      const corners = [
        { x: -width / 2, y: -height / 2 },
        { x: width / 2, y: -height / 2 },
        { x: width / 2, y: height / 2 },
        { x: -width / 2, y: height / 2 }
      ].map((point) => ({
        x: center.x + point.x * cos - point.y * sin,
        y: center.y + point.x * sin + point.y * cos
      }));
      return boundsFromPoints(corners, 2);
    };

    ((scene.walls || []).concat(scene.previewWall ? [scene.previewWall] : [])).forEach((wall) => {
      const rect = boundsFromPoints(wall.bodyPolygon || [wall.startPoint, wall.endPoint], 6);
      append(rect, {
        kind: wall.preview ? 'preview-wall' : 'wall',
        hard: false,
        weight: wall.isActiveMeasurement || wall.preview ? 950 : 360,
        pathHard: false,
        pathWeight: wall.isActiveMeasurement || wall.preview ? 520 : 90,
        pathPadding: 3
      });
    });

    (scene.openings || []).forEach((opening) => {
      append(boundsFromPoints(opening.hitPolygon, 5), {
        kind: 'opening',
        hard: false,
        weight: 720,
        pathHard: false,
        pathWeight: 420,
        pathPadding: 4
      });
    });

    (scene.dimensions || []).forEach((dimension) => {
      let labelRect = dimension.labelBox || null;
      let lineStart = null;
      let lineEnd = null;
      if (dimension.startPoint && dimension.endPoint) {
        lineStart = dimension.startPoint;
        lineEnd = dimension.endPoint;
        if (!labelRect) {
          const center = {
            x: (lineStart.x + lineEnd.x) / 2,
            y: (lineStart.y + lineEnd.y) / 2
          };
          const isBuildingOverall = dimension.kind === 'building-overall';
          const permanentFont = `${isBuildingOverall ? '600' : '500'} 12px sans-serif`;
          labelRect = rotatedLabelBounds(
            center,
            measureWidth(dimension.label, permanentFont) + 6,
            15,
            Math.atan2(lineEnd.y - lineStart.y, lineEnd.x - lineStart.x)
          );
        }
      } else if (dimension.wall) {
        const wall = dimension.wall;
        const startX = Number.isFinite(dimension.startX) ? dimension.startX : 0;
        const endX = Number.isFinite(dimension.endX) ? dimension.endX : wall.widthPx;
        const y = Number(dimension.offset) || 0;
        const toCanvas = (x, localY) => ({
          x: wall.startPoint.x + wall.direction.x * x + wall.localY.x * localY,
          y: wall.startPoint.y + wall.direction.y * x + wall.localY.y * localY
        });
        lineStart = toCanvas(startX, y);
        lineEnd = toCanvas(endX, y);
      }
      append(labelRect, {
        kind: 'dimension-label',
        hard: true,
        padding: 5,
        pathHard: true,
        pathWeight: 2400,
        pathPadding: 6
      });
      append(segmentBounds(lineStart, lineEnd, 3), {
        kind: 'dimension-line',
        hard: false,
        weight: 260,
        pathHard: false,
        pathWeight: 760,
        pathPadding: 4
      });
    });

    (scene.closedSpaceLabels || []).forEach((label) => {
      if (!label || !label.centroid) return;
      const scale = label.detailScale || 1;
      const titleWidth = measureWidth(label.roomName, `bold ${12 * scale}px sans-serif`);
      const metricWidth = Math.max(
        measureWidth(`H=${label.ceilingHeightMm}mm`, `${9 * scale}px sans-serif`),
        measureWidth(`S≈${label.areaM2}m²`, `${9 * scale}px sans-serif`)
      );
      const rawWidth = Math.ceil(Math.max(titleWidth, metricWidth) + 24 * scale);
      const rawHeight = 52 * scale;
      const fitScale = Math.min(
        1,
        label.detailMaxWidthPx ? label.detailMaxWidthPx / rawWidth : 1,
        label.detailMaxHeightPx ? label.detailMaxHeightPx / rawHeight : 1
      );
      const width = rawWidth * fitScale;
      const height = rawHeight * fitScale;
      append({
        left: label.centroid.x - width / 2,
        right: label.centroid.x + width / 2,
        top: label.centroid.y - height / 2,
        bottom: label.centroid.y + height / 2
      }, {
        kind: 'room-label',
        hard: true,
        padding: 6,
        pathHard: true,
        pathWeight: 2200,
        pathPadding: 6
      });
    });

    if (scene.activeSegment && scene.activeSegment.lengthMm) {
      const rpx = this.rpxScale || ((this.canvasRect && this.canvasRect.width) || 390) / 750;
      const top = Number(this.data.overlayContentTop || 0);
      append({ left: 16 * rpx, right: 300 * rpx, top, bottom: top + 96 * rpx }, {
        kind: 'top-measurement',
        hard: true,
        padding: 5,
        pathHard: true,
        pathWeight: 1800,
        pathPadding: 5
      });
    }

    if (this.selectedWallToolbarRect) {
      append(this.selectedWallToolbarRect, {
        kind: 'wall-toolbar',
        hard: true,
        padding: 6,
        pathHard: true,
        pathWeight: 1800,
        pathPadding: 6
      });
    }
    if (controls.activeAngle) {
      append({
        left: controls.activeAngle.left,
        right: controls.activeAngle.left + controls.activeAngle.width,
        top: controls.activeAngle.top,
        bottom: controls.activeAngle.top + controls.activeAngle.height
      }, {
        kind: 'angle-control',
        hard: true,
        padding: 5,
        pathHard: true,
        pathWeight: 1600,
        pathPadding: 5
      });
    }
    if (controls.closeAction) {
      append({
        left: controls.closeAction.cx - 28,
        right: controls.closeAction.cx + 28,
        top: controls.closeAction.cy - 24,
        bottom: controls.closeAction.cy + 24
      }, {
        kind: 'close-action',
        hard: true,
        padding: 5,
        pathHard: false,
        pathWeight: 0
      });
    }
    if (controls.measurePosition && controls.measurePosition.button) {
      const button = controls.measurePosition.button;
      append({
        left: button.cx - button.radius,
        right: button.cx + button.radius,
        top: button.cy - button.radius,
        bottom: button.cy + button.radius
      }, {
        kind: 'measure-position-action',
        hard: true,
        padding: 7,
        pathHard: false,
        pathWeight: 0
      });
    }

    return obstacles;
  },

  buildSurveyGuideData(floor, session, cursorPlacementState, presentationState) {
    const state = presentationState || this.data;
    const guide = resolveSurveyGuide({
      guideEnabled: !!this.guideEnabled,
      completed: !!this.guideSessionCompleted,
      floor,
      session,
      cursorPlacementState,
      cursorSnapLabel: state.cursorLensSnapLabel,
      bleConnected: !!state.bleConnected,
      canSetInitialMeasurementSide: this.isFirstMeasurePositionStage(floor, session),
      numberPadVisible: !!state.numberPadVisible,
      angleMeasureVisible: !!state.angleMeasureVisible,
      componentEditorVisible: !!state.componentEditorVisible
    });

    if (!guide) {
      this.surveyGuideCanvasModel = null;
      this.surveyGuideLayoutCache = null;
      return {
        surveyGuideVisible: false,
        surveyGuideTarget: ''
      };
    }

    const guideBody = guide.dynamicCursorLabel && state.cursorLensSnapLabel
      ? `${state.cursorLensSnapLabel}，松手确定起点。`
      : guide.body;
    const rect = this.canvasRect || { width: 0, height: 0 };
    const target = this.getSurveyGuideTargetPoint(guide.target, floor, session);
    if (!target || !rect.width || !rect.height) {
      this.surveyGuideCanvasModel = null;
      return {
        surveyGuideVisible: true,
        surveyGuideTarget: guide.target
      };
    }

    const designScale = Math.max(0.82, Math.min(1.08, rect.width / 390));
    const safeArea = this.getCanvasControlSafeArea(rect);
    const cardWidth = Math.max(168 * designScale, Math.min(180 * designScale, safeArea.right - safeArea.left));
    const bodyFontSize = 15 * designScale;
    const bodyLineHeight = 20 * designScale;
    const bodyLines = this.wrapSurveyGuideCanvasBody(
      guideBody,
      cardWidth - 32 * designScale,
      bodyFontSize
    );
    const bodyFirstBaseline = (16 + 28 + 26) * designScale;
    const bodyBottomPadding = 22 * designScale;
    const cardHeight = Math.max(
      112 * designScale,
      bodyFirstBaseline + Math.max(0, bodyLines.length - 1) * bodyLineHeight + bodyBottomPadding
    );
    const spatialTargets = ['cursor', 'preview', 'close', 'measure-side', 'object', 'dock-cursor', 'measure'];
    const gap = (spatialTargets.indexOf(guide.target) >= 0 ? 124 : 24) * designScale;
    const previousLayout = this.surveyGuideLayoutCache && this.surveyGuideLayoutCache.key === guide.key
      ? this.surveyGuideLayoutCache
      : null;
    const layoutInput = {
      target,
      safeArea,
      cardWidth,
      cardHeight,
      gap,
      characterSize: 70 * designScale,
      obstacles: this.getSurveyGuideObstacles(),
      previousLayout,
      preferCharacterBelowCard: !!target.nativeOverlay
    };
    const layout = solveGuideLayout(layoutInput);
    if (!layout) {
      this.surveyGuideCanvasModel = null;
      return {
        surveyGuideVisible: false,
        surveyGuideTarget: guide.target
      };
    }
    const { card, placement, character } = layout;
    const connector = target.nativeOverlay
      ? buildDirectGuideConnector(
        { x: character.handX, y: character.handY },
        {
          x: target.x,
          y: target.y - target.height / 2 - 5 * designScale
        }
      )
      : layout.connector;
    this.surveyGuideLayoutCache = {
      key: guide.key,
      card,
      character
    };
    const characterSources = {
      left: '/packages/surveying/assets/surveying-guide-k-left-v3.png',
      right: '/packages/surveying/assets/surveying-guide-k-right-v3.png',
      down: '/packages/surveying/assets/surveying-guide-k-down-v3.png'
    };
    this.surveyGuideCanvasModel = {
      card,
      target,
      placement,
      character,
      connector,
      bodyLines,
      title: '小K提示',
      characterSrc: characterSources[character.pose],
      bodyFontSize,
      bodyLineHeight,
      scale: designScale
    };
    return {
      surveyGuideVisible: true,
      surveyGuideTarget: guide.target
    };
  },

  syncFromDraft(extraData) {
    if (!this.draft) return;

    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const selectedWall = this.buildSelectedWall(floor, session.selectedWallId);
    const stageMessage = this.buildStageMessage(floor, session, selectedWall);
    const bottomState = this.buildBottomActionState(floor, session);
    const cursorPlacementState = this.resolveCursorPlacementState(floor, session);
    if (cursorPlacementState !== 'dragging') {
      this.cursorPlacementState = cursorPlacementState;
    }
    const renderData = this.buildCanvasRenderData(floor, session);
    const renderRevision = this.surveySceneRevision;
    // A canvas-originated wall drag keeps the formal placement state as
    // `placed`, but its lens occupies the same upper-left lane. Keep the
    // regular live-measurement bubble out of that lane for the whole drag.
    const topMetricSuppressed = cursorPlacementState !== 'placed' || this.canvasCursorLensActive;
    const selectedOpening = this.buildSelectedOpening(floor, session.selectedOpeningId);
    const requestedComponentSpecMode = (extraData && extraData.componentSpecMode) || this.data.componentSpecMode;
    const componentState = this.buildComponentEditorState(floor, selectedOpening, requestedComponentSpecMode);
    const presentationState = Object.assign({}, this.data, extraData || {});
    const surveyGuideData = this.buildSurveyGuideData(
      floor,
      session,
      cursorPlacementState,
      presentationState
    );

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
      topMetricVisible: !topMetricSuppressed && renderData.topMetricVisible,
      topMetricLength: topMetricSuppressed ? '' : renderData.topMetricLength,
      topMetricAngle: topMetricSuppressed ? '' : renderData.topMetricAngle,
      angleActionAvailable: (session.mode === 'diagonal' && !!session.previewPoint &&
        (session.state === 'wallPreview' || session.state === 'awaitingLength') && floor.walls.length > 0) ||
        this.canRemeasureLastDiagonalAngle(floor, session),
      measurePositionVisible: renderData.measurePositionVisible,
      measurePositionStyle: renderData.measurePositionStyle,
      measurePositionButtonLabel: renderData.measurePositionButtonLabel,
      canSwitchInitialMeasurementSide: this.isFirstMeasurePositionStage(floor, session),
      closureGuideVisible: renderData.closureGuideVisible,
      closureGuideStyle: renderData.closureGuideStyle,
      closeActionVisible: renderData.closeActionVisible && !this.isCursorLensActive(),
      closeActionStyle: renderData.closeActionStyle,
      selectedWall,
      selectedOpening,
      canResumeWallDrawing: !!selectedOpening && floor.walls.length > 0 && !floor.spaces.some((space) => space.closed),
      componentEditorTitle: componentState.title,
      componentTypeLabel: componentState.typeLabel,
      componentSpecMode: componentState.specMode,
      componentSpecOptions: componentState.specOptions,
      componentSpecLabel: componentState.specLabel,
      componentSelectedOpening: componentState.opening,
      componentSpecValue: componentState.specValue,
      spaceSummary: this.buildSpaceSummary(),
      measurementTitle: stageMessage.title,
      measurementValue: stageMessage.value,
      isSurveyEmpty: !floor.walls.length,
      guideEnabled: !!this.guideEnabled,
      modePillText: bottomState.modePillText,
      manualActionActive: bottomState.manualActionActive,
      manualActionSubtitle: bottomState.manualActionSubtitle,
      cursorActionSubtitle: bottomState.cursorActionSubtitle,
      cursorPlacementState,
      historySummary: {
        undo: this.history.undo.length,
        redo: this.history.redo.length
      }
    }, surveyGuideData, extraData || {}), () => {
      if (renderRevision !== this.surveySceneRevision || this.surveyCanvasDisposed) return;
      this.drawSurveyCanvas({ renderRevision });
      // A cursor-drag frame can finish after its drop event on native Canvas.
      // Clear the transient layer after the formal redraw so it cannot cover a
      // closed room with an obsolete frame after snapping to a wall.
      // Canvas-originated wall drags do not change cursorPlacementState to
      // `dragging`. They still own an active lens, so clearing this layer here
      // would erase it after every formal-canvas redraw and make it flicker.
      if (!this.isCursorLensActive()) {
        this.clearCursorDragCanvas({ force: true });
      }
      if (this.data.cursorPlacementState === 'awaitingWallDrop') {
        this.refreshCursorControlRect();
      } else if (this.data.cursorPlacementState !== 'dragging') {
        this.cursorControlRect = null;
      }
      if (this.data.componentEditorVisible) {
        this.scheduleComponentSceneRender();
      }
    });
  },

  centerSelectedWall(numPadVisible) {
    if (!this.canvasRect || !this.draft) return;
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const wallId = session.selectedWallId;
    if (!wallId) return;

    const wall = surveyGraph.getWall(floor, wallId);
    if (!wall) return;

    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const midXMm = (start.xMm + end.xMm) / 2;
    const midYMm = (start.yMm + end.yMm) / 2;

    const viewport = this.getViewport();
    const scale = viewport.scale;

    const padHeight = numPadVisible ? 240 : 0;

    const nextOffsetX = -midXMm * scale;
    const nextOffsetY = -midYMm * scale - (padHeight / 2);

    this.draft = surveyGraph.updateViewport(this.draft, {
      offsetX: nextOffsetX,
      offsetY: nextOffsetY
    });
  },

  buildComponentEditorState(floor, selectedOpening, requestedSpecMode) {
    const mode = selectedOpening && selectedOpening.type === 'window' ? 'window' : 'door';
    const specOptions = (COMPONENT_SPEC_OPTIONS[mode] || COMPONENT_SPEC_OPTIONS.door).map((item) => Object.assign({}, item, {
      value: selectedOpening ? this.getComponentSpecRawValue(floor, selectedOpening.id, item.key) : '0'
    }));
    const specMode = specOptions.some((item) => item.key === requestedSpecMode)
      ? requestedSpecMode
      : 'length';
    const activeSpec = specOptions.find((item) => item.key === specMode) || specOptions[0];
    const typeLabel = mode === 'window' ? '窗' : '门';

    return {
      mode,
      title: selectedOpening ? `编辑${typeLabel}` : '编辑门窗',
      typeLabel,
      specMode,
      specOptions,
      specLabel: activeSpec ? activeSpec.label : '尺寸',
      opening: selectedOpening,
      specValue: selectedOpening ? this.getComponentSpecRawValue(floor, selectedOpening.id, specMode) : '0'
    };
  },

  getComponentSpecRawValue(floor, openingId, mode) {
    const opening = surveyGraph.getOpening(floor, openingId);
    if (!opening) return '0';
    const wall = surveyGraph.getWall(floor, opening.wallId);
    const wallLength = wall ? wall.lengthMm || 0 : 0;
    const openingWidth = opening.widthMm || 0;
    const edge1 = Math.max(0, Math.round((opening.centerOffsetMm || 0) - openingWidth / 2));
    const edge2 = Math.max(0, Math.round(wallLength - edge1 - openingWidth));
    const valueMap = {
      length: opening.widthMm || 0,
      depth: opening.depthMm || (wall && wall.thicknessMm) || 0,
      height: opening.heightMm || 0,
      sill: opening.sillHeightMm || 0,
      edge1,
      edge2
    };
    return String(Math.round(valueMap[mode] || 0));
  },

  buildCanvasRenderData(floor, session) {
    const scene = surveyCanvasRenderer.createSurveyRenderScene({
      floor,
      session,
      viewport: this.getViewport(),
      rect: this.canvasRect || { width: 0, height: 0 }
    });
    this.surveyRenderScene = scene;
    this.surveySceneRevision = (this.surveySceneRevision || 0) + 1;
    const wallUnionSignature = ['closed', 'open'].map((group) => {
      const plan = scene.wallSolidPlans && scene.wallSolidPlans[group];
      const rings = (plan && plan.rings) || [];
      return `${group}=${rings.length}[${rings.map((ring) => ring.length).join(',')}]`;
    }).join(' ');
    if (this.surveyWallUnionSignature !== wallUnionSignature) {
      this.surveyWallUnionSignature = wallUnionSignature;
      console.info(
        `[surveying-editor] Wall union ${surveyCanvasRenderer.RENDER_REVISION} ${wallUnionSignature}`
      );
    }
    let cursorVisible = false;
    let guideVisible = false;
    let cursorStyle = '';
    let cursorHorizontalGuideStyle = '';
    let cursorVerticalGuideStyle = '';
    if (
      this.resolveCursorPlacementState(floor, session) === 'placed' &&
      session.anchorNodeId &&
      session.state !== 'spaceClosed' &&
      session.state !== 'wallSelected' &&
      session.state !== 'remeasureAwaitingInput'
    ) {
      const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
      if (anchor) {
        const cursorPoint = surveyGraph.getCursorDisplayPoint(floor, session) || anchor;
        const cursorScreenPoint = this.mmToCanvasPoint(cursorPoint);
        cursorVisible = true;
        cursorStyle = `left:${roundPx(cursorScreenPoint.x - 24)}px; top:${roundPx(cursorScreenPoint.y - 24)}px;`;

        if (floor.walls.length > 0) {
          const anchorScreenPoint = this.mmToCanvasPoint(cursorPoint);
          guideVisible = true;
          cursorHorizontalGuideStyle = `top:${roundPx(anchorScreenPoint.y)}px;`;
          cursorVerticalGuideStyle = `left:${roundPx(anchorScreenPoint.x)}px;`;
        }
      }
    }

    const activeSegment = scene.activeSegment;
    const angleActionAvailable = (session.mode === 'diagonal' && !!session.previewPoint &&
      (session.state === 'wallPreview' || session.state === 'awaitingLength') && floor.walls.length > 0) ||
      this.canRemeasureLastDiagonalAngle(floor, session);
    const topMetric = this.buildTopMetric(activeSegment);
    if (angleActionAvailable && !topMetric.angle) {
      const previousWall = floor.walls[floor.walls.length - 1];
      const turningAngle = previousWall
        ? normalizeAngleDiff(session.previewAngleDeg, previousWall.angleDeg)
        : null;
      const interiorAngle = Number.isFinite(session.previewInteriorAngleDeg)
        ? session.previewInteriorAngleDeg
        : (turningAngle === null ? null : 180 - turningAngle);
      if (Number.isFinite(interiorAngle)) {
        topMetric.angle = `∠${Math.round(interiorAngle)}°`;
      }
    }
    const measurePosition = this.buildMeasurePosition(activeSegment, floor, session);
    const closure = this.buildClosureRender(floor, session);
    const activeAngle = this.buildActiveAngleControl(scene, angleActionAvailable);
    this.canvasControls = this.buildCanvasControls(
      measurePosition,
      closure,
      activeAngle
    );

    return {
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
      closureGuideVisible: false,
      closureGuideStyle: '',
      closeActionVisible: closure.actionVisible,
      closeActionStyle: closure.actionStyle
    };
  },

  buildCanvasControls(measurePosition, closure, activeAngle) {
    const measureControl = measurePosition && measurePosition.control
      ? Object.assign({}, measurePosition.control)
      : null;
    return {
      closeAction: closure && closure.action
        ? Object.assign({ key: 'close', radius: 14 }, closure.action)
        : null,
      measurePosition: measureControl,
      activeAngle: activeAngle || null
    };
  },

  buildActiveAngleControl(scene, angleActionAvailable) {
    const segment = scene && scene.activeSegment;
    const walls = (scene && scene.walls) || [];
    const previousWall = segment && segment.preview
      ? walls[walls.length - 1]
      : walls[walls.length - 2];
    if (!angleActionAvailable || !segment || !previousWall ||
      !Number.isFinite(segment.interiorAngleDeg)) {
      return null;
    }

    const anchor = segment.startPoint;
    const incoming = { x: -previousWall.direction.x, y: -previousWall.direction.y };
    const outgoing = segment.direction;
    const bisectorRaw = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
    const bisectorLength = Math.sqrt(bisectorRaw.x * bisectorRaw.x + bisectorRaw.y * bisectorRaw.y);
    if (!anchor) return null;

    const bisector = bisectorLength
      ? { x: bisectorRaw.x / bisectorLength, y: bisectorRaw.y / bisectorLength }
      : { x: -incoming.y, y: incoming.x };
    const arcRadius = 26;
    const labelWidth = 68;
    const labelHeight = 30;
    const rect = this.canvasRect || { width: 0, height: 0 };
    const labelCenter = {
      x: clamp(anchor.x + bisector.x * 54, labelWidth / 2 + 8, Math.max(labelWidth / 2 + 8, rect.width - labelWidth / 2 - 8)),
      y: clamp(anchor.y + bisector.y * 54, labelHeight / 2 + 8, Math.max(labelHeight / 2 + 8, rect.height - labelHeight / 2 - 8))
    };
    const startAngle = Math.atan2(incoming.y, incoming.x);
    const rawSweep = Math.atan2(
      incoming.x * outgoing.y - incoming.y * outgoing.x,
      incoming.x * outgoing.x + incoming.y * outgoing.y
    );

    return {
      key: 'angle',
      anchor,
      arcRadius,
      startAngle,
      endAngle: startAngle + rawSweep,
      anticlockwise: rawSweep < 0,
      left: labelCenter.x - labelWidth / 2,
      top: labelCenter.y - labelHeight / 2,
      width: labelWidth,
      height: labelHeight,
      text: `∠${Math.round(segment.interiorAngleDeg)}°`
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
    const rawThickness = (thicknessMm || surveyGraph.DEFAULT_THICKNESS_MM) * scale;
    return Math.max(MIN_WALL_THICKNESS_PX, rawThickness);
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
      measurementStartInsetMm: session.previewMeasurementStartInsetMm || 0,
      measurementStartExtensionMm: session.previewMeasurementStartExtensionMm || 0,
      measurementEndInsetMm: session.previewMeasurementEndInsetMm || 0,
      measurementSide: session.previewMeasurementSide || session.measurementSide,
      bodyNormalSide: session.previewBodyNormalSide || '',
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
    const renderStart = geometry && geometry.start ? geometry.start : start;
    const renderEnd = geometry && geometry.end ? geometry.end : end;
    const startPoint = this.mmToCanvasPoint(renderStart);
    const endPoint = this.mmToCanvasPoint(renderEnd);
    const width = distancePx(startPoint, endPoint);
    const viewport = this.getViewport();
    const thicknessPx = geometry
      ? geometry.thicknessMm * viewport.scale
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
      angle: Number.isFinite(segment.interiorAngleDeg)
        ? `∠${Math.round(segment.interiorAngleDeg)}°`
        : ''
    };
  },

  isFirstMeasurePositionStage(floor, session) {
    return surveyGraph.canSetInitialMeasurementSide(floor, session);
  },

  getCanvasControlSafeArea(rect) {
    const designScale = Math.max(0.82, Math.min(1.08, rect.width / 390));
    const edgeInset = 12 * designScale;
    const rightRailReserve = 105 * designScale;
    const bottomDockReserve = 128 * designScale;
    const topInset = Math.max(edgeInset, (this.data.overlayContentTop || 0) + edgeInset);
    return {
      left: edgeInset,
      top: topInset,
      right: Math.max(edgeInset, rect.width - rightRailReserve - edgeInset),
      bottom: Math.max(topInset, rect.height - bottomDockReserve)
    };
  },

  constrainCanvasCircle(circle, safeArea) {
    return Object.assign({}, circle, {
      cx: clamp(circle.cx, safeArea.left + circle.radius, safeArea.right - circle.radius),
      cy: clamp(circle.cy, safeArea.top + circle.radius, safeArea.bottom - circle.radius)
    });
  },

  buildMeasurePosition(segment, floor, session) {
    if (!this.isFirstMeasurePositionStage(floor, session)) {
      return { visible: false, style: '', buttonLabel: '', control: null };
    }

    const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
      ? session.activeSpaceStartWallIndex
      : 0;
    const wall = floor.walls[startWallIndex];
    const start = wall && surveyGraph.getNode(floor, wall.startNodeId);
    const end = wall && surveyGraph.getNode(floor, wall.endNodeId);
    const startPoint = segment && (segment.measurementStartPoint || segment.startPoint)
      ? (segment.measurementStartPoint || segment.startPoint)
      : (start ? this.mmToCanvasPoint(start) : null);
    const endPoint = segment && (segment.measurementEndPoint || segment.endPoint)
      ? (segment.measurementEndPoint || segment.endPoint)
      : (end ? this.mmToCanvasPoint(end) : null);
    const measurementSide = segment && segment.measurementSide
      ? segment.measurementSide
      : (wall ? wall.measurementSide : session.previewMeasurementSide || session.measurementSide);
    if (!startPoint || !endPoint) {
      return { visible: false, style: '', buttonLabel: '', control: null };
    }

    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) return { visible: false, style: '', buttonLabel: '', control: null };

    const leftNormal = { x: -dy / length, y: dx / length };
    const sideNormal = measurementSide === 'right'
      ? { x: -leftNormal.x, y: -leftNormal.y }
      : leftNormal;
    const rect = this.canvasRect || { width: 0, height: 0 };
    const safeArea = this.getCanvasControlSafeArea(rect);
    const radius = 22;
    const target = {
      x: (startPoint.x + endPoint.x) / 2,
      y: (startPoint.y + endPoint.y) / 2
    };
    const button = this.constrainCanvasCircle({
      cx: target.x + sideNormal.x * 94,
      cy: target.y + sideNormal.y * 94,
      radius
    }, safeArea);
    const control = {
      key: 'measure-position',
      arrowAxis: sideNormal,
      button
    };

    return {
      visible: true,
      style: '',
      buttonLabel: '',
      control
    };
  },

  buildClosureRender(floor, session) {
    if ((!session.closeCandidateNodeId && !session.closeCandidatePoint) || (!session.previewPoint && !session.anchorNodeId)) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
      ? session.activeSpaceStartWallIndex
      : 0;
    const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
    const minimumActiveWallCount = surveyGraph.getMinimumActiveCloseWallCount(floor, session);
    if (activeWallCount + (session.previewPoint ? 1 : 0) < minimumActiveWallCount) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const closurePath = surveyGraph.getClosurePath(floor, session);
    if (closurePath.length < 2) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const canvasPath = closurePath.map((point) => this.mmToCanvasPoint(point));
    const startPoint = canvasPath[0];
    const endPoint = canvasPath[canvasPath.length - 1];
    const rawWidth = canvasPath.slice(1).reduce((total, point, index) => (
      total + distancePx(canvasPath[index], point)
    ), 0);
    const lastWall = floor.walls[floor.walls.length - 1] || null;
    const width = session.state === 'closing' ? Math.max(rawWidth, 72) : rawWidth;
    const angleDeg = rawWidth > 1
      ? Math.atan2(endPoint.y - startPoint.y, endPoint.x - startPoint.x) * 180 / Math.PI
      : (lastWall ? lastWall.angleDeg : 0);
    const pathMidpoint = getPolylineMidpoint(canvasPath) || getMidPoint(startPoint, endPoint);
    const midX = pathMidpoint.x;
    const midY = pathMidpoint.y;
    const rect = this.canvasRect || { width: 0, height: 0 };
    const actionRadius = 14;
    const safePadding = actionRadius + 8;
    const bottomReserved = 132;
    const preferredActionX = session.state === 'closing' ? startPoint.x : midX;
    const preferredActionY = session.state === 'closing' ? startPoint.y - 88 : midY;
    const actionX = clamp(preferredActionX, safePadding, Math.max(safePadding, rect.width - safePadding));
    const actionY = clamp(preferredActionY, safePadding, Math.max(safePadding, rect.height - safePadding - bottomReserved));

    const actionVisible = session.state === 'closing' || session.state === 'mergeClosing' ||
      ((session.state === 'wallPreview' || session.state === 'awaitingLength') && !!session.previewPoint);
    const action = { cx: actionX, cy: actionY };
    return {
      guideVisible: width > 1,
      guideStyle: `left:${roundPx(startPoint.x)}px; top:${roundPx(startPoint.y)}px; width:${roundPx(width)}px; transform:rotate(${roundPx(angleDeg)}deg);`,
      actionVisible,
      actionStyle: `left:${roundPx(actionX - actionRadius)}px; top:${roundPx(actionY - actionRadius)}px;`,
      action
    };
  },

  formatWallLabel(wall) {
    const lengthLabel = formatMm(wall.lengthMm);
    if (wall.mode === 'diagonal') {
      return `${lengthLabel} ∠ ${Math.round(wall.angleDeg)}°`;
    }
    return lengthLabel;
  },

  buildSelectedWall(floor, wallId) {
    this.selectedWallToolbarRect = null;
    if (!wallId) return null;
    const wall = surveyGraph.getWall(floor, wallId);
    if (!wall) return null;
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    let actionStyle = '';
    if (start && end) {
      const startPoint = this.mmToCanvasPoint(start);
      const endPoint = this.mmToCanvasPoint(end);
      const midX = (startPoint.x + endPoint.x) / 2;
      const midY = (startPoint.y + endPoint.y) / 2;
      const rect = this.canvasRect || { width: 0, height: 0 };
      const dx = endPoint.x - startPoint.x;
      const dy = endPoint.y - startPoint.y;
      const length = Math.sqrt(dx * dx + dy * dy) || 1;
      const normal = { x: -dy / length, y: dx / length };
      const toolbarWidth = WALL_TOOLBAR_VISIBLE_ACTIONS * WALL_TOOLBAR_ACTION_WIDTH_PX +
        (WALL_TOOLBAR_VISIBLE_ACTIONS - 1) * WALL_TOOLBAR_ACTION_GAP_PX +
        WALL_TOOLBAR_HORIZONTAL_PADDING_PX + WALL_TOOLBAR_BORDER_PX;
      const toolbarHeight = 54;
      const candidateOffsets = [56, -74, 92, -110];
      const toolbarPoint = candidateOffsets.map((offset) => ({
        left: midX + normal.x * offset - toolbarWidth / 2,
        top: midY + normal.y * offset - toolbarHeight / 2,
        offset
      })).find((candidate) => (
        candidate.left >= 12 &&
        candidate.top >= 18 &&
        candidate.left + toolbarWidth <= rect.width - 12 &&
        candidate.top + toolbarHeight <= rect.height - 18
      )) || {
        left: clamp(midX - toolbarWidth / 2, 12, Math.max(12, rect.width - toolbarWidth - 12)),
        top: clamp(midY - 80, 18, Math.max(18, rect.height - toolbarHeight - 18)),
        offset: -80
      };
      this.selectedWallToolbarRect = {
        left: toolbarPoint.left,
        right: toolbarPoint.left + toolbarWidth,
        top: toolbarPoint.top,
        bottom: toolbarPoint.top + toolbarHeight
      };
      actionStyle = `left:${roundPx(toolbarPoint.left)}px; top:${roundPx(toolbarPoint.top)}px;`;
    }

    return {
      id: wall.id,
      length: formatMm(wall.lengthMm),
      angle: `${Math.round(wall.angleDeg)}°`,
      thickness: formatMm(wall.thicknessMm),
      side: wall.measurementSide === 'left' ? '左侧' : '右侧',
      mode: wall.mode === 'diagonal' ? '斜墙' : '直墙',
      actionStyle
    };
  },

  buildSelectedOpening(floor, openingId) {
    if (!openingId) return null;
    const opening = surveyGraph.getOpening(floor, openingId);
    if (!opening) return null;
    const wall = surveyGraph.getWall(floor, opening.wallId);
    const wallLength = wall ? (wall.lengthMm || 0) : 0;
    const width = opening.widthMm || 0;
    const edge1 = Math.max(0, Math.round((opening.centerOffsetMm || 0) - width / 2));
    const edge2 = Math.max(0, Math.round(wallLength - edge1 - width));

    return {
      id: opening.id,
      wallId: opening.wallId,
      type: opening.type,
      typeLabel: opening.type === 'window' ? '窗' : '门',
      width: formatCompactMm(opening.widthMm),
      depth: formatMm(opening.depthMm || (wall && wall.thicknessMm) || 0),
      height: formatCompactMm(opening.heightMm),
      sill: formatMm(opening.sillHeightMm || 0),
      offset: formatMm(opening.centerOffsetMm || 0),
      edge1: formatMm(edge1),
      edge2: formatMm(edge2),
      wallLength: formatMm(wallLength),
      modelId: opening.modelId || '',
      modelCategory: opening.modelCategory || '',
      materialId: opening.materialId || '',
      modelLabel: this.getComponentModelLabel(opening),
      swatch: this.getComponentModelSwatch(opening),
      entryDoor: !!opening.entryDoor,
      openDirection: opening.openDirection === 'outside' ? 'outside' : 'inside',
      openDirectionLabel: opening.openDirection === 'outside' ? '外开' : '内开'
    };
  },

  getComponentModelLabel(opening) {
    const type = opening && opening.type === 'window' ? 'window' : 'door';
    const item = (COMPONENT_LIBRARY[type] || []).find((option) => option.id === opening.modelId);
    return item ? item.label : (type === 'window' ? '本地窗模型' : '本地门模型');
  },

  getComponentModelSwatch(opening) {
    const type = opening && opening.type === 'window' ? 'window' : 'door';
    const item = (COMPONENT_LIBRARY[type] || []).find((option) => option.id === opening.modelId);
    return item ? item.swatch : '#9ca3af';
  },

  buildSpaceSummary() {
    const areaMm2 = surveyGraph.calculateSpaceAreaMm2(this.draft);
    if (!areaMm2) return null;
    return {
      area: `${(areaMm2 / 1000000).toFixed(2)} m²`,
      label: '单空间已闭合'
    };
  },

  buildBottomActionState(floor, session) {
    if (session.state === 'awaitingLength' || session.state === 'wallPreview') {
      return {
        modePillText: '待输入长度',
        manualActionActive: true,
        manualActionSubtitle: '确认当前墙',
        cursorActionSubtitle: '取消待测墙'
      };
    }

    if (session.state === 'remeasureAwaitingInput') {
      return {
        modePillText: '复尺模式',
        manualActionActive: true,
        manualActionSubtitle: '输入复尺值',
        cursorActionSubtitle: '退出复尺'
      };
    }

    if (session.state === 'closing' || session.state === 'mergeClosing') {
      return {
        modePillText: '可闭合',
        manualActionActive: false,
        manualActionSubtitle: '继续补测',
        cursorActionSubtitle: '保留闭合点'
      };
    }

    if (session.state === 'wallSnapPending') {
      return {
        modePillText: '放置光标',
        manualActionActive: false,
        manualActionSubtitle: '拖到目标位置',
        cursorActionSubtitle: '取消吸附'
      };
    }

    if (session.state === 'spaceClosed') {
      return {
        modePillText: '已闭合',
        manualActionActive: false,
        manualActionSubtitle: '选择墙复尺',
        cursorActionSubtitle: '已完成'
      };
    }

    return {
      modePillText: floor.walls.length ? '继续测墙' : '测墙模式',
      manualActionActive: false,
      manualActionSubtitle: floor.walls.length ? '拖墙后输入' : '输入当前墙',
      cursorActionSubtitle: '保留已测墙'
    };
  },

  resolveCursorPlacementState(floor, session) {
    if (this.cursorPlacementState === 'dragging') return 'dragging';
    if (!floor || !session) return 'placed';
    if (session.state === 'wallSnapPending') {
      return 'awaitingWallDrop';
    }
    return this.cursorPlacementState === 'awaitingWallDrop' ? 'awaitingWallDrop' : 'placed';
  },

  enterResetCursorAfterClose(draft) {
    const floor = draft && surveyGraph.getActiveFloor(draft);
    const session = floor && floor.session;
    if (!session || session.state !== 'spaceClosed') return draft;
    this.cursorPlacementState = 'awaitingWallDrop';
    return surveyGraph.startWallSnap(draft);
  },

  resetCursorPlacement() {
    this.clearCursorDragCanvas({ force: true });
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (!floor.walls.length) {
      this.cursorPlacementState = 'placed';
      this.applyDraft(surveyGraph.resetCursor(this.draft), { persist: true });
      wx.showToast({ title: '光标已复位', icon: 'none' });
      return;
    }

    this.cursorPlacementState = 'awaitingWallDrop';
    this.applyDraft(surveyGraph.startWallSnap(this.draft), { persist: true, recordHistory: false });
    wx.showToast({ title: '请拖动光标到墙体', icon: 'none' });
  },

  buildGuideSnapPoint(floor, session, rawMm) {
    // 仅在 spaceClosed 状态下，拖动光标时根据辅助线交叉点吸附
    if (!floor || !session || session.state !== 'spaceClosed') return rawMm;
    if (!rawMm) return rawMm;
    const nodes = floor.nodes || [];
    if (!nodes.length) return rawMm;

    const SNAP_THRESHOLD_MM = 120; // 吸附阈值
    let bestX = null;
    let bestY = null;
    let minDx = SNAP_THRESHOLD_MM;
    let minDy = SNAP_THRESHOLD_MM;

    nodes.forEach((node) => {
      const dx = Math.abs(rawMm.xMm - node.xMm);
      const dy = Math.abs(rawMm.yMm - node.yMm);
      if (dx < minDx) { minDx = dx; bestX = node.xMm; }
      if (dy < minDy) { minDy = dy; bestY = node.yMm; }
    });

    return {
      xMm: bestX !== null ? bestX : rawMm.xMm,
      yMm: bestY !== null ? bestY : rawMm.yMm
    };
  },

  buildStageMessage(floor, session, selectedWall) {
    if (session.state === 'idle') {
      return { title: '准备测墙', value: '重置光标后，从橙色光标拖出墙体方向' };
    }
    if (session.state === 'cursorPlaced') {
      return { title: '光标已放置', value: '从光标拖出墙体方向' };
    }
    if (session.state === 'wallSnapPending') {
      return { title: '新房间起点', value: '拖到墙体可吸附，也可放在画布空白处' };
    }
    if (session.state === 'wallPreview') {
      return { title: '当前墙段', value: '释放后生成待测墙，不会自动落图' };
    }
    if (session.state === 'awaitingLength') {
      return { title: '等待长度', value: `点击“手输 mm”录入 ${formatMm(session.previewLengthMm)} 附近的实测值` };
    }
    if (session.state === 'wallCommitted') {
      return { title: '墙体已确认', value: '继续从光标拖出下一面墙' };
    }
    if (session.state === 'closing') {
      return { title: '可闭合空间', value: '端点已接近起点，确认后吸附闭合' };
    }
    if (session.state === 'mergeClosing') {
      return { title: '可闭合空间', value: '已检测到安全闭合边，点击“合”即可闭合' };
    }
    if (session.state === 'spaceClosed') {
      return { title: '单空间已闭合', value: '点击墙体可复尺、改墙侧或墙厚' };
    }
    if (session.state === 'wallSelected' && session.selectedOpeningId) {
      const opening = surveyGraph.getOpening(floor, session.selectedOpeningId);
      if (opening) {
        return { title: opening.type === 'window' ? '已选窗' : '已选门', value: `${formatMm(opening.widthMm)} x ${formatMm(opening.heightMm)} · 正式量房` };
      }
    }
    if (session.state === 'wallSelected' && selectedWall) {
      return { title: '已选墙体', value: `${selectedWall.length} · ${selectedWall.side} · ${selectedWall.thickness}` };
    }
    if (session.state === 'remeasureAwaitingInput' && selectedWall) {
      return { title: '复尺中', value: `请输入${selectedWall.mode}的新毫米长度` };
    }
    return { title: '正式量房', value: `${floor.walls.length} 面墙` };
  },

  getViewport() {
    if (this.viewportInteraction && this.viewportInteraction.viewport) {
      return this.viewportInteraction.viewport;
    }
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

  mmToClientPoint(point) {
    const rect = this.canvasRect || { left: 0, top: 0, width: 0, height: 0 };
    const canvasPoint = this.mmToCanvasPoint(point);
    return {
      x: rect.left + canvasPoint.x,
      y: rect.top + canvasPoint.y
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

  getCursorPlacementCandidate(clientPoint, options) {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const rawPoint = this.canvasPointToMm(clientPoint);
    if (!floor || !rawPoint) return { type: 'none', pointMm: null };
    const opts = options || {};
    const viewport = this.getViewport();
    const searchToleranceMm = opts.useHysteresis
      ? surveySnapEngine.SNAP_RELEASE_PX / Math.max(0.000001, viewport.scale)
      : surveyGraph.CLOSE_TOLERANCE_MM;
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      rawPoint,
      searchToleranceMm
    );
    let resolvedTarget = target;
    if (opts.useHysteresis) {
      const snapCandidate = target && ['vertex', 'wall', 'alignment'].includes(target.type)
        ? target
        : null;
      const snap = surveySnapEngine.resolveSnap({
        scale: viewport.scale,
        rawPointMm: rawPoint,
        candidate: snapCandidate,
        previousLock: this.cursorSnapLock
      });
      this.cursorSnapLock = snap.lock;
      resolvedTarget = snap.candidate || { type: 'free', pointMm: rawPoint };
    }
    return {
      type: resolvedTarget.type,
      pointMm: resolvedTarget.pointMm,
      nodeId: resolvedTarget.nodeId || '',
      wallId: resolvedTarget.wallId || '',
      snapLine: resolvedTarget.snapLine || '',
      axis: resolvedTarget.axis || '',
      referencePoint: resolvedTarget.referencePoint || null
    };
  },

  buildCursorLens(pointMm, targetType, snapLine) {
    const point = pointMm || { xMm: 0, yMm: 0 };
    const floor = this.draft ? surveyGraph.getActiveFloor(this.draft) : null;
    this.cursorLensScene = floor
      ? surveyCanvasRenderer.createSurveyLensScene({
        floor,
        session: floor.session,
        centerPoint: point,
        size: CURSOR_LENS_SIZE_PX,
        scale: CURSOR_LENS_SCALE
      })
      : null;

    const snapLabel = targetType === 'vertex'
      ? (snapLine === 'outer' ? '外边顶点吸附' : '顶点吸附')
      : (targetType === 'alignment'
        ? (snapLine === 'outer' ? '外边顶点延长吸附' : '顶点延长吸附')
      : (targetType === 'wall'
        ? (snapLine === 'outer' ? '外边吸附' : '内边吸附')
        : '自由放置'));
    const xLabel = `X ${Math.round(point.xMm)}`;
    const yLabel = `Y ${Math.round(point.yMm)}`;
    this.cursorLensMeta = {
      snapLabel,
      coordinateLabel: `${xLabel} / ${yLabel}`
    };

    return {
      cursorLensVisible: true,
      cursorLensXLabel: xLabel,
      cursorLensYLabel: yLabel,
      cursorLensSnapLabel: snapLabel,
      cursorLensSnapType: targetType || 'none'
    };
  },

  resolvePreviewLensTarget(session, previewPointMm) {
    if (!session) return { type: 'free', snapLine: '' };
    const guide = session.alignmentSnapGuide;
    if (guide) {
      if (guide.type === 'start-vertex-closure') {
        return { type: 'vertex', snapLine: guide.snapLine || '' };
      }
      if (
        guide.type === 'vertex-axis' ||
        guide.type === 'rectangle-third-wall' ||
        guide.type === 'previous-diagonal-direction'
      ) {
        return {
          type: 'alignment',
          snapLine: guide.snapLine || '',
          axis: guide.direction === 'vertical' ? 'x' : 'y'
        };
      }
    }
    const closePoint = session.closeCandidatePoint;
    const snappedToClosePoint = !!(
      previewPointMm &&
      closePoint &&
      surveyGraph.distanceMm(previewPointMm, closePoint) <= 1
    );
    if (snappedToClosePoint && session.closeCandidateType === 'shared-wall') {
      return { type: 'wall', snapLine: session.activeSpaceSharedSnapLine || 'inner' };
    }
    if (
      snappedToClosePoint &&
      (session.closeCandidateType === 'merge' || session.closeCandidateType === 'start' || session.closeCandidateNodeId)
    ) {
      return { type: 'vertex', snapLine: '' };
    }
    if (session.closeCandidateType === 'shared-wall') {
      return { type: 'wall', snapLine: session.activeSpaceSharedSnapLine || 'inner' };
    }
    return { type: 'free', snapLine: '' };
  },

  isCursorLensActive() {
    return this.cursorPlacementState === 'dragging' || this.canvasCursorLensActive;
  },

  updateCanvasCursorLens(clientPoint, pointMm, target) {
    this.canvasCursorLensActive = true;
    const now = Date.now();
    const shouldUpdateLens = !this.data.cursorLensVisible ||
      now - this.cursorLensLastUpdateAt >= 80;
    const lensData = shouldUpdateLens
      ? this.buildCursorLens(
        pointMm,
        (target && target.type) || 'free',
        (target && target.snapLine) || ''
      )
      : null;
    this.cursorDragSnapGuide = null;
    this.queueCursorDragCanvas(clientPoint, { showCursor: false });
    if (!lensData) return;

    this.cursorLensLastUpdateAt = now;
    this.setData(Object.assign({ cursorLensActive: true }, lensData));
  },

  clearCanvasCursorLens() {
    if (!this.canvasCursorLensActive) return;
    this.canvasCursorLensActive = false;
    this.cursorLensLastUpdateAt = 0;
    this.clearCursorDragCanvas();
    this.setData({
      cursorLensActive: false,
      cursorLensVisible: false
    });
  },

  buildCursorDragSnapGuide(candidate) {
    if (!candidate || !candidate.pointMm || candidate.type === 'free' || candidate.type === 'none') {
      return null;
    }

    const point = this.mmToCanvasPoint(candidate.pointMm);
    if (candidate.type === 'alignment') {
      return {
        axis: candidate.axis === 'x' ? 'x' : 'y',
        point
      };
    }
    if (candidate.type === 'vertex') {
      return {
        axis: 'both',
        point
      };
    }

    const floor = surveyGraph.getActiveFloor(this.draft);
    let wall = candidate.wallId ? surveyGraph.getWall(floor, candidate.wallId) : null;
    if (!wall && candidate.nodeId) {
      wall = (floor.walls || []).find((item) => (
        item.startNodeId === candidate.nodeId || item.endNodeId === candidate.nodeId
      )) || null;
    }
    if (!wall) {
      return null;
    }

    const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
    const startNode = surveyGraph.getNode(floor, wall.startNodeId);
    const endNode = surveyGraph.getNode(floor, wall.endNodeId);
    const startMm = candidate.snapLine === 'outer' && geometry && geometry.outerStart
      ? geometry.outerStart
      : startNode;
    const endMm = candidate.snapLine === 'outer' && geometry && geometry.outerEnd
      ? geometry.outerEnd
      : endNode;
    if (!startMm || !endMm) {
      return null;
    }
    return {
      startPoint: this.mmToCanvasPoint(startMm),
      endPoint: this.mmToCanvasPoint(endMm)
    };
  },

  resolveCursorDragPoint(clientPoint, includeLens) {
    const candidate = this.getCursorPlacementCandidate(clientPoint, { useHysteresis: true });
    // 自由放置必须严格跟随手指。只有真正命中顶点或墙体时，才把
    // 十字光标移动到吸附后的坐标，避免一次 mm 往返换算造成初始跳位。
    const isSnapped = candidate && (
      candidate.type === 'vertex' || candidate.type === 'wall' || candidate.type === 'alignment'
    );
    const displayPoint = isSnapped && candidate.pointMm
      ? this.mmToClientPoint(candidate.pointMm)
      : clientPoint;
    // touchend 的 cover-view 坐标可能回报手指释放前的原始位置。提交时
    // 必须沿用用户最后看到的吸附候选，否则外边顶点会被重新判成内边。
    this.cursorDragCandidate = isSnapped && candidate.pointMm
      ? Object.assign({}, candidate, {
        pointMm: { xMm: candidate.pointMm.xMm, yMm: candidate.pointMm.yMm }
      })
      : null;
    this.cursorDragClientPoint = { x: displayPoint.x, y: displayPoint.y };
    this.cursorDragSnapGuide = this.buildCursorDragSnapGuide(candidate);
    const dragData = {
      dragCursorX: displayPoint.x,
      dragCursorY: displayPoint.y
    };
    const lensData = includeLens
      ? this.buildCursorLens(
        candidate && candidate.pointMm ? candidate.pointMm : this.canvasPointToMm(clientPoint),
        candidate && candidate.type,
        candidate && candidate.snapLine
      )
      : null;
    this.queueCursorDragCanvas(displayPoint);
    return lensData ? Object.assign(dragData, lensData) : dragData;
  },

  projectOpeningOffsetMm(point, wallId) {
    if (!point || !wallId) return null;
    const floor = surveyGraph.getActiveFloor(this.draft);
    const wall = surveyGraph.getWall(floor, wallId);
    if (!wall) return null;
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    if (!start || !end) return null;

    const pointMm = this.canvasPointToMm(point);
    const length = surveyGraph.distanceMm(start, end);
    if (!length) return null;
    const dx = (end.xMm - start.xMm) / length;
    const dy = (end.yMm - start.yMm) / length;
    return Math.round((pointMm.xMm - start.xMm) * dx + (pointMm.yMm - start.yMm) * dy);
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
    if (!canStartWallDrag(session.state)) return false;

    const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
    // Use the same displayed point as the canvas. Exterior T chains expose the
    // outer working line while their graph anchor stays on the topology line.
    const cursorSource = surveyGraph.getCursorDisplayPoint(floor, session) || anchor;
    if (!cursorSource) return false;

    const cursorPoint = this.mmToCanvasPoint(cursorSource);
    const localPoint = {
      x: clientPoint.x - this.canvasRect.left,
      y: clientPoint.y - this.canvasRect.top
    };
    return distancePx(cursorPoint, localPoint) <= 44;
  },

  applyDraft(nextDraft, options) {
    const opts = options || {};
    this.clearCursorDragCanvas({ force: true });
    if (opts.recordHistory) {
      this.history.undo.push(opts.historyDraft ? surveyGraph.cloneDraft(opts.historyDraft) : surveyGraph.cloneDraft(this.draft));
      if (this.history.undo.length > MAX_HISTORY) {
        this.history.undo.shift();
      }
      this.history.redo = [];
    }
    this.draft = nextDraft;
    this.syncFromDraft(opts.extraData);
    if (opts.persist !== false) {
      this.scheduleFormalPersist();
    }
  },

  onBack() {
    if (this.data.componentEditorVisible) {
      this.closeComponentEditor();
      return;
    }
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

  onTopMetricAngleTap() {
    if (!this.data.angleActionAvailable) return;
    this.openAngleMeasurement();
  },

  onToolTap(e) {
    const tool = e.currentTarget.dataset.tool;

    if (tool && tool.indexOf('object-') === 0) {
      this.onObjectToolTap(tool);
      return;
    }

    if (tool === 'straight' || tool === 'diagonal') {
      this.applyDraft(surveyGraph.setMode(this.draft, tool), { persist: false });
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

    if (tool === 'ble-measure') {
      this.onBottomMeasure();
      return;
    }

    if (tool === 'reset') {
      this.resetCursorPlacement();
    }
  },

  onBottomMeasure() {
    if (this.data.componentEditorVisible) {
      this.triggerComponentSpecBluetoothMeasure();
      return;
    }

    if (!app.globalData.bleConnected) {
      this.requestBluetoothConnection();
      return;
    }

    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor && floor.session;
    if (session && (session.state === 'wallPreview' || session.state === 'awaitingLength')) {
      this.startBluetoothMeasure('pendingWall');
      return;
    }

    const currentWall = floor && floor.walls && floor.walls.length
      ? floor.walls[floor.walls.length - 1]
      : null;
    const selectedWallId = session && (session.selectedWallId || (
      session.state === 'cursorPlaced'
        ? session.activeSpaceSharedWallId
        : ((session.state === 'wallCommitted' || session.state === 'closing' || session.state === 'mergeClosing') && currentWall
          ? currentWall.id
          : '')
    ));
    const selectedWall = selectedWallId
      ? surveyGraph.getWall(floor, selectedWallId)
      : null;
    if (selectedWall && !session.selectedOpeningId) {
      this.bleMeasureHistoryDraft = surveyGraph.cloneDraft(this.draft);
      const selectedWallDraft = session.selectedWallId
        ? this.draft
        : surveyGraph.selectWall(this.draft, selectedWall.id);
      this.draft = surveyGraph.startRemeasure(selectedWallDraft);
      this.syncFromDraft({ numberPadVisible: false });
      this.startBluetoothMeasure('selectedWall');
      return;
    }

    if (!this.data.numberPadVisible) {
      this.openLengthPad();
      setTimeout(() => this.triggerBluetoothNumberMeasure(), 0);
      return;
    }
    this.triggerBluetoothNumberMeasure();
  },

  onObjectToolTap(tool) {
    if (tool === 'object-edit') {
      this.openSelectedObjectEditor();
      return;
    }

    if (tool === 'object-add') {
      this.addOpening('door');
      return;
    }

    if (tool === 'object-delete') {
      this.deleteSelectedObject();
      return;
    }

    wx.showToast({ title: '该对象工具将在 Phase 8 继续定义', icon: 'none' });
  },

  onWallContextAction(e) {
    const action = e.currentTarget.dataset.action;
    if (action === 'door' || action === 'window') {
      this.addOpening(action);
      return;
    }
    if (action === 'remeasure') {
      this.onStartRemeasure();
      return;
    }
    if (action === 'edit') {
      this.openSelectedObjectEditor();
      return;
    }
    if (action === 'delete') {
      this.deleteSelectedObject();
      return;
    }
    if (action === 'exit') {
      this.onExitWallSelection();
    }
  },


  addOpening(type) {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const wallId = floor.session.selectedWallId;
    if (!wallId) {
      wx.showToast({ title: '请先选择墙体', icon: 'none' });
      return;
    }

    try {
      const nextDraft = surveyGraph.addOpeningToWall(this.draft, wallId, type);
      this.applyDraft(nextDraft, {
        recordHistory: true
      });
      wx.showToast({
        title: type === 'window' ? '已添加窗，可继续测墙' : '已添加门，可继续测墙',
        icon: 'none'
      });
    } catch (err) {
      wx.showToast({ title: err.message || '添加失败', icon: 'none' });
    }
  },

  openSelectedObjectEditor() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (floor.session.selectedOpeningId) {
      this.openComponentEditor();
      return;
    }
    if (floor.session.selectedWallId) {
      this.openNumberPad('thickness');
      return;
    }
    wx.showToast({ title: '请先选择墙体或门窗', icon: 'none' });
  },

  openComponentEditor() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    if (!opening) {
      wx.showToast({ title: '请先选择门窗', icon: 'none' });
      return;
    }
    const specMode = 'length';
    const rawVal = this.getComponentSpecRawValue(floor, opening.id, specMode);
    this.setData({
      componentEditorVisible: true,
      componentPanelMode: 'spec',
      componentSpecMode: specMode,
      componentSpecInput: rawVal,
      componentSpecValue: rawVal
    }, () => {
      this.scheduleComponentSceneRender();
    });
  },

  closeComponentEditor() {
    this.setData({ componentEditorVisible: false }, () => {
      this.destroyComponentScene();
      this.onExitWallSelection();
      this.refreshCanvasRect();
    });
  },

  deleteSelectedOpening() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (!floor.session.selectedOpeningId) {
      wx.showToast({ title: '请先选择门窗', icon: 'none' });
      return;
    }
    const nextDraft = surveyGraph.deleteOpening(this.draft, floor.session.selectedOpeningId);
    this.applyDraft(nextDraft, { recordHistory: true });
    wx.showToast({ title: '门窗已删除', icon: 'none' });
  },

  deleteSelectedObject() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (floor.session.selectedOpeningId) {
      this.deleteSelectedOpening();
      return;
    }
    if (floor.session.selectedWallId) {
      this.deleteSelectedWall();
      return;
    }
    wx.showToast({ title: '请先选择墙体或门窗', icon: 'none' });
  },

  deleteSelectedWall() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const wallId = floor.session.selectedWallId;
    if (!wallId || !surveyGraph.getWall(floor, wallId)) {
      wx.showToast({ title: '请先选择墙体', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '删除墙体',
      content: '将删除当前墙体及其上的门窗。若它是两个闭合空间的共用墙，空间将自动合并；否则相关空间会转回未闭合状态。',
      confirmText: '删除',
      confirmColor: '#d71920',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const nextDraft = surveyGraph.deleteWall(this.draft, wallId);
          this.applyDraft(nextDraft, { recordHistory: true });
          wx.showToast({ title: '墙体已删除', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err.message || '删除失败，请重试', icon: 'none' });
        }
      }
    });
  },

  onOpeningEditField(e) {
    const field = e.currentTarget.dataset.field;
    if (field === 'width') {
      this.openNumberPad('openingWidth');
      return;
    }
    if (field === 'height') {
      this.openNumberPad('openingHeight');
      return;
    }
    if (field === 'sill') {
      this.openNumberPad('openingSill');
    }
  },

  onOpeningDirectionTap(e) {
    const direction = e.currentTarget.dataset.direction;
    if (direction !== 'inside' && direction !== 'outside') return;
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const selectedOpening = session.selectedOpeningId
      ? surveyGraph.getOpening(floor, session.selectedOpeningId)
      : null;
    if (!selectedOpening || selectedOpening.type !== 'door' || selectedOpening.openDirection === direction) {
      return;
    }
    const nextDraft = surveyGraph.updateOpening(this.draft, selectedOpening.id, { openDirection: direction });
    this.applyDraft(nextDraft, {
      recordHistory: true,
      extraData: { numberPadVisible: this.data.numberPadVisible }
    });
    wx.showToast({ title: direction === 'outside' ? '门开向已设为外开' : '门开向已设为内开', icon: 'none' });
  },

  onToggleSide(e) {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const selectedOpening = session.selectedOpeningId ? surveyGraph.getOpening(floor, session.selectedOpeningId) : null;
    if (selectedOpening) {
      if (selectedOpening.type !== 'door') {
        wx.showToast({ title: '窗不支持开向切换', icon: 'none' });
        return;
      }
      const nextDirection = selectedOpening.openDirection === 'outside' ? 'inside' : 'outside';
      const nextDraft = surveyGraph.updateOpening(this.draft, selectedOpening.id, { openDirection: nextDirection });
      this.applyDraft(nextDraft, {
        recordHistory: true,
        extraData: { numberPadVisible: this.data.numberPadVisible }
      });
      wx.showToast({ title: nextDirection === 'outside' ? '门开向已设为外开' : '门开向已设为内开', icon: 'none' });
      return;
    }

    const dataset = e && e.currentTarget ? e.currentTarget.dataset : {};
    const source = dataset && dataset.source;
    if (source !== 'measure-position' || !this.isFirstMeasurePositionStage(floor, session)) {
      wx.showToast({ title: '内外墙方向只能在第一条边确认', icon: 'none' });
      return;
    }

    const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
      ? session.activeSpaceStartWallIndex
      : 0;
    const firstWall = floor.walls[startWallIndex] || null;
    const activeWallId = firstWall ? firstWall.id : '';
    const activeWall = activeWallId ? surveyGraph.getWall(floor, activeWallId) : null;
    const currentSide = session.previewPoint
      ? (session.previewMeasurementSide || session.measurementSide)
      : (activeWall ? activeWall.measurementSide : session.measurementSide);
    const nextSide = currentSide === 'right' ? 'left' : 'right';
    const nextDraft = surveyGraph.setMeasurementSide(this.draft, nextSide, activeWallId);
    this.applyDraft(nextDraft, {
      recordHistory: true,
      extraData: { numberPadVisible: this.data.numberPadVisible }
    });
    wx.showToast({ title: '测量位置已更新', icon: 'none' });
  },

  onDisabledTap() {
    this.showPlannedToast();
  },

  async onSaveDraft() {
    wx.showLoading({ title: '保存草稿...' });
    const saved = this.persistFormalDraft();
    try {
      wx.setStorageSync(FORMAL_DRAFT_BACKUP_KEY, {
        draft: this.draft ? surveyGraph.cloneDraft(this.draft) : null,
        leadId: this.data.leadId || '',
        time: Date.now()
      });
    } catch (err) {
      // 备份失败不影响正式草稿保存结果。
    }

    if (!saved) {
      wx.hideLoading();
      wx.showToast({ title: '保存失败', icon: 'none' });
      return;
    }

    try {
      await this.saveFormalFloorPlan('draft');
      wx.hideLoading();
      this.setData({
        formalNotice: '草稿已保存到服务端',
        floorPlanStatus: 'draft'
      });
      wx.showToast({ title: '已保存草稿', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('Save surveying draft to cloud failed:', err);
      this.setData({
        formalNotice: '本地草稿已保存，服务端保存失败'
      });
      wx.showToast({ title: '服务端保存失败', icon: 'none' });
    }
  },

  async onSubmitFloorPlan() {
    const floor = this.draft ? surveyGraph.getActiveFloor(this.draft) : null;
    if (!floor || !(floor.spaces || []).some((space) => space.closed)) {
      wx.showToast({ title: '请先完成至少一个闭合空间', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '提交量房...' });
    try {
      await this.saveFormalFloorPlan('completed');
      wx.hideLoading();
      this.guideSessionCompleted = true;
      this.syncFromDraft({ formalNotice: '量房已完成', floorPlanStatus: 'completed' });
      wx.showToast({ title: '量房已完成', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.error) || '提交失败', icon: 'none' });
    }
  },

  async onExportCad() {
    const floorPlanId = this.serverDraftId || this.data.serverDraftId || this.getStoredServerDraftId(this.data.leadId || '');
    if (this.data.floorPlanStatus !== 'completed' || !floorPlanId) {
      wx.showToast({ title: '请先完成并保存量房', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '生成 CAD...' });
    try {
      const response = await api.downloadFile(`/miniprogram/floorplans/${floorPlanId}/export/dxf`);
      const fileManager = wx.getFileSystemManager();
      const header = response.header || {};
      const disposition = header['Content-Disposition'] || header['content-disposition'] || '';
      let downloadName = `户型_${Date.now()}.dxf`;
      const utfMatch = String(disposition).match(/filename\*=(?:UTF-8''|utf-8'')([^;]+)/i);
      if (utfMatch && utfMatch[1]) {
        try {
          downloadName = decodeURIComponent(utfMatch[1].trim().replace(/^"|"$/g, ''));
        } catch (error) {
          // keep fallback
        }
      } else {
        const plainMatch = String(disposition).match(/filename="([^"]+)"/i) || String(disposition).match(/filename=([^;]+)/i);
        if (plainMatch && plainMatch[1]) downloadName = plainMatch[1].trim().replace(/^"|"$/g, '');
      }
      downloadName = String(downloadName || '户型.dxf').replace(/[\\/:*?"<>|\r\n]+/g, '_');
      if (!/\.dxf$/i.test(downloadName)) downloadName = `${downloadName}.dxf`;
      const destPath = `${wx.env.USER_DATA_PATH}/${downloadName}`;
      fileManager.saveFile({
        tempFilePath: response.tempFilePath,
        filePath: destPath,
        success: (saved) => {
          wx.openDocument({
            filePath: saved.savedFilePath || destPath,
            fileType: 'dxf',
            showMenu: true,
            success: () => wx.showToast({ title: 'CAD 已生成', icon: 'success' }),
            fail: () => wx.showModal({
              title: 'CAD 文件已生成',
              content: '当前设备无法直接打开 DXF，请将文件转发到 CAD 设备或在电脑端打开。',
              showCancel: false,
              confirmText: '知道了'
            })
          });
        },
        fail: () => {
          // Older runtimes may reject custom filePath; fall back to default save.
          fileManager.saveFile({
            tempFilePath: response.tempFilePath,
            success: (saved) => {
              wx.openDocument({
                filePath: saved.savedFilePath,
                fileType: 'dxf',
                showMenu: true,
                success: () => wx.showToast({ title: 'CAD 已生成', icon: 'success' }),
                fail: () => wx.showModal({
                  title: 'CAD 文件已生成',
                  content: '当前设备无法直接打开 DXF，请将文件转发到 CAD 设备或在电脑端打开。',
                  showCancel: false,
                  confirmText: '知道了'
                })
              });
            },
            fail: () => wx.showModal({
              title: 'CAD 文件已生成',
              content: '文件已下载，但当前设备无法保存到文件域，请转发到 CAD 设备处理。',
              showCancel: false,
              confirmText: '知道了'
            })
          });
        }
      });
    } catch (err) {
      wx.showToast({ title: (err && err.error) || 'CAD 导出失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  reportMeasurement(record) {
    if (!record || !record.value) return Promise.resolve(false);

    const measurement = {
      ...record,
      auditId: record.auditId || `survey-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      measuredAt: record.measuredAt || new Date().toISOString()
    };
    const floorPlanId = this.serverDraftId || this.data.serverDraftId || this.getStoredServerDraftId(this.data.leadId || '');
    if (!floorPlanId) {
      this.enqueuePendingMeasurement(measurement);
      return Promise.resolve(false);
    }

    return this.sendMeasurementRecord(floorPlanId, measurement).catch((err) => {
      this.enqueuePendingMeasurement(measurement);
      console.warn('[surveying-editor] Measurement audit logging failed', err);
      return false;
    });
  },

  enqueuePendingMeasurement(record) {
    if (!record || !record.auditId) return;
    const pending = this.pendingMeasurementRecords || [];
    if (!pending.some((item) => item.auditId === record.auditId)) {
      pending.push(record);
    }
    this.pendingMeasurementRecords = pending;
  },

  async sendMeasurementRecord(floorPlanId, record) {
    if (!floorPlanId || !record || !record.auditId) return false;
    const reportKey = `${floorPlanId}:${record.auditId}`;
    if (this.reportedMeasurementKeys && this.reportedMeasurementKeys[reportKey]) return true;

    await api.request('/measurements', 'POST', {
      floorPlanId,
      value: record.value,
      unit: 'meters',
      type: record.type || 'length',
      direction: record.direction || '',
      source: 'ble',
      metadata: {
        measurementMode: 'surveying',
        auditId: record.auditId,
        ...(record.metadata || {})
      },
      measuredAt: record.measuredAt
    });

    this.reportedMeasurementKeys[reportKey] = true;
    return true;
  },

  async flushPendingMeasurements(floorPlanId) {
    const pending = this.pendingMeasurementRecords || [];
    if (!floorPlanId || !pending.length) return;
    this.pendingMeasurementRecords = [];

    const failed = [];
    for (const record of pending) {
      try {
        await this.sendMeasurementRecord(floorPlanId, record);
      } catch (err) {
        failed.push(record);
        console.warn('[surveying-editor] Deferred measurement audit logging failed', err);
      }
    }
    failed.forEach((record) => this.enqueuePendingMeasurement(record));
  },

  onBottomAction(e) {
    const action = e.currentTarget.dataset.action;

    if (action === 'manual') {
      this.openLengthPad();
      return;
    }

    if (action === 'cursor') {
      this.resetCursorPlacement();
      return;
    }

    if (action === 'add') {
      const floor = surveyGraph.getActiveFloor(this.draft);
      if (!floor.walls.length) {
        wx.showToast({ title: '请先完成第一个房间', icon: 'none' });
        return;
      }
      this.applyDraft(surveyGraph.startWallSnap(this.draft), {
        recordHistory: false,
        extraData: { numberPadVisible: false }
      });
      wx.showToast({ title: '点击已有墙体放置光标', icon: 'none' });
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

  hitRect(point, rect) {
    return !!point && !!rect && point.x >= rect.left && point.x <= rect.left + rect.width &&
      point.y >= rect.top && point.y <= rect.top + rect.height;
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
    if (controls.activeAngle && this.hitRect(localPoint, controls.activeAngle)) {
      return { key: 'angle' };
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
    if (control.key === 'angle') {
      this.onTopMetricAngleTap();
      return true;
    }
    return false;
  },

  hitTestLockHandles(clientPoint) {
    if (!this.canvasRect || !clientPoint || !this.draft) return null;
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    if (!session || session.state !== 'remeasureAwaitingInput') return null;

    const wall = surveyGraph.getWall(floor, session.selectedWallId);
    if (!wall) return null;

    const startNode = surveyGraph.getNode(floor, wall.startNodeId);
    const endNode = surveyGraph.getNode(floor, wall.endNodeId);
    if (!startNode || !endNode) return null;

    const startPt = this.mmToCanvasPoint(startNode);
    const endPt = this.mmToCanvasPoint(endNode);

    const localPoint = {
      x: clientPoint.x - this.canvasRect.left,
      y: clientPoint.y - this.canvasRect.top
    };

    const threshold = 28; // visual circle radius is 14px, 28px hits comfortably
    if (distancePx(startPt, localPoint) <= threshold) {
      return { nodeId: startNode.id };
    }
    if (distancePx(endPt, localPoint) <= threshold) {
      return { nodeId: endNode.id };
    }
    return null;
  },

  onCanvasTouchStart(e) {
    if (this.data.numberPadVisible || !this.canvasRect) return;
    this.canvasTapSelectedObject = false;
    const touches = e.touches || [];

    if (touches.length >= 2) {
      const first = getTouchPoint(touches[0], this.canvasRect);
      const second = getTouchPoint(touches[1], this.canvasRect);
      const center = getMidPoint(first, second);
      const viewport = this.getViewport();
      this.beginViewportInteraction(viewport);
      this.touchState = {
        mode: 'pinch',
        startDistance: distancePx(first, second),
        startScale: viewport.scale,
        startCenter: center,
        startCenterMm: this.canvasPointToMm(center)
      };
      return;
    }

    if (!touches.length) return;

    const point = getTouchPoint(touches[0], this.canvasRect);
    
    // Check lock handles hit first
    const lockHit = this.hitTestLockHandles(point);
    if (lockHit) {
      this.touchState = {
        mode: 'lockHandle',
        lockHit,
        startPoint: point
      };
      return;
    }

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
    const openingHit = this.hitTestOpeningAtClientPoint(point);
    const nearCursor = this.isCursorTouchTarget(e) || this.isNearCursorPoint(point);
    const viewport = this.getViewport();
    const snapPending = session.state === 'wallSnapPending';

    this.touchState = {
      mode: snapPending ? 'wallSnapPending' : (openingHit && openingHit.openingId ? 'openingPending' : 'pending'),
      startPoint: point,
      lastPoint: point,
      nearCursor,
      openingHit: snapPending ? null : openingHit,
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
      const center = getMidPoint(first, second);
      const nextDistance = distancePx(first, second);
      if (!this.touchState.startDistance) return;
      const scale = clamp(this.touchState.startScale * (nextDistance / this.touchState.startDistance), MIN_SCALE, MAX_SCALE);
      const anchorMm = this.touchState.startCenterMm || this.canvasPointToMm(center);
      const rect = this.canvasRect;
      const offsetX = center.x - rect.left - rect.width / 2 - anchorMm.xMm * scale;
      const offsetY = center.y - rect.top - rect.height / 2 - anchorMm.yMm * scale;
      const nextViewport = {
        scale,
        offsetX,
        offsetY
      };
      if (!this.updateViewportInteraction(nextViewport)) {
        this.draft = surveyGraph.updateViewport(this.draft, nextViewport);
        this.syncFromDraft();
      }
      return;
    }

    if (!touches.length) return;

    const point = getTouchPoint(touches[0], this.canvasRect);
    this.touchState.lastPoint = point;
    const dx = point.x - this.touchState.startPoint.x;
    const dy = point.y - this.touchState.startPoint.y;
    const moved = Math.sqrt(dx * dx + dy * dy);
    const currentMm = this.canvasPointToMm(point);

    if (this.touchState.mode === 'wallSnapPending') {
      return;
    }

    if (this.touchState.mode === 'openingPending') {
      if (moved < TOUCH_SLOP_PX) return;
      if (!this.touchState.historyDraft) {
        this.touchState.historyDraft = surveyGraph.cloneDraft(this.draft);
      }
      this.touchState.mode = 'opening';
    }

    if (this.touchState.mode === 'opening') {
      const openingHit = this.touchState.openingHit || {};
      const nextOffset = this.projectOpeningOffsetMm(point, openingHit.wallId);
      if (nextOffset === null) return;
      this.draft = surveyGraph.updateOpening(this.draft, openingHit.openingId, { centerOffsetMm: nextOffset });
      this.syncFromDraft();
      return;
    }

    if (this.touchState.mode === 'pending') {
      if (moved < TOUCH_SLOP_PX) return;

      if (this.touchState.nearCursor && canStartWallDrag(this.touchState.sessionState)) {
        if (!this.touchState.historyDraft) {
          this.touchState.historyDraft = surveyGraph.cloneDraft(this.draft);
        }
        if (this.touchState.sessionState === 'awaitingLength') {
          const pendingFloor = surveyGraph.getActiveFloor(this.draft);
          const pendingSession = pendingFloor.session;
          try {
            this.draft = surveyGraph.commitPreviewLength(
              this.draft,
              pendingSession.previewLengthMm,
              'preview-continuation'
            );
            this.touchState.sessionState = 'wallCommitted';
          } catch (err) {
            wx.showToast({ title: err.message || '无法继续当前墙段', icon: 'none' });
            this.touchState.mode = 'pan';
            this.beginViewportInteraction(this.touchState.startViewport);
            return;
          }
        }
        this.draft = surveyGraph.startPreview(this.draft, currentMm);
        this.touchState.mode = 'wall';
      } else {
        this.touchState.mode = 'pan';
        this.beginViewportInteraction(this.touchState.startViewport);
      }
    }

    if (this.touchState.mode === 'wall') {
      // 如果已封闭（spaceClosed），拖动时开启辅助线交叉吸附
      const _floor = surveyGraph.getActiveFloor(this.draft);
      const _session = _floor.session;
      const snappedMm = this.buildGuideSnapPoint(_floor, _session, currentMm);
      this.draft = surveyGraph.startPreview(this.draft, snappedMm);
      const previewFloor = surveyGraph.getActiveFloor(this.draft);
      const previewPointMm = surveyGraph.getCursorDisplayPoint(previewFloor, previewFloor.session)
        || previewFloor.session.previewPoint
        || snappedMm;
      this.updateCanvasCursorLens(point, previewPointMm, this.resolvePreviewLensTarget(previewFloor.session, previewPointMm));
      this.syncFromDraft();
      return;
    }

    if (this.touchState.mode === 'pan') {
      const startViewport = this.touchState.startViewport;
      const nextViewport = {
        scale: startViewport.scale,
        offsetX: startViewport.offsetX + dx,
        offsetY: startViewport.offsetY + dy
      };
      if (!this.updateViewportInteraction(nextViewport)) {
        this.draft = surveyGraph.updateViewport(this.draft, nextViewport);
        this.syncFromDraft();
      }
    }
  },

  onCanvasTouchEnd() {
    if (!this.touchState) return;

    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;
    const touchState = this.touchState;
    const lockTap = touchState.mode === 'lockHandle';
    const controlTap = touchState.mode === 'control';
    const movedWall = touchState.mode === 'wall';
    const movedOpening = touchState.mode === 'opening';
    const openingTap = touchState.mode === 'openingPending';
    const wasTap = touchState.mode === 'pending';
    const historyDraft = touchState.historyDraft;

    this.touchState = null;
    if (movedWall) {
      this.clearCanvasCursorLens();
    }

    if (lockTap) {
      const nextDraft = surveyGraph.setFixedNode(this.draft, touchState.lockHit.nodeId);
      this.applyDraft(nextDraft, { persist: false });
      return;
    }

    if (controlTap) {
      this.handleCanvasControlTap(touchState.control);
      return;
    }

    if (touchState.mode === 'wallSnapPending') {
      const candidate = this.getCursorPlacementCandidate(touchState.startPoint);
      if (!candidate || !candidate.pointMm || (
        candidate.type !== 'vertex' && candidate.type !== 'wall'
      )) {
        wx.showToast({ title: '请选择已有墙体或顶点', icon: 'none' });
        return;
      }
      // Canvas tapping must preserve the same inner/outer vertex target as
      // the bottom cursor drag path rather than reclassifying raw coordinates.
      const nextDraft = surveyGraph.snapCursorToWall(this.draft, candidate.pointMm, candidate);
      this.cursorPlacementState = 'placed';
      this.applyDraft(nextDraft, {
        recordHistory: false,
        extraData: {
          cursorPlacementState: 'placed',
          numberPadVisible: false
        }
      });
      wx.showToast({ title: '光标已吸附到墙体', icon: 'none' });
      return;
    }

    if (openingTap) {
      const openingHit = touchState.openingHit || {};
      if (openingHit.openingId) {
        // Native canvas may emit tap after touchend. Mark this selection so the
        // fallback blank-canvas handler does not immediately clear it.
        this.canvasTapSelectedObject = true;
        this.applyDraft(surveyGraph.selectOpening(this.draft, openingHit.openingId), {
          extraData: { numberPadVisible: false },
          persist: false
        });
      }
      return;
    }

    if (movedOpening) {
      const openingHit = touchState.openingHit || {};
      if (openingHit.openingId) {
        const nextOffset = this.projectOpeningOffsetMm(touchState.lastPoint || touchState.startPoint, openingHit.wallId);
        const nextDraft = nextOffset === null
          ? surveyGraph.selectOpening(this.draft, openingHit.openingId)
          : surveyGraph.updateOpening(this.draft, openingHit.openingId, { centerOffsetMm: nextOffset });
        this.applyDraft(nextDraft, {
          recordHistory: true,
          historyDraft,
          extraData: { numberPadVisible: false }
        });
        wx.showToast({ title: '门窗位置已更新', icon: 'none' });
      }
      return;
    }

    if (wasTap && !touchState.nearCursor) {
      const openingHit = this.hitTestOpeningAtClientPoint(touchState.startPoint);
      if (openingHit && openingHit.openingId) {
        this.canvasTapSelectedObject = true;
        this.applyDraft(surveyGraph.selectOpening(this.draft, openingHit.openingId), {
          extraData: { numberPadVisible: false },
          persist: false
        });
        return;
      }

      const wallHit = this.hitTestWallAtClientPoint(touchState.startPoint);
      if (wallHit && wallHit.wallId) {
        this.canvasTapSelectedObject = true;
        this.draft = surveyGraph.selectWall(this.draft, wallHit.wallId);
        this.centerSelectedWall(false);
        this.applyDraft(this.draft, {
          extraData: { numberPadVisible: false },
          persist: false
        });
        return;
      }

      // 选中墙体（含其上的门窗）后，点击画布空白处应退出对象编辑状态。
      if (session.state === 'wallSelected') {
        this.onExitWallSelection();
        return;
      }

      if ((session.state === 'idle' || session.state === 'cursorPlaced') && !floor.walls.length) {
        const pointMm = this.canvasPointToMm(touchState.startPoint);
        const nextDraft = surveyGraph.placeCursor(this.draft, pointMm);
        this.applyDraft(nextDraft, {
          recordHistory: !!session.anchorNodeId,
          extraData: { numberPadVisible: false }
        });
        wx.showToast({ title: '光标已放置', icon: 'none' });
      }
      return;
    }

    if (movedWall) {
      if (session.previewLengthMm >= surveyGraph.MIN_WALL_LENGTH_MM) {
        const releasePointMm = this.canvasPointToMm(touchState.lastPoint || touchState.startPoint);
        const directClosureHit = surveyGraph.isDirectClosureHit(floor, session, releasePointMm);
        if (directClosureHit) {
          try {
            const nextDraft = this.enterResetCursorAfterClose(surveyGraph.confirmClosure(this.draft));
            this.applyDraft(nextDraft, {
              recordHistory: true,
              historyDraft
            });
            wx.showToast({ title: '已吸附闭合点并闭合', icon: 'success' });
          } catch (err) {
            wx.showToast({ title: err.message || '闭合失败，请重新测量', icon: 'none' });
          }
          return;
        }
        if (session.mode === 'diagonal') {
          const nextDraft = surveyGraph.holdPreviewForInput(this.draft);
          this.applyDraft(nextDraft, { persist: false });
          wx.showToast({ title: '点击顶部角度可校准方向，或直接测量墙长', icon: 'none' });
          return;
        }
        try {
          const nextDraft = maybeAutoConfirmSharedBoundaryClose(
            surveyGraph.commitPreviewLength(this.draft, session.previewLengthMm, 'preview')
          );
          const nextSession = surveyGraph.getActiveFloor(nextDraft).session;
          this.applyDraft(this.enterResetCursorAfterClose(nextDraft), {
            recordHistory: true,
            historyDraft
          });
          wx.showToast({
            title: nextSession.state === 'spaceClosed'
              ? '已吸附闭合点并闭合'
              : ((nextSession.state === 'closing' || nextSession.state === 'mergeClosing') ? '可闭合，点击“合”确认' : '墙体已确认'),
            icon: nextSession.state === 'spaceClosed' ? 'success' : 'none'
          });
        } catch (err) {
          wx.showToast({ title: err.message || '成墙失败，请重试', icon: 'none' });
          this.applyDraft(surveyGraph.cancelPending(this.draft), { persist: false });
        }
      } else {
        this.applyDraft(surveyGraph.cancelPending(this.draft));
      }
      return;
    }

    if (touchState.mode === 'pan' || touchState.mode === 'pinch') {
      if (!this.finishViewportInteraction()) {
        this.scheduleFormalPersist();
      }
    }
  },

  onCanvasTap() {
    // 部分原生 canvas 叠层只派发 tap；作为 touchend 的兜底，空白处仍应收起工具栏。
    if (this.canvasTapSelectedObject) {
      this.canvasTapSelectedObject = false;
      return;
    }
    const floor = this.draft && surveyGraph.getActiveFloor(this.draft);
    if (floor && floor.session && floor.session.state === 'wallSelected') {
      this.onExitWallSelection();
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
    this.centerSelectedWall(false);
    this.applyDraft(this.draft, {
      extraData: { numberPadVisible: false },
      persist: false
    });
  },

  hitTestOpeningAtClientPoint(point) {
    if (!this.canvasRect || !this.surveyRenderScene || !point) return null;
    return surveyCanvasRenderer.hitTestSurveyOpening(this.surveyRenderScene, {
      x: point.x - this.canvasRect.left,
      y: point.y - this.canvasRect.top
    });
  },

  onExitWallSelection() {
    if (!this.draft) return;
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (!floor.session.selectedWallId && !floor.session.selectedOpeningId) return;
    this.touchState = null;
    this.applyDraft(surveyGraph.cancelPending(this.draft), {
      extraData: {
        selectedWall: null,
        selectedOpening: null
      },
      persist: false
    });
  },

  onResumeWallDrawing() {
    const nextDraft = surveyGraph.cancelPending(this.draft);
    const nextFloor = surveyGraph.getActiveFloor(nextDraft);
    if (nextFloor.session.state !== 'wallCommitted') {
      wx.showToast({ title: '请使用新建房间起点开始测量', icon: 'none' });
      return;
    }
    this.applyDraft(nextDraft, { persist: false });
    wx.showToast({ title: '已回到末端，拖动光标继续测墙', icon: 'none' });
  },

  onStartRemeasure() {
    this.draft = surveyGraph.startRemeasure(this.draft);
    this.centerSelectedWall(true);
    this.applyDraft(this.draft, { persist: false });
    this.openNumberPad('length');
  },

  onConfirmClose() {
    const session = surveyGraph.getActiveFloor(this.draft).session;
    const canCloseCommittedWall = session.state === 'closing' || session.state === 'mergeClosing';
    const canClosePreviewWall = (session.state === 'wallPreview' || session.state === 'awaitingLength') &&
      !!session.previewPoint &&
      !!(session.closeCandidateNodeId || session.closeCandidatePoint);
    if (!canCloseCommittedWall && !canClosePreviewWall) return;

    try {
      const nextDraft = this.enterResetCursorAfterClose(surveyGraph.confirmClosure(this.draft));
      this.applyDraft(nextDraft, { recordHistory: true });
      wx.showToast({ title: '单空间已闭合', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: err.message || '闭合失败，请重新测量', icon: 'none' });
    }
  },

  onConfirmClosure() {
    this.onConfirmClose();
  },

  onUndo() {
    this.clearCursorDragCanvas({ force: true });
    if (!this.history.undo.length) return;
    this.history.redo.push(surveyGraph.cloneDraft(this.draft));
    const restoredDraft = this.history.undo.pop();
    const restoredSession = surveyGraph.getActiveFloor(restoredDraft).session;
    this.draft = (restoredSession.state === 'wallPreview' || restoredSession.state === 'awaitingLength')
      ? surveyGraph.cancelPending(restoredDraft)
      : restoredDraft;
    this.syncFromDraft({ numberPadVisible: false });
    this.scheduleFormalPersist();
  },

  onUndoTap() {
    if (!this.history.undo.length) return;
    this.onUndo();
  },

  onRedoTap() {
    this.clearCursorDragCanvas({ force: true });
    if (!this.history.redo.length) return;
    this.history.undo.push(surveyGraph.cloneDraft(this.draft));
    this.draft = this.history.redo.pop();
    this.syncFromDraft({ numberPadVisible: false });
    this.scheduleFormalPersist();
  },

  // ─── 光标三态：已放置 → 等待拖放 → 正在拖拽 ───

  getCursorEventTouch(e, allowChangedTouch) {
    const touches = Array.prototype.slice.call((e && e.touches) || []);
    const changedTouches = allowChangedTouch
      ? Array.prototype.slice.call((e && e.changedTouches) || [])
      : [];
    // touchmove 时 changedTouches 才是本次真正发生变化的触点；部分
    // Android 基础库中的 touches 会保留按下时的位置。
    const candidates = changedTouches.concat(touches);
    if (!candidates.length) return null;
    if (this.cursorDragTouchId === null || this.cursorDragTouchId === undefined) {
      return candidates[0];
    }
    return candidates.find((touch) => touch && touch.identifier === this.cursorDragTouchId)
      || candidates[0];
  },

  getCursorDragTouch(e, allowChangedTouch) {
    const touch = this.getCursorEventTouch(e, allowChangedTouch);
    if (!touch) return null;

    const numberOrNull = (value) => {
      if (value === '' || value === null || value === undefined) return null;
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : null;
    };
    const pageX = numberOrNull(touch.pageX);
    const pageY = numberOrNull(touch.pageY);
    const clientX = numberOrNull(touch.clientX);
    const clientY = numberOrNull(touch.clientY);
    const dataset = e && e.currentTarget && e.currentTarget.dataset;
    const fromCursorControl = dataset
      && (dataset.cursorControl === true || dataset.cursorControl === 'true');

    // 当前页面固定且不可滚动，page 坐标与 fixed 展示层同源；优先使用
    // 它可避开少数 Android cover-view 中 client 坐标停留在 0 的问题。
    const hasUsablePagePoint = pageX !== null && pageY !== null
      && (!fromCursorControl || (pageX > 0 && pageY > 0));
    const hasUsableClientPoint = clientX !== null && clientY !== null
      && (!fromCursorControl || (clientX > 0 && clientY > 0));
    if (hasUsablePagePoint) {
      return { x: pageX, y: pageY };
    }
    if (hasUsableClientPoint) {
      return { x: clientX, y: clientY };
    }
    const detail = e && e.detail;
    const detailX = numberOrNull(detail && detail.x);
    const detailY = numberOrNull(detail && detail.y);
    if (!fromCursorControl && detailX !== null && detailY !== null) {
      return { x: detailX, y: detailY };
    }

    const localX = numberOrNull(touch.x);
    const localY = numberOrNull(touch.y);
    if (localX === null || localY === null) return null;
    if (fromCursorControl) {
      // cover-view 的 x/y 是相对控件本身的局部坐标。手指移出按钮后
      // 数值仍沿原触摸目标变化，因此加上按钮矩形即可得到屏幕坐标。
      const controlRect = this.cursorControlRect;
      if (!controlRect) return null;
      return { x: controlRect.left + localX, y: controlRect.top + localY };
    }

    // 非 cover-view 事件的最后兜底；当前正式拖拽路径不会走到这里。
    return { x: localX, y: localY };
  },

  refreshCursorControlRect() {
    const query = wx.createSelectorQuery();
    query.select('#cursor-drag-control').boundingClientRect((rect) => {
      this.cursorControlRect = rect || null;
    });
    query.exec();
  },

  onResetCursorTap() {
    this.resetCursorPlacement();
  },

  onCursorControlTouchStart(e) {
    if (this.resolveCursorPlacementState(
      surveyGraph.getActiveFloor(this.draft),
      surveyGraph.getActiveFloor(this.draft).session
    ) !== 'awaitingWallDrop') {
      return;
    }
    const touch = this.getCursorEventTouch(e, false);
    if (!touch) return;
    this.cursorDragTouchId = touch.identifier === undefined ? null : touch.identifier;
    this.cursorDragStartPoint = this.getCursorDragTouch(e, false);
    this.cursorDragCandidate = null;
    this.cursorSnapLock = null;
    this.cursorLensLastUpdateAt = 0;
    this.clearCursorDragCanvas();
    this.refreshCursorControlRect();
    // Do not replace the touch target on touchstart.  On WeChat, changing the
    // conditional tree here can drop every following touchmove event.
    this.cursorDragPending = true;
  },

  onCursorControlTouchMove(e) {
    if (!this.cursorDragPending && this.cursorPlacementState !== 'dragging') return;
    const point = this.getCursorDragTouch(e, true);
    if (!point) return;
    this.cursorDragPending = false;
    const wasDragging = this.cursorPlacementState === 'dragging';
    this.cursorPlacementState = 'dragging';
    const now = Date.now();
    // A native cover-view can take a frame to apply the first setData update.
    // Keep rebuilding until that visible flag has arrived, otherwise a rapid
    // drag can remain in the dragging state without ever mounting its lens.
    const shouldUpdateLens = !wasDragging || !this.data.cursorLensVisible ||
      now - this.cursorLensLastUpdateAt >= 80;
    const dragData = this.resolveCursorDragPoint(point, shouldUpdateLens);
    if (shouldUpdateLens) {
      this.cursorLensLastUpdateAt = now;
      this.setData(Object.assign({
        cursorPlacementState: 'dragging',
        cursorLensActive: true,
        topMetricVisible: false,
        topMetricLength: '',
        topMetricAngle: ''
      }, dragData));
    }
  },

  onCursorDragEnd(e) {
    const wasDragging = this.cursorPlacementState === 'dragging';
    const dragWasPending = this.cursorDragPending;
    const reportedReleasePoint = this.getCursorDragTouch(e, true) || this.cursorDragClientPoint;
    const releasePoint = reportedReleasePoint || {
      x: this.data.dragCursorX,
      y: this.data.dragCursorY
    };
    const startPoint = this.cursorDragStartPoint;
    const movedWithoutTouchMove = !wasDragging && dragWasPending && startPoint
      && reportedReleasePoint
      && Math.hypot(releasePoint.x - startPoint.x, releasePoint.y - startPoint.y) >= 8;
    this.cursorDragPending = false;
    this.cursorDragTouchId = null;
    this.cursorDragStartPoint = null;
    if (!wasDragging && !movedWithoutTouchMove) return;
    this.clearCursorDragCanvas();
    const candidate = this.cursorDragCandidate || this.getCursorPlacementCandidate(releasePoint, { useHysteresis: true });
    this.cursorDragCandidate = null;
    this.cursorSnapLock = null;

    if (!candidate || candidate.type === 'none' || !candidate.pointMm) {
      this.cursorPlacementState = 'awaitingWallDrop';
      this.setData({
        cursorPlacementState: 'awaitingWallDrop',
        cursorLensActive: false,
        cursorLensVisible: false
      }, () => this.drawSurveyCanvas());
      wx.showToast({ title: '光标放置失败，请重试', icon: 'none' });
      return;
    }

    this.cursorPlacementState = 'placed';
    const nextDraft = candidate.type === 'vertex' || candidate.type === 'wall'
      ? surveyGraph.snapCursorToWall(this.draft, candidate.pointMm, candidate)
      : surveyGraph.placeNewWallChainCursor(this.draft, candidate.pointMm);
    this.applyDraft(nextDraft, {
      recordHistory: false,
      extraData: {
        cursorPlacementState: 'placed',
        cursorLensActive: false,
        cursorLensVisible: false,
        numberPadVisible: false
      }
    });
    const placedMessage = candidate.type === 'vertex'
      ? `光标已吸附到${candidate.snapLine === 'outer' ? '外边顶点' : '顶点'}`
      : (candidate.type === 'alignment'
        ? `光标已对齐到${candidate.snapLine === 'outer' ? '外边顶点延长线' : '顶点延长线'}`
      : (candidate.type === 'wall'
        ? `光标已吸附到${candidate.snapLine === 'outer' ? '外边' : '内边'}`
        : '光标已放置'));
    wx.showToast({ title: placedMessage, icon: 'none' });
  },

  onCursorDragCancel() {
    const wasDragging = this.cursorPlacementState === 'dragging';
    this.cursorDragPending = false;
    this.cursorDragTouchId = null;
    this.cursorDragStartPoint = null;
    this.cursorSnapLock = null;
    if (!wasDragging) return;
    this.clearCursorDragCanvas();
    this.cursorPlacementState = 'awaitingWallDrop';
    this.setData({
      cursorPlacementState: 'awaitingWallDrop',
      cursorLensActive: false,
      cursorLensVisible: false
    }, () => this.drawSurveyCanvas());
  },


  onRedo() {
    this.clearCursorDragCanvas({ force: true });
    if (!this.history.redo.length) return;
    this.history.undo.push(surveyGraph.cloneDraft(this.draft));
    this.draft = this.history.redo.pop();
    this.syncFromDraft({ numberPadVisible: false });
    this.scheduleFormalPersist();
  },

  onRequestResetCanvas() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const hasContent = floor.walls.length > 0
      || (floor.nodes && floor.nodes.length > 0)
      || (floor.openings && floor.openings.length > 0)
      || (floor.spaces && floor.spaces.length > 0)
      || this.history.undo.length > 0
      || this.history.redo.length > 0;
    if (!hasContent) {
      wx.showToast({ title: '画布已经是空的', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '重做确认',
      content: '将清空当前画布的所有墙体和门窗，该操作不可撤销。是否继续？',
      confirmText: '清空重做',
      confirmColor: '#d71920',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        this.onResetCanvas();
      }
    });
  },

  onResetCanvas() {
    const freshDraft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.history = { undo: [], redo: [] };
    this.pendingMeasurementRecords = [];
    this.draft = freshDraft;
    try {
      wx.setStorageSync(this.formalDraftKey || this.getFormalDraftKey(this.data.leadId || ''), surveyGraph.cloneDraft(this.draft));
    } catch (err) {
      // 清除本地草稿失败不阻塞操作
    }
    this.syncFromDraft({ numberPadVisible: false });
    wx.showToast({ title: '画布已清空', icon: 'success' });
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
    this.centerSelectedWall(true);
    this.syncFromDraft({
      numberPadVisible: true,
      numberPadTitle: session.state === 'wallSelected' || session.state === 'remeasureAwaitingInput' ? '输入复尺长度' : '输入当前墙长',
      numberPadSubtitle: '单位：mm，确认后落图',
      numberInput: inputValue
    });
  },

  updateComponentSpecValue(draft, openingId, specMode, value) {
    const floor = surveyGraph.getActiveFloor(draft);
    const opening = surveyGraph.getOpening(floor, openingId);
    if (!opening) throw new Error('请先选择门窗');
    const wall = surveyGraph.getWall(floor, opening.wallId);
    const wallLength = wall ? wall.lengthMm || 0 : 0;
    const currentWidth = opening.widthMm || 0;
    const patch = {};

    if (specMode === 'length') {
      patch.widthMm = value;
    } else if (specMode === 'depth') {
      patch.depthMm = value;
    } else if (specMode === 'height') {
      patch.heightMm = value;
    } else if (specMode === 'sill') {
      patch.sillHeightMm = value;
    } else if (specMode === 'edge1') {
      patch.centerOffsetMm = Math.round(value + currentWidth / 2);
    } else if (specMode === 'edge2') {
      patch.centerOffsetMm = Math.round(wallLength - value - currentWidth / 2);
    }

    let nextDraft = surveyGraph.updateOpening(draft, openingId, patch);
    if (specMode === 'depth' && this.data.componentSyncWallThickness && wall) {
      nextDraft = surveyGraph.setThickness(nextDraft, value, wall.id);
    }
    return nextDraft;
  },

  isComponentNumberPadMode() {
    return !!(this.numberPadMode && this.numberPadMode.indexOf('component') === 0);
  },

  getComponentSpecModeFromNumberPad() {
    if (!this.isComponentNumberPadMode()) return '';
    return this.numberPadMode.replace('component', '').replace(/^./, (letter) => letter.toLowerCase());
  },

  applyLiveComponentNumberInput(inputValue) {
    if (!this.isComponentNumberPadMode()) return;
    if (inputValue === '') {
      this.setData({ componentSpecValue: '0' });
      return;
    }

    const value = parseInt(inputValue, 10);
    if (!Number.isFinite(value)) return;

    const floor = surveyGraph.getActiveFloor(this.draft);
    const openingId = floor.session.selectedOpeningId;
    const specMode = this.getComponentSpecModeFromNumberPad();

    try {
      const nextDraft = this.updateComponentSpecValue(this.draft, openingId, specMode, value);
      this.draft = nextDraft;
      this.syncFromDraft({
        componentEditorVisible: true,
        componentPanelMode: 'spec',
        componentSpecMode: specMode,
        numberPadVisible: true,
        numberInput: inputValue
      });
      this.scheduleFormalPersist();
    } catch (err) {
      wx.showToast({ title: err.message || '输入无效', icon: 'none' });
    }
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

    if (mode && mode.indexOf('component') === 0) {
      const floor = surveyGraph.getActiveFloor(this.draft);
      const openingId = floor.session.selectedOpeningId;
      const opening = surveyGraph.getOpening(floor, openingId);
      if (!opening) {
        wx.showToast({ title: '请先选择门窗', icon: 'none' });
        return;
      }
      const specMode = mode.replace('component', '').replace(/^./, (letter) => letter.toLowerCase());
      const titleMap = {
        length: '修改构件长度',
        depth: '修改构件宽度',
        height: '修改构件高度',
        sill: '修改距地高度',
        edge1: '修改边距1',
        edge2: '修改边距2'
      };
      this.setData({
        componentSpecMode: specMode,
        numberPadVisible: true,
        numberPadTitle: titleMap[specMode] || '修改构件尺寸',
        numberPadSubtitle: '单位：mm，保存到正式量房门窗',
        numberInput: this.getComponentSpecRawValue(floor, openingId, specMode)
      });
      this.numberPadMode = mode;
      return;
    }

    if (mode === 'openingWidth' || mode === 'openingHeight' || mode === 'openingSill') {
      const floor = surveyGraph.getActiveFloor(this.draft);
      const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
      if (!opening) {
        wx.showToast({ title: '请先选择门窗', icon: 'none' });
        return;
      }
      const titleMap = {
        openingWidth: '修改门窗宽度',
        openingHeight: '修改门窗高度',
        openingSill: opening.type === 'window' ? '修改窗距地' : '修改门距地'
      };
      const valueMap = {
        openingWidth: opening.widthMm,
        openingHeight: opening.heightMm,
        openingSill: opening.sillHeightMm || 0
      };
      this.setData({
        numberPadVisible: true,
        numberPadTitle: titleMap[mode],
        numberPadSubtitle: '单位：mm，保存到正式量房门窗',
        numberInput: String(valueMap[mode])
      });
      this.numberPadMode = mode;
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
    if (this.isComponentNumberPadMode()) {
      this.applyLiveComponentNumberInput(value);
    }
  },

  onNumberConfirm() {
    const value = this.numberPadMode === 'angle'
      ? parseFloat(this.data.numberInput)
      : parseInt(this.data.numberInput, 10);
    const floor = surveyGraph.getActiveFloor(this.draft);
    const session = floor.session;

    try {
      if (this.numberPadMode === 'angle') {
        if (!Number.isFinite(value) || value <= 0 || value >= 180) {
          wx.showToast({ title: '请输入 1–179° 的有效角度', icon: 'none' });
          return;
        }
        const nextDraft = surveyGraph.applyPreviewInteriorAngle(
          this.draft,
          value,
          this.angleMeasurementSource || 'manual'
        );
        this.stopPhoneAngleMeasurement();
        this.draft = nextDraft;
        if (this.angleRemeasureOriginalDraft) {
          this.angleRemeasureHistoryDraft = this.angleRemeasureOriginalDraft;
          this.angleRemeasureOriginalDraft = null;
        }
        this.numberPadMode = '';
        this.setData({
          numberPadVisible: false,
          numberInput: '',
          numberUnit: 'mm',
          angleMeasureVisible: false,
          angleManualInputVisible: false,
          angleTriangleMeasuringSide: ''
        });
        this.openLengthPad();
        return;
      }

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

      if (this.numberPadMode && this.numberPadMode.indexOf('component') === 0) {
        const specMode = this.getComponentSpecModeFromNumberPad();
        this.numberPadMode = '';
        this.syncFromDraft({
          numberPadVisible: false,
          numberInput: '',
          componentEditorVisible: true,
          componentSpecMode: specMode
        });

        return;
      }

      if (this.numberPadMode === 'openingWidth' || this.numberPadMode === 'openingHeight' || this.numberPadMode === 'openingSill') {
        const patch = {};
        if (this.numberPadMode === 'openingWidth') patch.widthMm = value;
        if (this.numberPadMode === 'openingHeight') patch.heightMm = value;
        if (this.numberPadMode === 'openingSill') patch.sillHeightMm = value;
        const nextDraft = surveyGraph.updateOpening(this.draft, session.selectedOpeningId, patch);
        this.numberPadMode = '';
        this.applyDraft(nextDraft, {
          recordHistory: true,
          extraData: { numberPadVisible: false, numberInput: '' }
        });
        wx.showToast({ title: '门窗尺寸已更新', icon: 'none' });
        return;
      }

      if (session.state === 'awaitingLength' || session.state === 'wallPreview') {
        const nextDraft = maybeAutoConfirmSharedBoundaryClose(
          surveyGraph.commitPreviewLength(this.draft, value, 'manual')
        );
        const nextSession = surveyGraph.getActiveFloor(nextDraft).session;
        this.applyDraft(this.enterResetCursorAfterClose(nextDraft), {
          recordHistory: true,
          historyDraft: this.angleRemeasureHistoryDraft || undefined,
          extraData: { numberPadVisible: false, numberInput: '' }
        });
        this.angleRemeasureHistoryDraft = null;
        wx.showToast({
          title: nextSession.state === 'spaceClosed'
            ? '已吸附闭合点并闭合'
            : ((nextSession.state === 'closing' || nextSession.state === 'mergeClosing') ? '可闭合，点击“合”确认' : '墙体已确认'),
          icon: nextSession.state === 'spaceClosed' ? 'success' : 'none'
        });
        return;
      }

      if (session.state === 'remeasureAwaitingInput') {
        const wasClosed = floor.spaces.some((space) => space.closed);
        this.draft = surveyGraph.remeasureSelectedWall(this.draft, value, 'manual');
        this.centerSelectedWall(false);
        this.applyDraft(this.draft, {
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
    if (this.numberPadMode === 'angle') {
      this.stopPhoneAngleMeasurement();
      if (this.data.angleTriangleMeasuringSide) {
        this.clearBleMeasureTimers();
        this.bleMeasureTarget = 'ignore';
      }
      this.resetPhoneAngleState();
      this.resetAngleTriangle();
      if (this.angleRemeasureOriginalDraft) {
        this.draft = this.angleRemeasureOriginalDraft;
        this.angleRemeasureOriginalDraft = null;
      }
    }
    this.numberPadMode = '';
    this.centerSelectedWall(false);
    this.applyDraft(this.draft, { persist: false });
    this.setData({
      numberPadVisible: false,
      numberInput: '',
      numberUnit: 'mm',
      angleMeasureVisible: false,
      angleManualInputVisible: false,
      angleTriangleMeasuringSide: ''
    });
  },

  componentNumberPadMode(specMode) {
    return `component${specMode.charAt(0).toUpperCase()}${specMode.slice(1)}`;
  },

  onComponentPanelTab(e) {
    const mode = e.currentTarget.dataset.mode || 'spec';
    const updateData = { componentPanelMode: mode };
    if (mode === 'spec') {
      const floor = surveyGraph.getActiveFloor(this.draft);
      const specMode = this.data.componentSpecMode || 'length';
      const rawVal = this.getComponentSpecRawValue(floor, floor.session.selectedOpeningId, specMode);
      updateData.componentSpecInput = rawVal;
      updateData.componentSpecValue = rawVal;
    }
    this.setData(updateData, () => {
      this.scheduleComponentSceneRender();
    });
  },

  onComponentSpecTab(e) {
    const mode = e.currentTarget.dataset.mode || 'length';
    const floor = surveyGraph.getActiveFloor(this.draft);
    const rawVal = this.getComponentSpecRawValue(floor, floor.session.selectedOpeningId, mode);
    const activeSpec = (this.data.componentSpecOptions || []).find((item) => item.key === mode);
    this.setData({
      componentSpecMode: mode,
      componentSpecLabel: activeSpec ? activeSpec.label : '尺寸',
      componentSpecValue: rawVal,
      componentSpecInput: rawVal
    }, () => {
      this.scheduleComponentSceneRender();
    });
  },

  openActiveComponentNumberPad() {
    // Embedded keyboard takes over; no-op.
  },

  onComponentKeyboardKey(e) {
    const key = e.currentTarget.dataset.key;
    let value = this.data.componentSpecInput || '';

    if (key === '清空') {
      value = '';
    } else if (key === '退格') {
      value = value.slice(0, -1);
    } else if (/^\d$/.test(key)) {
      value = value === '0' ? key : `${value}${key}`;
    }

    this.setData({
      componentSpecInput: value,
      componentSpecValue: value || '0'
    });

    if (value === '') {
      return;
    }

    const intVal = parseInt(value, 10);
    if (!Number.isFinite(intVal)) return;

    const floor = surveyGraph.getActiveFloor(this.draft);
    const openingId = floor.session.selectedOpeningId;
    const specMode = this.data.componentSpecMode || 'length';

    try {
      const nextDraft = this.updateComponentSpecValue(this.draft, openingId, specMode, intVal);
      this.draft = nextDraft;
      this.syncFromDraft({
        componentEditorVisible: true,
        componentPanelMode: 'spec',
        componentSpecMode: specMode
      });
      this.scheduleFormalPersist();
    } catch (err) {
      wx.showToast({ title: err.message || '输入无效', icon: 'none' });
    }
  },

  onToggleComponentThicknessSync() {
    this.setData({ componentSyncWallThickness: !this.data.componentSyncWallThickness });
  },

  onComponentFlip(e) {
    const direction = e.currentTarget.dataset.direction === 'outside' ? 'outside' : 'inside';
    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    if (!opening) return;
    if (opening.type !== 'door') {
      wx.showToast({ title: '窗构件暂不支持开向切换', icon: 'none' });
      return;
    }
    const nextDraft = surveyGraph.updateOpening(this.draft, opening.id, { openDirection: direction });
    this.applyDraft(nextDraft, {
      recordHistory: true,
      extraData: { componentEditorVisible: true, componentPanelMode: 'flip' }
    });
  },

  onComponentCategoryTap(e) {
    const category = e.currentTarget.dataset.category || '';
    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    if (!opening) return;
    const type = opening.type === 'window' ? 'window' : 'door';
    const model = (COMPONENT_LIBRARY[type] || []).find((item) => item.category === category) || {};
    const nextDraft = surveyGraph.updateOpening(this.draft, opening.id, {
      modelCategory: category,
      modelId: model.id || opening.modelId,
      materialId: model.materialId || opening.materialId
    });
    this.applyDraft(nextDraft, {
      recordHistory: true,
      extraData: { componentEditorVisible: true, componentPanelMode: 'library' }
    });
  },

  onComponentModelTap(e) {
    const modelId = e.currentTarget.dataset.id || '';
    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    if (!opening) return;
    const type = opening.type === 'window' ? 'window' : 'door';
    const model = (COMPONENT_LIBRARY[type] || []).find((item) => item.id === modelId);
    if (!model) return;
    const nextDraft = surveyGraph.updateOpening(this.draft, opening.id, {
      modelId: model.id,
      modelCategory: model.category,
      materialId: model.materialId
    });
    this.applyDraft(nextDraft, {
      recordHistory: true,
      extraData: { componentEditorVisible: true, componentPanelMode: 'library' }
    });
  },

  onToggleEntryDoor() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    if (!opening || opening.type !== 'door') return;
    const nextDraft = surveyGraph.updateOpening(this.draft, opening.id, { entryDoor: !opening.entryDoor });
    this.applyDraft(nextDraft, {
      recordHistory: true,
      extraData: { componentEditorVisible: true }
    });
  },

  scheduleComponentSceneRender() {
    if (this.componentRenderTimer) {
      clearTimeout(this.componentRenderTimer);
    }
    this.componentRenderTimer = setTimeout(() => {
      this.componentRenderTimer = null;
      this.initComponentScene();
    }, 30);
  },

  initComponentScene() {
    if (!this.data.componentEditorVisible) return;
    wx.createSelectorQuery()
      .in(this)
      .select('#component-webgl')
      .fields({ node: true, size: true })
      .exec((res) => {
        const target = res && res[0];
        const canvas = target && target.node;
        if (!canvas) return;
        const width = target.width || canvas._width || canvas.width || 1;
        const height = target.height || canvas._height || canvas.height || 1;
        this.componentCanvasWidth = width;
        this.componentCanvasHeight = height;
        const dpr = this.surveyCanvasDpr || 1;
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        if (!this.componentRenderer || this.componentCanvas !== canvas) {
          const { createScopedThreejs } = require('../vendor/threejs-miniprogram.js');
          this.componentTHREE = createScopedThreejs(canvas);
          this.componentCanvas = canvas;
          this.componentRenderer = new this.componentTHREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
          this.componentRenderer.setPixelRatio(dpr);
          this.componentRenderer.setSize(width, height);
        } else {
          this.componentRenderer.setSize(width, height);
        }
        this.rebuildComponentScene(width, height);
        this.startComponentAnimation();
      });
  },

  destroyComponentScene() {
    this.componentAnimationRunning = false;
    this.componentTouch = null;
    this.componentScene = null;
    this.componentCamera = null;
    this.componentOrbit = null;
    this.componentOrbitOpeningId = '';
    this.componentCanvasWidth = 0;
    this.componentCanvasHeight = 0;
    if (this.componentRenderer && this.componentRenderer.dispose) {
      this.componentRenderer.dispose();
    }
    this.componentRenderer = null;
    this.componentCanvas = null;
    this.componentTHREE = null;
  },

  rebuildComponentScene(width, height) {
    const THREE = this.componentTHREE;
    if (!THREE || !this.componentRenderer) return;
    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    const wall = opening ? surveyGraph.getWall(floor, opening.wallId) : null;
    if (!opening || !wall) return;

    const scale = 0.01;
    const wallLength = Math.max(wall.lengthMm || 0, opening.widthMm || 900, 1200) * scale;
    const wallHeight = Math.max(2800, (opening.sillHeightMm || 0) + (opening.heightMm || 0) + 300) * scale;
    const wallDepth = Math.max(wall.thicknessMm || 200, 80) * scale;
    const openingWidth = Math.max(opening.widthMm || 0, 100) * scale;
    const openingHeight = Math.max(opening.heightMm || 0, 100) * scale;
    const openingSill = Math.max(opening.sillHeightMm || 0, 0) * scale;
    const edge1 = Math.max(0, (opening.centerOffsetMm || 0) - (opening.widthMm || 0) / 2) * scale;
    const edge2 = Math.max(0, wallLength - edge1 - openingWidth);
    const openingCenterX = -wallLength / 2 + edge1 + openingWidth / 2;
    const openingCenterY = openingSill + openingHeight / 2;
    const canReuseOrbit = this.componentOrbit && this.componentOrbitOpeningId === opening.id;
    const previousSpherical = canReuseOrbit ? this.componentOrbit.spherical.clone() : null;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 2000);
    const radius = Math.max(wallLength, wallHeight) * 1.55;
    const orbitTarget = new THREE.Vector3(0, wallHeight * 0.42, 0);
    if (previousSpherical) {
      camera.position.setFromSpherical(previousSpherical).add(orbitTarget);
    } else {
      camera.position.set(wallLength * 0.18, wallHeight * 0.52, -radius);
    }
    camera.lookAt(orbitTarget);

    scene.add(new THREE.AmbientLight(0xffffff, 0.72));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(-20, 32, 28);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.35);
    fillLight.position.set(20, 16, -20);
    scene.add(fillLight);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xf8f8f3, roughness: 0.92, metalness: 0.01 });
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x7f8580, roughness: 0.97, metalness: 0.01 });
    const doorFrameMat = new THREE.MeshStandardMaterial({ color: 0x3f2b1f, roughness: 0.68, metalness: 0.04 });
    const doorPanelMat = new THREE.MeshStandardMaterial({ color: 0xc0783d, roughness: 0.72, metalness: 0.03 });
    const handleMat = new THREE.MeshStandardMaterial({ color: 0xd4aa62, roughness: 0.36, metalness: 0.25 });
    const windowFrameMat = new THREE.MeshStandardMaterial({ color: 0x323a3d, roughness: 0.56, metalness: 0.08 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0xa7d8f0, roughness: 0.14, metalness: 0.02, transparent: true, opacity: 0.5 });
    const openingFrameMat = opening.type === 'window' ? windowFrameMat : doorFrameMat;
    const redMat = new THREE.LineBasicMaterial({ color: 0xe12d2d, linewidth: 3, depthTest: false, depthWrite: false });

    const addBox = (x, y, z, sx, sy, sz, mat) => {
      if (sx <= 0.01 || sy <= 0.01 || sz <= 0.01) return null;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      return mesh;
    };

    addBox(0, -0.04, -wallDepth * 0.55, wallLength + 4, 0.08, wallDepth + 2, floorMat);
    addBox(-wallLength / 2 + edge1 / 2, wallHeight / 2, 0, edge1, wallHeight, wallDepth, wallMat);
    addBox(wallLength / 2 - edge2 / 2, wallHeight / 2, 0, edge2, wallHeight, wallDepth, wallMat);
    addBox(openingCenterX, openingSill / 2, 0, openingWidth, openingSill, wallDepth, wallMat);
    addBox(openingCenterX, openingSill + openingHeight + (wallHeight - openingSill - openingHeight) / 2, 0, openingWidth, Math.max(0, wallHeight - openingSill - openingHeight), wallDepth, wallMat);

    const frameDepth = Math.max(wallDepth * 1.18, 0.16);
    const frame = Math.max(0.08, Math.min(openingWidth, openingHeight) * 0.08);
    addBox(openingCenterX, openingSill + openingHeight + frame / 2, -wallDepth * 0.58, openingWidth + frame * 2, frame, frameDepth, openingFrameMat);
    addBox(openingCenterX, openingSill - frame / 2, -wallDepth * 0.58, openingWidth + frame * 2, frame, frameDepth, openingFrameMat);
    addBox(openingCenterX - openingWidth / 2 - frame / 2, openingCenterY, -wallDepth * 0.58, frame, openingHeight + frame * 2, frameDepth, openingFrameMat);
    addBox(openingCenterX + openingWidth / 2 + frame / 2, openingCenterY, -wallDepth * 0.58, frame, openingHeight + frame * 2, frameDepth, openingFrameMat);

    if (opening.type === 'window') {
      addBox(openingCenterX, openingCenterY, -wallDepth * 0.64, openingWidth * 0.92, openingHeight * 0.9, 0.04, glassMat);
      addBox(openingCenterX, openingCenterY, -wallDepth * 0.72, frame * 0.72, openingHeight * 0.9, frameDepth * 0.6, windowFrameMat);
      addBox(openingCenterX - openingWidth * 0.24, openingCenterY, -wallDepth * 0.72, frame * 0.42, openingHeight * 0.9, frameDepth * 0.45, windowFrameMat);
      addBox(openingCenterX + openingWidth * 0.24, openingCenterY, -wallDepth * 0.72, frame * 0.42, openingHeight * 0.9, frameDepth * 0.45, windowFrameMat);
      addBox(openingCenterX, openingCenterY, -wallDepth * 0.72, openingWidth * 0.9, frame * 0.45, frameDepth * 0.45, windowFrameMat);
    } else {
      const swing = opening.openDirection === 'outside' ? -0.28 : 0.18;
      const door = addBox(openingCenterX + swing, openingSill + openingHeight / 2, -wallDepth * 0.68, openingWidth * 0.9, openingHeight * 0.96, Math.max(0.08, wallDepth * 0.42), doorPanelMat);
      if (door && opening.modelCategory === 'double-door') {
        addBox(openingCenterX, openingSill + openingHeight / 2, -wallDepth * 0.95, frame * 0.35, openingHeight * 0.86, frameDepth * 0.35, doorFrameMat);
      }
      addBox(openingCenterX + openingWidth * 0.28, openingSill + openingHeight * 0.52, -wallDepth * 0.94, frame * 0.6, frame * 0.45, frameDepth * 0.45, handleMat);
    }

    const makeLine = (points) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point[0], point[1], point[2])));
      const line = new THREE.Line(geometry, redMat);
      line.renderOrder = 20;
      scene.add(line);
    };
    const dimMat = new THREE.LineBasicMaterial({ color: 0x475569, linewidth: 1.5 });
    const makeDimLine = (points) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point[0], point[1], point[2])));
      const line = new THREE.Line(geometry, dimMat);
      scene.add(line);
    };
    const frontZ = -wallDepth * 1.7;
    const backZ = wallDepth * 1.7;
    const makeDoubleSideLine = (points) => {
      makeLine(points.map((point) => [point[0], point[1], frontZ]));
      makeLine(points.map((point) => [point[0], point[1], backZ]));
    };
    const makeDoubleSideDimLine = (points) => {
      makeDimLine(points.map((point) => [point[0], point[1], frontZ]));
      makeDimLine(points.map((point) => [point[0], point[1], backZ]));
    };
    const makeDepthLine = (x, y) => {
      makeLine([[x, y, frontZ], [x, y, backZ]]);
      makeLine([[x - 0.24, y, frontZ], [x + 0.24, y, frontZ]]);
      makeLine([[x - 0.24, y, backZ], [x + 0.24, y, backZ]]);
    };
    const makeParamLine = (paramKey, points) => {
      const isSpecLength = paramKey === 'length' && (this.data.componentSpecMode === 'length' || this.data.componentSpecMode === 'spec');
      const isActive = isSpecLength || (this.data.componentSpecMode === paramKey);
      const mat = isActive ? redMat : dimMat;
      const geometry = new THREE.BufferGeometry().setFromPoints(points.map((point) => new THREE.Vector3(point[0], point[1], point[2])));
      const line = new THREE.Line(geometry, mat);
      if (isActive) {
        line.renderOrder = 20;
      }
      scene.add(line);
    };
    const makeDoubleSideParamLine = (paramKey, points) => {
      makeParamLine(paramKey, points.map((p) => [p[0], p[1], frontZ]));
      makeParamLine(paramKey, points.map((p) => [p[0], p[1], backZ]));
    };

    // 1. Left Margin (edge1)
    if (edge1 > 0.01) {
      makeDoubleSideParamLine('edge1', [[-wallLength / 2, openingCenterY], [openingCenterX - openingWidth / 2, openingCenterY]]);
      makeDoubleSideParamLine('edge1', [[-wallLength / 2 - 0.04, openingCenterY - 0.04], [-wallLength / 2 + 0.04, openingCenterY + 0.04]]);
      makeDoubleSideParamLine('edge1', [[openingCenterX - openingWidth / 2 - 0.04, openingCenterY - 0.04], [openingCenterX - openingWidth / 2 + 0.04, openingCenterY + 0.04]]);
    }

    // 2. Right Margin (edge2)
    if (edge2 > 0.01) {
      makeDoubleSideParamLine('edge2', [[openingCenterX + openingWidth / 2, openingCenterY], [wallLength / 2, openingCenterY]]);
      makeDoubleSideParamLine('edge2', [[openingCenterX + openingWidth / 2 - 0.04, openingCenterY - 0.04], [openingCenterX + openingWidth / 2 + 0.04, openingCenterY + 0.04]]);
      makeDoubleSideParamLine('edge2', [[wallLength / 2 - 0.04, openingCenterY - 0.04], [wallLength / 2 + 0.04, openingCenterY + 0.04]]);
    }

    // 3. Opening Width (length)
    makeDoubleSideParamLine('length', [[openingCenterX - openingWidth / 2, openingSill + openingHeight + 0.28], [openingCenterX + openingWidth / 2, openingSill + openingHeight + 0.28]]);
    makeDoubleSideParamLine('length', [[openingCenterX - openingWidth / 2, openingSill + openingHeight], [openingCenterX - openingWidth / 2, openingSill + openingHeight + 0.34]]);
    makeDoubleSideParamLine('length', [[openingCenterX + openingWidth / 2, openingSill + openingHeight], [openingCenterX + openingWidth / 2, openingSill + openingHeight + 0.34]]);
    makeDoubleSideParamLine('length', [[openingCenterX - openingWidth / 2 - 0.04, openingSill + openingHeight + 0.28 - 0.04], [openingCenterX - openingWidth / 2 + 0.04, openingSill + openingHeight + 0.28 + 0.04]]);
    makeDoubleSideParamLine('length', [[openingCenterX + openingWidth / 2 - 0.04, openingSill + openingHeight + 0.28 - 0.04], [openingCenterX + openingWidth / 2 + 0.04, openingSill + openingHeight + 0.28 + 0.04]]);

    // 4. Opening Height (height)
    makeDoubleSideParamLine('height', [[openingCenterX + openingWidth / 2 + 0.22, openingSill], [openingCenterX + openingWidth / 2 + 0.22, openingSill + openingHeight]]);
    makeDoubleSideParamLine('height', [[openingCenterX + openingWidth / 2, openingSill], [openingCenterX + openingWidth / 2 + 0.28, openingSill]]);
    makeDoubleSideParamLine('height', [[openingCenterX + openingWidth / 2, openingSill + openingHeight], [openingCenterX + openingWidth / 2 + 0.28, openingSill + openingHeight]]);
    makeDoubleSideParamLine('height', [[openingCenterX + openingWidth / 2 + 0.22 - 0.04, openingSill - 0.04], [openingCenterX + openingWidth / 2 + 0.22 + 0.04, openingSill + 0.04]]);
    makeDoubleSideParamLine('height', [[openingCenterX + openingWidth / 2 + 0.22 - 0.04, openingSill + openingHeight - 0.04], [openingCenterX + openingWidth / 2 + 0.22 + 0.04, openingSill + openingHeight + 0.04]]);

    // 5. Sill Height (sill)
    if (openingSill > 0.01) {
      makeDoubleSideParamLine('sill', [[openingCenterX - 0.18, 0], [openingCenterX - 0.18, openingSill]]);
      makeDoubleSideParamLine('sill', [[openingCenterX, 0], [openingCenterX - 0.24, 0]]);
      makeDoubleSideParamLine('sill', [[openingCenterX, openingSill], [openingCenterX - 0.24, openingSill]]);
      makeDoubleSideParamLine('sill', [[openingCenterX - 0.18 - 0.04, -0.04], [openingCenterX - 0.18 + 0.04, 0.04]]);
      makeDoubleSideParamLine('sill', [[openingCenterX - 0.18 - 0.04, openingSill - 0.04], [openingCenterX - 0.18 + 0.04, openingSill + 0.04]]);
    }

    // 6. Thickness/Depth (depth)
    if (this.data.componentSpecMode === 'depth') {
      makeDepthLine(openingCenterX, openingCenterY);
    }

    // Draw Wall Length Dimension
    makeDoubleSideDimLine([[-wallLength / 2, -0.28], [wallLength / 2, -0.28]]);
    makeDoubleSideDimLine([[-wallLength / 2, 0], [-wallLength / 2, -0.34]]);
    makeDoubleSideDimLine([[wallLength / 2, 0], [wallLength / 2, -0.34]]);
    makeDoubleSideDimLine([[-wallLength / 2 - 0.04, -0.28 - 0.04], [-wallLength / 2 + 0.04, -0.28 + 0.04]]);
    makeDoubleSideDimLine([[wallLength / 2 - 0.04, -0.28 - 0.04], [wallLength / 2 + 0.04, -0.28 + 0.04]]);

    // Draw Wall Height Dimension
    makeDoubleSideDimLine([[wallLength / 2 + 0.35, 0], [wallLength / 2 + 0.35, wallHeight]]);
    makeDoubleSideDimLine([[wallLength / 2, 0], [wallLength / 2 + 0.41, 0]]);
    makeDoubleSideDimLine([[wallLength / 2, wallHeight], [wallLength / 2 + 0.41, wallHeight]]);
    makeDoubleSideDimLine([[wallLength / 2 + 0.35 - 0.04, -0.04], [wallLength / 2 + 0.35 + 0.04, 0.04]]);
    makeDoubleSideDimLine([[wallLength / 2 + 0.35 - 0.04, wallHeight - 0.04], [wallLength / 2 + 0.35 + 0.04, wallHeight + 0.04]]);

    this.componentScene = scene;
    this.componentCamera = camera;
    this.componentOrbit = {
      target: orbitTarget,
      spherical: previousSpherical || new THREE.Spherical().setFromVector3(camera.position.clone().sub(orbitTarget)),
      THREE
    };
    this.componentOrbitOpeningId = opening.id;
    this.updateDimensionLabels();
  },

  startComponentAnimation() {
    if (this.componentAnimationRunning || !this.componentCanvas) return;
    this.componentAnimationRunning = true;
    const animate = () => {
      if (!this.componentAnimationRunning || !this.data.componentEditorVisible) return;
      if (this.componentRenderer && this.componentScene && this.componentCamera) {
        this.componentRenderer.render(this.componentScene, this.componentCamera);
      }
      this.componentCanvas.requestAnimationFrame(animate);
    };
    this.componentCanvas.requestAnimationFrame(animate);
  },

  updateComponentCamera() {
    if (!this.componentOrbit || !this.componentCamera) return;
    this.componentCamera.position.setFromSpherical(this.componentOrbit.spherical).add(this.componentOrbit.target);
    this.componentCamera.lookAt(this.componentOrbit.target);
    this.updateDimensionLabels();
  },

  updateDimensionLabels() {
    const THREE = this.componentTHREE;
    if (!THREE || !this.componentCamera || !this.componentCanvas) return;

    this.componentCamera.updateMatrixWorld(true);
    this.componentCamera.matrixWorldInverse.getInverse(this.componentCamera.matrixWorld);

    const floor = surveyGraph.getActiveFloor(this.draft);
    const opening = surveyGraph.getOpening(floor, floor.session.selectedOpeningId);
    const wall = opening ? surveyGraph.getWall(floor, opening.wallId) : null;
    if (!opening || !wall) return;

    const scale = 0.01;
    const wallLength = Math.max(wall.lengthMm || 0, opening.widthMm || 900, 1200) * scale;
    const wallHeight = Math.max(2800, (opening.sillHeightMm || 0) + (opening.heightMm || 0) + 300) * scale;
    const wallDepth = Math.max(wall.thicknessMm || 200, 80) * scale;

    const openingWidth = Math.max(opening.widthMm || 0, 100) * scale;
    const openingHeight = Math.max(opening.heightMm || 0, 100) * scale;
    const openingSill = Math.max(opening.sillHeightMm || 0, 0) * scale;
    const edge1 = Math.max(0, (opening.centerOffsetMm || 0) - (opening.widthMm || 0) / 2) * scale;
    const edge2 = Math.max(0, wallLength - edge1 - openingWidth);
    const openingCenterX = -wallLength / 2 + edge1 + openingWidth / 2;
    const openingCenterY = openingSill + openingHeight / 2;

    const frontZ = -wallDepth * 1.7;
    const backZ = wallDepth * 1.7;
    const activeZ = this.componentCamera.position.z > 0 ? backZ : frontZ;

    const width = this.componentCanvasWidth || 375;
    const height = this.componentCanvasHeight || 400;

    // 1. Wall Length Label (bottom)
    const wallLengthVec = new THREE.Vector3(0, -0.38, activeZ);
    wallLengthVec.project(this.componentCamera);
    const wlX = (wallLengthVec.x * 0.5 + 0.5) * width - 40;
    const wlY = (-(wallLengthVec.y * 0.5) + 0.5) * height - 8;

    // 2. Wall Height Label (right side)
    const wallHeightVec = new THREE.Vector3(wallLength / 2 + 0.45, wallHeight / 2, activeZ);
    wallHeightVec.project(this.componentCamera);
    const whX = (wallHeightVec.x * 0.5 + 0.5) * width - 40;
    const whY = (-(wallHeightVec.y * 0.5) + 0.5) * height - 8;

    // 3. Opening Edge1 Label
    const edge1Vec = new THREE.Vector3((-wallLength / 2 + openingCenterX - openingWidth / 2) / 2, openingCenterY + 0.12, activeZ);
    edge1Vec.project(this.componentCamera);
    const e1X = (edge1Vec.x * 0.5 + 0.5) * width - 40;
    const e1Y = (-(edge1Vec.y * 0.5) + 0.5) * height - 8;

    // 4. Opening Edge2 Label
    const edge2Vec = new THREE.Vector3((openingCenterX + openingWidth / 2 + wallLength / 2) / 2, openingCenterY + 0.12, activeZ);
    edge2Vec.project(this.componentCamera);
    const e2X = (edge2Vec.x * 0.5 + 0.5) * width - 40;
    const e2Y = (-(edge2Vec.y * 0.5) + 0.5) * height - 8;

    // 5. Opening Width (length) Label
    const lengthVec = new THREE.Vector3(openingCenterX, openingSill + openingHeight + 0.38, activeZ);
    lengthVec.project(this.componentCamera);
    const lenX = (lengthVec.x * 0.5 + 0.5) * width - 40;
    const lenY = (-(lengthVec.y * 0.5) + 0.5) * height - 8;

    // 6. Opening Height Label
    const heightVec = new THREE.Vector3(openingCenterX + openingWidth / 2 + 0.35, openingCenterY, activeZ);
    heightVec.project(this.componentCamera);
    const hX = (heightVec.x * 0.5 + 0.5) * width - 40;
    const hY = (-(heightVec.y * 0.5) + 0.5) * height - 8;

    // 7. Opening Sill Height Label
    const sillVec = new THREE.Vector3(openingCenterX - 0.32, openingSill / 2, activeZ);
    sillVec.project(this.componentCamera);
    const sX = (sillVec.x * 0.5 + 0.5) * width - 40;
    const sY = (-(sillVec.y * 0.5) + 0.5) * height - 8;

    const showWL = wallLengthVec.z <= 1;
    const showWH = wallHeightVec.z <= 1;
    const showE1 = edge1Vec.z <= 1 && edge1 > 0.01;
    const showE2 = edge2Vec.z <= 1 && edge2 > 0.01;
    const showLen = lengthVec.z <= 1;
    const showH = heightVec.z <= 1;
    const showS = sillVec.z <= 1 && openingSill > 0.01;

    this.setData({
      wallLengthLabel: `${Math.round(wall.lengthMm)} mm`,
      wallHeightLabel: `${Math.round(wallHeight / scale)} mm`,
      paramEdge1Label: `${Math.round(edge1 / scale)} mm`,
      paramEdge2Label: `${Math.round(edge2 / scale)} mm`,
      paramLengthLabel: `${Math.round(opening.widthMm)} mm`,
      paramHeightLabel: `${Math.round(opening.heightMm)} mm`,
      paramSillLabel: `${Math.round(opening.sillHeightMm || 0)} mm`,

      wallLengthStyle: showWL ? `left: ${wlX}px; top: ${wlY}px; display: block;` : 'display: none;',
      wallHeightStyle: showWH ? `left: ${whX}px; top: ${whY}px; display: block;` : 'display: none;',
      paramEdge1Style: showE1 ? `left: ${e1X}px; top: ${e1Y}px; display: block;` : 'display: none;',
      paramEdge2Style: showE2 ? `left: ${e2X}px; top: ${e2Y}px; display: block;` : 'display: none;',
      paramLengthStyle: showLen ? `left: ${lenX}px; top: ${lenY}px; display: block;` : 'display: none;',
      paramHeightStyle: showH ? `left: ${hX}px; top: ${hY}px; display: block;` : 'display: none;',
      paramSillStyle: showS ? `left: ${sX}px; top: ${sY}px; display: block;` : 'display: none;'
    });
  },

  onComponentTouchStart(e) {
    const touches = e.touches || [];
    if (touches.length === 1) {
      this.componentTouch = {
        mode: 'rotate',
        x: touches[0].clientX,
        y: touches[0].clientY
      };
    } else if (touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      this.componentTouch = {
        mode: 'zoom',
        dist: Math.sqrt(dx * dx + dy * dy)
      };
    }
  },

  onComponentTouchMove(e) {
    if (!this.componentTouch || !this.componentOrbit) return;
    const touches = e.touches || [];
    if (this.componentTouch.mode === 'rotate' && touches.length === 1) {
      const dx = touches[0].clientX - this.componentTouch.x;
      const dy = touches[0].clientY - this.componentTouch.y;
      this.componentOrbit.spherical.theta -= dx * 0.01;
      this.componentOrbit.spherical.phi = clamp(this.componentOrbit.spherical.phi - dy * 0.008, 0.24, Math.PI / 2.05);
      this.componentTouch.x = touches[0].clientX;
      this.componentTouch.y = touches[0].clientY;
      this.updateComponentCamera();
    } else if (this.componentTouch.mode === 'zoom' && touches.length === 2) {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0 && this.componentTouch.dist > 0) {
        this.componentOrbit.spherical.radius = clamp(this.componentOrbit.spherical.radius * (this.componentTouch.dist / dist), 8, 100);
        this.componentTouch.dist = dist;
        this.updateComponentCamera();
      }
    }
  },

  onComponentTouchEnd() {
    this.componentTouch = null;
  },

  showPlannedToast() {
    wx.showToast({ title: '该功能暂未开放', icon: 'none' });
  }
});
