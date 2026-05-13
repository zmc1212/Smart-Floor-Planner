Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    currentStep: { type: Number, value: 1 },
    lastDirection: { type: String, value: '' },
    canFinish: { type: Boolean, value: false }
  },
  data: {
    selectedDirection: 'H',
    availableDirections: [],
    allDirections: [
      { key: 'H', label: '\u5c42\u9ad8', desc: '\u6d4b\u91cf\u623f\u95f4\u5c42\u9ad8' },
      { key: 'E', label: '\u4e1c\u5411', desc: '\u5411\u53f3\uff08\u6a2a\u5411\uff09' },
      { key: 'S', label: '\u5357\u5411', desc: '\u5411\u4e0b\uff08\u7eb5\u5411\uff09' },
      { key: 'W', label: '\u897f\u5411', desc: '\u5411\u5de6\uff08\u6a2a\u5411\uff09' },
      { key: 'N', label: '\u5317\u5411', desc: '\u5411\u4e0a\uff08\u7eb5\u5411\uff09' },
      { key: 'ANGLE', label: '\u659c\u89d2', desc: '\u975e\u76f4\u89d2\u5899\u9762' }
    ]
  },
  observers: {
    'show, currentStep, lastDirection': function (show, step, lastDir) {
      if (!show) return;

      let available = [];
      let defaultSelect = 'E';

      if (step === 0) {
        available = this.data.allDirections.filter(d => d.key === 'H');
        defaultSelect = 'H';
      } else {
        const angleOption = this.data.allDirections.filter(d => d.key === 'ANGLE');
        if (lastDir === 'ANGLE') {
          available = this.data.allDirections.filter(d => d.key !== 'H' && d.key !== 'ANGLE');
          defaultSelect = 'E';
        } else if (lastDir === 'E' || lastDir === 'W') {
          available = this.data.allDirections.filter(d => d.key === 'S' || d.key === 'N');
          defaultSelect = 'S';
        } else if (lastDir === 'S' || lastDir === 'N') {
          available = this.data.allDirections.filter(d => d.key === 'E' || d.key === 'W');
          defaultSelect = 'E';
        } else {
          available = this.data.allDirections.filter(d => d.key !== 'H' && d.key !== 'ANGLE');
          defaultSelect = 'E';
        }
        if (step >= 2) {
          available = available.concat(angleOption);
        }
      }

      this.setData({
        availableDirections: available,
        selectedDirection: defaultSelect
      });
    }
  },
  methods: {
    onSelectDirection(e) {
      this.setData({ selectedDirection: e.currentTarget.dataset.dir });
    },
    onConfirm() {
      if (this.data.selectedDirection === 'ANGLE') {
        this.triggerEvent('startangle');
      } else {
        this.triggerEvent('confirm', { direction: this.data.selectedDirection });
      }
    },
    onFinish() {
      this.triggerEvent('finish');
    },
    onClose() {
      this.triggerEvent('close');
    }
  }
});
