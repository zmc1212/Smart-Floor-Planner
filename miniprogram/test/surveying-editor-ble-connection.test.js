const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);

test('unconnected BLE measurement entries offer in-editor device connection', () => {
  assert.match(editorScript, /requestBluetoothConnection\(\)\s*\{[\s\S]*wx\.showModal/);
  assert.match(editorScript, /confirmText:\s*'去连接'/);
  assert.match(editorScript, /connectBluetoothForMeasurement\(\)\s*\{[\s\S]*bluetooth\.initBLE/);
  assert.equal((editorScript.match(/this\.requestBluetoothConnection\(\);/g) || []).length, 4);
});

test('current, closable, pending, selected, and cursor-snapped walls receive BLE measurements without opening the number pad', () => {
  assert.match(editorScript, /onBottomMeasure\(\)\s*\{[\s\S]*session\.state === 'wallPreview'[\s\S]*startBluetoothMeasure\('pendingWall'\)[\s\S]*session\.state === 'cursorPlaced'[\s\S]*session\.state === 'wallCommitted' \|\| session\.state === 'closing' \|\| session\.state === 'mergeClosing'[\s\S]*selectedWall && !session\.selectedOpeningId[\s\S]*startBluetoothMeasure\('selectedWall'\)/);
  assert.match(editorScript, /target === 'selectedWall'[\s\S]*applyBleReadingToSelectedWall\(distanceInMeters\)/);
  assert.match(editorScript, /target === 'pendingWall'[\s\S]*applyBleReadingToPendingWall\(distanceInMeters\)/);
  assert.match(editorScript, /applyBleReadingToSelectedWall\(distanceInMeters\)\s*\{[\s\S]*remeasureSelectedWall\(this\.draft, valueMm, 'ble'\)/);
  assert.match(editorScript, /applyBleReadingToPendingWall\(distanceInMeters\)\s*\{[\s\S]*commitPreviewLength\(this\.draft, valueMm, 'ble'\)/);
});

test('selected-wall BLE remeasure restores the pre-measurement draft when applying or redrawing fails', () => {
  assert.match(editorScript, /applyBleReadingToSelectedWall\(distanceInMeters\)\s*\{[\s\S]*const historyDraft = this\.bleMeasureHistoryDraft;[\s\S]*const restoreMeasurementDraft = \(\) =>[\s\S]*this\.history\.undo\.splice\(historyUndoLength\);[\s\S]*this\.history\.redo = historyRedo;[\s\S]*this\.draft = surveyGraph\.cloneDraft\(historyDraft\);[\s\S]*distanceInMeters === null[\s\S]*restoreMeasurementDraft\(\);[\s\S]*catch \(err\) \{[\s\S]*restoreMeasurementDraft\(\);/);
});

test('connected BLE dock measure without a pending or selected wall asks to drag a wall first', () => {
  assert.match(
    editorScript,
    /onBottomMeasure\(\)\s*\{[\s\S]*if \(this\.data\.numberPadVisible\) \{\s*this\.triggerBluetoothNumberMeasure\(\);\s*return;\s*\}\s*wx\.showToast\(\{\s*title:\s*'请先拉出一条墙'/
  );
  assert.doesNotMatch(
    editorScript,
    /openLengthPad\(\);\s*setTimeout\(\(\) => this\.triggerBluetoothNumberMeasure\(\)/
  );
  assert.doesNotMatch(
    editorScript,
    /onBottomMeasure\(\)\s*\{[\s\S]*请先打开数字修改/
  );
});

test('formal BLE audits send the same audit ID at top level and in compatibility metadata', () => {
  assert.match(
    editorScript,
    /sendMeasurementRecord\(floorPlanId, record\)[\s\S]*floorPlanId,\s*auditId: record\.auditId,[\s\S]*metadata:\s*\{[\s\S]*measurementMode: 'surveying',[\s\S]*auditId: record\.auditId/
  );
});
