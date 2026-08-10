// miniprogram/utils/bluetooth.js

var _deviceId = '';
var _writeCharacteristics = []; // 存储所有可写入的特征值以供广播
var _onMeasureCallback = null;
var _isConnecting = false;
var _onConnectCallback = null;
var _onDisconnectCallback = null;
var _scanTimer = null; // 搜索总时间计时器
var _foundDevices = []; // 发现的设备列表，用于超时判断
var _verifyingDevices = {}; // 记录正在验证或验证失败的设备，避免重复请求
var _isStateChangeRegistered = false;
var _isValueChangeRegistered = false;
var _deviceName = ''; // 存储当前连接的设备名称
var _hasTriggeredReady = false; // 确保就绪回调仅触发一次
var _hasRequestedDeviceIdCode = false; // 每次连接只查询一次 ATC001# 机器 ID
var _dataBuffersByChannel = {};

var _heartbeatTimer = null;
var _lastResponseTime = 0;
const HEARTBEAT_INTERVAL = 5000; // 5秒发一次心跳
const HEARTBEAT_TIMEOUT = 12000;  // 12秒没收到任何回复认为断开

const TARGET_DEVICE_NAME = 'LDMStudio 4D';

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

function getAdvertisDataHex(advertisData) {
  if (!advertisData) return '';
  try {
    return bytesToHex(new Uint8Array(advertisData));
  } catch (error) {
    console.warn('[BLE discovery] 无法读取广播数据:', error);
    return '';
  }
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

function requestDeviceIdCode() {
  if (_hasRequestedDeviceIdCode || !_deviceId || _writeCharacteristics.length === 0) return;
  _hasRequestedDeviceIdCode = true;
  console.log('[BLE IDCODE] 发送 ATC001#，读取协议定义的 96 位机器 ID。');
  sendBLECommand('ATC001#');
}

function initBLE(callback, connectCallback, disconnectCallback, silent = false) {
  _onMeasureCallback = callback;
  _onConnectCallback = connectCallback;
  _onDisconnectCallback = disconnectCallback;
  _verifyingDevices = {}; // 重置验证状态
  wx.openBluetoothAdapter({
    success: function (res) {
      // 注册全局断开监听 (仅注册一次)
      if (!_isStateChangeRegistered) {
        wx.onBLEConnectionStateChange(function (res) {
          console.log('蓝牙连接状态变化:', res.connected, '设备ID:', res.deviceId);
          if (!res.connected && res.deviceId === _deviceId) {
            handleDisconnect('系统蓝牙断开信号');
          }
        });
        _isStateChangeRegistered = true;
      }

      if (!silent) wx.showLoading({ title: '搜索测距仪...', mask: true });
      startScan(silent);
    },
    fail: function (err) {
      if (!silent) wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
      wx.onBluetoothAdapterStateChange(function (res) {
        if (res.available) {
          if (!silent) wx.showLoading({ title: '搜索测距仪...', mask: true });
          startScan(silent);
        }
      });
    }
  });
}

function startScan(silent = false) {
  if (_isConnecting) return;
  _foundDevices = []; // 重置搜索列表

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
        if (!silent) {
          wx.hideLoading();
          wx.showModal({
            title: '权限提醒',
            content: '安卓搜索蓝牙需开启：' + msgs.join('、') + '，请前往设置开启后重试。',
            showCancel: false
          });
        }
        return;
      }
    }
  } catch (err) {
    console.error('获取系统设置失败', err);
  }

  // 设置 10 秒搜索超时 (验证需要额外时间)
  if (_scanTimer) clearTimeout(_scanTimer);
  _scanTimer = setTimeout(function () {
    if (!_isConnecting) {
      wx.stopBluetoothDevicesDiscovery();
      if (!silent) {
        wx.hideLoading();
        
        var isAndroid = false;
        try { isAndroid = wx.getSystemInfoSync().platform === 'android'; } catch(e){}

        wx.showModal({
          title: '未发现设备',
          content: '未搜索到授权的测距仪，请确保设备已开启、已在后台录入编码并靠近手机。',
          showCancel: false
        });
      }
    }
  }, 10000);

  wx.startBluetoothDevicesDiscovery({
    allowDuplicatesKey: false,
    success: function (res) {
      wx.onBluetoothDeviceFound(function (devices) {
        var deviceList = devices.devices;
        for (var i = 0; i < deviceList.length; i++) {
          var device = deviceList[i];
          const name = device.name || device.localName || '';

          // 发现目标类设备
          if (name.trim().includes(TARGET_DEVICE_NAME) && !_isConnecting) {
            _foundDevices.push(device);
            logDiscoveredDevice(device, name.trim());
            
            if (_verifyingDevices[device.deviceId]) return; // 已验证或验证中
            _verifyingDevices[device.deviceId] = true;

            console.log('搜索到设备，请求后台验证...', name, 'ID:', device.deviceId);

            var api = require('./api.js');
            const app = getApp();
            api.request('/devices/verify-binding', 'POST', { 
              deviceId: device.deviceId, 
              name: name.trim(),
              openid: app.globalData.openid
            }).then(function(verifyRes) {
              if (verifyRes.success && verifyRes.authorized) {
                if (_isConnecting) return; // 可能已连接上其他设备
                _isConnecting = true;
                if (_scanTimer) clearTimeout(_scanTimer);
                wx.stopBluetoothDevicesDiscovery();
                if (!silent) wx.hideLoading();

                console.log('✅ 设备授权成功，发起连接:', name);
                connectDevice(device.deviceId, name.trim(), silent);
              } else {
                console.log('🚫 设备未授权:', verifyRes.message);
                // Optionally show feedback if the user specifically tried this device
              }
            }).catch(function(err) {
              console.error('设备验证请求失败:', err);
              // 验证失败允许重试
              _verifyingDevices[device.deviceId] = false; 
            });
          }
        }
      });
    },
    fail: function (err) {
      console.log('搜索设备失败', err);
      if (_scanTimer) clearTimeout(_scanTimer);
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

function connectDevice(deviceId, name, silent = false) {
  _isConnecting = true;
  _writeCharacteristics = []; // 连接前重置写入通道
  _dataBuffersByChannel = {};
  wx.stopBluetoothDevicesDiscovery();
  if (!silent) wx.showLoading({ title: '连接 ' + name + '...' });

  wx.createBLEConnection({
    deviceId: deviceId,
    success: function () {
      _deviceId = deviceId;
      // 保存到本地缓存以便后续一键直连
      wx.setStorageSync('last_ble_device_id', deviceId);
      wx.setStorageSync('last_ble_device_name', name);

      if (!silent) wx.showToast({ title: '连接成功', icon: 'success' });
      _deviceName = name;
      _hasTriggeredReady = false;
      _hasRequestedDeviceIdCode = false;
      getServices(deviceId);
      
      startHeartbeat();
    },
    fail: function (err) {
      if (!silent) wx.hideLoading();
      console.log('连接失败', err);
      // 如果直连失败，清除缓存
      wx.removeStorageSync('last_ble_device_id');
      wx.removeStorageSync('last_ble_device_name');
      if (!silent) wx.showToast({ title: '连接失败', icon: 'none' });
      _isConnecting = false;
      if (_onConnectCallback) _onConnectCallback(false);
    }
  });
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
            _onConnectCallback(true, _deviceName);
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
  stopHeartbeat();
  
  wx.closeBLEConnection({ deviceId: tempId }).catch(function(){});
  
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

function autoConnectBLE(callback, connectCallback, disconnectCallback, silent = false) {
  _onMeasureCallback = callback;
  _onConnectCallback = connectCallback;
  _onDisconnectCallback = disconnectCallback;

  var lastId = wx.getStorageSync('last_ble_device_id');
  var lastName = wx.getStorageSync('last_ble_device_name');

  console.log('尝试一键直连，记忆设备名称:', lastName, 'ID:', lastId);

  if (lastId) {
    wx.openBluetoothAdapter({
      success: function (res) {
        // 注册全局断开监听 (仅注册一次)
        if (!_isStateChangeRegistered) {
          wx.onBLEConnectionStateChange(function (res) {
            console.log('蓝牙连接状态变化:', res.connected, '设备ID:', res.deviceId);
            if (!res.connected && res.deviceId === _deviceId) {
              handleDisconnect('系统蓝牙断开信号');
            }
          });
          _isStateChangeRegistered = true;
        }

        if (!silent) wx.showLoading({ title: '验证授权中...', mask: true });
        var api = require('./api.js');
        const app = getApp();
        api.request('/devices/verify-binding', 'POST', { 
          deviceId: lastId, 
          name: lastName,
          openid: app.globalData.openid 
        })
          .then(function(verifyRes) {
            if (verifyRes.success && verifyRes.authorized) {
              connectDevice(lastId, lastName || '记忆设备', silent);
            } else {
              if (!silent) {
                wx.hideLoading();
                wx.showToast({ title: verifyRes.message || '设备未授权', icon: 'none' });
              }
              wx.removeStorageSync('last_ble_device_id');
              wx.removeStorageSync('last_ble_device_name');
              // 未授权时可以重置去搜索界面
              if (_onConnectCallback) _onConnectCallback(false);
            }
          }).catch(function(err) {
             if (!silent) {
               wx.hideLoading();
               wx.showToast({ title: '设备验证失败', icon: 'none' });
             }
             if (_onConnectCallback) _onConnectCallback(false);
          });
      },
      fail: function (err) {
        if (!silent) wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
        if (_onConnectCallback) _onConnectCallback(false);
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
  closeBLE: closeBLE,
  sendBLECommand: sendBLECommand,
  autoConnectBLE: autoConnectBLE,
  setCallbacks: setCallbacks,
  clearBuffer: clearBuffer,
  setTemporaryMeasureCallback: setTemporaryMeasureCallback,
  restoreMeasureCallback: restoreMeasureCallback,
  getCurrentDeviceInfo: getCurrentDeviceInfo,
  hasRememberedDevice: hasRememberedDevice
};
