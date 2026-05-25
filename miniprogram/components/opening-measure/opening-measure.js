const bluetooth = require('../../utils/bluetooth.js');

function formatMeters(value) {
  const num = Number(value || 0);
  return num > 0 ? num.toFixed(3) : '--';
}

function getPreviewData(ref, offsetMeters, widthMeters, wallLengthUnits) {
  const wallMeters = Number(wallLengthUnits || 0) / 10;
  const safeWidth = wallMeters > 0 ? Math.max(0, Number(widthMeters || 0)) : 0;
  const safeOffset = wallMeters > 0 ? Math.max(0, Number(offsetMeters || 0)) : 0;
  const startMeters = ref === 'end'
    ? Math.max(0, wallMeters - safeOffset - safeWidth)
    : safeOffset;

  return {
    previewLeft: wallMeters > 0 ? Math.max(0, Math.min(100, startMeters / wallMeters * 100)) : 0,
    previewWidth: wallMeters > 0 ? Math.max(0, Math.min(100, safeWidth / wallMeters * 100)) : 0
  };
}

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    openingType: { type: String, value: 'DOOR' },
    wallLabel: { type: String, value: '' },
    wallLength: { type: Number, value: 0 },
    reference: { type: String, value: 'start' }
  },
  data: {
    step: 1,
    ref: 'start',
    offsetMeters: 0,
    widthMeters: 0,
    isMeasuring: false,
    wallLengthMeters: '0.000',
    offsetText: '--',
    widthText: '--',
    previewLeft: 0,
    previewWidth: 0
  },
  observers: {
    show(show) {
      if (show) {
        this.resetState();
        bluetooth.setTemporaryMeasureCallback((dist) => {
          this.onBLEMeasure(dist);
        });
        this.openLaser();
      } else {
        this.cleanupMeasure();
        bluetooth.restoreMeasureCallback();
      }
    },
    'wallLength, reference': function () {
      this.setData({
        wallLengthMeters: (Number(this.properties.wallLength || 0) / 10).toFixed(3),
        ref: this.properties.reference === 'end' ? 'end' : 'start',
        previewLeft: 0,
        previewWidth: 0
      });
    }
  },
  lifetimes: {
    detached() {
      this.cleanupMeasure();
      bluetooth.restoreMeasureCallback();
    }
  },
  methods: {
    resetState() {
      this.cleanupMeasure();
      this.setData({
        step: 1,
        ref: this.properties.reference === 'end' ? 'end' : 'start',
        offsetMeters: 0,
        widthMeters: 0,
        isMeasuring: false,
        wallLengthMeters: (Number(this.properties.wallLength || 0) / 10).toFixed(3),
        offsetText: '--',
        widthText: '--',
        previewLeft: 0,
        previewWidth: 0
      });
    },

    cleanupMeasure() {
      if (this._measureTimer) {
        clearTimeout(this._measureTimer);
        this._measureTimer = null;
      }
      if (this._failTimer) {
        clearTimeout(this._failTimer);
        this._failTimer = null;
      }
    },

    openLaser() {
      bluetooth.sendBLECommand('ATK001#');
    },

    triggerMeasure() {
      if (this.data.isMeasuring) return;
      this.cleanupMeasure();
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
      this.cleanupMeasure();
      this.setData({ isMeasuring: false });

      if (distanceInMeters === null || distanceInMeters <= 0) {
        wx.showToast({ title: '\u6d4b\u91cf\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5', icon: 'none' });
        setTimeout(() => this.openLaser(), 600);
        return;
      }

      const value = Number(distanceInMeters);
      const wallLengthMeters = Number(this.properties.wallLength || 0) / 10;

      if (this.data.step === 1) {
        if (value >= wallLengthMeters) {
          wx.showToast({ title: '\u504f\u79fb\u8ddd\u79bb\u5df2\u8d85\u51fa\u5899\u957f', icon: 'none' });
          setTimeout(() => this.openLaser(), 600);
          return;
        }
        const preview = getPreviewData(this.data.ref, value, this.data.widthMeters, this.properties.wallLength);
        this.setData({
          offsetMeters: value,
          offsetText: formatMeters(value),
          step: 2,
          previewLeft: preview.previewLeft,
          previewWidth: preview.previewWidth
        });
        wx.showToast({ title: '\u504f\u79fb ' + value.toFixed(3) + 'm', icon: 'success' });
        setTimeout(() => this.openLaser(), 600);
        return;
      }

      if (this.data.step === 2) {
        if (this.data.offsetMeters + value > wallLengthMeters) {
          wx.showToast({ title: '\u504f\u79fb+\u5bbd\u5ea6\u8d85\u51fa\u5899\u957f', icon: 'none' });
          setTimeout(() => this.openLaser(), 600);
          return;
        }
        const preview = getPreviewData(this.data.ref, this.data.offsetMeters, value, this.properties.wallLength);
        this.setData({
          widthMeters: value,
          widthText: formatMeters(value),
          step: 3,
          previewLeft: preview.previewLeft,
          previewWidth: preview.previewWidth
        });
        wx.showToast({ title: '\u5bbd\u5ea6 ' + value.toFixed(3) + 'm', icon: 'success' });
      }
    },

    onMeasureTap() {
      this.triggerMeasure();
    },

    onSelectReference(e) {
      const ref = e.currentTarget.dataset.ref === 'end' ? 'end' : 'start';
      if (ref === this.data.ref) return;

      this.cleanupMeasure();
      this.setData({
        ref: ref,
        step: 1,
        offsetMeters: 0,
        widthMeters: 0,
        offsetText: '--',
        widthText: '--',
        isMeasuring: false,
        previewLeft: 0,
        previewWidth: 0
      });
      this.openLaser();
    },

    onRetryStep(e) {
      const step = Number(e.currentTarget.dataset.step || 1);
      this.cleanupMeasure();
      if (step <= 1) {
        this.setData({
          step: 1,
          offsetMeters: 0,
          widthMeters: 0,
          offsetText: '--',
          widthText: '--',
          isMeasuring: false,
          previewLeft: 0,
          previewWidth: 0
        });
      } else {
        const preview = getPreviewData(this.data.ref, this.data.offsetMeters, 0, this.properties.wallLength);
        this.setData({
          step: 2,
          widthMeters: 0,
          widthText: '--',
          isMeasuring: false,
          previewLeft: preview.previewLeft,
          previewWidth: preview.previewWidth
        });
      }
      this.openLaser();
    },

    onConfirm() {
      if (!this.data.offsetMeters || !this.data.widthMeters) {
        wx.showToast({ title: '\u8bf7\u5148\u5b8c\u6210\u4e24\u6b65\u6d4b\u91cf', icon: 'none' });
        return;
      }

      const wallLengthMeters = Number(this.properties.wallLength || 0) / 10;
      if (this.data.offsetMeters + this.data.widthMeters > wallLengthMeters) {
        wx.showToast({ title: '\u504f\u79fb+\u5bbd\u5ea6\u8d85\u51fa\u5899\u957f', icon: 'none' });
        return;
      }

      this.triggerEvent('confirm', {
        ref: this.data.ref,
        offsetMeters: this.data.offsetMeters,
        widthMeters: this.data.widthMeters
      });
    },

    onClose() {
      this.cleanupMeasure();
      bluetooth.restoreMeasureCallback();
      this.triggerEvent('close');
    }
  }
});
