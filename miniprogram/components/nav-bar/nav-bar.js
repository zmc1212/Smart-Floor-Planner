Component({
  properties: {
    navBarHeightTotal: { type: Number, value: 0 },
    statusBarHeight: { type: Number, value: 0 },
    capsulePadding: { type: Number, value: 0 },
    canUndo: { type: Boolean, value: false },
    canRedo: { type: Boolean, value: false },
    showHistory: { type: Boolean, value: true }
  },
  methods: {
    onUndo() { this.triggerEvent('undo'); },
    onRedo() { this.triggerEvent('redo'); },
    onExport() { this.triggerEvent('export'); }
  }
})
