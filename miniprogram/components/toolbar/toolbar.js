Component({
  options: {
    styleIsolation: 'apply-shared'
  },
  properties: {
    activeTool: {
      type: String,
      value: 'SELECT'
    },
    currentRoomType: {
      type: String,
      value: '客厅'
    },
    is3DView: {
      type: Boolean,
      value: false
    },
    canUndo: {
      type: Boolean,
      value: false
    },
    canRedo: {
      type: Boolean,
      value: false
    }
  },

  data: {
    tools: [
      { id: 'SELECT', icon: 'select', label: '选择', iconText: '选' },
      { id: 'SHAPE', icon: 'shape', label: '空间', iconText: '+' },
      { id: 'PARTITION', icon: 'partition', label: '内墙', iconText: '墙' },
      { id: 'DOOR', icon: 'door', label: '门', iconText: '门' },
      { id: 'WINDOW', icon: 'window', label: '窗户', iconText: '窗' }
    ]
  },

  methods: {
    onUndo: function () {
      if (this.data.canUndo) this.triggerEvent('undo');
    },
    onRedo: function () {
      if (this.data.canRedo) this.triggerEvent('redo');
    },
    onToolClick: function (e) {
      var toolId = e.currentTarget.dataset.tool;
      this.triggerEvent('change', { tool: toolId });
    },

    onToggleClick: function () {
      this.triggerEvent('toggle3d');
    },

    closeMenu: function () {}
  }
});
