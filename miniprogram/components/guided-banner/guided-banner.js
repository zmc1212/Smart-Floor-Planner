Component({
  properties: {
    guidedMode: { type: Boolean, value: false },
    currentGuidedRoomName: { type: String, value: '' },
    guidedEdgeIndex: { type: Number, value: 0 },
    edgeNames: { type: Array, value: [] }
  },
  methods: {
    onExitGuide() { this.triggerEvent('exitguide'); },
    onStartRemeasure() { this.triggerEvent('startremeasure'); },
    onExitToLibrary() { this.triggerEvent('exittolibrary'); }
  }
})
