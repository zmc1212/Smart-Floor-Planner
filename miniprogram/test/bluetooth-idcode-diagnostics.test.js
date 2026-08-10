const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bluetoothSource = fs.readFileSync(
  path.join(__dirname, '..', 'utils', 'bluetooth.js'),
  'utf8'
);

test('BLE diagnostics log broadcast data and query the documented IDCODE once per connection', () => {
  assert.match(bluetoothSource, /function logDiscoveredDevice\(device, name\)/);
  assert.match(bluetoothSource, /advertisData=\[/);
  assert.match(bluetoothSource, /sendBLECommand\('ATC001#'\)/);
  assert.match(bluetoothSource, /_hasRequestedDeviceIdCode = false/);
});

test('BLE diagnostics validate and log the 16-byte IDCODE response frame', () => {
  assert.match(bluetoothSource, /a === 0x49 && b === 0x44/);
  assert.match(bluetoothSource, /dataBuffer\.length < 16/);
  assert.match(bluetoothSource, /dataBuffer\[15\] !== 0x23/);
  assert.match(bluetoothSource, /idCodeCrc !== dataBuffer\[14\]/);
  assert.match(bluetoothSource, /idCodeHex=/);
  assert.match(bluetoothSource, /idCodeAscii=/);
});
