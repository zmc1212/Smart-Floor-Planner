const test = require('node:test');
const assert = require('node:assert/strict');

const editorPath = require.resolve('../packages/surveying/editor/surveying-editor.js');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');

function loadEditor() {
  delete require.cache[editorPath];
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    removeStorageSync() {},
    showToast() {}
  };
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  require(editorPath);
  assert.ok(definition);
  const editor = Object.assign({}, definition, {
    draft: surveyGraph.createSurveyDraft(),
    data: Object.assign({}, definition.data, {
      numberInput: '240',
      serverDraftId: ''
    }),
    numberPadMode: 'thickness',
    numberPadMeasurementSource: 'ble',
    pendingMeasurementRecords: [],
    reportedMeasurementKeys: Object.create(null),
    _flushingMeasurements: false
  });
  editor.setData = (patch, callback) => {
    editor.data = Object.assign({}, editor.data, patch);
    if (typeof callback === 'function') callback();
  };
  editor.applyDraft = (nextDraft) => {
    editor.draft = nextDraft;
  };
  return editor;
}

test('BLE wall-thickness confirmation does not create a duplicate manual audit', () => {
  const editor = loadEditor();
  const reported = [];
  editor.reportManualMeasurementMm = (value, options) => {
    reported.push({ value, options });
    return Promise.resolve(true);
  };

  editor.onNumberConfirm();

  assert.equal(reported.length, 0);
  assert.equal(editor.numberPadMode, '');
});

test('manual wall-thickness confirmation creates one length audit', () => {
  const editor = loadEditor();
  editor.numberPadMeasurementSource = 'manual';
  const reported = [];
  editor.reportManualMeasurementMm = (value, options) => {
    reported.push({ value, options });
    return Promise.resolve(true);
  };

  editor.onNumberConfirm();

  assert.equal(reported.length, 1);
  assert.equal(reported[0].value, 240);
  assert.equal(reported[0].options.type, 'length');
  assert.equal(reported[0].options.metadata.measurementKind, 'wall_thickness');
});

test('equal consecutive BLE readings remain available to different editor targets', () => {
  const editor = loadEditor();
  editor.numberPadMode = 'length';
  editor.data.numberPadVisible = true;

  assert.equal(editor.applyBleReadingToNumberPad(2.5), true);
  assert.equal(editor.applyBleReadingToNumberPad(2.5), true);
  assert.equal(editor.data.numberInput, '2500');
});

test('embedded component keyboard batches keystrokes into one final manual audit', async () => {
  const editor = loadEditor();
  const floor = surveyGraph.getActiveFloor(editor.draft);
  floor.nodes = [
    { id: 'a', xMm: 0, yMm: 0 },
    { id: 'b', xMm: 10000, yMm: 0 }
  ];
  floor.walls = [{
    id: 'wall-1', startNodeId: 'a', endNodeId: 'b', mode: 'straight',
    lengthMm: 10000, angleDeg: 0, thicknessMm: 200, status: 'confirmed'
  }];
  floor.openings = [{
    id: 'opening-1', type: 'window', wallId: 'wall-1', widthMm: 1000,
    centerOffsetMm: 5000, heightMm: 1500, sillHeightMm: 900
  }];
  floor.session.selectedOpeningId = 'opening-1';
  floor.session.state = 'openingSelected';
  editor.data.componentSpecInput = '40';
  editor.data.componentSpecMode = 'length';
  editor.syncFromDraft = (patch) => {
    editor.data = Object.assign({}, editor.data, patch || {});
  };
  editor.scheduleFormalPersist = () => {};
  const reported = [];
  editor.reportManualMeasurementMm = (value, options) => {
    reported.push({ value, options });
    return Promise.resolve(true);
  };

  editor.onComponentKeyboardKey({ currentTarget: { dataset: { key: '0' } } });
  editor.onComponentKeyboardKey({ currentTarget: { dataset: { key: '1' } } });
  assert.equal(reported.length, 0);
  await editor.flushPendingComponentManualAudit();

  assert.equal(reported.length, 1);
  assert.equal(reported[0].value, 4001);
  assert.equal(reported[0].options.type, 'opening_width');
  assert.equal(reported[0].options.metadata.openingId, 'opening-1');
});

test('pending-wall BLE audit is bound to the wall created by the reading', () => {
  const editor = loadEditor();
  editor.draft = surveyGraph.placeCursor(editor.draft, { xMm: 0, yMm: 0 });
  editor.draft = surveyGraph.startPreview(editor.draft, { xMm: 2000, yMm: 0 });
  editor.bleMeasureTarget = 'pendingWall';
  const reported = [];
  editor.reportMeasurement = (record) => {
    reported.push(record);
    return Promise.resolve(true);
  };

  editor.onBluetoothMeasure(2, { rawFrameHexCompact: '415444' });

  assert.equal(reported.length, 1);
  assert.ok(reported[0].metadata.wallId);
  assert.equal(reported[0].direction, reported[0].metadata.wallId);
  const floor = surveyGraph.getActiveFloor(editor.draft);
  assert.equal(reported[0].metadata.wallId, floor.walls[0].id);
});

test('a late app-command frame is not reclassified as a hardware-key reading', () => {
  const editor = loadEditor();
  editor.draft = surveyGraph.placeCursor(editor.draft, { xMm: 0, yMm: 0 });
  editor.draft = surveyGraph.startPreview(editor.draft, { xMm: 2000, yMm: 0 });
  editor.bleMeasureTarget = 'pendingWall';

  editor.onBluetoothMeasure(null);
  editor.onBluetoothMeasure(2);

  const floor = surveyGraph.getActiveFloor(editor.draft);
  assert.equal(floor.walls.length, 0);
  assert.equal(floor.session.state, 'wallPreview');
});
