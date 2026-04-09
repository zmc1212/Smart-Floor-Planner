Component({
  properties: {
    show: { type: Boolean, value: false },
    currentStep: { type: Number, value: 1 }
  },
  data: {
    selectedDirection: 'E', // 'E' | 'S' | 'W' | 'N'
    directions: [
      { key: 'E', label: '→ 东', desc: '向右（横向）' },
      { key: 'S', label: '↓ 南', desc: '向下（纵向）' },
      { key: 'W', label: '← 西', desc: '向左（横向）' },
      { key: 'N', label: '↑ 北', desc: '向上（纵向）' }
    ]
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
