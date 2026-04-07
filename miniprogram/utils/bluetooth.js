// miniprogram/utils/bluetooth.js

var _deviceId = '';
var _serviceId = '';
var _characteristicId = '';
var _writeCharacteristicId = '';
var _onMeasureCallback = null;
var _isConnecting = false;

function initBLE(callback) {
  _onMeasureCallback = callback;
  wx.openBluetoothAdapter({
    success: function (res) {
      startScan();
      wx.showToast({ title: '开始搜索蓝牙设备', icon: 'none' });
    },
    fail: function (err) {
      wx.showToast({ title: '请打开手机蓝牙', icon: 'none' });
      wx.onBluetoothAdapterStateChange(function (res) {
        if (res.available) {
          startScan();
        }
      });
    }
  });
}

function startScan() {
  if (_isConnecting) return;
  wx.startBluetoothDevicesDiscovery({
    allowDuplicatesKey: false,
    success: function (res) {
      wx.onBluetoothDeviceFound(function (devices) {
        var deviceList = devices.devices;
        for (var i = 0; i < deviceList.length; i++) {
          var device = deviceList[i];
          // 如果名称包含测距仪常见的名字，可以增加名字过滤。这里目前只要搜到信号强于 -80 的新蓝牙就尝试询问或者交给用户选
          // 考虑到静默连接，我们可以过滤有特定名前缀的，但若不知前缀，只把搜到的设备通过回调抛出给页面，或者就弹窗
          if (device.name && device.name.length > 0 && !_isConnecting) {
            // 暂不静默连接，抛给上层或者直接用微信 action sheet
            // TODO: 这里简化为将设备抛出，交给页面渲染或者就在这使用 wx.showActionSheet
            offerDevice(device);
          }
        }
      });
    }
  });
}

var _foundDevices = [];
var _offerTimer = null;
function offerDevice(device) {
  var exists = false;
  for (var i = 0; i < _foundDevices.length; i++) {
    if (_foundDevices[i].deviceId === device.deviceId) {
      // 更新 RSSI 信息
      _foundDevices[i].RSSI = device.RSSI;
      exists = true; break;
    }
  }
  if (!exists) {
    _foundDevices.push(device);
  }

  // 按照信号强度 (RSSI) 降序排序，信号越强（负数越小，约接近0）排在越前面
  _foundDevices.sort(function (a, b) {
    return b.RSSI - a.RSSI;
  });

  if (_offerTimer) {
    clearTimeout(_offerTimer);
  }
  _offerTimer = setTimeout(function () {
    if (_isConnecting) return;

    // 生成包含信号强度的显示列表，只取前 6 个最强的设备避免列表过长
    var displayDevices = _foundDevices.slice(0, 6);
    var itemList = displayDevices.map(function (d) {
      return (d.name || '未知设备') + ' (信号:' + d.RSSI + ')';
    });

    wx.showActionSheet({
      itemList: itemList,
      success: function (res) {
        var selected = displayDevices[res.tapIndex];
        connectDevice(selected.deviceId, selected.name);
      }
    });
  }, 1500); // 1.5秒后把找的设备供用户选择
}

function connectDevice(deviceId, name) {
  _isConnecting = true;
  wx.stopBluetoothDevicesDiscovery();
  wx.showLoading({ title: '连接 ' + name + '...' });

  wx.createBLEConnection({
    deviceId: deviceId,
    success: function () {
      _deviceId = deviceId;
      wx.showToast({ title: '连接成功', icon: 'success' });
      getServices(deviceId);
    },
    fail: function (err) {
      wx.hideLoading();
      console.log('连接失败', err)
      wx.showToast({ title: '连接失败', icon: 'none' });
      _isConnecting = false;
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
        // 排除掉微信过滤或标准的通用基础服务
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

        // 订阅通知特征值
        if (item.properties.notify || item.properties.indicate) {
          wx.notifyBLECharacteristicValueChange({
            deviceId: deviceId,
            serviceId: serviceId,
            characteristicId: item.uuid,
            state: true,
            success: function () {
              console.log('✅ Subscribe Success:', item.uuid);
              _serviceId = serviceId;
              _characteristicId = item.uuid;
              listenValueChange();
            }
          });
        }

        // 寻找可写入的特征值
        if (item.properties.write || item.properties.writeNoResponse) {
          console.log('发现可写入特征值:', item.uuid);
          _writeCharacteristicId = item.uuid;
          _serviceId = serviceId;
        }
      }
    }
  });
}

var dataBuffer = [];
function listenValueChange() {
  wx.onBLECharacteristicValueChange(function (res) {
    // 移除严格匹配 res.characteristicId === _characteristicId 的限制
    // 因为某些仪器可能有多个 Notify 通道
    var length = res.value.byteLength;
    var arr = new Uint8Array(res.value);

    // 增加日志打印原始十六进制数据以供调试
    var hexArr = [];
    for (var i = 0; i < length; i++) {
      var hex = arr[i].toString(16).toUpperCase();
      hexArr.push(hex.length === 1 ? '0' + hex : hex);
      dataBuffer.push(arr[i]);
    }
    console.log('收到蓝牙数据 [UUID: ' + res.characteristicId.substring(4, 8) + '], 长度:', length, '内容: [', hexArr.join(' '), ']');

    // 接下来正常解析缓冲池
    while (dataBuffer.length >= 17) {
      var a = dataBuffer[0];
      var b = dataBuffer[1];
      var c = dataBuffer[2];

      if (a === 0x41 && b === 0x54 && c === 0x44) {
        var u8 = new Uint8Array(dataBuffer.slice(3, 7));
        var dataDv = new DataView(u8.buffer);
        var meadist = dataDv.getUint32(0, true);

        var distanceInMeters = meadist / 10000.0;
        console.log("测距结果:", distanceInMeters, "m, 原始字节:", u8);

        if (_onMeasureCallback) {
          _onMeasureCallback(distanceInMeters);
        }
        dataBuffer.splice(0, 17);
      } else {
        // 如果头部不是 ATD，并且如果正好返回的是 ATK001# 等回应，我们目前只做了移出策略。
        // 为了避免把有用的反馈当垃圾丢掉，我们可以把识别到的 A, T 首字母做下判断
        if (a === 0x41 && b === 0x54 && (dataBuffer[2] === 0x4B || dataBuffer[2] === 0x4D)) { // ATK or ATM
          // 这里可能是收到了回应，我们暂不处理距离，但是可以将这几个字节从 buffer 移除
          // 按照协议，ATK001# 等是 7 字节
          if (dataBuffer.length >= 7) {
            console.log('收到通信回应: ', String.fromCharCode.apply(null, dataBuffer.slice(0, 7)));
            dataBuffer.splice(0, 7);
            continue;
          }
        }

        dataBuffer.shift(); // 丢弃无效头部1字节
      }
    }
  });
}

function sendBLECommand(cmd) {
  if (!_deviceId || !_serviceId || !_writeCharacteristicId) {
    console.error('蓝牙未连接或未发现写入特征值');
    return;
  }

  // 将字符串转为 ArrayBuffer
  var buffer = new ArrayBuffer(cmd.length);
  var dataView = new DataView(buffer);
  for (var i = 0; i < cmd.length; i++) {
    dataView.setUint8(i, cmd.charCodeAt(i));
  }

  wx.writeBLECharacteristicValue({
    deviceId: _deviceId,
    serviceId: _serviceId,
    characteristicId: _writeCharacteristicId,
    value: buffer,
    success: function (res) {
      console.log('指令发送成功:', cmd);
    },
    fail: function (err) {
      console.error('指令发送失败:', err);
    }
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
}

module.exports = {
  initBLE: initBLE,
  closeBLE: closeBLE,
  sendBLECommand: sendBLECommand
};
