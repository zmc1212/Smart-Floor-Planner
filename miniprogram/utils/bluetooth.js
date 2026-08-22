// miniprogram/utils/bluetooth.js

var _deviceId = '';
var _writeCharacteristics = []; // 存储所有可写入的特征值以供广播
var _onMeasureCallback = null;
var _isConnecting = false;
var _onConnectCallback = null;
var _onDisconnectCallback = null;
var _scanTimer = null; // 搜索总时间计时器
var _scanPollTimer = null; // 搜索期间轮询已发现列表
var _foundDevices = []; // 发现的目标设备列表，用于超时判断
var _nearbySeenById = {}; // 本次扫描见过的全部 BLE 设备（诊断用）
var _unauthorizedMessages = []; // 搜到但未授权的原因
var _verifyingDevices = {}; // 记录正在验证或验证失败的设备，避免重复请求
var _deviceFoundHandler = null; // 保持同一引用以便 off/on，避免监听堆叠
var _isStateChangeRegistered = false;
var _isValueChangeRegistered = false;
var _deviceName = ''; // 存储当前连接的设备名称
var _hasTriggeredReady = false; // 确保就绪回调仅触发一次
var _hasRequestedDeviceIdCode = false; // 每次连接只查询一次 ATC001# 机器 ID
var _dataBuffersByChannel = {};
var _enrollMode = false;
var _enrollCollectMode = false;
var _onEnrollDeviceFound = null;
var _onEnrollScanComplete = null;
var _enrollFoundById = {};
var _activeScanSilent = false;

var _heartbeatTimer = null;
var _lastResponseTime = 0;
const HEARTBEAT_INTERVAL = 5000; // 5秒发一次心跳
const HEARTBEAT_TIMEOUT = 12000;  // 12秒没收到任何回复认为断开

const TARGET_DEVICE_NAME = 'LDMStudio 4D';
const TARGET_DEVICE_NAME_TOKEN = 'LDMSTUDIO';

function bytesToHex(bytes) {
  var hex = [];
  for (var i = 0; i < bytes.length; i++) {
    var value = bytes[i].toString(16).toUpperCase();
    hex.push(value.length === 1 ? '0' + value : value);
  }
  return hex.join(' ');
}

function bytesToSafeAscii(bytes) {
  var text = '';
  for (var i = 0; i < bytes.length; i++) {
    text += bytes[i] >= 0x20 && bytes[i] <= 0x7E
      ? String.fromCharCode(bytes[i])
      : '.';
  }
  return text;
}

function toUint8Array(advertisData) {
  if (!advertisData) return null;
  try {
    if (advertisData instanceof Uint8Array) return advertisData;
    if (Array.isArray(advertisData)) return new Uint8Array(advertisData);
    return new Uint8Array(advertisData);
  } catch (error) {
    return null;
  }
}

function getAdvertisDataHex(advertisData) {
  var bytes = toUint8Array(advertisData);
  if (!bytes) return '';
  try {
    return bytesToHex(bytes);
  } catch (error) {
    console.warn('[BLE discovery] 无法读取广播数据:', error);
    return '';
  }
}

function getAdvertisDataHexCompact(advertisData) {
  return getAdvertisDataHex(advertisData).replace(/\s+/g, '');
}

function bytesToPackedAscii(bytes) {
  var text = '';
  if (!bytes) return text;
  for (var i = 0; i < bytes.length; i++) {
    if (bytes[i] >= 0x20 && bytes[i] <= 0x7E) {
      text += String.fromCharCode(bytes[i]);
    }
  }
  return text.trim();
}

function parseAdvertisLocalName(advertisData) {
  var bytes = toUint8Array(advertisData);
  if (!bytes || bytes.length < 3) return '';
  var offset = 0;
  while (offset < bytes.length) {
    var length = bytes[offset];
    if (!length) break;
    if (offset + 1 >= bytes.length) break;
    var type = bytes[offset + 1];
    var start = offset + 2;
    var end = Math.min(offset + 1 + length, bytes.length);
    if ((type === 0x08 || type === 0x09) && end > start) {
      var parsed = bytesToPackedAscii(bytes.subarray(start, end));
      if (parsed) return parsed;
    }
    offset += length + 1;
  }
  return '';
}

function collectDiscoveryNameParts(device) {
  var parts = [];
  if (!device) return parts;
  if (device.name) parts.push(String(device.name));
  if (device.localName) parts.push(String(device.localName));
  var parsedName = parseAdvertisLocalName(device.advertisData);
  if (parsedName) parts.push(parsedName);
  var packedAscii = bytesToPackedAscii(toUint8Array(device.advertisData));
  if (packedAscii) parts.push(packedAscii);
  if (device.serviceData && typeof device.serviceData === 'object') {
    Object.keys(device.serviceData).forEach(function (key) {
      if (key) parts.push(String(key));
      var serviceAscii = bytesToPackedAscii(toUint8Array(device.serviceData[key]));
      if (serviceAscii) parts.push(serviceAscii);
    });
  }
  return parts;
}

function logDiscoveredDevice(device, name) {
  console.log(
    '[BLE discovery] deviceId=' + String(device.deviceId || '') +
    ' name=' + String(name || '') +
    ' localName=' + String(device.localName || '') +
    ' RSSI=' + String(device.RSSI == null ? '' : device.RSSI) +
    ' advertisData=[' + getAdvertisDataHex(device.advertisData) + ']'
  );
}

function resolveDeviceName(device) {
  var parts = collectDiscoveryNameParts(device);
  var i;
  for (i = 0; i < parts.length; i++) {
    var candidate = String(parts[i] || '').trim();
    if (isTargetRangefinderName(candidate)) return candidate;
  }
  for (i = 0; i < parts.length; i++) {
    var fallback = String(parts[i] || '').trim();
    if (fallback) return fallback;
  }
  return '';
}

/** 匹配 LDMStudio 系列广播名（大小写不敏感，兼容仅含 LDMStudio 前缀）。 */
function isTargetRangefinderName(name) {
  var normalized = String(name || '').trim().toUpperCase();
  if (!normalized) return false;
  if (normalized.indexOf(TARGET_DEVICE_NAME.toUpperCase()) !== -1) return true;
  return normalized.indexOf(TARGET_DEVICE_NAME_TOKEN) !== -1;
}

function rememberNearbyDevice(device) {
  var id = String((device && device.deviceId) || '').trim();
  if (!id) return;
  var name = resolveDeviceName(device);
  var previous = _nearbySeenById[id];
  var nextName = name || (previous && previous.name) || '(no name)';
  _nearbySeenById[id] = {
    deviceId: id,
    name: nextName,
    rssi: device && device.RSSI
  };
  if (!previous || (name && previous.name === '(no name)')) {
    console.log(
      '[BLE discovery] nearby deviceId=' + id +
      ' name=' + (name || '(no name)') +
      ' RSSI=' + String(device && device.RSSI == null ? '' : device.RSSI) +
      ' advertisData=[' + getAdvertisDataHex(device && device.advertisData) + ']'
    );
  }
}

function clearScanTimers() {
  if (_scanTimer) {
    clearTimeout(_scanTimer);
    _scanTimer = null;
  }
  if (_scanPollTimer) {
    clearInterval(_scanPollTimer);
    _scanPollTimer = null;
  }
}

function detachDeviceFoundListener() {
  if (!_deviceFoundHandler) return;
  try {
    if (typeof wx.offBluetoothDeviceFound === 'function') {
      wx.offBluetoothDeviceFound(_deviceFoundHandler);
    }
  } catch (error) {
    console.warn('[BLE discovery] offBluetoothDeviceFound failed:', error);
  }
  _deviceFoundHandler = null;
}

function buildNotFoundContent() {
  var nearbyCount = Object.keys(_nearbySeenById).length;
  var targetCount = _foundDevices.length;
  if (_enrollMode) {
    return nearbyCount > 0
      ? ('附近发现 ' + nearbyCount + ' 台蓝牙设备，但没有 LDMStudio 测距仪。请确认仪器已开机并靠近手机。')
      : '未搜索到 LDMStudio 4D，请确保测距仪已开机并靠近手机。';
  }
  if (targetCount > 0 && _unauthorizedMessages.length > 0) {
    return _unauthorizedMessages[0] + '（附近已发现测距仪，但未通过企业授权）';
  }
  if (targetCount > 0) {
    return '附近已发现测距仪，但未通过企业授权。请确认已在后台录入编码并分配给本公司。';
  }
  if (nearbyCount > 0) {
    return '附近发现 ' + nearbyCount + ' 台蓝牙设备，但没有授权的 LDMStudio 测距仪。请确认仪器已开机、已录入并靠近手机。';
  }
  return '未搜索到授权的测距仪，请确保设备已开启、已在后台录入编码并靠近手机。';
}

function requestDeviceIdCode() {
  if (_hasRequestedDeviceIdCode || !_deviceId || _writeCharacteristics.length === 0) return;
  _hasRequestedDeviceIdCode = true;
  console.log('[BLE IDCODE] 发送 ATC001#，读取协议定义的 96 位机器 ID。');
  sendBLECommand('ATC001#');
}

function getBluetoothErrorText(err) {
  if (!err) return '';
  return String(err.errMsg || err.message || err.error || '');
}

function isBluetoothAdapterAlreadyOpenError(err) {
  return /already\s*(open|opened)/i.test(getBluetoothErrorText(err));
}

function classifyBluetoothAdapterOpenFailure(err, context) {
  context = context || {};
  if (isBluetoothAdapterAlreadyOpenError(err)) {
    return { kind: 'already_open' };
  }

  var text = getBluetoothErrorText(err).toLowerCase();
  var errCode = err && (err.errCode != null ? err.errCode : err.errno);
  var bluetoothEnabled = context.bluetoothEnabled;
  var bluetoothAuthorized = context.bluetoothAuthorized;
  var locationEnabled = context.locationEnabled;
  var locationAuthorized = context.locationAuthorized;

  if (
    bluetoothAuthorized === 'denied' ||
    /permission denied|system permission|auth deny|authorize fail|not authorized|unauthorized/.test(text)
  ) {
    return { kind: 'permission_denied' };
  }

  if (locationEnabled === false || locationAuthorized === 'denied') {
    return { kind: 'location_required' };
  }

  var adapterUnavailable = errCode === 10001 || errCode === 1500102 || /not available/.test(text);
  if (adapterUnavailable) {
    if (bluetoothEnabled === true) return { kind: 'permission_denied' };
    return { kind: 'bluetooth_off' };
  }

  if (bluetoothEnabled === false) return { kind: 'bluetooth_off' };
  return { kind: 'unavailable' };
}

function readBluetoothEnvironment() {
  var sysInfo = {};
  try {
    sysInfo = typeof wx.getSystemInfoSync === 'function' ? (wx.getSystemInfoSync() || {}) : {};
  } catch (error) {
    sysInfo = {};
  }
  var sysSetting = {};
  try {
    sysSetting = typeof wx.getSystemSetting === 'function' ? (wx.getSystemSetting() || {}) : {};
  } catch (error) {
    sysSetting = {};
  }
  var appAuth = {};
  try {
    appAuth = typeof wx.getAppAuthorizeSetting === 'function' ? (wx.getAppAuthorizeSetting() || {}) : {};
  } catch (error) {
    appAuth = {};
  }
  return {
    platform: sysInfo.platform,
    bluetoothEnabled: sysSetting.bluetoothEnabled,
    locationEnabled: sysSetting.locationEnabled,
    bluetoothAuthorized: appAuth.bluetoothAuthorized,
    locationAuthorized: appAuth.locationAuthorized
  };
}

function registerBleConnectionStateListener() {
  if (_isStateChangeRegistered) return;
  wx.onBLEConnectionStateChange(function (res) {
    console.log('蓝牙连接状态变化:', res.connected, '设备ID:', res.deviceId);
    if (!res.connected && res.deviceId === _deviceId) {
      handleDisconnect('系统蓝牙断开信号');
    }
  });
  _isStateChangeRegistered = true;
}

var _isAdapterStateChangeRegistered = false;
function registerAdapterStateListener(silent, scanMs) {
  if (_isAdapterStateChangeRegistered) return;
  if (typeof wx.onBluetoothAdapterStateChange !== 'function') return;
  _isAdapterStateChangeRegistered = true;
  wx.onBluetoothAdapterStateChange(function (res) {
    if (res && res.available) {
      if (!silent) wx.showLoading({ title: '搜索测距仪...', mask: true });
      startScan(silent, scanMs);
    }
  });
}

function notifyBluetoothAdapterOpenFailed(kind, err, silent) {
  console.error('[BLE] openBluetoothAdapter failed:', kind, err);
  if (_enrollCollectMode && _onEnrollScanComplete) {
    _onEnrollScanComplete({ success: false, devices: [], error: kind || 'bluetooth_unavailable' });
  } else if (_onConnectCallback) {
    _onConnectCallback(false);
  }
  if (silent) return;

  if (kind === 'bluetooth_off') {
    wx.showModal({
      title: '请打开手机蓝牙',
      content: '连接测距仪需要开启系统蓝牙开关，打开后请返回小程序再试。',
      confirmText: '去开启',
      success: function (res) {
        if (res.confirm && typeof wx.openSystemBluetoothSetting === 'function') {
          wx.openSystemBluetoothSetting();
        }
      }
    });
    return;
  }

  if (kind === 'location_required') {
    wx.showModal({
      title: '权限提醒',
      content: '安卓搜索测距仪需要开启系统定位开关，并允许微信使用位置信息。',
      confirmText: '去设置',
      success: function (res) {
        if (!res.confirm) return;
        if (typeof wx.openAppAuthorizeSetting === 'function') {
          wx.openAppAuthorizeSetting();
        } else if (typeof wx.openSetting === 'function') {
          wx.openSetting();
        }
      }
    });
    return;
  }

  wx.showModal({
    title: '需要蓝牙权限',
    content: '请在系统设置中允许微信使用蓝牙和「附近的设备」。华为/鸿蒙手机授权蓝牙后仍可能拦截扫描，请一并打开附近设备权限后返回重试。',
    confirmText: '去设置',
    success: function (res) {
      if (!res.confirm) return;
      if (typeof wx.openAppAuthorizeSetting === 'function') {
        wx.openAppAuthorizeSetting();
      } else if (typeof wx.openSetting === 'function') {
        wx.openSetting();
      }
    }
  });
}

function openBluetoothAdapterOnce(callback) {
  wx.openBluetoothAdapter({
    mode: 'central',
    success: function () {
      callback(null);
    },
    fail: function (err) {
      if (isBluetoothAdapterAlreadyOpenError(err)) {
        callback(null);
        return;
      }
      callback(err || { errMsg: 'openBluetoothAdapter:fail' });
    }
  });
}

function ensureBluetoothAdapterOpen(options) {
  var silent = Boolean(options && options.silent);
  var scanMs = options && options.scanMs;
  var onOpen = options && options.onOpen;
  var env = readBluetoothEnvironment();
  var isIOS = env.platform === 'ios';

  function fail(kind, err) {
    notifyBluetoothAdapterOpenFailed(kind, err, silent);
    if (kind === 'bluetooth_off') {
      registerAdapterStateListener(silent, scanMs);
    }
  }

  function attemptOpen(isRetry) {
    openBluetoothAdapterOnce(function (err) {
      if (!err) {
        registerBleConnectionStateListener();
        if (onOpen) onOpen();
        return;
      }
      env = readBluetoothEnvironment();
      var classified = classifyBluetoothAdapterOpenFailure(err, env);
      var shouldRetry = !isRetry
        && classified.kind !== 'bluetooth_off'
        && classified.kind !== 'location_required'
        && classified.kind !== 'permission_denied'
        && env.bluetoothEnabled !== false;
      if (shouldRetry) {
        setTimeout(function () { attemptOpen(true); }, 400);
        return;
      }
      fail(classified.kind, err);
    });
  }

  // iOS cannot report the system Bluetooth switch. Skipping open here would
  // never pull the iOS Bluetooth permission prompt.
  if (!isIOS && env.bluetoothEnabled === false) {
    fail('bluetooth_off');
    return;
  }
  if (env.platform === 'android' && (env.locationEnabled === false || env.locationAuthorized === 'denied')) {
    fail('location_required');
    return;
  }

  // wx.authorize(scope.bluetooth) does not grant iOS system Bluetooth and can
  // hang without a callback on iOS 13.x. Always open the adapter; that is the
  // API that actually requests the system permission.
  if (typeof wx.authorize === 'function' && env.bluetoothAuthorized !== 'authorized') {
    try {
      wx.authorize({
        scope: 'scope.bluetooth',
        success: function () {},
        fail: function () {}
      });
    } catch (error) {}
  }
  attemptOpen(false);
}

function initBLE(callback, connectCallback, disconnectCallback, silent = false, options = {}) {
  _onMeasureCallback = callback;
  _onConnectCallback = connectCallback;
  _onDisconnectCallback = disconnectCallback;
  _verifyingDevices = {}; // 重置验证状态
  _unauthorizedMessages = [];
  _nearbySeenById = {};
  // 未真正连上时清掉连接中锁，避免上次失败残留导致本次搜索直接跳过目标设备
  if (!_deviceId) _isConnecting = false;
  _enrollMode = Boolean(options && options.enrollMode);
  _enrollCollectMode = Boolean(options && options.enrollCollectMode);
  _onEnrollDeviceFound = (_enrollCollectMode && options && options.onDeviceFound) || null;
  _onEnrollScanComplete = (_enrollCollectMode && options && options.onComplete) || null;
  _enrollFoundById = {};
  _activeScanSilent = Boolean(silent);
  ensureBluetoothAdapterOpen({
    silent: silent,
    scanMs: options && options.scanMs,
    onOpen: function () {
      if (!silent) {
        wx.showLoading({
          title: '搜索测距仪...',
          mask: true
        });
      }
      startScan(silent, options && options.scanMs);
    }
  });
}

/** 平台录入：扫描收集多台 LDMStudio，只读 deviceId/MAC，不建立连接。 */
function scanBLEForEnrollment(onDeviceFound, onComplete, options) {
  var opts = options || {};
  return initBLE(
    function () {},
    function () {},
    function () {},
    Boolean(opts.silent),
    {
      enrollMode: true,
      enrollCollectMode: true,
      onDeviceFound: onDeviceFound,
      onComplete: onComplete,
      scanMs: opts.scanMs || 10000
    }
  );
}

function initBLEForEnrollment(connectCallback, disconnectCallback, silent = false) {
  return initBLE(
    function () {},
    connectCallback,
    disconnectCallback,
    silent,
    { enrollMode: true }
  );
}

function finishEnrollCollectScan(silent, reason) {
  clearScanTimers();
  try { wx.stopBluetoothDevicesDiscovery(); } catch (e) {}
  detachDeviceFoundListener();
  if (!silent) wx.hideLoading();
  var devices = Object.keys(_enrollFoundById).map(function (id) {
    return _enrollFoundById[id];
  });
  console.log('[BLE enroll collect] done reason=' + reason + ' count=' + devices.length);
  if (_onEnrollScanComplete) {
    _onEnrollScanComplete({
      success: devices.length > 0,
      devices: devices,
      reason: reason
    });
  }
  _enrollCollectMode = false;
  _onEnrollDeviceFound = null;
  _onEnrollScanComplete = null;
}

function processDiscoveredDevice(device, silent) {
  if (!device) return;
  rememberNearbyDevice(device);
  var name = resolveDeviceName(device);
  if (!isTargetRangefinderName(name) || _isConnecting) return;

  _foundDevices.push(device);
  logDiscoveredDevice(device, name || TARGET_DEVICE_NAME);

  if (_enrollCollectMode) {
    var mac = String(device.deviceId || '').trim().toUpperCase();
    if (!mac || _enrollFoundById[mac]) return;
    var found = {
      deviceId: mac,
      name: name || TARGET_DEVICE_NAME,
      rssi: device.RSSI
    };
    _enrollFoundById[mac] = found;
    console.log('录入扫描收集设备:', found.name, found.deviceId);
    if (_onEnrollDeviceFound) _onEnrollDeviceFound(found);
    return;
  }

  if (_verifyingDevices[device.deviceId]) return;
  _verifyingDevices[device.deviceId] = true;

  if (_enrollMode) {
    if (_isConnecting) return;
    _isConnecting = true;
    clearScanTimers();
    try { wx.stopBluetoothDevicesDiscovery(); } catch (e) {}
    detachDeviceFoundListener();
    if (!silent) wx.hideLoading();
    console.log('录入模式：跳过授权校验，直接连接:', name, device.deviceId);
    connectDevice(device.deviceId, name || TARGET_DEVICE_NAME, silent);
    return;
  }

  console.log('搜索到设备，请求后台验证...', name, 'ID:', device.deviceId);

  var api = require('./api.js');
  const app = getApp();
  api.request('/devices/verify-binding', 'POST', {
    deviceId: device.deviceId,
    name: name || TARGET_DEVICE_NAME,
    advertisDataHex: getAdvertisDataHexCompact(device.advertisData),
    openid: app.globalData.openid
  }).then(function (verifyRes) {
    if (verifyRes.success && verifyRes.authorized) {
      if (_isConnecting) return;
      _isConnecting = true;
      clearScanTimers();
      try { wx.stopBluetoothDevicesDiscovery(); } catch (e) {}
      detachDeviceFoundListener();
      if (!silent) wx.hideLoading();

      console.log('✅ 设备授权成功，发起连接:', name);
      connectDevice(device.deviceId, name || TARGET_DEVICE_NAME, silent);
    } else {
      var denyMessage = (verifyRes && verifyRes.message) || '设备未授权';
      console.log('🚫 设备未授权:', denyMessage);
      if (_unauthorizedMessages.indexOf(denyMessage) === -1) {
        _unauthorizedMessages.push(denyMessage);
      }
    }
  }).catch(function (err) {
    console.error('设备验证请求失败:', err);
    _verifyingDevices[device.deviceId] = false;
  });
}

function handleBluetoothDeviceFound(res) {
  var deviceList = (res && res.devices) || [];
  for (var i = 0; i < deviceList.length; i++) {
    processDiscoveredDevice(deviceList[i], _activeScanSilent);
  }
}

function pollAlreadyDiscoveredDevices(silent) {
  if (typeof wx.getBluetoothDevices !== 'function') return;
  wx.getBluetoothDevices({
    success: function (res) {
      var list = (res && res.devices) || [];
      console.log('[BLE discovery] getBluetoothDevices count=' + list.length);
      for (var i = 0; i < list.length; i++) {
        processDiscoveredDevice(list[i], silent);
      }
    },
    fail: function (err) {
      console.warn('[BLE discovery] getBluetoothDevices failed:', err);
    }
  });
}

function startScan(silent = false, scanMs) {
  if (_isConnecting) {
    console.warn('[BLE discovery] skip startScan because _isConnecting=true deviceId=' + _deviceId);
    return;
  }
  _foundDevices = [];
  _nearbySeenById = {};
  _unauthorizedMessages = [];
  _activeScanSilent = Boolean(silent);
  if (_enrollCollectMode) _enrollFoundById = {};

  // 前置检查安卓系统定位权限与开关
  try {
    var sysInfo = wx.getSystemInfoSync();
    if (sysInfo.platform === 'android') {
      var sysSetting = typeof wx.getSystemSetting === 'function' ? wx.getSystemSetting() : {};
      var appAuth = typeof wx.getAppAuthorizeSetting === 'function' ? wx.getAppAuthorizeSetting() : {};

      var msgs = [];
      if (sysSetting.locationEnabled === false) msgs.push('【系统定位开关】');
      if (appAuth.locationAuthorized === 'denied') msgs.push('【微信定位权限】');
      if (appAuth.bluetoothAuthorized === 'denied') msgs.push('【微信蓝牙权限】');

      if (msgs.length > 0) {
        console.warn('[BLE discovery] android permission blocked:', msgs.join(','));
        if (!silent) {
          wx.hideLoading();
          wx.showModal({
            title: '权限提醒',
            content: '安卓搜索蓝牙需开启：' + msgs.join('、') + '，请前往设置开启后重试。',
            showCancel: false
          });
        }
        if (_enrollCollectMode) {
          finishEnrollCollectScan(true, 'permission_denied');
        } else if (_onConnectCallback) {
          _onConnectCallback(false);
        }
        return;
      }
    }
  } catch (err) {
    console.error('获取系统设置失败', err);
  }

  var timeoutMs = Number(scanMs) > 0 ? Number(scanMs) : 10000;
  clearScanTimers();
  _scanTimer = setTimeout(function () {
    var nearbyCount = Object.keys(_nearbySeenById).length;
    console.log(
      '[BLE discovery] timeout nearby=' + nearbyCount +
      ' targets=' + _foundDevices.length +
      ' unauthorized=' + _unauthorizedMessages.length
    );
    clearScanTimers();
    if (_enrollCollectMode) {
      finishEnrollCollectScan(silent, 'timeout');
      if (!silent && Object.keys(_enrollFoundById).length === 0) {
        wx.showModal({
          title: '未发现设备',
          content: buildNotFoundContent(),
          showCancel: false
        });
      }
      return;
    }
    if (!_isConnecting) {
      try { wx.stopBluetoothDevicesDiscovery(); } catch (e) {}
      detachDeviceFoundListener();
      if (!silent) {
        wx.hideLoading();
        wx.showModal({
          title: '未发现设备',
          content: buildNotFoundContent(),
          showCancel: false
        });
      }
      // 搜不到授权设备时必须回调失败，否则连接弹窗会一直 loading 且无法关闭
      if (_onConnectCallback) _onConnectCallback(false);
    }
  }, timeoutMs);

  // 先挂监听再开扫，避免 success 回调晚于首批广播而漏设备
  detachDeviceFoundListener();
  _deviceFoundHandler = handleBluetoothDeviceFound;
  wx.onBluetoothDeviceFound(_deviceFoundHandler);

  console.log('[BLE discovery] start scan timeoutMs=' + timeoutMs + ' enroll=' + _enrollMode + ' collect=' + _enrollCollectMode);

  wx.startBluetoothDevicesDiscovery({
    allowDuplicatesKey: true,
    powerLevel: 'high',
    success: function () {
      console.log('[BLE discovery] startBluetoothDevicesDiscovery success');
      pollAlreadyDiscoveredDevices(silent);
      _scanPollTimer = setInterval(function () {
        if (_isConnecting) {
          clearScanTimers();
          return;
        }
        pollAlreadyDiscoveredDevices(silent);
      }, 2000);
    },
    fail: function (err) {
      console.log('搜索设备失败', err);
      clearScanTimers();
      detachDeviceFoundListener();
      if (_enrollCollectMode) {
        finishEnrollCollectScan(silent, 'scan_failed');
      } else if (_onConnectCallback) {
        _onConnectCallback(false);
      }
      if (!silent) {
        wx.hideLoading();

        var errMsg = '搜索失败，请确保蓝牙正常。';
        if (err.errCode === 10001 || /location/i.test(err.errMsg) || /system/i.test(err.errMsg)) {
          errMsg = '蓝牙未准备就绪或权限不足，请检查手机蓝牙、系统定位开关及微信定位权限。';
        }
        wx.showModal({
          title: '搜索异常',
          content: errMsg + ' (' + (err.errCode || err.errMsg) + ')',
          showCancel: false
        });
      }
    }
  });
}

/**
 * 取消进行中的 BLE 搜索（不主动断开已建立的连接）。
 * 供连接弹窗关闭时解除 loading 锁。
 */
function cancelBLEDiscovery() {
  clearScanTimers();
  try { wx.stopBluetoothDevicesDiscovery(); } catch (e) {}
  detachDeviceFoundListener();
  if (!_deviceId) {
    _isConnecting = false;
  }
}

function connectDevice(deviceId, name, silent = false) {
  _isConnecting = true;
  _writeCharacteristics = []; // 连接前重置写入通道
  _dataBuffersByChannel = {};
  try { wx.stopBluetoothDevicesDiscovery(); } catch (e) {}
  detachDeviceFoundListener();
  if (!silent) wx.showLoading({ title: '连接 ' + name + '...' });

  wx.createBLEConnection({
    deviceId: deviceId,
    success: function () {
      resumeConnectedSession(deviceId, name, silent, false);
    },
    fail: function (err) {
      if (isAlreadyConnectedError(err)) {
        // 退出小程序后系统层连接常仍在；JS 状态已丢失。按已连接恢复，勿清记忆设备。
        console.log('[BLE] createBLEConnection already connected, resume session:', deviceId, err);
        resumeConnectedSession(deviceId, name, silent, true);
        return;
      }
      if (!silent) wx.hideLoading();
      console.log('连接失败', err);
      // 真正连不上时清掉记忆，避免下次直连死循环
      wx.removeStorageSync('last_ble_device_id');
      wx.removeStorageSync('last_ble_device_name');
      if (!silent) wx.showToast({ title: '连接失败', icon: 'none' });
      _isConnecting = false;
      if (_onConnectCallback) _onConnectCallback(false);
    }
  });
}

function isAlreadyConnectedError(err) {
  if (!err) return false;
  if (err.errno === 1509007) return true;
  var msg = String(err.errMsg || err.message || '');
  return /already\s*connect/i.test(msg);
}

function resumeConnectedSession(deviceId, name, silent, fromAlreadyConnected) {
  _deviceId = deviceId;
  wx.setStorageSync('last_ble_device_id', deviceId);
  wx.setStorageSync('last_ble_device_name', name);

  if (!silent) {
    wx.hideLoading();
    wx.showToast({
      title: fromAlreadyConnected ? '已恢复连接' : '连接成功',
      icon: 'success'
    });
  }
  _deviceName = name;
  _hasTriggeredReady = false;
  _hasRequestedDeviceIdCode = false;
  getServices(deviceId);
  startHeartbeat();
}

function getServices(deviceId) {
  wx.getBLEDeviceServices({
    deviceId: deviceId,
    success: function (res) {
      var services = res.services;
      for (var i = 0; i < services.length; i++) {
        var serviceId = services[i].uuid;
        if (serviceId.indexOf('1800') === -1 && serviceId.indexOf('1801') === -1) {
          getCharacteristics(deviceId, serviceId);
        }
      }
    }
  });
}

function getCharacteristics(deviceId, serviceId) {
  wx.getBLEDeviceCharacteristics({
    deviceId: deviceId,
    serviceId: serviceId,
    success: function (res) {
      for (var i = 0; i < res.characteristics.length; i++) {
        var item = res.characteristics[i];
        var properties = item.properties || {};
        console.log(
          '[BLE channel] service=' + serviceId +
          ' characteristic=' + item.uuid +
          ' read=' + !!properties.read +
          ' write=' + !!properties.write +
          ' writeNoResponse=' + !!properties.writeNoResponse +
          ' notify=' + !!properties.notify +
          ' indicate=' + !!properties.indicate
        );

        // 订阅所有通知特征值
        if (properties.notify || properties.indicate) {
          wx.notifyBLECharacteristicValueChange({
            deviceId: deviceId,
            serviceId: serviceId,
            characteristicId: item.uuid,
            state: true,
            success: function () {
              console.log('✅ 订阅成功:', item.uuid);
              listenValueChange();
            }
          });
        }

        // 收集所有可写入的特征值
        if (properties.write || properties.writeNoResponse) {
          console.log('发现写入通道:', item.uuid);
          _writeCharacteristics.push({
            serviceId: serviceId,
            characteristicId: item.uuid,
            writeNoResponse: properties.writeNoResponse
          });
          
          if (!_hasTriggeredReady && _onConnectCallback) {
            _hasTriggeredReady = true;
            console.log('🚀 发现写入通道，设备就绪');
            _onConnectCallback(true, _deviceName, _deviceId);
          }

          // 等待通知特征值订阅完成后，读取厂商协议中的稳定机器 ID。
          setTimeout(requestDeviceIdCode, 300);
        }
      }
    }
  });
}

function getBleChannelKey(serviceId, characteristicId) {
  return String(serviceId || 'unknown-service') + '/' + String(characteristicId || 'unknown-characteristic');
}

function getBleChannelLabel(serviceId, characteristicId) {
  return 'service=' + String(serviceId || 'unknown-service') + ' characteristic=' + String(characteristicId || 'unknown-characteristic');
}

function listenValueChange() {
  if (_isValueChangeRegistered) return;
  _isValueChangeRegistered = true;
  
  wx.onBLECharacteristicValueChange(function (res) {
    _lastResponseTime = Date.now(); // 收到任何数据都刷新心跳存活时间

    var length = res.value.byteLength;
    var arr = new Uint8Array(res.value);
    var channelLabel = getBleChannelLabel(res.serviceId, res.characteristicId);

    // 打印原始 Hex 以供调试
    var hexArr = [];
    for (var i = 0; i < length; i++) {
      var hex = arr[i].toString(16).toUpperCase();
      hexArr.push(hex.length === 1 ? '0' + hex : hex);
    }
    console.log('[BLE recv] ' + channelLabel + ' length=' + length + ' hex=[' + hexArr.join(' ') + ']');

    var channelKey = getBleChannelKey(res.serviceId, res.characteristicId);
    var dataBuffer = _dataBuffersByChannel[channelKey] || [];
    _dataBuffersByChannel[channelKey] = dataBuffer;
    for (var dataIndex = 0; dataIndex < arr.length; dataIndex += 1) {
      dataBuffer.push(arr[dataIndex]);
    }

    // 解析数据包
    while (dataBuffer.length >= 7) {
      var a = dataBuffer[0];
      var b = dataBuffer[1];
      var c = dataBuffer[2];

      if (a === 0x49 && b === 0x44) { // ID + 96 位机器 ID + CRC + #
        if (dataBuffer.length < 16) break;

        if (dataBuffer[15] !== 0x23) {
          console.warn('[BLE IDCODE] 帧尾错误，丢弃一个字节。');
          dataBuffer.shift();
          continue;
        }

        var idCodeCrc = 0;
        for (var idCodeIndex = 0; idCodeIndex < 14; idCodeIndex++) {
          idCodeCrc += dataBuffer[idCodeIndex];
        }
        idCodeCrc %= 256;
        if (idCodeCrc !== dataBuffer[14]) {
          console.warn('[BLE IDCODE] CRC 校验失败，丢弃一个字节。');
          dataBuffer.shift();
          continue;
        }

        var idCodeBytes = dataBuffer.slice(2, 14);
        console.log(
          '[BLE IDCODE] deviceId=' + _deviceId +
          ' name=' + _deviceName +
          ' raw=[' + bytesToHex(dataBuffer.slice(0, 16)) + ']' +
          ' idCodeHex=' + bytesToHex(idCodeBytes) +
          ' idCodeAscii=' + bytesToSafeAscii(idCodeBytes)
        );
        dataBuffer.splice(0, 16);
      } else if (a === 0x41 && b === 0x54 && c === 0x44) { // ATD 开始
        // 有可能是发出 ATD001# 后仪器的回显 (7字节): A T D 0 0 1 #
        if (dataBuffer.length >= 7 && dataBuffer[3] === 0x30 && dataBuffer[4] === 0x30 && dataBuffer[5] === 0x31 && dataBuffer[6] === 0x23) {
          console.log('收到命令反馈: ATD001#');
          dataBuffer.splice(0, 7);
          continue;
        }

        if (dataBuffer.length < 17) break; // 数据不足，等完整的 17 字节数据

        // 验证帧尾 #
        if (dataBuffer[16] !== 0x23) {
          console.log("ATD 数据包帧尾错误，非 #");
          dataBuffer.shift();
          continue;
        }

        // 验证 CRC: 累加前 15 字节 (A 到 最后一个数据字节)
        var sum = 0;
        for (var i = 0; i < 15; i++) {
          sum += dataBuffer[i];
        }
        var crc = sum % 256;
        if (crc !== dataBuffer[15]) {
          console.log("ATD 数据包 CRC 校验失败, 计算得到: " + crc + ", 实际: " + dataBuffer[15]);
          dataBuffer.shift();
          continue;
        }

        var distU8 = new Uint8Array(dataBuffer.slice(3, 7));
        var dataDv = new DataView(distU8.buffer);
        // 使用大端控制 (false) 解析: 00 00 02 77 -> 631
        var meadist = dataDv.getUint32(0, false);

        var distanceInMeters = meadist / 10000.0;

        // 提取角度X和Y (依据文档定义)
        var angleXU8 = new Uint8Array(dataBuffer.slice(7, 11));
        var angleYU8 = new Uint8Array(dataBuffer.slice(11, 15));

        console.log("ATD测距结果:", distanceInMeters, "m", "原始距离字节:", distU8, "角度X:", angleXU8, "角度Y:", angleYU8);

        if (_onMeasureCallback) {
          _onMeasureCallback(distanceInMeters);
        }
        dataBuffer.splice(0, 17);
      } else if (a === 0x41 && b === 0x54 && (c === 0x4B || c === 0x4D || c === 0x45)) {
        // 处理 ATK/ATM/ATE (7字节)
        var cmdStr = String.fromCharCode.apply(null, dataBuffer.slice(0, 7));
        console.log('收到命令反馈: ', cmdStr);
        if (c === 0x45) { // ATE 测量错误
          if (_onMeasureCallback) {
            _onMeasureCallback(null); // 传递 null 表示测量失败
          }
        }
        dataBuffer.splice(0, 7);
      } else {
        dataBuffer.shift(); // 丢弃无效头部
      }
    }
  });
}

function startHeartbeat() {
  stopHeartbeat();
  _lastResponseTime = Date.now();
  console.log('禁用软件心跳，以免ATD001破坏测距仪当前的激光长亮(Preparing)状态');
  // _heartbeatTimer = setInterval(function() {
  //   if (_deviceId) {
  //     // 发送 ATD001# 查询距离作为心跳包 - 这会导致硬件激光被意外关闭并返回旧数据！
  //     // sendBLECommand('ATD001#');
  //     
  //     // var now = Date.now();
  //     // if (now - _lastResponseTime > HEARTBEAT_TIMEOUT) {
  //     //   console.log('心跳超时，认为设备已断开连接');
  //     //   handleDisconnect('心跳检测超时');
  //     // }
  //   } else {
  //     stopHeartbeat();
  //   }
  // }, HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
    console.log('已停止心跳维持机制');
  }
}

function handleDisconnect(reason) {
  if (!_deviceId) return;
  console.log('⚠️ 触发断开处理流程:', reason);
  
  var tempId = _deviceId;
  _deviceId = '';
  _isConnecting = false;
  _foundDevices = [];
  _writeCharacteristics = [];
  _dataBuffersByChannel = {};
  _hasRequestedDeviceIdCode = false;
  _enrollMode = false;
  stopHeartbeat();

  wx.closeBLEConnection({
    deviceId: tempId,
    complete: function () {}
  });
  
  if (_onDisconnectCallback) {
    _onDisconnectCallback();
  }
}

function clearBuffer() {
  _dataBuffersByChannel = {};
  console.log('蓝牙数据缓冲区已清空');
}

var _lastCmdTime = 0;
var _lastCmdStr = '';

function sendBLECommand(cmd) {
  if (!_deviceId || _writeCharacteristics.length === 0) {
    console.error('蓝牙未连接或未发现写入特征值');
    return false;
  }

  // JS层面的防抖：防止短时间内某些回调导致重复发同一条指令
  var now = Date.now();
  if (cmd === _lastCmdStr && now - _lastCmdTime < 50) {
    console.log('阻止极短时间内重复发送相同的指令:', cmd);
    return false;
  }
  _lastCmdTime = now;
  _lastCmdStr = cmd;

  // 如果是测量指令，先清空缓冲区旧数据，确保收到的下一包是实时的结果
  if (cmd.includes('ATK') || cmd.includes('ATD')) {
    clearBuffer();
  }

  var buffer = new ArrayBuffer(cmd.length);
  var dataView = new DataView(buffer);
  for (var i = 0; i < cmd.length; i++) {
    dataView.setUint8(i, cmd.charCodeAt(i));
  }

  // 通道去重：防止某些BLE模块被微信重复枚举了相同的 UUID
  var uniqueChannels = [];
  var seenChannels = {};
  for (var j = 0; j < _writeCharacteristics.length; j++) {
    var channelKey = getBleChannelKey(
      _writeCharacteristics[j].serviceId,
      _writeCharacteristics[j].characteristicId
    );
    if (!seenChannels[channelKey]) {
      seenChannels[channelKey] = true;
      uniqueChannels.push(_writeCharacteristics[j]);
    }
  }

  // 广播指令到所有不重复的可写通道
  uniqueChannels.forEach(function (channel) {
    wx.writeBLECharacteristicValue({
      deviceId: _deviceId,
      serviceId: channel.serviceId,
      characteristicId: channel.characteristicId,
      value: buffer,
      writeType: channel.writeNoResponse ? 'writeNoResponse' : 'write',
      success: function () {
        console.log(
          '[BLE write] cmd=' + cmd +
          ' ' + getBleChannelLabel(channel.serviceId, channel.characteristicId) +
          ' type=' + (channel.writeNoResponse ? 'writeNoResponse' : 'write')
        );
        // console.log('成功下发指令到:', channel.characteristicId.substring(4, 8), '内容:', cmd);
      },
      fail: function (err) {
        console.error(
          '[BLE write failed] cmd=' + cmd +
          ' ' + getBleChannelLabel(channel.serviceId, channel.characteristicId) +
          ' error=' + (err.errMsg || err.errCode || 'unknown')
        );
        // console.log('下发失败:', err.errMsg);
      }
    });
  });

  return uniqueChannels.length > 0;
}

function closeBLE() {
  handleDisconnect('用户主动断开');
  wx.closeBluetoothAdapter();
}

var _autoConnectInFlight = false;

function finishAutoConnectInFlight() {
  _autoConnectInFlight = false;
}

function autoConnectBLE(callback, connectCallback, disconnectCallback, silent = false) {
  _onMeasureCallback = callback;
  _onConnectCallback = connectCallback;
  _onDisconnectCallback = disconnectCallback;

  // 本进程内已恢复过连接：直接回报已连接，供工作台冷启动 UI 同步
  if (_deviceId) {
    console.log('[BLE] session already connected, notify UI:', _deviceId);
    if (connectCallback) connectCallback(true, _deviceName, _deviceId);
    return;
  }

  if (_autoConnectInFlight) {
    console.log('[BLE] autoConnect already in flight; updated callbacks only');
    return;
  }

  var lastId = wx.getStorageSync('last_ble_device_id');
  var lastName = wx.getStorageSync('last_ble_device_name');

  console.log('尝试一键直连，记忆设备名称:', lastName, 'ID:', lastId);

  if (lastId) {
    _autoConnectInFlight = true;
    var userConnectCallback = connectCallback;
    _onConnectCallback = function (success, name, id) {
      finishAutoConnectInFlight();
      if (userConnectCallback) userConnectCallback(success, name, id);
    };

    ensureBluetoothAdapterOpen({
      silent: silent,
      onOpen: function () {
        if (!silent) wx.showLoading({ title: '验证授权中...', mask: true });
        var api = require('./api.js');
        const app = getApp();
        api.request('/devices/verify-binding', 'POST', {
          deviceId: lastId,
          name: lastName,
          openid: app.globalData.openid
        })
          .then(function (verifyRes) {
            if (verifyRes.success && verifyRes.authorized) {
              connectDevice(lastId, lastName || '记忆设备', silent);
            } else {
              if (!silent) {
                wx.hideLoading();
                wx.showToast({ title: verifyRes.message || '设备未授权', icon: 'none' });
              }
              wx.removeStorageSync('last_ble_device_id');
              wx.removeStorageSync('last_ble_device_name');
              if (_onConnectCallback) _onConnectCallback(false);
            }
          }).catch(function (err) {
            console.error('[BLE] silent verify failed:', err);
            if (!silent) {
              wx.hideLoading();
              wx.showToast({ title: '设备验证失败', icon: 'none' });
            }
            if (_onConnectCallback) _onConnectCallback(false);
          });
      }
    });
  } else {
    if (silent) {
      if (_onConnectCallback) _onConnectCallback(false);
      return;
    }
    // 没有记忆设备时，用户主动触发时再进入常规搜索
    if (!silent) wx.showToast({ title: '无记忆设备，请手动搜索', icon: 'none' });
    initBLE(callback, connectCallback, disconnectCallback, silent);
  }
}

function hasRememberedDevice() {
  return !!wx.getStorageSync('last_ble_device_id');
}

function isSessionConnected() {
  return !!_deviceId;
}

function setCallbacks(callback, connectCallback, disconnectCallback) {
  if (callback !== undefined) _onMeasureCallback = callback;
  if (connectCallback !== undefined) _onConnectCallback = connectCallback;
  if (disconnectCallback !== undefined) _onDisconnectCallback = disconnectCallback;
}

// === 临时回调管理（供角度测量等子流程使用）===
var _savedMeasureCallback = null;

/**
 * 临时替换测量回调。调用后蓝牙的测量结果将发往 tempCb，
 * 直到调用 restoreMeasureCallback() 恢复原始回调。
 */
function setTemporaryMeasureCallback(tempCb) {
  _savedMeasureCallback = _onMeasureCallback;
  _onMeasureCallback = tempCb;
}

/**
 * 恢复之前被替换的测量回调
 */
function restoreMeasureCallback() {
  if (_savedMeasureCallback !== null) {
    _onMeasureCallback = _savedMeasureCallback;
    _savedMeasureCallback = null;
  }
}

function getCurrentDeviceInfo() {
  return {
    deviceId: _deviceId || wx.getStorageSync('last_ble_device_id') || '',
    name: wx.getStorageSync('last_ble_device_name') || ''
  };
}

module.exports = {
  initBLE: initBLE,
  initBLEForEnrollment: initBLEForEnrollment,
  scanBLEForEnrollment: scanBLEForEnrollment,
  closeBLE: closeBLE,
  cancelBLEDiscovery: cancelBLEDiscovery,
  sendBLECommand: sendBLECommand,
  autoConnectBLE: autoConnectBLE,
  setCallbacks: setCallbacks,
  clearBuffer: clearBuffer,
  setTemporaryMeasureCallback: setTemporaryMeasureCallback,
  restoreMeasureCallback: restoreMeasureCallback,
  getCurrentDeviceInfo: getCurrentDeviceInfo,
  hasRememberedDevice: hasRememberedDevice,
  isSessionConnected: isSessionConnected,
  classifyBluetoothAdapterOpenFailure: classifyBluetoothAdapterOpenFailure,
  resolveDeviceName: resolveDeviceName,
  isTargetRangefinderName: isTargetRangefinderName,
  TARGET_DEVICE_NAME: TARGET_DEVICE_NAME
};
