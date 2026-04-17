var util = require('../../utils/util.js');
var ToolType = util.ToolType;
var RoomTypes = util.RoomTypes;
var layouts = require('../../utils/templates.js');

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
    }
  },

  data: {
    tools: [
      { id: 'SELECT', icon: 'select', label: '选择', iconText: '↖' },
      { id: 'SHAPE', icon: 'shape', label: '空间形状', iconText: '+' },
      { id: 'DOOR', icon: 'door', label: '门', iconText: '🚪' },
      { id: 'WINDOW', icon: 'window', label: '窗户', iconText: '▦' }
    ]
  },

  methods: {
    onToolClick: function (e) {
      var toolId = e.currentTarget.dataset.tool;
      this.triggerEvent('change', { tool: toolId });
    },

    onToggleClick: function () {
      this.triggerEvent('toggle3d');
    },

    closeMenu: function () {
    }
  }
});
