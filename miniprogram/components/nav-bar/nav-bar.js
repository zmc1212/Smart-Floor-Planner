Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    navBarHeightTotal: { type: Number, value: 0 },
    statusBarHeight: { type: Number, value: 0 },
    capsulePadding: { type: Number, value: 0 },
    canUndo: { type: Boolean, value: false },
    canRedo: { type: Boolean, value: false },
    showHistory: { type: Boolean, value: true },
    showClear: { type: Boolean, value: false },
    bleConnected: { type: Boolean, value: false }
  },
  methods: {
    onUndo() { this.triggerEvent('undo'); },
    onRedo() { this.triggerEvent('redo'); },
    onClear() { this.triggerEvent('clear'); },
    onExport() { this.triggerEvent('export'); }
  }
})
