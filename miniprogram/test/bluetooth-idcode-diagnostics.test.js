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

test('BLE scan failure paths notify the connect callback so the connector can unlock', () => {
  assert.match(bluetoothSource, /function cancelBLEDiscovery\(\)/);
  assert.match(bluetoothSource, /搜不到授权设备时必须回调失败/);
  assert.match(bluetoothSource, /permission_denied[\s\S]*_onConnectCallback\(false\)/);
  assert.match(bluetoothSource, /scan_failed[\s\S]*_onConnectCallback\(false\)/);
  assert.match(
    fs.readFileSync(path.join(__dirname, '..', 'utils', 'bluetooth.js'), 'utf8'),
    /cancelBLEDiscovery: cancelBLEDiscovery/
  );

  const connectorSource = fs.readFileSync(
    path.join(__dirname, '..', 'components', 'ble-connector', 'ble-connector.js'),
    'utf8'
  );
  assert.match(connectorSource, /bluetooth\.cancelBLEDiscovery\(\)/);
  assert.match(
    connectorSource,
    /onClose\(\) \{\s*if \(this\.data\.connecting\) \{\s*bluetooth\.cancelBLEDiscovery\(\);/
  );
  assert.match(connectorSource, /onClose\(\) \{[\s\S]*?this\.triggerEvent\('close'\);/);
});

test('BLE discovery registers the listener before scanning and logs nearby devices', () => {
  assert.match(bluetoothSource, /function isTargetRangefinderName\(name\)/);
  assert.match(bluetoothSource, /TARGET_DEVICE_NAME_TOKEN = 'LDMSTUDIO'/);
  assert.match(bluetoothSource, /powerLevel: 'high'/);
  assert.match(bluetoothSource, /wx\.onBluetoothDeviceFound\(_deviceFoundHandler\)/);
  assert.match(bluetoothSource, /startBluetoothDevicesDiscovery\(/);
  assert.match(bluetoothSource, /\[BLE discovery\] start scan/);
  assert.match(bluetoothSource, /\[BLE discovery\] nearby deviceId=/);
  assert.match(bluetoothSource, /getBluetoothDevices/);
  assert.match(bluetoothSource, /buildNotFoundContent/);
  const listenAt = bluetoothSource.indexOf('wx.onBluetoothDeviceFound(_deviceFoundHandler)');
  const startAt = bluetoothSource.indexOf('wx.startBluetoothDevicesDiscovery({');
  assert.ok(listenAt > -1 && startAt > -1 && listenAt < startAt);
});

test('BLE already-connect resumes the existing system session instead of failing', () => {
  assert.match(bluetoothSource, /function isAlreadyConnectedError\(err\)/);
  assert.match(bluetoothSource, /function resumeConnectedSession\(/);
  assert.match(bluetoothSource, /errno === 1509007/);
  assert.match(bluetoothSource, /already\\s\*connect/);
  assert.match(bluetoothSource, /createBLEConnection already connected, resume session/);
  assert.match(bluetoothSource, /已恢复连接/);
  assert.match(bluetoothSource, /isSessionConnected/);
  assert.match(bluetoothSource, /_autoConnectInFlight/);
});

test('App forwards silent BLE state changes to pages that expose the editor hook', () => {
  const appSource = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(appSource, /notifyBleConnectionResult\(success\)[\s\S]*?currentPage\.updateBleConnected\(!!success\)/);
});
