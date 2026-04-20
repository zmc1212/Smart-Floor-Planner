Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    currentStep: { type: Number, value: 1 },
    lastDirection: { type: String, value: '' },
    canFinish: { type: Boolean, value: false } // 新增：是否允许闭合房间
  },
  data: {
    selectedDirection: 'H',
    availableDirections: [],
    allDirections: [
      { key: 'H', label: '↕ 高', desc: '测量房间层高' },
      { key: 'E', label: '→ 东', desc: '向右（横向）' },
      { key: 'S', label: '↓ 南', desc: '向下（纵向）' },
      { key: 'W', label: '← 西', desc: '向左（横向）' },
      { key: 'N', label: '↑ 北', desc: '向上（纵向）' },
      { key: 'ANGLE', label: '📐 斜角', desc: '非直角墙面' }
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
        var angleOption = this.data.allDirections.filter(d => d.key === 'ANGLE');
        if (lastDir === 'ANGLE') {
          // 斜角后任意方向都可以
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
        // 至少已测量1条边后，追加斜角选项
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
