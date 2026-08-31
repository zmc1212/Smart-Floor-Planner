const test = require('node:test');
const assert = require('node:assert/strict');

const editorPath = require.resolve('../packages/surveying/editor/surveying-editor.js');
const api = require('../utils/api.js');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyLayout = require('../utils/surveyLayout.js');

function loadEditor(storage) {
  delete require.cache[editorPath];
  global.getApp = () => ({ globalData: {} });
  global.wx = {
    getStorageSync(key) {
      return storage.has(key) ? storage.get(key) : '';
    },
    setStorageSync(key, value) {
      storage.set(key, value);
    },
    removeStorageSync(key) {
      storage.delete(key);
    }
  };
  let definition = null;
  global.Page = (pageDefinition) => {
    definition = pageDefinition;
  };
  require(editorPath);
  assert.ok(definition);
  return Object.assign({}, definition, {
    data: Object.assign({}, definition.data, { leadId: 'lead-1', serverDraftId: '' }),
    formalDraftKey: 'surveying_draft_v1_lead-1',
    pendingMeasurementRecords: [],
    reportedMeasurementKeys: Object.create(null),
    _flushingMeasurements: false,
    serverDraftId: ''
  });
}

test('measurement audits survive page recreation before a floorPlanId exists', async () => {
  const storage = new Map();
  const editor = loadEditor(storage);

  const queued = await editor.reportMeasurement({
    auditId: 'audit-offline-1',
    value: 3.456,
    type: 'length',
    source: 'manual',
    metadata: { target: 'pendingWall' }
  });

  assert.equal(queued, false);
  assert.equal(editor.pendingMeasurementRecords.length, 1);
  const storageKey = editor.getPendingMeasurementStorageKey();
  assert.equal(storage.get(storageKey)[0].auditId, 'audit-offline-1');

  const recreated = loadEditor(storage);
  recreated.pendingMeasurementRecords = recreated.loadPendingMeasurements();
  assert.deepEqual(
    recreated.pendingMeasurementRecords.map((item) => item.auditId),
    ['audit-offline-1']
  );
});

test('failed flush keeps a durable record and successful retry removes it', async (t) => {
  const storage = new Map();
  const editor = loadEditor(storage);
  editor.enqueuePendingMeasurement({
    auditId: 'audit-retry-1',
    value: 2.5,
    type: 'length',
    source: 'manual',
    measuredAt: '2026-08-31T00:00:00.000Z',
    metadata: { target: 'selectedWall' }
  });

  const originalRequest = api.request;
  t.after(() => {
    api.request = originalRequest;
    delete global.Page;
    delete global.getApp;
    delete global.wx;
  });

  let shouldFail = true;
  const payloads = [];
  api.request = async (path, method, payload) => {
    payloads.push({ path, method, payload });
    if (shouldFail) throw new Error('offline');
    return { success: true };
  };

  assert.equal(await editor.flushPendingMeasurements('floor-plan-1'), false);
  assert.equal(editor.pendingMeasurementRecords.length, 1);
  assert.equal(storage.get(editor.getPendingMeasurementStorageKey()).length, 1);

  shouldFail = false;
  assert.equal(await editor.flushPendingMeasurements('floor-plan-1'), true);
  assert.equal(editor.pendingMeasurementRecords.length, 0);
  assert.equal(storage.has(editor.getPendingMeasurementStorageKey()), false);
  assert.equal(payloads[1].path, '/measurements');
  assert.equal(payloads[1].method, 'POST');
  assert.equal(payloads[1].payload.source, 'manual');
  assert.equal(payloads[1].payload.auditId, 'audit-retry-1');
  assert.equal(payloads[1].payload.metadata.auditId, 'audit-retry-1');
});

test('loading an existing formal plan retries its durable measurement queue', async (t) => {
  const storage = new Map();
  const editor = loadEditor(storage);
  editor.setData = (patch) => {
    editor.data = Object.assign({}, editor.data, patch);
  };
  editor.syncFromDraft = () => {};
  editor.autosaveFormalFloorPlan = () => Promise.resolve(true);
  editor.pendingRestoredLocalDraft = null;
  editor.localDraftSavedAt = 0;

  const originalRequest = api.request;
  t.after(() => {
    api.request = originalRequest;
    delete global.Page;
    delete global.getApp;
    delete global.wx;
  });

  const graph = surveyGraph.createSurveyDraft();
  api.request = async () => ({
    success: true,
    data: {
      _id: 'floor-plan-restored',
      status: 'draft',
      updatedAt: '2026-08-31T00:00:00.000Z',
      layoutData: surveyLayout.createFormalSurveyLayout(graph, 'draft')
    }
  });
  let flushedFloorPlanId = '';
  editor.flushPendingMeasurements = async (floorPlanId) => {
    flushedFloorPlanId = floorPlanId;
    return true;
  };

  await editor.loadFormalFloorPlan('floor-plan-restored');

  assert.equal(flushedFloorPlanId, 'floor-plan-restored');
});

test('measurement reporting is durably queued before its network request settles', async (t) => {
  const storage = new Map();
  const editor = loadEditor(storage);
  editor.serverDraftId = 'floor-plan-1';
  editor.data.serverDraftId = 'floor-plan-1';
  const originalRequest = api.request;
  t.after(() => {
    api.request = originalRequest;
    delete global.Page;
    delete global.getApp;
    delete global.wx;
  });
  let rejectRequest;
  api.request = () => new Promise((resolve, reject) => {
    rejectRequest = reject;
  });

  const reporting = editor.reportMeasurement({
    auditId: 'audit-write-ahead',
    value: 1.234,
    type: 'length',
    source: 'ble'
  });
  assert.equal(editor.pendingMeasurementRecords.length, 1);
  assert.equal(storage.get(editor.getPendingMeasurementStorageKey()).length, 1);
  rejectRequest(new Error('offline'));
  assert.equal(await reporting, false);
  assert.equal(editor.pendingMeasurementRecords.length, 1);
});

test('an unbound audit queue migrates to the formal floor plan without changing audit IDs', () => {
  const storage = new Map();
  const editor = loadEditor(storage);
  editor.setData = (patch) => {
    editor.data = Object.assign({}, editor.data, patch);
  };
  editor.enqueuePendingMeasurement({ auditId: 'audit-bind-1', value: 2.5, source: 'manual' });
  const draftKey = editor.getPendingMeasurementStorageKey();

  editor.persistServerDraftId('lead-1', 'floor-plan-bound');

  const floorKey = editor.getPendingMeasurementStorageKey();
  assert.notEqual(floorKey, draftKey);
  assert.equal(storage.has(draftKey), false);
  assert.equal(storage.get(floorKey)[0].auditId, 'audit-bind-1');
  assert.equal(storage.get(floorKey)[0].floorPlanId, 'floor-plan-bound');
});

test('a queue above the warning threshold is retained instead of dropping oldest audits', () => {
  const storage = new Map();
  const editor = loadEditor(storage);
  editor.pendingMeasurementRecords = Array.from({ length: 501 }, (_, index) => ({
    auditId: `audit-${index}`,
    value: 1
  }));

  editor.persistPendingMeasurements();

  assert.equal(editor.pendingMeasurementRecords.length, 501);
  assert.equal(storage.get(editor.getPendingMeasurementStorageKey()).length, 501);
  assert.equal(editor.pendingMeasurementRecords[0].auditId, 'audit-0');
});
