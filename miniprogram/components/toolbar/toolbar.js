var util = require('../../utils/util.js');
var ToolType = util.ToolType;
var RoomTypes = util.RoomTypes;
var layouts = require('../../utils/templates.js');

Component({
  properties: {
    activeTool: {
      type: String,
      value: 'SELECT'
    },
    currentRoomType: {
      type: String,
      value: '客厅'
    }
  },

  data: {
    isMenuOpen: false,
    isTemplateMenuOpen: false,
    roomTypes: RoomTypes,
    layoutTemplates: layouts.templates,
    tools: [
      { id: 'SELECT', icon: 'select', label: '选择', iconText: '↖' },
      { id: 'ROOM', icon: 'room', label: '绘制房间', iconText: '☐' },
      { id: 'TEMPLATE', icon: 'template', label: '户型库', iconText: '⊞' },
      { id: 'DOOR', icon: 'door', label: '门', iconText: '🚪' },
      { id: 'WINDOW', icon: 'window', label: '窗户', iconText: '▦' },
      { id: 'ERASER', icon: 'eraser', label: '橡皮擦', iconText: '✎' }
    ]
  },

  observers: {
    'activeTool': function (val) {
      if (val !== 'ROOM') {
        this.setData({ isMenuOpen: false });
      }
      if (val !== 'TEMPLATE') {
        this.setData({ isTemplateMenuOpen: false });
      }
    }
  },

  methods: {
    onToolClick: function (e) {
      var toolId = e.currentTarget.dataset.tool;
      if (toolId === 'ROOM') {
        if (this.properties.activeTool === 'ROOM') {
          // 只在二次点击时打开菜单
          this.setData({ isMenuOpen: !this.data.isMenuOpen, isTemplateMenuOpen: false });
        } else {
          this.triggerEvent('toolchange', { tool: 'ROOM' });
          this.setData({ isTemplateMenuOpen: false });
        }
      } else if (toolId === 'TEMPLATE') {
        if (this.properties.activeTool === 'TEMPLATE') {
          this.setData({ isTemplateMenuOpen: !this.data.isTemplateMenuOpen, isMenuOpen: false });
        } else {
          this.triggerEvent('toolchange', { tool: 'TEMPLATE' });
          this.setData({ isTemplateMenuOpen: true, isMenuOpen: false });
        }
      } else {
        this.triggerEvent('toolchange', { tool: toolId });
        this.setData({ isMenuOpen: false, isTemplateMenuOpen: false });
      }
    },

    onRoomTypeClick: function (e) {
      var type = e.currentTarget.dataset.type;
      this.triggerEvent('roomtypechange', { type: type });
      this.setData({ isMenuOpen: false });
    },

    onTemplateClick: function (e) {
      var templateId = e.currentTarget.dataset.id;
      this.triggerEvent('addtemplate', { templateId: templateId });
      this.setData({ isTemplateMenuOpen: false });
      this.triggerEvent('toolchange', { tool: 'SELECT' });
    },

    closeMenu: function () {
      this.setData({ isMenuOpen: false, isTemplateMenuOpen: false });
    }
  }
});
