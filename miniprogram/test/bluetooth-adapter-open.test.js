const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const bluetoothPath = require.resolve('../utils/bluetooth.js');
const appJsonPath = path.join(__dirname, '..', 'app.json');

function loadBluetooth() {
  delete require.cache[bluetoothPath];
  return require(bluetoothPath);
}

function createWxStub(overrides) {
  const calls = [];
  const wx = {
    calls,
    getSystemInfoSync() {
      return { platform: 'android', brand: 'huawei' };
    },
    getSystemSetting() {
      return { bluetoothEnabled: true, locationEnabled: true };
    },
    getAppAuthorizeSetting() {
      return { bluetoothAuthorized: 'authorized', locationAuthorized: 'authorized' };
    },
    authorize(options) {
      if (options && options.success) options.success();
    },
    openBluetoothAdapter(options) {
      if (options && options.success) options.success({});
    },
    showLoading() { calls.push('showLoading'); },
    hideLoading() { calls.push('hideLoading'); },
    showToast(options) { calls.push({ type: 'toast', title: options && options.title }); },
    showModal(options) {
      calls.push({
        type: 'modal',
        title: options && options.title,
        content: options && options.content
      });
    },
    onBLEConnectionStateChange() {},
    onBluetoothAdapterStateChange() {},
    onBluetoothDeviceFound() {},
    offBluetoothDeviceFound() {},
    startBluetoothDevicesDiscovery(options) {
      calls.push('startScan');
      if (options && options.success) options.success();
    },
    getBluetoothDevices(options) {
      calls.push('getBluetoothDevices');
      if (options && options.success) options.success({ devices: [] });
    },
    stopBluetoothDevicesDiscovery() { calls.push('stopScan'); },
    openSystemBluetoothSetting() { calls.push('openSystemBluetoothSetting'); },
    openAppAuthorizeSetting() { calls.push('openAppAuthorizeSetting'); },
    openSetting() { calls.push('openSetting'); }
  };
  return Object.assign(wx, overrides);
}

function withWx(overrides, run) {
  const originalWx = global.wx;
  const wx = createWxStub(overrides);
  global.wx = wx;
  try {
    return run(wx, loadBluetooth());
  } finally {
    global.wx = originalWx;
    delete require.cache[bluetoothPath];
  }
}

test('app.json declares scope.bluetooth so WeChat can prompt for BLE on HarmonyOS', () => {
  const appConfig = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const bluetooth = appConfig.permission && appConfig.permission['scope.bluetooth'];
  assert.ok(bluetooth && bluetooth.desc);
  assert.match(bluetooth.desc, /测距仪/);
});

test('already-open adapter is treated as ready instead of asking to turn Bluetooth on', () => {
  withWx({
    openBluetoothAdapter(options) {
      options.fail({ errMsg: 'openBluetoothAdapter:fail already opened' });
    }
  }, (wx, bluetooth) => {
    bluetooth.initBLE(function () {}, function () {}, function () {}, false);
    assert.ok(wx.calls.includes('startScan'));
    assert.equal(
      wx.calls.some(function (item) {
        return item && item.type === 'toast' && item.title === '请打开手机蓝牙';
      }),
      false
    );
    bluetooth.cancelBLEDiscovery();
  });
});

test('Huawei system permission denied does not masquerade as Bluetooth being off', () => {
  withWx({
    openBluetoothAdapter(options) {
      options.fail({
        errCode: 10001,
        errMsg: 'openBluetoothAdapter:fail system permission denied'
      });
    }
  }, (wx, bluetooth) => {
    let connectResult;
    bluetooth.initBLE(function () {}, function (success) {
      connectResult = success;
    }, function () {}, false);

    assert.equal(connectResult, false);
    assert.equal(wx.calls.includes('startScan'), false);
    const modal = wx.calls.find(function (item) {
      return item && item.type === 'modal';
    });
    assert.ok(modal);
    assert.match(String(modal.title + modal.content), /附近的设备|蓝牙权限/);
    assert.doesNotMatch(String(modal.title), /请打开手机蓝牙/);
    assert.equal(
      wx.calls.some(function (item) {
        return item && item.type === 'toast' && /请打开/.test(item.title || '');
      }),
      false
    );
  });
});

test('adapter unavailable while system Bluetooth is on is classified as a permission gap', () => {
  const bluetooth = withWx({}, function (_wx, module) { return module; });
  const classified = bluetooth.classifyBluetoothAdapterOpenFailure(
    { errCode: 10001, errMsg: 'openBluetoothAdapter:fail not available' },
    { bluetoothEnabled: true, bluetoothAuthorized: 'authorized' }
  );
  assert.equal(classified.kind, 'permission_denied');
});

test('adapter unavailable while system Bluetooth is off is classified as bluetooth_off', () => {
  const bluetooth = withWx({}, function (_wx, module) { return module; });
  const classified = bluetooth.classifyBluetoothAdapterOpenFailure(
    { errCode: 10001, errMsg: 'openBluetoothAdapter:fail not available' },
    { bluetoothEnabled: false, bluetoothAuthorized: 'authorized' }
  );
  assert.equal(classified.kind, 'bluetooth_off');
});

test('does not wait for scope.bluetooth authorize before opening the adapter', () => {
  var opened = false;
  withWx({
    getAppAuthorizeSetting() {
      return { bluetoothAuthorized: 'not determined', locationAuthorized: 'authorized' };
    },
    authorize() {},
    openBluetoothAdapter(options) {
      opened = true;
      if (options && options.success) options.success({});
    }
  }, function (wx, bluetooth) {
    bluetooth.initBLE(function () {}, function () {}, function () {}, false);
    assert.equal(opened, true);
    bluetooth.cancelBLEDiscovery();
  });
});

test('iOS still opens the adapter when the system Bluetooth flag is unavailable', () => {
  var opened = false;
  withWx({
    getSystemInfoSync() {
      return { platform: 'ios', brand: 'iPhone' };
    },
    getSystemSetting() {
      return { bluetoothEnabled: false, locationEnabled: true };
    },
    getAppAuthorizeSetting() {
      return { bluetoothAuthorized: 'denied', locationAuthorized: 'authorized' };
    },
    authorize() {},
    openBluetoothAdapter(options) {
      opened = true;
      if (options && options.success) options.success({});
    }
  }, function (wx, bluetooth) {
    bluetooth.initBLE(function () {}, function () {}, function () {}, false);
    assert.equal(opened, true);
    bluetooth.cancelBLEDiscovery();
  });
});

test('platform enrollment can cancel and does not reuse cached discovery results', () => {
  withWx({}, function (wx, bluetooth) {
    let completed;
    bluetooth.scanBLEForEnrollment(
      function () {},
      function (result) { completed = result; },
      { silent: true, scanMs: 10000 }
    );

    assert.equal(wx.calls.includes('getBluetoothDevices'), false);
    assert.equal(bluetooth.cancelBLEEnrollmentScan(), true);
    assert.equal(wx.calls.includes('stopScan'), true);
    assert.equal(completed.reason, 'cancelled');
    assert.deepEqual(completed.devices, []);
  });
});
