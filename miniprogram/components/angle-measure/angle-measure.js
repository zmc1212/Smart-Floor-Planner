const bluetooth = require('../../utils/bluetooth.js');
const util = require('../../utils/util.js');

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    wallALength: { type: Number, value: 0 }
  },
  data: {
    step: 1,
    sideA: 0,
    sideB: 0,
    diagonal: 0,
    angleDeg: 0,
    isValid: true,
    isMeasuring: false,
    stepLabels: ['\u6d4b\u91cf\u5899 A', '\u6d4b\u91cf\u5899 B', '\u6d4b\u91cf\u5bf9\u89d2\u7ebf', '\u786e\u8ba4\u7ed3\u679c'],
    stepDescs: [
      '\u5c06\u6d4b\u8ddd\u4eea\u8d34\u7d27\u5899\u89d2\uff0c\u6cbf\u7b2c\u4e00\u9762\u5899\u6d4b\u91cf\u8ddd\u79bb',
      '\u5c06\u6d4b\u8ddd\u4eea\u8d34\u7d27\u540c\u4e00\u5899\u89d2\uff0c\u6cbf\u7b2c\u4e8c\u9762\u5899\u6d4b\u91cf\u8ddd\u79bb',
      '\u4ece\u5899 A \u7aef\u70b9\u5bf9\u51c6\u5899 B \u7aef\u70b9\uff0c\u6d4b\u91cf\u5bf9\u89d2\u7ebf\u8ddd\u79bb',
      '\u89d2\u5ea6\u8ba1\u7b97\u5b8c\u6210\uff0c\u8bf7\u786e\u8ba4\u7ed3\u679c'
    ]
  },

  observers: {
    show(show) {
      if (show) {
        this.resetState();
        if (this.properties.wallALength > 0) {
          this.setData({
            step: 2,
            sideA: this.properties.wallALength
          });
        }
        bluetooth.setTemporaryMeasureCallback(dist => {
          this.onBLEMeasure(dist);
        });
        this.openLaser();
      } else {
        bluetooth.restoreMeasureCallback();
      }
    }
  },

  methods: {
    resetState() {
      this.setData({
        step: 1,
        sideA: 0,
        sideB: 0,
        diagonal: 0,
        angleDeg: 0,
        isValid: true,
        isMeasuring: false
      });
      if (this._measureTimer) clearTimeout(this._measureTimer);
      if (this._failTimer) clearTimeout(this._failTimer);
    },

    openLaser() {
      console.log('[AngleMeasure] open laser');
      bluetooth.sendBLECommand('ATK001#');
    },

    triggerMeasure() {
      if (this.data.isMeasuring) return;
      this.setData({ isMeasuring: true });

      bluetooth.clearBuffer();
      bluetooth.sendBLECommand('ATK001#');

      this._measureTimer = setTimeout(() => {
        bluetooth.sendBLECommand('ATD001#');
        this._failTimer = setTimeout(() => {
          this.onBLEMeasure(null);
        }, 4000);
      }, 3500);
    },

    onBLEMeasure(distanceInMeters) {
      this.setData({ isMeasuring: false });
      if (this._measureTimer) {
        clearTimeout(this._measureTimer);
        this._measureTimer = null;
      }
      if (this._failTimer) {
        clearTimeout(this._failTimer);
        this._failTimer = null;
      }

      if (distanceInMeters === null || distanceInMeters <= 0) {
        wx.showToast({ title: '\u6d4b\u91cf\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' });
        setTimeout(() => this.openLaser(), 800);
        return;
      }

      const step = this.data.step;

      if (step === 1) {
        this.setData({ sideA: distanceInMeters, step: 2 });
        wx.showToast({ title: `\u5899 A: ${distanceInMeters.toFixed(3)}m`, icon: 'success' });
        setTimeout(() => this.openLaser(), 600);
      } else if (step === 2) {
        this.setData({ sideB: distanceInMeters, step: 3 });
        wx.showToast({ title: `\u5899 B: ${distanceInMeters.toFixed(3)}m`, icon: 'success' });
        setTimeout(() => this.openLaser(), 600);
      } else if (step === 3) {
        this.setData({ diagonal: distanceInMeters });

        const a = this.data.sideA;
        const b = this.data.sideB;
        const d = distanceInMeters;
        const angle = util.calculateAngle(a, b, d);

        if (isNaN(angle)) {
          this.setData({ isValid: false, step: 4, angleDeg: 0 });
          wx.showToast({ title: '\u6570\u636e\u4e0d\u5408\u7406\uff0c\u8bf7\u91cd\u6d4b', icon: 'none' });
        } else {
          this.setData({
            isValid: true,
            step: 4,
            angleDeg: Math.round(angle * 10) / 10
          });
          wx.showToast({ title: `\u89d2\u5ea6: ${angle.toFixed(1)}\u00b0`, icon: 'success' });
        }
      }
    },

    onMeasureTap() {
      this.triggerMeasure();
    },

    onRetry() {
      if (this.data.step === 4) {
        this.resetState();
        if (this.properties.wallALength > 0) {
          this.setData({ step: 2, sideA: this.properties.wallALength });
        }
      }
      this.openLaser();
    },

    onRetryStep(e) {
      const targetStep = parseInt(e.currentTarget.dataset.step, 10);
      this.setData({ step: targetStep });
      setTimeout(() => this.openLaser(), 300);
    },

    onConfirm() {
      if (!this.data.isValid) {
        wx.showToast({ title: '\u89d2\u5ea6\u65e0\u6548\uff0c\u8bf7\u91cd\u65b0\u6d4b\u91cf', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm', {
        angle: this.data.angleDeg,
        wallLength: this.data.sideB,
        sideA: this.data.sideA,
        sideB: this.data.sideB,
        diagonal: this.data.diagonal
      });
    },

    onClose() {
      bluetooth.restoreMeasureCallback();
      this.triggerEvent('close');
    }
  }
});
