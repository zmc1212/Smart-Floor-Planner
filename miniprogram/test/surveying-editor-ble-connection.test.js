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
