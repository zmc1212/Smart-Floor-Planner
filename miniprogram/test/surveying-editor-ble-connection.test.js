const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);

test('ble input mode requires a picked direction before hardware measurement', () => {
  assert.match(editorScript, /bleInputMode[\s\S]*请先点选方向箭头/);
  assert.match(editorScript, /setBleInputMode\(/);
  assert.match(editorScript, /lockPreviewBearing\(/);
  assert.match(editorScript, /drawBleDirectionScreenOverlay\(/);
  assert.match(editorScript, /onBleDirectionTap\(/);
  assert.match(editorScript, /createDirectionPickController\(/);
});

test('automatic BLE direction waits for privacy and follows the page lifecycle', () => {
  assert.match(
    editorScript,
    /startBleDirectionAutoPick\(\)\s*\{[\s\S]*?ensureHeadingSensorReady\(\)/
  );
  assert.match(editorScript, /onHide\(\)\s*\{[\s\S]*?suspendBleDirectionAutoPick\(\)/);
  assert.match(editorScript, /onShow\(\)\s*\{[\s\S]*?resumeBleDirectionAutoPick\(\)/);
  assert.match(
    editorScript,
    /bleSelectedDirectionKey = '';[\s\S]*?directionPickController\.setSelectedKey\(''\)/
  );
});

test('blank canvas taps clear the BLE direction lock and restore candidates', () => {
  assert.match(
    editorScript,
    /clearBleDirectionSelection\(\)\s*\{[\s\S]*?bleDirectionMode === 'auto'[\s\S]*?bleDirectionMode = 'manual';[\s\S]*?stopBleDirectionAutoPick\(\)[\s\S]*?bleSelectedDirectionKey = '';[\s\S]*?directionPickController\.setSelectedKey\(''\)[\s\S]*?clearBleLockedBearing\(this\.draft\)[\s\S]*?recordHistory: false/
  );
  assert.match(
    editorScript,
    /if \(wasTap\)\s*\{[\s\S]*?hitTestOpeningAtClientPoint[\s\S]*?hitTestWallAtClientPoint[\s\S]*?hitTestClosedSpaceAtClientPoint[\s\S]*?clearBleDirectionSelection\(\)/
  );
  assert.match(
    editorScript,
    /if \(controlTap\)\s*\{[\s\S]*?canvasTapSelectedObject = true;[\s\S]*?handleCanvasControlTap\(touchState\.control\)/
  );
  assert.match(editorScript, /onCanvasTap\(\)\s*\{[\s\S]*?clearBleDirectionSelection\(\)/);
});

test('BLE direction arrows do not block wall selection or cursor-adjacent short taps', () => {
  const touchStart = editorScript.slice(
    editorScript.indexOf('onCanvasTouchStart(e) {'),
    editorScript.indexOf('onCanvasTouchMove(e) {')
  );
  assert.match(
    touchStart,
    /const openingHit = this\.hitTestOpeningAtClientPoint\(point\);[\s\S]*?const wallHit = this\.hitTestWallAtClientPoint\(point\);[\s\S]*?const controlHit = this\.hitTestCanvasControl\(point\);/
  );
  assert.match(
    touchStart,
    /controlHit\.key === 'ble-direction'[\s\S]*?openingHit && openingHit\.openingId[\s\S]*?wallHit && wallHit\.wallId[\s\S]*?if \(controlHit && !bleDirectionOverlapsObject\)/
  );
  assert.match(editorScript, /if \(wasTap\)\s*\{[\s\S]*?surveyGraph\.selectWall\(this\.draft, wallHit\.wallId\)/);
  assert.doesNotMatch(editorScript, /if \(wasTap && !touchState\.nearCursor\)/);
});

test('unconnected BLE measurement entries offer in-editor device connection', () => {
  assert.match(editorScript, /requestBluetoothConnection\(\)\s*\{[\s\S]*wx\.showModal/);
  assert.match(editorScript, /confirmText:\s*'去连接'/);
  assert.match(editorScript, /connectBluetoothForMeasurement\(\)\s*\{[\s\S]*bluetooth\.initBLE/);
  assert.equal((editorScript.match(/this\.requestBluetoothConnection\(\);/g) || []).length, 4);
});

test('editor syncs an active BLE session when shown and avoids duplicate discovery', () => {
  assert.match(editorScript, /onShow\(\)\s*\{[\s\S]*?this\.syncBleConnectionState\(\);/);
  assert.match(
    editorScript,
    /syncBleConnectionState\(\)\s*\{[\s\S]*?bluetooth\.isSessionConnected\(\)[\s\S]*?this\.updateBleConnected\(connected\)/
  );
  assert.match(
    editorScript,
    /connectBluetoothForMeasurement\(\)\s*\{[\s\S]*?bluetooth\.isSessionConnected\(\)[\s\S]*?this\.syncBleConnectionState\(\)[\s\S]*?return true;[\s\S]*?bluetooth\.initBLE/
  );
  assert.match(editorScript, /bluetooth\.initBLE\([\s\S]*?return false;/);
  assert.match(
    editorScript,
    /onNavigationCalibrationConfirm\(\)\s*\{[\s\S]*?const sessionReady = this\.connectBluetoothForMeasurement\(\)[\s\S]*?if \(sessionReady\)[\s\S]*?this\.syncBleConnectionState\(\)/
  );
});

test('current, closable, pending, selected, and cursor-snapped walls receive BLE measurements without opening the number pad', () => {
  assert.match(
    editorScript,
    /resolveBleMeasureTarget\(\)\s*\{[\s\S]*session\.state === 'wallPreview' \|\| session\.state === 'awaitingLength'[\s\S]*target: 'pendingWall'[\s\S]*session\.state === 'cursorPlaced'[\s\S]*session\.state === 'wallCommitted' \|\| session\.state === 'closing' \|\| session\.state === 'mergeClosing'[\s\S]*selectedWall && session && !session\.selectedOpeningId[\s\S]*target: 'selectedWall'/
  );
  assert.match(editorScript, /onBottomMeasure\(\)\s*\{[\s\S]*resolveBleMeasureTarget\(\)[\s\S]*startBluetoothMeasure\('pendingWall'\)[\s\S]*startBluetoothMeasure\('selectedWall'\)/);
  assert.match(editorScript, /target === 'selectedWall'[\s\S]*applyBleReadingToSelectedWall\(distanceInMeters\)/);
  assert.match(editorScript, /target === 'pendingWall'[\s\S]*applyBleReadingToPendingWall\(distanceInMeters\)/);
  assert.match(editorScript, /applyBleReadingToSelectedWall\(distanceInMeters\)\s*\{[\s\S]*remeasureSelectedWall\(this\.draft, valueMm, 'ble'\)/);
  assert.match(editorScript, /applyBleReadingToPendingWall\(distanceInMeters\)\s*\{[\s\S]*commitPreviewLength\(this\.draft, valueMm, 'ble'\)/);
});

test('device ATD frames apply to the current wall without a dock 测距 command', () => {
  assert.match(
    editorScript,
    /onBluetoothMeasure\(distanceInMeters, frameMetadata\)\s*\{[\s\S]*const hardwareTriggered = !target;[\s\S]*resolveBleMeasureTarget\(\)[\s\S]*prepareBleMeasureTarget\(resolved\)/
  );
  assert.match(editorScript, /bleOrigin: hardwareTriggered \? 'device' : 'app'/);
  assert.doesNotMatch(editorScript, /this\.bleMeasureTarget \|\| 'numberPad'/);
  assert.match(
    editorScript,
    /target === 'pendingWall'[\s\S]*applyBleReadingToPendingWall\(distanceInMeters\)[\s\S]*target === 'numberPad'[\s\S]*applyBleReadingToNumberPad\(distanceInMeters\)/
  );
});

test('selected-wall BLE remeasure restores the pre-measurement draft when applying or redrawing fails', () => {
  assert.match(editorScript, /applyBleReadingToSelectedWall\(distanceInMeters\)\s*\{[\s\S]*const historyDraft = this\.bleMeasureHistoryDraft;[\s\S]*const restoreMeasurementDraft = \(\) =>[\s\S]*this\.history\.undo\.splice\(historyUndoLength\);[\s\S]*this\.history\.redo = historyRedo;[\s\S]*this\.draft = surveyGraph\.cloneDraft\(historyDraft\);[\s\S]*distanceInMeters === null[\s\S]*restoreMeasurementDraft\(\);[\s\S]*catch \(err\) \{[\s\S]*restoreMeasurementDraft\(\);/);
  assert.match(
    editorScript,
    /prepareBleMeasureTarget\(resolved\)\s*\{[\s\S]*bleMeasureHistoryDraft = surveyGraph\.cloneDraft\(this\.draft\);[\s\S]*startRemeasure\(selectedWallDraft\)/
  );
});

test('connected BLE dock measure without a pending or selected wall asks to drag a wall first', () => {
  assert.match(
    editorScript,
    /onBottomMeasure\(\)\s*\{[\s\S]*resolved\.target === 'numberPad'[\s\S]*this\.triggerBluetoothNumberMeasure\(\);[\s\S]*wx\.showToast\(\{\s*title:\s*resolved\.reason \|\| '请先拉出一条墙'/
  );
  assert.match(
    editorScript,
    /resolveBleMeasureTarget\(\)\s*\{[\s\S]*return \{ target: '', reason: '请先拉出一条墙' \}/
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
