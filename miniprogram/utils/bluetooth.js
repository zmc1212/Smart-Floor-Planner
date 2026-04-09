// miniprogram/utils/bluetooth.js

var _deviceId = '';
var _writeCharacteristics = []; // 存储所有可写入的特征值以供广播
var _onMeasureCallback = null;
var _isConnecting = false;
var _onConnectCallback = null;
var _scanTimer = null; // 搜索总时间计时器
var _foundDevices = []; // 发现的设备列表，用于超时判断

const TARGET_DEVICE_NAME = 'LDMStudio 4D';

function initBLE(callback, connectCallback) {
  _onMeasureCallback = callback;
  _onConnectCallback = connectCallback;
  wx.openBluetoothAdapter({
    success: function (res) {
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

  // 设置 10 秒搜索超时
  if (_scanTimer) clearTimeout(_scanTimer);
  _scanTimer = setTimeout(function () {
    if (_foundDevices.length === 0 && !_isConnecting) {
      wx.stopBluetoothDevicesDiscovery();
      wx.hideLoading();
      
      var isAndroid = false;
      try { isAndroid = wx.getSystemInfoSync().platform === 'android'; } catch(e){}

      wx.showModal({
        title: '未发现设备',
        content: '未搜索到测距仪 ' + TARGET_DEVICE_NAME + '，请确保设备已开启并靠近手机。' + (isAndroid ? '安卓部分版本必须开启“系统定位”和“微信定位权限”才能搜索。' : ''),
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
          console.log('搜索中...', name, 'ID:', device.deviceId);

          // 更加稳健的匹配：忽略首尾空格，且包含关键词即可
          if (name.trim().includes(TARGET_DEVICE_NAME) && !_isConnecting) {
            // 发现目标设备，立刻锁定状态并直接自动连接
            _isConnecting = true;
            if (_scanTimer) clearTimeout(_scanTimer);
            wx.stopBluetoothDevicesDiscovery();
            wx.hideLoading();

            console.log('✅ 匹配成功，发起自动连接:', name);
            connectDevice(device.deviceId, name.trim());
            return;
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

// 废弃旧的 offerDevice 逻辑，改为直接连接
function offerDevice(device) {
  // 不再使用此函数
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

function sendBLECommand(cmd) {
  if (!_deviceId || _writeCharacteristics.length === 0) {
    console.error('蓝牙未连接或未发现写入特征值');
    return;
  }

  var buffer = new ArrayBuffer(cmd.length);
  var dataView = new DataView(buffer);
  for (var i = 0; i < cmd.length; i++) {
    dataView.setUint8(i, cmd.charCodeAt(i));
  }

  // 广播指令到所有可写通道
  _writeCharacteristics.forEach(function (channel) {
    wx.writeBLECharacteristicValue({
      deviceId: _deviceId,
      serviceId: channel.serviceId,
      characteristicId: channel.characteristicId,
      value: buffer,
      writeType: channel.writeNoResponse ? 'writeNoResponse' : 'write',
      success: function () {
        console.log('成功下发指令到:', channel.characteristicId.substring(4, 8), '内容:', cmd);
      },
      fail: function (err) {
        console.log('下发失败 (通道:', channel.characteristicId.substring(4, 8) + '):', err.errMsg);
      }
    });
  });
}

function closeBLE() {
  if (_deviceId) {
    wx.closeBLEConnection({ deviceId: _deviceId });
    _deviceId = '';
  }
  wx.closeBluetoothAdapter();
  _isConnecting = false;
  _foundDevices = [];
  _writeCharacteristics = [];
}

function autoConnectBLE(callback, connectCallback) {
  _onMeasureCallback = callback;
  _onConnectCallback = connectCallback;
  var lastId = wx.getStorageSync('last_ble_device_id');
  var lastName = wx.getStorageSync('last_ble_device_name');

  console.log('尝试一键直连，记忆设备名称:', lastName, 'ID:', lastId);

  if (lastId) {
    wx.openBluetoothAdapter({
      success: function (res) {
        connectDevice(lastId, lastName || '记忆设备');
      },
      fail: function (err) {
        wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
        if (_onConnectCallback) _onConnectCallback(false);
      }
    });
  } else {
    // 没有记忆设备时，直接调用常规搜索
    wx.showToast({ title: '无记忆设备，请手动搜索', icon: 'none' });
    initBLE(callback, connectCallback);
  }
}

module.exports = {
  initBLE: initBLE,
  closeBLE: closeBLE,
  sendBLECommand: sendBLECommand,
  autoConnectBLE: autoConnectBLE
};
