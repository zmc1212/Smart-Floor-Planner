const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'surveying-editor', 'surveying-editor.js'),
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
