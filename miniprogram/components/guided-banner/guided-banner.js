Component({
  properties: {
    guidedMode: { type: Boolean, value: false },
    currentGuidedRoomName: { type: String, value: '' },
    guidedEdgeIndex: { type: Number, value: 0 },
    canFinish: { type: Boolean, value: false }
  },
  methods: {
    onExitGuide() { this.triggerEvent('exitguide'); },
    onStartRemeasure() { this.triggerEvent('startremeasure'); },
    onExitToLibrary() { this.triggerEvent('exittolibrary'); },
    onAddEdge() { this.triggerEvent('addedge'); },
    onFinishPolygon() { this.triggerEvent('finishpolygon'); }
  }
})
