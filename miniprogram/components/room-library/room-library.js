Component({
  properties: {
    plannedRooms: { type: Array, value: [] },
    layoutTemplates: { type: Array, value: [] }
  },
  methods: {
    onSelectLayout(e) { this.triggerEvent('selectlayout', { id: e.currentTarget.dataset.id }); },
    onResetLayout() { this.triggerEvent('resetlayout'); },
    onEnterRoom(e) { this.triggerEvent('enterroom', { id: e.currentTarget.dataset.id }); }
  }
})
