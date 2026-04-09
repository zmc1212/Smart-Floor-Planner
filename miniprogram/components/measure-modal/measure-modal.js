Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    show: { type: Boolean, value: false },
    currentStep: { type: Number, value: 1 }
  },
  data: {
    selectedDirection: 'E', // 'H' | 'E' | 'S' | 'W' | 'N'
    directions: [
      { key: 'H', label: '↕ 高', desc: '测量房间层高' },
      { key: 'E', label: '→ 东', desc: '向右（横向）' },
      { key: 'S', label: '↓ 南', desc: '向下（纵向）' },
      { key: 'W', label: '← 西', desc: '向左（横向）' },
      { key: 'N', label: '↑ 北', desc: '向上（纵向）' }
    ]
  },
  observers: {
    'currentStep': function (step) {
      if (step === 0) {
        this.setData({ selectedDirection: 'H' });
      } else if (this.data.selectedDirection === 'H') {
        this.setData({ selectedDirection: 'E' });
      }
    }
  },
  methods: {
    onSelectDirection(e) {
      this.setData({ selectedDirection: e.currentTarget.dataset.dir });
    },
    onConfirm() {
      this.triggerEvent('confirm', { direction: this.data.selectedDirection });
    }
  }
});
