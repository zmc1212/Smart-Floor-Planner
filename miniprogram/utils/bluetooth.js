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

var _heartbeatTimer = null;
var _lastResponseTime = 0;
const HEARTBEAT_INTERVAL = 5000; // 5秒发一次心跳
const HEARTBEAT_TIMEOUT = 12000;  // 12秒没收到任何回复认为断开

const TARGET_DEVICE_NAME = 'LDMStudio 4D';

function initBLE(callback, connectCallback, disconnectCallback) {
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

      wx.showLoading({ title: '搜索测距仪...', mask: true });
      startScan();
    },
    fail: function (err) {
      wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
      wx.onBluetoothAdapterStateChange(function (res) {
        if (res.available) {
          wx.showLoading({ title: '搜索测距仪...', mask: true });
          startScan();
        }
      });
    }
  });
}

function startScan() {
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
        wx.hideLoading();
        wx.showModal({
          title: '权限提醒',
          content: '安卓搜索蓝牙需开启：' + msgs.join('、') + '，请前往设置开启后重试。',
          showCancel: false
        });
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
      wx.hideLoading();
      
      var isAndroid = false;
      try { isAndroid = wx.getSystemInfoSync().platform === 'android'; } catch(e){}

      wx.showModal({
        title: '未发现设备',
        content: '未搜索到授权的测距仪，请确保设备已开启、已在后台录入编码并靠近手机。',
        showCancel: false
      });
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
            
            if (_verifyingDevices[device.deviceId]) return; // 已验证或验证中
            _verifyingDevices[device.deviceId] = true;

            console.log('搜索到设备，请求后台验证...', name, 'ID:', device.deviceId);

            var api = require('./api.js');
            api.request('/devices/verify', 'POST', { 
              deviceId: device.deviceId, 
              name: name.trim() 
            }).then(function(verifyRes) {
              if (verifyRes.success && verifyRes.authorized) {
                if (_isConnecting) return; // 可能已连接上其他设备
                _isConnecting = true;
                if (_scanTimer) clearTimeout(_scanTimer);
                wx.stopBluetoothDevicesDiscovery();
                wx.hideLoading();

                console.log('✅ 设备授权成功，发起连接:', name);
                connectDevice(device.deviceId, name.trim());
              } else {
                console.log('🚫 设备未授权，忽略:', name, device.deviceId);
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
  });
}

function connectDevice(deviceId, name) {
  _isConnecting = true;
  _writeCharacteristics = []; // 连接前重置写入通道
  wx.stopBluetoothDevicesDiscovery();
  wx.showLoading({ title: '连接 ' + name + '...' });

  wx.createBLEConnection({
    deviceId: deviceId,
    success: function () {
      _deviceId = deviceId;
      // 保存到本地缓存以便后续一键直连
      wx.setStorageSync('last_ble_device_id', deviceId);
      wx.setStorageSync('last_ble_device_name', name);

      wx.showToast({ title: '连接成功', icon: 'success' });
      getServices(deviceId);
      if (_onConnectCallback) _onConnectCallback(true, name);
      
      startHeartbeat();
    },
    fail: function (err) {
      wx.hideLoading();
      console.log('连接失败', err);
      // 如果直连失败，清除缓存
      wx.removeStorageSync('last_ble_device_id');
      wx.removeStorageSync('last_ble_device_name');
      wx.showToast({ title: '连接失败', icon: 'none' });
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

        // 订阅所有通知特征值
        if (item.properties.notify || item.properties.indicate) {
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
        if (item.properties.write || item.properties.writeNoResponse) {
          console.log('发现写入通道:', item.uuid);
          _writeCharacteristics.push({
            serviceId: serviceId,
            characteristicId: item.uuid,
            writeNoResponse: item.properties.writeNoResponse
          });
        }
      }
    }
  });
}

var dataBuffer = [];
function listenValueChange() {
  wx.onBLECharacteristicValueChange(function (res) {
    _lastResponseTime = Date.now(); // 收到任何数据都刷新心跳存活时间

    var length = res.value.byteLength;
    var arr = new Uint8Array(res.value);

    // 打印原始 Hex 以供调试
    var hexArr = [];
    for (var i = 0; i < length; i++) {
      var hex = arr[i].toString(16).toUpperCase();
      hexArr.push(hex.length === 1 ? '0' + hex : hex);
      dataBuffer.push(arr[i]);
    }
    console.log('收到蓝牙数据 [UUID: ' + res.characteristicId.substring(4, 8) + '], 长度:', length, '内容: [', hexArr.join(' '), ']');

    // 解析数据包
    while (dataBuffer.length >= 7) {
      var a = dataBuffer[0];
      var b = dataBuffer[1];
      var c = dataBuffer[2];

      if (a === 0x41 && b === 0x54 && c === 0x44) { // ATD 开始
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
  console.log('启动心跳维持机制...');
  _heartbeatTimer = setInterval(function() {
    if (_deviceId) {
      // 发送 ATD001# 查询距离作为心跳包
      sendBLECommand('ATD001#');
      
      var now = Date.now();
      if (now - _lastResponseTime > HEARTBEAT_TIMEOUT) {
        console.log('心跳超时，认为设备已断开连接');
        handleDisconnect('心跳检测超时');
      }
    } else {
      stopHeartbeat();
    }
  }, HEARTBEAT_INTERVAL);
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
  stopHeartbeat();
  
  wx.closeBLEConnection({ deviceId: tempId }).catch(function(){});
  
  if (_onDisconnectCallback) {
    _onDisconnectCallback();
  }
}

var _lastCmdTime = 0;
var _lastCmdStr = '';

function sendBLECommand(cmd) {
  if (!_deviceId || _writeCharacteristics.length === 0) {
    console.error('蓝牙未连接或未发现写入特征值');
    return;
  }

  // JS层面的防抖：防止短时间内某些回调导致重复发同一条指令
  var now = Date.now();
  if (cmd === _lastCmdStr && now - _lastCmdTime < 500) {
    console.log('阻止极短时间内重复发送相同的指令:', cmd);
    return;
  }
  _lastCmdTime = now;
  _lastCmdStr = cmd;

  var buffer = new ArrayBuffer(cmd.length);
  var dataView = new DataView(buffer);
  for (var i = 0; i < cmd.length; i++) {
    dataView.setUint8(i, cmd.charCodeAt(i));
  }

  // 通道去重：防止某些BLE模块被微信重复枚举了相同的 UUID
  var uniqueChannels = [];
  var seenUuids = {};
  for (var j = 0; j < _writeCharacteristics.length; j++) {
    var cId = _writeCharacteristics[j].characteristicId;
    if (!seenUuids[cId]) {
      seenUuids[cId] = true;
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
        // console.log('成功下发指令到:', channel.characteristicId.substring(4, 8), '内容:', cmd);
      },
      fail: function (err) {
        // console.log('下发失败:', err.errMsg);
      }
    });
  });
}

function closeBLE() {
  handleDisconnect('用户主动断开');
  wx.closeBluetoothAdapter();
}

function autoConnectBLE(callback, connectCallback, disconnectCallback) {
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

        wx.showLoading({ title: '验证授权中...', mask: true });
        var api = require('./api.js');
        api.request('/devices/verify', 'POST', { deviceId: lastId, name: lastName })
          .then(function(verifyRes) {
            if (verifyRes.success && verifyRes.authorized) {
              connectDevice(lastId, lastName || '记忆设备');
            } else {
              wx.hideLoading();
              wx.showToast({ title: '设备已被移除或未授权', icon: 'none' });
              wx.removeStorageSync('last_ble_device_id');
              wx.removeStorageSync('last_ble_device_name');
              // 未授权时可以重置去搜索界面
              if (_onConnectCallback) _onConnectCallback(false);
            }
          }).catch(function(err) {
             wx.hideLoading();
             wx.showToast({ title: '设备验证失败', icon: 'none' });
             if (_onConnectCallback) _onConnectCallback(false);
          });
      },
      fail: function (err) {
        wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
        if (_onConnectCallback) _onConnectCallback(false);
      }
    });
  } else {
    // 没有记忆设备时，直接调用常规搜索
    wx.showToast({ title: '无记忆设备，请手动搜索', icon: 'none' });
    initBLE(callback, connectCallback, disconnectCallback);
  }
}

module.exports = {
  initBLE: initBLE,
  closeBLE: closeBLE,
  sendBLECommand: sendBLECommand,
  autoConnectBLE: autoConnectBLE
};
