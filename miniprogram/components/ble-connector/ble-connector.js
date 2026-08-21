const bluetooth = require('../../utils/bluetooth.js');

Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    }
  },

  data: {
    connecting: false,
    statusText: '待连接'
  },

  methods: {
    onClose() {
      if (this.data.connecting) {
        bluetooth.cancelBLEDiscovery();
        this.setData({ connecting: false, statusText: '待连接' });
      }
      this.triggerEvent('close');
    },

    onContainerTap() {
      // Prevent bubbling
    },

    onAutoConnect() {
      if (this.data.connecting) return;
      this.setData({ connecting: true, statusText: '正在自动连接...' });
      bluetooth.autoConnectBLE(
        () => {}, // Measure callback (handled by page)
        (success, name) => {
          this.setData({ connecting: false });
          if (success) {
            this.setData({ statusText: '连接成功' });
            wx.showToast({ title: '连接成功', icon: 'success' });
            this.triggerEvent('success');
            setTimeout(() => this.triggerEvent('close'), 1000);
          } else {
            this.setData({ statusText: '连接失败' });
          }
        },
        () => {
          this.setData({ connecting: false, statusText: '连接已断开' });
          this.triggerEvent('disconnect');
        }
      );
    },

    onSearchNew() {
      if (this.data.connecting) return;
      this.setData({ connecting: true, statusText: '正在搜索设备...' });
      bluetooth.initBLE(
        () => {}, // Measure callback
        (success, name) => {
          this.setData({ connecting: false });
          if (success) {
            this.setData({ statusText: '连接成功' });
            wx.showToast({ title: '连接成功', icon: 'success' });
            this.triggerEvent('success');
            setTimeout(() => this.triggerEvent('close'), 1000);
          } else {
            this.setData({ statusText: '未发现设备' });
          }
        },
        () => {
          this.setData({ connecting: false, statusText: '连接已断开' });
          this.triggerEvent('disconnect');
        }
      );
    }
  }
})
