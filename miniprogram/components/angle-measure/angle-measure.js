// components/angle-measure/angle-measure.js
var bluetooth = require('../../utils/bluetooth.js');
var util = require('../../utils/util.js');

Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    wallALength: { type: Number, value: 0 } // 上一条边已测则预填（米）
  },
  data: {
    step: 1,             // 1=测墙A, 2=测墙B, 3=测对角线, 4=结果
    sideA: 0,            // 墙A长度（米）
    sideB: 0,            // 墙B长度（米）
    diagonal: 0,         // 对角线长度（米）
    angleDeg: 0,         // 计算出的角度
    isValid: true,       // 角度是否有效
    isMeasuring: false,  // 当前是否正在等待测量结果
    stepLabels: ['测量墙A', '测量墙B', '测量对角线', '确认结果'],
    stepDescs: [
      '将测距仪贴紧墙角，沿第一面墙测量距离',
      '将测距仪贴紧同一墙角，沿第二面墙测量距离',
      '从墙A端点瞄准墙B端点，测量对角线距离',
      '角度计算完成，请确认结果'
    ]
  },

  observers: {
    'show': function (show) {
      if (show) {
        this.resetState();
        // 如果预填了墙A长度，直接跳到步骤2
        if (this.properties.wallALength > 0) {
          this.setData({
            step: 2,
            sideA: this.properties.wallALength
          });
        }
        // 接管蓝牙回调
        var that = this;
        bluetooth.setTemporaryMeasureCallback(function (dist) {
          that.onBLEMeasure(dist);
        });
        // 自动开启激光
        this.openLaser();
      } else {
        // 还原蓝牙回调
        bluetooth.restoreMeasureCallback();
      }
    }
  },

  methods: {
    resetState: function () {
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

    openLaser: function () {
      console.log('[角度测量] 开启激光...');
      bluetooth.sendBLECommand('ATK001#');
    },

    triggerMeasure: function () {
      if (this.data.isMeasuring) return;
      this.setData({ isMeasuring: true });

      var that = this;
      bluetooth.clearBuffer();
      bluetooth.sendBLECommand('ATK001#');

      this._measureTimer = setTimeout(function () {
        bluetooth.sendBLECommand('ATD001#');
        that._failTimer = setTimeout(function () {
          that.onBLEMeasure(null);
        }, 4000);
      }, 3500);
    },

    onBLEMeasure: function (distanceInMeters) {
      this.setData({ isMeasuring: false });
      if (this._measureTimer) { clearTimeout(this._measureTimer); this._measureTimer = null; }
      if (this._failTimer) { clearTimeout(this._failTimer); this._failTimer = null; }

      if (distanceInMeters === null || distanceInMeters <= 0) {
        wx.showToast({ title: '测量失败，请重试', icon: 'none' });
        // 重新开启激光供再次测量
        var that = this;
        setTimeout(function () { that.openLaser(); }, 800);
        return;
      }

      var step = this.data.step;

      if (step === 1) {
        this.setData({ sideA: distanceInMeters, step: 2 });
        wx.showToast({ title: '墙A: ' + distanceInMeters.toFixed(3) + 'm ✓', icon: 'success' });
        var that = this;
        setTimeout(function () { that.openLaser(); }, 600);

      } else if (step === 2) {
        this.setData({ sideB: distanceInMeters, step: 3 });
        wx.showToast({ title: '墙B: ' + distanceInMeters.toFixed(3) + 'm ✓', icon: 'success' });
        var that = this;
        setTimeout(function () { that.openLaser(); }, 600);

      } else if (step === 3) {
        this.setData({ diagonal: distanceInMeters });

        var a = this.data.sideA;
        var b = this.data.sideB;
        var d = distanceInMeters;
        var angle = util.calculateAngle(a, b, d);

        if (isNaN(angle)) {
          this.setData({ isValid: false, step: 4, angleDeg: 0 });
          wx.showToast({ title: '数据不合理，请重测', icon: 'none' });
        } else {
          this.setData({
            isValid: true,
            step: 4,
            angleDeg: Math.round(angle * 10) / 10
          });
          wx.showToast({ title: '角度: ' + angle.toFixed(1) + '° ✓', icon: 'success' });
        }
      }
    },

    // 手动触发测量按钮
    onMeasureTap: function () {
      this.triggerMeasure();
    },

    // 重测当前步骤
    onRetry: function () {
      if (this.data.step === 4) {
        // 回退到步骤1重来
        this.resetState();
        if (this.properties.wallALength > 0) {
          this.setData({ step: 2, sideA: this.properties.wallALength });
        }
        this.openLaser();
      } else {
        this.openLaser();
      }
    },

    // 重测单步
    onRetryStep: function (e) {
      var targetStep = parseInt(e.currentTarget.dataset.step);
      this.setData({ step: targetStep });
      var that = this;
      setTimeout(function () { that.openLaser(); }, 300);
    },

    // 确认结果
    onConfirm: function () {
      if (!this.data.isValid) {
        wx.showToast({ title: '角度无效，请重新测量', icon: 'none' });
        return;
      }
      this.triggerEvent('confirm', {
        angle: this.data.angleDeg,
        wallLength: this.data.sideB, // 新墙长度=墙B
        sideA: this.data.sideA,
        sideB: this.data.sideB,
        diagonal: this.data.diagonal
      });
    },

    onClose: function () {
      bluetooth.restoreMeasureCallback();
      this.triggerEvent('close');
    }
  }
});
