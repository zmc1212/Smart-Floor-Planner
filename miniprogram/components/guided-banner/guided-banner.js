Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    guidedMode: { type: Boolean, value: false },
    currentGuidedRoomName: { type: String, value: '' },
    guidedEdgeIndex: { type: Number, value: 0 },
    canFinish: { type: Boolean, value: false },
    bleConnected: { type: Boolean, value: false }
  },
  methods: {
    onExitGuide() { this.triggerEvent('exitguide'); },
    onStartRemeasure() { this.triggerEvent('startremeasure'); },
    onExitToLibrary() { this.triggerEvent('exittolibrary'); },
    onSubmitFloorPlan() { this.triggerEvent('submitfloorplan'); },
    onAddEdge() { this.triggerEvent('addedge'); },
    onFinishPolygon() { this.triggerEvent('finishpolygon'); }
  }
})
