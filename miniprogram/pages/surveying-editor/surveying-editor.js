const app = getApp();
const surveyGraph = require('../../utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../../utils/surveyCanvasRenderer.js');
const surveyViewportInteraction = require('../../utils/surveyViewportInteraction.js');
const bluetooth = require('../../utils/bluetooth.js');
const api = require('../../utils/api.js');
const util = require('../../utils/util.js');
const surveyLayout = require('../../utils/surveyLayout.js');

const RESERVED_TOOLS = [
  { key: 'settings', label: '设置' },
  { key: 'reference', label: '参考' },
  { key: 'lock', label: '锁定' },
  { key: 'area', label: '面积' },
  { key: 'cad', label: 'CAD' },
  { key: 'more', label: '更多' }
];
const OBJECT_TOOLS = [
  { key: 'object-edit', label: '编辑', helper: '尺寸' },
  { key: 'object-split', label: '拆分', helper: '后续' },
  { key: 'object-add', label: '添加', helper: '门窗' },
  { key: 'object-arrange', label: '布置', helper: '后续' },
  { key: 'object-delete', label: '删除', helper: '墙体/门窗' }
];

const NUMBER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '清空', '0', '退格'];
const FORMAL_DRAFT_KEY = 'surveying_draft_v1';
const FORMAL_DRAFT_BACKUP_KEY = 'surveying_last_draft_backup';
const FORMAL_SERVER_DRAFT_ID_KEY = 'surveying_floorplan_id';
const SURVEYING_ONBOARDING_SEEN_KEY = 'surveying_editor_onboarding_v1_seen';
const COMPONENT_SPEC_TABS = [
  { key: 'length', label: '长度' },
  { key: 'depth', label: '宽度' },
  { key: 'height', label: '高度' },
  { key: 'sill', label: '距地' },
  { key: 'edge1', label: '边距1' },
  { key: 'edge2', label: '边距2' }
];
const COMPONENT_PANEL_TABS = [
  { key: 'spec', label: '规格' },
  { key: 'flip', label: '翻转' },
  { key: 'library', label: '模型' }
];
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
const MIN_SCALE = 0.05;
const MAX_SCALE = 0.36;
const MAX_HISTORY = 40;
const MEASURE_LINE_TOP_PX = 40;
const WALL_VISUAL_SCALE = 0.56;
const MIN_WALL_THICKNESS_PX = 10;
const MAX_WALL_THICKNESS_PX = 22;
const WALL_TOOLBAR_ACTION_WIDTH_PX = 36;
const WALL_TOOLBAR_ACTION_GAP_PX = 8;
const WALL_TOOLBAR_HORIZONTAL_PADDING_PX = 16;
const WALL_TOOLBAR_BORDER_PX = 2;
const WALL_TOOLBAR_VISIBLE_ACTIONS = 5;
const DIMENSION_LINE_CENTER_PX = 16;
const DIMENSION_LABEL_HEIGHT_PX = 24;
const DIMENSION_COLLISION_GAP_PX = 8;
const DIMENSION_PRIMARY_GAP_PX = 22;
const CURSOR_LENS_SIZE_PX = 180;
const CURSOR_LENS_SCALE = 0.12;
const BLE_DUPLICATE_WINDOW_MS = 800;
const PHONE_LEVEL_TOLERANCE_DEG = 8;
const PHONE_HEADING_SAMPLE_COUNT = 9;
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
    { key: 'straight', label: '直线', helper: '正交吸附', icon: 'align', enabled: true, active: activeTool === 'straight' },
    { key: 'diagonal', label: '斜线', helper: '自由角度', icon: 'annotation', enabled: true, active: activeTool === 'diagonal' },
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

function canStartWallDrag(state) {
  // Closing is a suggestion, not a modal state: users may keep measuring from this endpoint.
  return state === 'cursorPlaced' || state === 'wallCommitted' || state === 'awaitingLength' ||
    state === 'closing' || state === 'mergeClosing';
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
    showFormalExtras: false,
    coreTools: buildCoreTools('straight', 200),
    objectTools: OBJECT_TOOLS,
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
    measurePositionButtonLabel: '↔',
    closureGuideVisible: false,
    closureGuideStyle: '',
    closeActionVisible: false,
    closeActionStyle: '',
    measurementTitle: '准备测墙',
    measurementValue: '从橙色光标拖出墙体方向',
    isSurveyEmpty: true,
    showOnboarding: false,
    onboardingStep: 0,
    onboardingTarget: 'cursor',
    onboardingTitle: '先放置起点',
    onboardingCopy: '拖动底部光标到墙角，确定第一面墙的起点',
    onboardingProgress: '1 / 3',
    onboardingActionLabel: '下一步',
    modePillText: '测墙模式',
    manualActionActive: false,
    manualActionSubtitle: '输入当前墙',
    cursorActionSubtitle: '保留已测墙',
    cursorPlacementState: 'placed',
    dragCursorX: 0,
    dragCursorY: 0,
    cursorLensVisible: false,
    cursorLensXLabel: 'X 0',
    cursorLensYLabel: 'Y 0',
    cursorLensSnapLabel: '网格吸附',
    cursorLensSnapType: 'none',
    closeHintVisible: false,
    closeHintText: '',
    closeHintActionVisible: false,
    selectedWall: null,
    selectedOpening: null,
    objectToolsVisible: false,
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
    componentEditorMode: '',
    componentPanelMode: 'spec',
    componentSpecMode: 'length',
    componentSyncWallThickness: false,
    componentPanelTabs: COMPONENT_PANEL_TABS,
    componentSpecTabs: COMPONENT_SPEC_TABS,
    componentCategories: [],
    componentLibraryItems: [],
    componentEditorTitle: '构件编辑',
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
    // Keep every floating control below the custom header and above the bottom dock.
    const overlayContentTop = navigationSafeTop + 56;

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
    this.cursorPlacementState = initialFloor && initialFloor.session && initialFloor.session.state === 'spaceClosed'
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
    this.cursorDragClientPoint = null;
    this.cursorDragAnimationFrame = null;
    this.transientCanvasMode = null;
    this.viewportInteraction = null;
    this.viewportInteractionFrameQueue = null;
    this.viewportInteractionAwaitingHandoff = false;
    this.cursorLensLastUpdateAt = 0;
    this.cursorLensScene = null;
    const rpxScale = (sysInfo.windowWidth || 375) / 750;
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
    this.cursorDragPending = false;
    this.cursorDragTouchId = null;
    this.cursorControlRect = null;
    this.canvasControls = {};
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
    this._bindBluetoothCallbacks();

    this.setData({
      statusBarHeight: sysInfo.statusBarHeight || 0,
      navigationSafeTop,
      overlayContentTop,
      rightRailTop: overlayContentTop + 10,
      rightRailBottom: safeAreaBottom + 154,
      bottomSafeArea: safeAreaBottom,
      leadId,
      communityName: context.communityName || '',
      serverDraftId: this.serverDraftId || '',
      title: context.communityName || '未填写小区',
      formalNotice: restoredDraft ? '已恢复本地草稿' : '新建正式量房'
    });
    this.syncFromDraft();
    if (!this.serverDraftId) this.maybeShowOnboarding();
    if (this.serverDraftId) this.loadFormalFloorPlan(this.serverDraftId);
  },

  onReady() {
    this.refreshCanvasRect();
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

  normalizeRestoredFormalDraft(draft) {
    if (!isRestorableSurveyDraft(draft)) return null;
    const restored = surveyGraph.cloneDraft(draft);
    const floor = surveyGraph.getActiveFloor(restored);
    const session = floor.session || {};
    if (session.state === 'wallPreview' || session.state === 'awaitingLength' || session.state === 'remeasureAwaitingInput') {
      return surveyGraph.cancelPending(restored);
    }
    return restored;
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
        formalNotice: res.data.status === 'completed' ? '已完成量房' : '已恢复正式草稿'
      });
      this.syncFromDraft();
      this.maybeShowOnboarding();
    } catch (err) {
      wx.showToast({ title: (err && err.error) || err.message || '户型加载失败', icon: 'none' });
      this.maybeShowOnboarding();
    }
  },

  maybeShowOnboarding() {
    if (this.onboardingResolved) return;
    this.onboardingResolved = true;
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (!floor || (floor.walls && floor.walls.length)) return;
    let seen = false;
    try {
      seen = !!wx.getStorageSync(SURVEYING_ONBOARDING_SEEN_KEY);
    } catch (err) {
      seen = false;
    }
    if (seen) return;
    try {
      wx.setStorageSync(SURVEYING_ONBOARDING_SEEN_KEY, true);
    } catch (err) {
      // The guide remains usable when storage is unavailable.
    }
    this.setData({
      showOnboarding: true,
      onboardingStep: 0,
      onboardingTarget: 'cursor',
      onboardingTitle: '先放置起点',
      onboardingCopy: '拖动底部光标到墙角，确定第一面墙的起点',
      onboardingProgress: '1 / 3',
      onboardingActionLabel: '下一步'
    });
  },

  onOnboardingNext() {
    const step = Number(this.data.onboardingStep || 0);
    if (step >= 2) {
      this.setData({ showOnboarding: false });
      return;
    }
    const next = step + 1;
    const content = [
      ['cursor', '先放置起点', '拖动底部光标到墙角，确定第一面墙的起点'],
      ['straight', '选择墙体工具', '右侧选择直线或斜线，再沿墙体方向拖动'],
      ['measure', '输入真实尺寸', '可手动输入毫米，也可点击测距读取蓝牙设备']
    ][next];
    this.setData({
      onboardingStep: next,
      onboardingTarget: content[0],
      onboardingTitle: content[1],
      onboardingCopy: content[2],
      onboardingProgress: `${next + 1} / 3`,
      onboardingActionLabel: next === 2 ? '开始量房' : '下一步'
    });
  },

  onOnboardingSkip() {
    this.setData({ showOnboarding: false });
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
        app.globalData.bleConnected = !!isConnected;
        this.setData({ bleConnected: !!isConnected });
      },
      () => {
        app.globalData.bleConnected = false;
        this.setData({ bleConnected: false });
      }
    );
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
        app.globalData.bleConnected = !!isConnected;
        this.setData({ bleConnected: !!isConnected });
      },
      () => {
        app.globalData.bleConnected = false;
        this.setData({ bleConnected: false });
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

    if (distanceInMeters === null || distanceInMeters <= 0) {
      wx.showToast({ title: '测量失败，请重试', icon: 'none' });
      return;
    }

    if (this.shouldIgnoreDuplicateBleReading(distanceInMeters)) {
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
      const nextDraft = surveyGraph.commitPreviewLength(this.draft, valueMm, 'ble');
      this.applyDraft(nextDraft, { recordHistory: true });
      wx.showToast({ title: '已更新当前墙体', icon: 'success' });
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
            this.initCursorDragCanvas();
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

  initCursorDragCanvas() {
    if (!this.canvasRect || !this.canvasRect.width || !this.canvasRect.height) return;

    wx.createSelectorQuery()
      .in(this)
      .select('#cursor-drag-canvas')
      .fields({ node: true, size: true })
      .exec((res) => {
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

  queueCursorDragCanvas(point) {
    if (!point || !this.canvasRect) return;
    if (this.transientCanvasMode === 'viewport') return;
    this.transientCanvasMode = 'cursor';
    this.cursorDragCanvasPoint = {
      x: point.x - this.canvasRect.left,
      y: point.y - this.canvasRect.top
    };
    if (!this.cursorDragCanvas || !this.cursorDragCtx || this.cursorDragAnimationFrame !== null) return;

    const render = () => {
      this.cursorDragAnimationFrame = null;
      if (!this.cursorDragCanvasPoint || this.cursorPlacementState !== 'dragging') return;
      surveyCanvasRenderer.drawDraggingCursor(
        this.cursorDragCtx,
        { width: this.canvasRect.width, height: this.canvasRect.height },
        this.cursorDragCanvasPoint,
        {
          dpr: this.cursorDragCanvasDpr || 1,
          lensScene: this.cursorLensScene,
          lensRect: this.cursorLensRect
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
    this.cursorDragClientPoint = null;
    this.cursorLensScene = null;
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
    if (!interaction || this.transientCanvasMode !== 'viewport' || !viewport || !this.cursorDragCtx) return;
    surveyCanvasRenderer.drawSurveyInteractionScene(
      this.cursorDragCtx,
      interaction.baseScene,
      {
        dpr: this.cursorDragCanvasDpr || 1,
        baseViewport: interaction.baseViewport,
        viewport
      }
    );
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
    }

    if (dirty && opts.persist) {
      this.scheduleFormalPersist();
    }
    return dirty;
  },

  drawSurveyCanvas() {
    if (!this.surveyCtx || !this.surveyRenderScene) return;
    surveyCanvasRenderer.drawSurveyScene(this.surveyCtx, this.surveyRenderScene, {
      dpr: this.surveyCanvasDpr || 1
    });
    this.drawCanvasControls();
    if (this.viewportInteractionAwaitingHandoff) {
      this.viewportInteractionAwaitingHandoff = false;
      this.clearViewportInteractionCanvas();
    }
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

  drawCanvasCallout(ctx, callout) {
    if (!callout || !callout.tip || !callout.pointer) return;
    const { tip, pointer } = callout;
    const centerX = tip.x + tip.width / 2;
    const centerY = tip.y + tip.height / 2;
    const dx = pointer.x - centerX;
    const dy = pointer.y - centerY;

    ctx.shadowColor = 'rgba(23, 161, 76, 0.28)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#17a14c';
    this.drawRoundRect(ctx, tip.x, tip.y, tip.width, tip.height, 18);
    ctx.fill();

    ctx.beginPath();
    if (Math.abs(dx) > Math.abs(dy)) {
      const baseX = dx >= 0 ? tip.x + tip.width - 1 : tip.x + 1;
      ctx.moveTo(baseX, centerY - 9);
      ctx.lineTo(baseX, centerY + 9);
    } else {
      const baseY = dy >= 0 ? tip.y + tip.height - 1 : tip.y + 1;
      ctx.moveTo(centerX - 9, baseY);
      ctx.lineTo(centerX + 9, baseY);
    }
    ctx.lineTo(pointer.x, pointer.y);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tip.text, centerX, centerY);
  },

  drawCanvasControls() {
    const ctx = this.surveyCtx;
    const rect = this.canvasRect;
    if (!ctx || !rect || !rect.width || !rect.height) return;

    const dpr = this.surveyCanvasDpr || 1;
    const controls = this.canvasControls || {};
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (controls.closeHint) {
      this.drawCanvasCallout(ctx, controls.closeHint);
    }

    if (controls.closeAction) {
      const close = controls.closeAction;
      ctx.beginPath();
      ctx.fillStyle = '#16a34a';
      ctx.arc(close.cx, close.cy, close.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('合', close.cx, close.cy + 1);
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
      this.drawCanvasCallout(ctx, measure);

      ctx.beginPath();
      ctx.fillStyle = 'rgba(65, 65, 69, 0.92)';
      ctx.arc(measure.button.cx, measure.button.cy, measure.button.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ef4444';
      this.drawRoundRect(ctx, measure.button.cx - 14, measure.button.cy - 8, 28, 4, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(measure.label, measure.button.cx, measure.button.cy + 11);
    }

    if (controls.initialGuide) {
      this.drawCanvasCallout(ctx, controls.initialGuide);
    }

    ctx.restore();
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
    const selectedOpening = this.buildSelectedOpening(floor, session.selectedOpeningId);
    const componentState = this.buildComponentEditorState(floor, selectedOpening);

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
      angleActionAvailable: (session.mode === 'diagonal' && !!session.previewPoint &&
        (session.state === 'wallPreview' || session.state === 'awaitingLength') && floor.walls.length > 0) ||
        this.canRemeasureLastDiagonalAngle(floor, session),
      measurePositionVisible: renderData.measurePositionVisible,
      measurePositionStyle: renderData.measurePositionStyle,
      measurePositionButtonLabel: renderData.measurePositionButtonLabel,
      canSwitchInitialMeasurementSide: this.isFirstMeasurePositionStage(floor, session),
      closureGuideVisible: renderData.closureGuideVisible,
      closureGuideStyle: renderData.closureGuideStyle,
      closeActionVisible: renderData.closeActionVisible,
      closeActionStyle: renderData.closeActionStyle,
      closeHintVisible: renderData.closeHintVisible,
      closeHintText: renderData.closeHintText,
      closeHintActionVisible: session.state === 'closing' || session.state === 'mergeClosing',
      selectedWall,
      selectedOpening,
      objectToolsVisible: !!(selectedWall || selectedOpening),
      canResumeWallDrawing: !!selectedOpening && floor.walls.length > 0 && !floor.spaces.some((space) => space.closed),
      componentEditorMode: componentState.mode,
      componentEditorTitle: componentState.title,
      componentCategories: componentState.categories,
      componentLibraryItems: componentState.libraryItems,
      componentSelectedOpening: componentState.opening,
      componentSpecValue: componentState.specValue,
      spaceSummary: this.buildSpaceSummary(),
      measurementTitle: stageMessage.title,
      measurementValue: stageMessage.value,
      isSurveyEmpty: !floor.walls.length,
      showOnboarding: this.data.showOnboarding && !floor.walls.length,
      modePillText: bottomState.modePillText,
      manualActionActive: bottomState.manualActionActive,
      manualActionSubtitle: bottomState.manualActionSubtitle,
      cursorActionSubtitle: bottomState.cursorActionSubtitle,
      cursorPlacementState,
      historySummary: {
        undo: this.history.undo.length,
        redo: this.history.redo.length
      }
    }, extraData || {}), () => {
      this.drawSurveyCanvas();
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

  buildComponentEditorState(floor, selectedOpening) {
    const mode = selectedOpening && selectedOpening.type === 'window' ? 'window' : 'door';
    const categories = (COMPONENT_CATEGORY_OPTIONS[mode] || []).map((item) => Object.assign({}, item, {
      active: selectedOpening ? item.key === selectedOpening.modelCategory : false
    }));
    const activeCategory = selectedOpening ? selectedOpening.modelCategory : '';
    const libraryItems = (COMPONENT_LIBRARY[mode] || [])
      .filter((item) => !activeCategory || item.category === activeCategory)
      .map((item) => Object.assign({}, item, {
      active: selectedOpening ? item.id === selectedOpening.modelId : false
    }));

    return {
      mode,
      title: selectedOpening ? `${selectedOpening.typeLabel}构件编辑` : '构件编辑',
      categories,
      libraryItems,
      opening: selectedOpening,
      specValue: selectedOpening ? this.getComponentSpecRawValue(floor, selectedOpening.id, this.data.componentSpecMode) : '0'
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
    let cursorVisible = false;
    let guideVisible = false;
    let cursorStyle = '';
    let cursorHorizontalGuideStyle = '';
    let cursorVerticalGuideStyle = '';
    let closeHintVisible = false;
    let closeHintText = '';

    if (session.previewPoint) {
      closeHintVisible = !!(session.closeCandidateNodeId || session.closeCandidatePoint);
      closeHintText = closeHintVisible
        ? (session.closeCandidateType === 'merge' ? '已检测到可合并闭合边，松开后可直接闭合' : '预览端点已接近起点，确认长度后可闭合')
        : '';
    }

    if (session.state === 'closing') {
      closeHintVisible = true;
      closeHintText = '当前端点已接近起点，可闭合单空间';
    }

    if (session.state === 'mergeClosing') {
      closeHintVisible = true;
      closeHintText = '已检测到可合并闭合边，点击“合”即可闭合';
    }

    if (
      this.resolveCursorPlacementState(floor, session) === 'placed' &&
      session.anchorNodeId &&
      session.state !== 'spaceClosed' &&
      session.state !== 'wallSelected' &&
      session.state !== 'remeasureAwaitingInput'
    ) {
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
    const initialGuide = this.buildInitialMeasurementGuide(floor, session);
    const activeAngle = this.buildActiveAngleControl(scene, angleActionAvailable);
    this.canvasControls = this.buildCanvasControls(measurePosition, closure, initialGuide, activeAngle);

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
      closeActionStyle: closure.actionStyle,
      closeHintVisible,
      closeHintText
    };
  },

  buildCanvasControls(measurePosition, closure, initialGuide, activeAngle) {
    return {
      closeAction: closure && closure.action
        ? Object.assign({ key: 'close', radius: 14 }, closure.action)
        : null,
      closeHint: closure && closure.hint ? closure.hint : null,
      measurePosition: measurePosition && measurePosition.control ? measurePosition.control : null,
      initialGuide: initialGuide || null,
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
      measurementSide: session.previewMeasurementSide || session.measurementSide,
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
      angle: Number.isFinite(segment.interiorAngleDeg)
        ? `∠${Math.round(segment.interiorAngleDeg)}°`
        : ''
    };
  },

  isFirstMeasurePositionStage(floor, session) {
    return surveyGraph.canSetInitialMeasurementSide(floor, session);
  },

  getCanvasControlSafeArea(rect) {
    const rightRailReserve = 96;
    const bottomDockReserve = 128;
    const topInset = Math.max(12, (this.data.overlayContentTop || 0) + 12);
    return {
      left: 12,
      top: topInset,
      right: Math.max(12, rect.width - rightRailReserve - 12),
      bottom: Math.max(topInset, rect.height - bottomDockReserve)
    };
  },

  buildAnchoredCallout(text, target, tipCenter, safeArea, pointerLength, compact) {
    const tipWidth = compact ? 132 : 202;
    const tipHeight = compact ? 32 : 38;
    const tip = {
      width: tipWidth,
      height: tipHeight,
      text,
      x: clamp(tipCenter.x - tipWidth / 2, safeArea.left, Math.max(safeArea.left, safeArea.right - tipWidth)),
      y: clamp(tipCenter.y - tipHeight / 2, safeArea.top, Math.max(safeArea.top, safeArea.bottom - tipHeight))
    };
    if (!Number.isFinite(pointerLength)) return { tip, pointer: target };

    const centerX = tip.x + tip.width / 2;
    const centerY = tip.y + tip.height / 2;
    const dx = target.x - centerX;
    const dy = target.y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const direction = { x: dx / distance, y: dy / distance };
    const horizontal = Math.abs(direction.x) > Math.abs(direction.y);
    const base = horizontal
      ? { x: direction.x >= 0 ? tip.x + tip.width - 1 : tip.x + 1, y: centerY }
      : { x: centerX, y: direction.y >= 0 ? tip.y + tip.height - 1 : tip.y + 1 };
    return {
      tip,
      pointer: {
        x: base.x + direction.x * pointerLength,
        y: base.y + direction.y * pointerLength
      }
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
      return { visible: false, style: '', buttonLabel: '↔', control: null };
    }

    const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
      ? session.activeSpaceStartWallIndex
      : 0;
    const wall = floor.walls[startWallIndex];
    const start = wall && surveyGraph.getNode(floor, wall.startNodeId);
    const end = wall && surveyGraph.getNode(floor, wall.endNodeId);
    if (!wall || !start || !end) {
      return { visible: false, style: '', buttonLabel: '↔', control: null };
    }

    const startPoint = this.mmToCanvasPoint(start);
    const endPoint = this.mmToCanvasPoint(end);
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) return { visible: false, style: '', buttonLabel: '↔', control: null };

    const leftNormal = { x: -dy / length, y: dx / length };
    const sideNormal = wall.measurementSide === 'right'
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
    const callout = this.buildAnchoredCallout(
      '切换内外墙方向，红线为测量位置',
      target,
      { x: target.x - sideNormal.x * 66, y: target.y - sideNormal.y * 66 },
      safeArea,
      18
    );
    const control = Object.assign({
      key: 'measure-position',
      label: '↕',
      button
    }, callout);

    return {
      visible: true,
      style: '',
      buttonLabel: '↕',
      control
    };
  },

  buildInitialMeasurementGuide(floor, session) {
    if (!floor || !session || floor.walls.length || session.state !== 'cursorPlaced' || !session.anchorNodeId) {
      return null;
    }
    const anchor = surveyGraph.getNode(floor, session.anchorNodeId);
    if (!anchor) return null;

    const cursor = this.mmToCanvasPoint(anchor);
    const rect = this.canvasRect || { width: 0, height: 0 };
    return this.buildAnchoredCallout(
      '沿预览线拖动',
      cursor,
      { x: cursor.x, y: cursor.y - 74 },
      this.getCanvasControlSafeArea(rect),
      undefined,
      true
    );
  },

  buildClosureRender(floor, session) {
    if ((!session.closeCandidateNodeId && !session.closeCandidatePoint) || (!session.previewPoint && !session.anchorNodeId)) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
      ? session.activeSpaceStartWallIndex
      : 0;
    const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
    const hasSharedBoundary = !!(session.activeSpaceSharedWallId || session.closeCandidateSharedWallId);
    const minimumActiveWallCount = session.activeSpaceSharedWallId ? 1 : (hasSharedBoundary ? 2 : 3);
    if (activeWallCount + (session.previewPoint ? 1 : 0) < minimumActiveWallCount) {
      return { guideVisible: false, guideStyle: '', actionVisible: false, actionStyle: '' };
    }

    const targetNode = session.closeCandidatePoint || surveyGraph.getNode(floor, session.closeCandidateNodeId);
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
      actionStyle: `left:${roundPx(actionX - 24)}px; top:${roundPx(actionY - 12)}px;`,
      action,
      hint: actionVisible ? this.buildClosureHint(action, startPoint, endPoint) : null
    };
  },

  buildClosureHint(action, startPoint, endPoint) {
    const rect = this.canvasRect || { width: 0, height: 0 };
    const safeArea = this.getCanvasControlSafeArea(rect);
    const tipWidth = 202;
    const tipHeight = 38;
    const scene = this.surveyRenderScene || {};
    const wallObstacles = ((scene.walls || []).concat(scene.previewWall ? [scene.previewWall] : []))
      .filter((wall) => wall && wall.startPoint && wall.endPoint)
      .map((wall) => ({
        left: Math.min(wall.startPoint.x, wall.endPoint.x) - (wall.thicknessPx || 0) / 2 - 8,
        right: Math.max(wall.startPoint.x, wall.endPoint.x) + (wall.thicknessPx || 0) / 2 + 8,
        top: Math.min(wall.startPoint.y, wall.endPoint.y) - (wall.thicknessPx || 0) / 2 - 8,
        bottom: Math.max(wall.startPoint.y, wall.endPoint.y) + (wall.thicknessPx || 0) / 2 + 8,
        weight: 1
      }));
    const segmentObstacle = {
      left: Math.min(startPoint.x, endPoint.x) - 12,
      right: Math.max(startPoint.x, endPoint.x) + 12,
      top: Math.min(startPoint.y, endPoint.y) - 12,
      bottom: Math.max(startPoint.y, endPoint.y) + 12,
      weight: 8
    };
    const actionObstacle = {
      left: action.cx - 26,
      right: action.cx + 26,
      top: action.cy - 26,
      bottom: action.cy + 26,
      weight: 100
    };
    const obstacles = wallObstacles.concat([segmentObstacle, actionObstacle]);
    const candidateCenters = [
      { x: action.cx - tipWidth / 2 - 28, y: action.cy },
      { x: action.cx + tipWidth / 2 + 28, y: action.cy },
      { x: action.cx, y: action.cy - tipHeight / 2 - 34 },
      { x: action.cx, y: action.cy + tipHeight / 2 + 34 }
    ].map((center) => ({
      x: clamp(center.x, safeArea.left + tipWidth / 2, Math.max(safeArea.left + tipWidth / 2, safeArea.right - tipWidth / 2)),
      y: clamp(center.y, safeArea.top + tipHeight / 2, Math.max(safeArea.top + tipHeight / 2, safeArea.bottom - tipHeight / 2))
    }));
    const scoreCandidate = (center) => {
      const tipBox = {
        left: center.x - tipWidth / 2,
        right: center.x + tipWidth / 2,
        top: center.y - tipHeight / 2,
        bottom: center.y + tipHeight / 2
      };
      return obstacles.reduce((score, obstacle) => (
        boxesOverlap(tipBox, obstacle, 6) ? score + obstacle.weight : score
      ), 0);
    };
    const tipCenter = candidateCenters.reduce((best, candidate) => (
      scoreCandidate(candidate) < scoreCandidate(best) ? candidate : best
    ), candidateCenters[0]);
    return this.buildAnchoredCallout('可闭合', action, tipCenter, safeArea, 8, true);
  },

  formatWallLabel(wall) {
    const lengthLabel = formatMm(wall.lengthMm);
    if (wall.mode === 'diagonal') {
      return `${lengthLabel} ∠ ${Math.round(wall.angleDeg)}°`;
    }
    return lengthLabel;
  },

  buildSelectedWall(floor, wallId) {
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
      width: formatMm(opening.widthMm),
      depth: formatMm(opening.depthMm || (wall && wall.thicknessMm) || 0),
      height: formatMm(opening.heightMm),
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
    if (session.state === 'spaceClosed' || session.state === 'wallSnapPending') {
      return 'awaitingWallDrop';
    }
    return this.cursorPlacementState === 'awaitingWallDrop' ? 'awaitingWallDrop' : 'placed';
  },

  resetCursorPlacement() {
    const floor = surveyGraph.getActiveFloor(this.draft);
    if (!floor.walls.length) {
      this.cursorPlacementState = 'placed';
      this.applyDraft(surveyGraph.resetCursor(this.draft), { persist: true });
      wx.showToast({ title: '光标已复位', icon: 'none' });
      return;
    }

    this.cursorPlacementState = 'awaitingWallDrop';
    this.applyDraft(surveyGraph.startWallSnap(this.draft), { persist: true });
    wx.showToast({ title: '请拖动光标到目标位置', icon: 'none' });
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

  getCursorPlacementCandidate(clientPoint) {
    const floor = surveyGraph.getActiveFloor(this.draft);
    const rawPoint = this.canvasPointToMm(clientPoint);
    if (!floor || !rawPoint) return { type: 'none', pointMm: null };
    const target = surveyGraph.getCursorPlacementTarget(
      floor,
      rawPoint,
      surveyGraph.CLOSE_TOLERANCE_MM
    );
    return {
      type: target.type,
      pointMm: target.pointMm,
      wallId: target.wallId || '',
      snapLine: target.snapLine || ''
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

    return {
      cursorLensVisible: true,
      cursorLensXLabel: `X ${Math.round(point.xMm)}`,
      cursorLensYLabel: `Y ${Math.round(point.yMm)}`,
      cursorLensSnapLabel: targetType === 'vertex'
        ? '顶点吸附'
        : (targetType === 'wall'
          ? (snapLine === 'outer' ? '外边吸附' : '内边吸附')
          : '自由放置'),
      cursorLensSnapType: targetType || 'none'
    };
  },

  resolveCursorDragPoint(clientPoint, includeLens) {
    const candidate = this.getCursorPlacementCandidate(clientPoint);
    // 自由放置必须严格跟随手指。只有真正命中顶点或墙体时，才把
    // 十字光标移动到吸附后的坐标，避免一次 mm 往返换算造成初始跳位。
    const isSnapped = candidate && (candidate.type === 'vertex' || candidate.type === 'wall');
    const displayPoint = isSnapped && candidate.pointMm
      ? this.mmToClientPoint(candidate.pointMm)
      : clientPoint;
    this.cursorDragClientPoint = { x: displayPoint.x, y: displayPoint.y };
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
    const cursorSource = session.state === 'awaitingLength' && session.previewPoint
      ? session.previewPoint
      : anchor;
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
      content: '将删除当前墙体及其上的门窗，已闭合空间会转回未闭合状态。',
      confirmText: '删除',
      confirmColor: '#d71920',
      success: (res) => {
        if (!res.confirm) return;
        const nextDraft = surveyGraph.deleteWall(this.draft, wallId);
        this.applyDraft(nextDraft, { recordHistory: true });
        wx.showToast({ title: '墙体已删除', icon: 'none' });
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
    if (!activeWall) return;
    const currentSide = activeWall ? activeWall.measurementSide : session.measurementSide;
    const nextSide = currentSide === 'right' ? 'left' : 'right';
    const nextDraft = surveyGraph.setMeasurementSide(this.draft, nextSide, activeWallId);
    this.applyDraft(nextDraft, {
      recordHistory: !!activeWallId,
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
        formalNotice: '草稿已保存到服务端'
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
      this.setData({ formalNotice: '量房已完成' });
      wx.showToast({ title: '量房已完成', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: (err && err.error) || '提交失败', icon: 'none' });
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
        recordHistory: true,
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
      const wallHit = this.hitTestWallAtClientPoint(touchState.startPoint);
      if (!wallHit || !wallHit.wallId) {
        wx.showToast({ title: '请点击已有墙体附近', icon: 'none' });
        return;
      }
      const pointMm = this.canvasPointToMm(touchState.startPoint);
      const nextDraft = surveyGraph.snapCursorToWall(this.draft, pointMm);
      this.applyDraft(nextDraft, {
        recordHistory: true,
        extraData: { numberPadVisible: false }
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
        if (session.mode === 'diagonal') {
          const nextDraft = surveyGraph.holdPreviewForInput(this.draft);
          this.applyDraft(nextDraft, { persist: false });
          wx.showToast({ title: '点击顶部角度可校准方向，或直接测量墙长', icon: 'none' });
          return;
        }
        try {
          const nextDraft = surveyGraph.commitPreviewLength(this.draft, session.previewLengthMm, 'preview');
          const nextSession = surveyGraph.getActiveFloor(nextDraft).session;
          this.applyDraft(nextDraft, {
            recordHistory: true,
            historyDraft
          });
          wx.showToast({
            title: (nextSession.state === 'closing' || nextSession.state === 'mergeClosing') ? '可闭合，点击“合”确认' : '墙体已确认',
            icon: 'none'
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
        selectedOpening: null,
        objectToolsVisible: false
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
      const nextDraft = surveyGraph.confirmClosure(this.draft);
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

    // 当前页面固定且不可滚动，page 坐标与 fixed 展示层同源；优先使用
    // 它可避开少数 Android cover-view 中 client 坐标停留在 0 的问题。
    if (pageX !== null && pageY !== null) {
      return { x: pageX, y: pageY };
    }
    if (clientX !== null && clientY !== null) {
      return { x: clientX, y: clientY };
    }
    const detail = e && e.detail;
    const detailX = numberOrNull(detail && detail.x);
    const detailY = numberOrNull(detail && detail.y);
    if (detailX !== null && detailY !== null) {
      return { x: detailX, y: detailY };
    }

    const localX = numberOrNull(touch.x);
    const localY = numberOrNull(touch.y);
    if (localX === null || localY === null) return null;
    const dataset = e && e.currentTarget && e.currentTarget.dataset;
    const fromCursorControl = dataset
      && (dataset.cursorControl === true || dataset.cursorControl === 'true');
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
    query.select('.cursor-fab-drop').boundingClientRect((rect) => {
      if (rect) this.cursorControlRect = rect;
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
    const shouldUpdateLens = !wasDragging || now - this.cursorLensLastUpdateAt >= 80;
    const dragData = this.resolveCursorDragPoint(point, shouldUpdateLens);
    if (shouldUpdateLens) {
      this.cursorLensLastUpdateAt = now;
      this.setData(Object.assign({
        cursorPlacementState: 'dragging'
      }, dragData));
    }
  },

  onCursorDragEnd(e) {
    const wasDragging = this.cursorPlacementState === 'dragging';
    this.cursorDragPending = false;
    const releasePoint = this.getCursorDragTouch(e, true) || this.cursorDragClientPoint || {
      x: this.data.dragCursorX,
      y: this.data.dragCursorY
    };
    this.cursorDragTouchId = null;
    if (!wasDragging) return;
    this.clearCursorDragCanvas();
    const candidate = this.getCursorPlacementCandidate(releasePoint);

    if (!candidate || candidate.type === 'none' || !candidate.pointMm) {
      this.cursorPlacementState = 'awaitingWallDrop';
      this.setData({
        cursorPlacementState: 'awaitingWallDrop',
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
      recordHistory: true,
      extraData: {
        cursorPlacementState: 'placed',
        cursorLensVisible: false,
        numberPadVisible: false
      }
    });
    const placedMessage = candidate.type === 'vertex'
      ? '光标已吸附到顶点'
      : (candidate.type === 'wall'
        ? `光标已吸附到${candidate.snapLine === 'outer' ? '外边' : '内边'}`
        : '光标已放置');
    wx.showToast({ title: placedMessage, icon: 'none' });
  },

  onCursorDragCancel() {
    const wasDragging = this.cursorPlacementState === 'dragging';
    this.cursorDragPending = false;
    this.cursorDragTouchId = null;
    if (!wasDragging) return;
    this.clearCursorDragCanvas();
    this.cursorPlacementState = 'awaitingWallDrop';
    this.setData({
      cursorPlacementState: 'awaitingWallDrop',
      cursorLensVisible: false
    }, () => this.drawSurveyCanvas());
  },


  onRedo() {
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
        const nextDraft = surveyGraph.commitPreviewLength(this.draft, value, 'manual');
        const nextSession = surveyGraph.getActiveFloor(nextDraft).session;
        this.applyDraft(nextDraft, {
          recordHistory: true,
          historyDraft: this.angleRemeasureHistoryDraft || undefined,
          extraData: { numberPadVisible: false, numberInput: '' }
        });
        this.angleRemeasureHistoryDraft = null;
        wx.showToast({
          title: (nextSession.state === 'closing' || nextSession.state === 'mergeClosing') ? '可闭合，点击“合”确认' : '墙体已确认',
          icon: 'none'
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
    this.setData({
      componentSpecMode: mode,
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
          const { createScopedThreejs } = require('threejs-miniprogram');
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
