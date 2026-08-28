/*
 * This browser harness intentionally loads the production Mini Program page
 * module. Platform differences live in this file; surveying state transitions,
 * topology, closure and Canvas rendering stay in miniprogram/.
 */

const appState = {
  globalData: {
    bleConnected: true,
    surveyingEditorContext: null,
    token: '',
    openid: ''
  }
};

let registeredPage = null;
let page = null;
let toastTimer = null;
let activePointerId = null;
let resizeTimer = null;

const dom = {
  canvasShell: document.querySelector('.grid-canvas'),
  surveyCanvas: document.querySelector('#survey-canvas'),
  dragCanvas: document.querySelector('#cursor-drag-canvas'),
  measurementTitle: document.querySelector('#measurement-title'),
  measurementValue: document.querySelector('#measurement-value'),
  topMetric: document.querySelector('#top-metric'),
  rendererRevision: document.querySelector('#renderer-revision'),
  modePill: document.querySelector('#mode-pill'),
  undo: document.querySelector('#undo-button'),
  redo: document.querySelector('#redo-button'),
  close: document.querySelector('#close-button'),
  deleteWall: document.querySelector('#delete-wall-button'),
  measureForm: document.querySelector('#measure-form'),
  measureInput: document.querySelector('#measure-input'),
  clear: document.querySelector('#clear-button'),
  export: document.querySelector('#export-button'),
  import: document.querySelector('#import-input'),
  sheet: document.querySelector('#number-sheet'),
  sheetForm: document.querySelector('#number-sheet .sheet-panel'),
  sheetMask: document.querySelector('#number-sheet .sheet-mask'),
  sheetCancel: document.querySelector('#sheet-cancel'),
  sheetTitle: document.querySelector('#sheet-title'),
  sheetSubtitle: document.querySelector('#sheet-subtitle'),
  sheetInput: document.querySelector('#sheet-input'),
  toast: document.querySelector('#toast'),
  eventLog: document.querySelector('#event-log'),
  wallTable: document.querySelector('#wall-table-body'),
  summary: {
    state: document.querySelector('#summary-state'),
    nodes: document.querySelector('#summary-nodes'),
    walls: document.querySelector('#summary-walls'),
    spaces: document.querySelector('#summary-spaces'),
    openings: document.querySelector('#summary-openings'),
    area: document.querySelector('#summary-area')
  }
};

function patchCanvasNode(canvas) {
  if (!canvas) return canvas;
  if (!canvas.createImage) canvas.createImage = () => new Image();
  if (!canvas.requestAnimationFrame) canvas.requestAnimationFrame = (callback) => requestAnimationFrame(callback);
  if (!canvas.cancelAnimationFrame) canvas.cancelAnimationFrame = (id) => cancelAnimationFrame(id);
  return canvas;
}

patchCanvasNode(dom.surveyCanvas);
patchCanvasNode(dom.dragCanvas);

function logEvent(message) {
  const item = document.createElement('li');
  const time = document.createElement('time');
  const body = document.createElement('span');
  const now = new Date();
  time.textContent = now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  body.textContent = String(message || '');
  item.append(time, body);
  dom.eventLog.prepend(item);
  while (dom.eventLog.children.length > 12) dom.eventLog.lastElementChild.remove();
}

function showToast(title) {
  const message = String(title || '');
  if (!message) return;
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  logEvent(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2200);
}

function readStorage(key) {
  const raw = localStorage.getItem(`surveying-h5:${key}`);
  if (raw === null) return '';
  try {
    return JSON.parse(raw);
  } catch (error) {
    return raw;
  }
}

function createSelectorQuery() {
  let selector = '';
  let rectCallback = null;
  let wantsFields = false;
  const query = {
    in() { return query; },
    select(value) {
      selector = value;
      return query;
    },
    boundingClientRect(callback) {
      rectCallback = callback;
      return query;
    },
    fields() {
      wantsFields = true;
      return query;
    },
    exec(callback) {
      requestAnimationFrame(() => {
        const target = selector === '.grid-canvas'
          ? dom.canvasShell
          : document.querySelector(selector);
        const rect = target ? target.getBoundingClientRect() : null;
        if (rectCallback) {
          rectCallback(rect ? {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height
          } : null);
        }
        if (callback) {
          callback([target && wantsFields ? {
            node: patchCanvasNode(target),
            width: rect.width,
            height: rect.height
          } : null]);
        }
      });
      return query;
    }
  };
  return query;
}

const wxBridge = {
  getSystemInfoSync() {
    return {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      screenHeight: window.screen.height || window.innerHeight,
      statusBarHeight: 0,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      safeArea: { bottom: window.screen.height || window.innerHeight }
    };
  },
  getWindowInfo() {
    return { pixelRatio: Math.min(window.devicePixelRatio || 1, 2) };
  },
  getMenuButtonBoundingClientRect() {
    return { top: 0, bottom: 0, left: window.innerWidth, right: window.innerWidth, width: 0, height: 0 };
  },
  createSelectorQuery,
  getStorageSync: readStorage,
  setStorageSync(key, value) {
    localStorage.setItem(`surveying-h5:${key}`, JSON.stringify(value));
  },
  removeStorageSync(key) {
    localStorage.removeItem(`surveying-h5:${key}`);
  },
  showToast(options) {
    showToast(options && options.title);
  },
  showLoading(options) {
    showToast(options && options.title);
  },
  hideLoading() {},
  showModal(options) {
    const confirmed = window.confirm(`${options.title || ''}\n\n${options.content || ''}`.trim());
    const result = { confirm: confirmed, cancel: !confirmed };
    if (options.success) options.success(result);
    if (options.complete) options.complete(result);
  },
  request(options) {
    fetch(options.url, {
      method: options.method || 'GET',
      headers: options.header || {},
      body: /^(GET|HEAD)$/i.test(options.method || 'GET') ? undefined : JSON.stringify(options.data || {})
    }).then(async (response) => {
      let data;
      try { data = await response.json(); } catch (error) { data = null; }
      if (options.success) options.success({ statusCode: response.status, data });
      if (options.complete) options.complete();
    }).catch((error) => {
      if (options.fail) options.fail(error);
      if (options.complete) options.complete();
    });
  },
  navigateBack(options) {
    if (history.length > 1) history.back();
    else if (options && options.fail) options.fail();
  },
  switchTab() {},
  startDeviceMotionListening(options) {
    if (options && options.fail) options.fail(new Error('H5 harness does not emulate device motion'));
  },
  stopDeviceMotionListening() {},
  onDeviceMotionChange() {},
  offDeviceMotionChange() {}
};

globalThis.getApp = () => appState;
globalThis.getCurrentPages = () => [];
globalThis.wx = wxBridge;
globalThis.Page = (definition) => {
  registeredPage = definition;
};

const surveyGraph = require('../../miniprogram/packages/surveying/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../../miniprogram/packages/surveying/utils/surveyCanvasRenderer.js');
const { CATEGORY_ORDER, createScenarioCatalog } = require('./scenarios.js');
require('../../miniprogram/packages/surveying/editor/surveying-editor.js');

const scenarioCatalog = createScenarioCatalog(surveyGraph);
const scenarios = Object.fromEntries(scenarioCatalog.map((scenario) => [scenario.key, scenario]));
let activeScenarioKey = '';

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function setAtPath(target, path, value) {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
  let cursor = target;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function createPageInstance(definition) {
  if (!definition) throw new Error('Mini Program surveying page was not registered');
  const instance = Object.assign({}, definition);
  instance.data = deepClone(definition.data || {});
  instance.setData = (patch, callback) => {
    Object.entries(patch || {}).forEach(([key, value]) => setAtPath(instance.data, key, value));
    renderUi();
    if (callback) requestAnimationFrame(callback);
  };
  return instance;
}

function eventForDataset(dataset) {
  return { currentTarget: { dataset: dataset || {} }, target: { dataset: dataset || {} } };
}

function activeFloor() {
  return page && page.draft ? surveyGraph.getActiveFloor(page.draft) : null;
}

function renderUi() {
  if (!page || !page.data) return;
  const data = page.data;
  const floor = activeFloor();
  const session = floor && floor.session ? floor.session : {};

  dom.measurementTitle.textContent = data.measurementTitle || '正式量房';
  dom.measurementValue.textContent = data.measurementValue || '';
  dom.modePill.textContent = data.modePillText || '测墙模式';
  dom.undo.disabled = !(data.historySummary && data.historySummary.undo > 0);
  dom.redo.disabled = !(data.historySummary && data.historySummary.redo > 0);

  const metricText = [data.topMetricLength, data.topMetricAngle].filter(Boolean).join('  ');
  dom.topMetric.textContent = metricText;
  dom.topMetric.hidden = !data.topMetricVisible || !metricText;

  document.querySelectorAll('.tool-button[data-tool]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.tool === data.activeTool);
  });
  if (dom.deleteWall) {
    const canDelete = !!(session.selectedWallId || session.selectedOpeningId);
    dom.deleteWall.classList.toggle('is-armed', canDelete);
    dom.deleteWall.disabled = false;
  }

  const closeControl = page.canvasControls && page.canvasControls.closeAction;
  dom.close.hidden = !data.closeActionVisible || !closeControl;
  if (closeControl) {
    dom.close.style.left = `${Math.round(closeControl.cx - 19)}px`;
    dom.close.style.top = `${Math.round(closeControl.cy - 19)}px`;
  }

  dom.sheet.hidden = !data.numberPadVisible;
  if (data.numberPadVisible) {
    dom.sheetTitle.textContent = data.numberPadTitle || '输入数值';
    dom.sheetSubtitle.textContent = data.numberPadSubtitle || '';
    if (document.activeElement !== dom.sheetInput) dom.sheetInput.value = data.numberInput || '';
  }

  if (!floor) return;
  const closedSpaces = (floor.spaces || []).filter((space) => space && space.closed);
  const area = closedSpaces.reduce((total, space) => total + surveyGraph.calculateSpaceAreaMm2(page.draft, space.id), 0);
  dom.summary.state.textContent = session.state || '—';
  dom.summary.nodes.textContent = String((floor.nodes || []).length);
  dom.summary.walls.textContent = String((floor.walls || []).length);
  dom.summary.spaces.textContent = String(closedSpaces.length);
  dom.summary.openings.textContent = String((floor.openings || []).length);
  dom.summary.area.textContent = area ? `${(area / 1e6).toFixed(2)} m²` : '—';

  dom.wallTable.replaceChildren();
  if (!(floor.walls || []).length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty-cell';
    cell.textContent = '暂无墙体';
    row.append(cell);
    dom.wallTable.append(row);
  } else {
    floor.walls.forEach((wall, index) => {
      const row = document.createElement('tr');
      [index + 1, `${Math.round(wall.lengthMm)} mm`, `${Math.round(wall.angleDeg)}°`, `${wall.thicknessMm} mm`, wall.measurementSide === 'right' ? '右' : '左']
        .forEach((value) => {
          const cell = document.createElement('td');
          cell.textContent = String(value);
          row.append(cell);
        });
      dom.wallTable.append(row);
    });
  }
}

function pointerTouch(event) {
  return {
    identifier: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    pageX: event.pageX,
    pageY: event.pageY,
    x: event.clientX,
    y: event.clientY
  };
}

function bindCanvasEvents() {
  dom.canvasShell.addEventListener('pointerdown', (event) => {
    if (activePointerId !== null || event.button !== 0) return;
    activePointerId = event.pointerId;
    dom.canvasShell.setPointerCapture(event.pointerId);
    const touch = pointerTouch(event);
    page.onCanvasTouchStart({
      touches: [touch],
      changedTouches: [touch],
      target: { dataset: {} },
      currentTarget: { dataset: {} }
    });
  });
  dom.canvasShell.addEventListener('pointermove', (event) => {
    if (event.pointerId !== activePointerId) return;
    const touch = pointerTouch(event);
    page.onCanvasTouchMove({ touches: [touch], changedTouches: [touch] });
  });
  const endPointer = (event) => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    page.onCanvasTouchEnd({ touches: [], changedTouches: [pointerTouch(event)] });
  };
  dom.canvasShell.addEventListener('pointerup', endPointer);
  dom.canvasShell.addEventListener('pointercancel', endPointer);
  dom.canvasShell.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = dom.canvasShell.getBoundingClientRect();
    const viewport = page.getViewport();
    const factor = Math.exp(-event.deltaY * 0.0015);
    const scale = Math.max(0.002, Math.min(4, viewport.scale * factor));
    const anchorMm = page.canvasPointToMm({ x: event.clientX, y: event.clientY });
    const nextViewport = {
      scale,
      offsetX: event.clientX - rect.left - rect.width / 2 - anchorMm.xMm * scale,
      offsetY: event.clientY - rect.top - rect.height / 2 - anchorMm.yMm * scale
    };
    page.applyDraft(surveyGraph.updateViewport(page.draft, nextViewport), { persist: false });
  }, { passive: false });
}

function closeNumberSheet() {
  if (!page.data.numberPadVisible) return;
  page.onNumberClose();
}

function simulateMeasurement(mm) {
  const value = Math.round(Number(mm));
  let floor = activeFloor();
  let session = floor && floor.session;
  if (!session || !Number.isFinite(value) || value < surveyGraph.MIN_WALL_LENGTH_MM) {
    showToast(`请输入不少于 ${surveyGraph.MIN_WALL_LENGTH_MM} mm 的整数读数`);
    return false;
  }

  if (session.state === 'wallPreview' || session.state === 'awaitingLength') {
    page.bleMeasureTarget = 'pendingWall';
  } else if (session.state === 'remeasureAwaitingInput' && session.selectedWallId) {
    page.bleMeasureHistoryDraft = surveyGraph.cloneDraft(page.draft);
    page.bleMeasureTarget = 'selectedWall';
  } else if (
    (session.state === 'wallCommitted' || session.state === 'closing' || session.state === 'mergeClosing') &&
    floor.walls.length
  ) {
    const currentWall = floor.walls[floor.walls.length - 1];
    page.bleMeasureHistoryDraft = surveyGraph.cloneDraft(page.draft);
    page.draft = surveyGraph.startRemeasure(surveyGraph.selectWall(page.draft, currentWall.id));
    page.syncFromDraft({ numberPadVisible: false });
    floor = activeFloor();
    session = floor.session;
    page.bleMeasureTarget = 'selectedWall';
  } else {
    showToast('请先从光标拖出待测墙体，或选择墙体进入复尺');
    return false;
  }
  page._lastBleNumberDist = null;
  page._lastBleNumberTime = 0;
  page.onBluetoothMeasure(value / 1000);
  logEvent(`模拟 BLE：${value} mm`);
  return true;
}

function fitDraftToCanvas(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  const nodes = floor.nodes || [];
  if (!nodes.length || !page.canvasRect) return draft;
  const minX = Math.min(...nodes.map((node) => node.xMm));
  const maxX = Math.max(...nodes.map((node) => node.xMm));
  const minY = Math.min(...nodes.map((node) => node.yMm));
  const maxY = Math.max(...nodes.map((node) => node.yMm));
  const widthMm = Math.max(1000, maxX - minX);
  const heightMm = Math.max(1000, maxY - minY);
  const canvasBounds = dom.surveyCanvas.getBoundingClientRect();
  const measureBounds = dom.measureForm.getBoundingClientRect();
  const measureOverlap = Math.max(0, canvasBounds.bottom - measureBounds.top);
  const horizontalPadding = 220;
  const topPadding = 100;
  const bottomPadding = Math.max(210, measureOverlap + 112);
  const availableHeight = Math.max(120, page.canvasRect.height - topPadding - bottomPadding);
  const scale = Math.max(0.02, Math.min(0.13,
    (page.canvasRect.width - horizontalPadding) / widthMm,
    availableHeight / heightMm
  ));
  const safeCenterY = topPadding + availableHeight / 2;
  return surveyGraph.updateViewport(draft, {
    scale,
    offsetX: -((minX + maxX) / 2) * scale,
    offsetY: safeCenterY - page.canvasRect.height / 2 - ((minY + maxY) / 2) * scale
  });
}

function buildScenario(key) {
  const scenario = scenarios[key];
  if (!scenario) return;
  try {
    const draft = scenario.build();
    page.history.undo.push(surveyGraph.cloneDraft(page.draft));
    page.history.redo = [];
    page.draft = fitDraftToCanvas(draft);
    activeScenarioKey = key;
    page.syncFromDraft({ numberPadVisible: false, numberInput: '' });
    page.persistFormalDraft();
    logEvent(`载入场景：${scenario.label}`);
  } catch (error) {
    console.error(error);
    showToast(`场景构造失败：${error.message}`);
  }
}

function clearDraft() {
  page.history.undo.push(surveyGraph.cloneDraft(page.draft));
  page.history.redo = [];
  page.draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  activeScenarioKey = '';
  page.syncFromDraft({ numberPadVisible: false, numberInput: '' });
  page.persistFormalDraft();
  logEvent('画布已清空');
}

function exportDraft() {
  const payload = {
    version: 4,
    measurementMode: 'surveying',
    surveyGraph: surveyGraph.cloneDraft(page.draft)
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `survey-graph-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  logEvent('已导出 version-4 正式墙图');
}

async function importDraft(file) {
  try {
    const payload = JSON.parse(await file.text());
    const rawDraft = payload && payload.version === 4 && payload.measurementMode === 'surveying'
      ? payload.surveyGraph
      : payload;
    const restored = page.normalizeRestoredFormalDraft(rawDraft);
    if (!restored) throw new Error('不是有效的 surveying-editor 墙图草稿');
    page.history.undo.push(surveyGraph.cloneDraft(page.draft));
    page.history.redo = [];
    page.draft = fitDraftToCanvas(restored);
    page.syncFromDraft({ numberPadVisible: false, numberInput: '' });
    page.persistFormalDraft();
    logEvent(`已导入：${file.name}`);
  } catch (error) {
    showToast(`导入失败：${error.message}`);
  } finally {
    dom.import.value = '';
  }
}

function bindControls() {
  document.querySelectorAll('[data-tool]').forEach((button) => {
    button.addEventListener('click', () => page.onToolTap(eventForDataset({ tool: button.dataset.tool })));
  });
  document.querySelectorAll('[data-scenario]').forEach((button) => {
    button.addEventListener('click', () => buildScenario(button.dataset.scenario));
  });
  dom.undo.addEventListener('click', () => page.onUndoTap());
  dom.redo.addEventListener('click', () => page.onRedoTap());
  if (dom.deleteWall) {
    dom.deleteWall.addEventListener('click', () => page.deleteSelectedObject());
  }
  dom.close.addEventListener('click', () => page.onConfirmClose());
  dom.clear.addEventListener('click', clearDraft);
  dom.export.addEventListener('click', exportDraft);
  dom.import.addEventListener('change', () => {
    const [file] = dom.import.files || [];
    if (file) importDraft(file);
  });
  dom.measureForm.addEventListener('submit', (event) => {
    event.preventDefault();
    simulateMeasurement(dom.measureInput.value);
  });
  dom.sheetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    page.setData({ numberInput: dom.sheetInput.value }, () => page.onNumberConfirm());
  });
  dom.sheetCancel.addEventListener('click', closeNumberSheet);
  dom.sheetMask.addEventListener('click', closeNumberSheet);
}

function renderScenarioCatalog() {
  const container = document.querySelector('#scenario-catalog');
  if (!container) return;
  container.replaceChildren();
  CATEGORY_ORDER.forEach((category, categoryIndex) => {
    const group = document.createElement('section');
    group.className = 'scenario-group';
    const heading = document.createElement('h3');
    heading.id = `scenario-category-${categoryIndex + 1}`;
    heading.textContent = category;
    const grid = document.createElement('div');
    grid.className = 'scenario-grid';
    grid.setAttribute('aria-labelledby', heading.id);
    scenarioCatalog.filter((scenario) => scenario.category === category).forEach((scenario) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.scenario = scenario.key;
      button.textContent = scenario.label;
      button.title = scenario.description;
      grid.append(button);
    });
    group.append(heading, grid);
    container.append(group);
  });
}

function exposeAutomationApi() {
  window.__surveyingH5 = {
    rendererRevision: surveyCanvasRenderer.RENDER_REVISION,
    getDraft: () => surveyGraph.cloneDraft(page.draft),
    getSnapshot: () => {
      const floor = activeFloor();
      return {
        scenario: activeScenarioKey,
        state: floor.session.state,
        nodes: floor.nodes.length,
        walls: floor.walls.length,
        spaces: floor.spaces.filter((space) => space.closed).length,
        openings: floor.openings.length,
        draft: surveyGraph.cloneDraft(page.draft)
      };
    },
    setDraft: (draft) => {
      const restored = page.normalizeRestoredFormalDraft(draft && draft.surveyGraph ? draft.surveyGraph : draft);
      if (!restored) throw new Error('Invalid surveying draft');
      page.draft = fitDraftToCanvas(restored);
      page.syncFromDraft({ numberPadVisible: false });
      return window.__surveyingH5.getSnapshot();
    },
    setViewport: (viewport) => {
      page.draft = surveyGraph.updateViewport(page.draft, viewport || {});
      page.refreshCanvasRect();
      page.syncFromDraft({ numberPadVisible: false });
      return window.__surveyingH5.getSnapshot();
    },
    getCursorClientPoint: () => {
      const floor = surveyGraph.getActiveFloor(page.draft);
      const cursor = surveyGraph.getCursorDisplayPoint(floor, floor.session);
      if (!cursor || !page.canvasRect) return null;
      return page.mmToClientPoint(cursor);
    },
    mmToClientPoint: (point) => {
      if (!point || !page.canvasRect) return null;
      return page.mmToClientPoint(point);
    },
    getCloseActionClientPoint: () => {
      const action = page.canvasControls && page.canvasControls.closeAction;
      if (!action || !page.canvasRect) return null;
      return {
        x: page.canvasRect.left + action.cx,
        y: page.canvasRect.top + action.cy
      };
    },
    runScenario: (key) => {
      buildScenario(key);
      return window.__surveyingH5.getSnapshot();
    },
    listScenarios: () => scenarioCatalog.map(({ build, ...scenario }) => ({ ...scenario })),
    simulateMeasurement,
    deleteSelectedObject: () => page.deleteSelectedObject(),
    clear: clearDraft
  };
}

function initialize() {
  page = createPageInstance(registeredPage);
  page.onLoad({});
  page.guideEnabled = false;
  page.setData({ guideEnabled: false });
  page.onReady();
  dom.rendererRevision.textContent = surveyCanvasRenderer.RENDER_REVISION;
  bindCanvasEvents();
  renderScenarioCatalog();
  bindControls();
  exposeAutomationApi();
  renderUi();
  logEvent('H5 桥接完成，生产测量算法已加载');

  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => page.refreshCanvasRect(), 120);
  });
  window.addEventListener('beforeunload', () => page.onUnload());
}

initialize();
