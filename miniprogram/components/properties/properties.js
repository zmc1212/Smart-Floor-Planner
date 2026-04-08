var util = require('../../utils/util.js');
var renderingService = require('../../utils/renderingService.js');

var StyleType = util.StyleType;
var RoomTypes = util.RoomTypes;
var RoomColors = util.RoomColors;

Component({
  properties: {
    selectedRooms: { type: Array, value: [] },
    visible: { type: Boolean, value: false },
    selectedEdge: { type: String, value: '' }
  },

  data: {
    roomColors: RoomColors
  },

  methods: {
    // === 基本操作 ===
    onClose: function () {
      this.triggerEvent('close');
    },

    onDelete: function () {
      this.triggerEvent('delete');
    },

    onMerge: function () {
      this.triggerEvent('merge');
    },

    toggleCollapse: function () {
      this.setData({ isCollapsed: !this.data.isCollapsed });
    },

    // === 房间属性修改 ===
    onNameInput: function (e) {
      var room = this.properties.selectedRooms[0];
      if (!room) return;
      this.triggerEvent('update', { id: room.id, updates: { name: e.detail.value } });
    },

    onWidthInput: function (e) {
      var room = this.properties.selectedRooms[0];
      if (!room) return;
      var val = parseFloat(e.detail.value);
      if (!isNaN(val) && val > 0) {
        this.triggerEvent('update', { id: room.id, updates: { width: val * 10 } });
      }
    },

    onHeightInput: function (e) {
      if (this.properties.selectedRooms.length === 1) {
        var num = parseFloat(e.detail.value);
        if (!isNaN(num) && num > 0) {
          this.triggerEvent('update', {
            id: this.properties.selectedRooms[0].id,
            updates: { height: num * 10 }
          });
        }
      }
    },

    onEdgeSelect: function(e) {
      this.triggerEvent('edgeselect', { edge: e.currentTarget.dataset.edge });
    },

    onColorSelect: function (e) {
      var color = e.currentTarget.dataset.color;
      var room = this.properties.selectedRooms[0];
      if (!room) return;
      this.triggerEvent('update', { id: room.id, updates: { color: color } });
    },

    // === 门窗管理 ===
    onDeleteOpening: function (e) {
      var openingId = e.currentTarget.dataset.id;
      var room = this.properties.selectedRooms[0];
      if (!room) return;
      var newOpenings = (room.openings || []).filter(function (o) { return o.id !== openingId; });
      this.triggerEvent('update', { id: room.id, updates: { openings: newOpenings } });
    },

    onHighlightOpening: function (e) {
      var id = e.currentTarget.dataset.id;
      this.triggerEvent('highlightopening', { id: id });
    },

    onUnhighlightOpening: function () {
      this.triggerEvent('highlightopening', { id: '' });
    },

    onOpeningWidthInput: function (e) {
      var openingId = e.currentTarget.dataset.id;
      var room = this.properties.selectedRooms[0];
      if (!room) return;
      var val = parseFloat(e.detail.value);
      if (isNaN(val) || val <= 0) return;
      var newOpenings = (room.openings || []).map(function (o) {
        return o.id === openingId ? Object.assign({}, o, { width: val * 10 }) : o;
      });
      this.triggerEvent('update', { id: room.id, updates: { openings: newOpenings } });
    },

    onOpeningHeightInput: function (e) {
      var openingId = e.currentTarget.dataset.id;
      var room = this.properties.selectedRooms[0];
      if (!room) return;
      var val = parseFloat(e.detail.value);
      if (isNaN(val) || val <= 0) return;
      var newOpenings = (room.openings || []).map(function (o) {
        return o.id === openingId ? Object.assign({}, o, { height: val * 10 }) : o;
      });
      this.triggerEvent('update', { id: room.id, updates: { openings: newOpenings } });
    },

    isPresetName: function (name) {
      return RoomTypes.indexOf(name) !== -1;
    }
  }
});
