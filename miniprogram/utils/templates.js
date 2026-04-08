var util = require('./util.js');

var templates = [
  {
    id: '1b1l',
    name: '一室一厅',
    rooms: [
      { name: '客厅', width: 40, height: 40, x: 0, y: 0, color: 'rgba(255, 255, 255, 0.8)' },
      { name: '卧室', width: 30, height: 30, x: 0, y: -30, color: 'rgba(255, 255, 255, 0.8)' }
    ]
  },
  {
    id: '2b1l',
    name: '二室一厅',
    rooms: [
      { name: '客厅', width: 40, height: 40, x: 0, y: 0, color: 'rgba(255, 255, 255, 0.8)' },
      { name: '主卧', width: 30, height: 40, x: 40, y: 0, color: 'rgba(255, 255, 255, 0.8)' },
      { name: '次卧', width: 30, height: 30, x: 0, y: -30, color: 'rgba(255, 255, 255, 0.8)' }
    ]
  },
  {
    id: '3b1l',
    name: '三室一厅',
    rooms: [
      { name: '客厅', width: 40, height: 50, x: 0, y: 0, color: 'rgba(255, 255, 255, 0.8)' },
      { name: '主卧', width: 30, height: 40, x: 40, y: 0, color: 'rgba(255, 255, 255, 0.8)' },
      { name: '次卧', width: 30, height: 30, x: 0, y: -30, color: 'rgba(255, 255, 255, 0.8)' },
      { name: '客房', width: 30, height: 30, x: 40, y: 40, color: 'rgba(255, 255, 255, 0.8)' }
    ]
  }
];

function generateTemplate(templateId, startX, startY) {
  var template = null;
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === templateId) {
      template = templates[i];
      break;
    }
  }
  if (!template) return [];

  var result = [];
  for (var j = 0; j < template.rooms.length; j++) {
    var r = template.rooms[j];
    result.push({
      id: util.generateUUID(),
      x: startX + r.x,
      y: startY + r.y,
      width: r.width,
      height: r.height,
      name: r.name,
      color: r.color,
      openings: []
    });
  }
  return result;
}

function generateTemplateRooms(templateId) {
  var template = null;
  for (var i = 0; i < templates.length; i++) {
    if (templates[i].id === templateId) {
      template = templates[i];
      break;
    }
  }
  if (!template) return [];

  var result = [];
  for (var j = 0; j < template.rooms.length; j++) {
    var r = template.rooms[j];
    result.push({
      id: util.generateUUID(),
      name: r.name,
      measured: false,
      color: r.color,
      defaultWidth: 40,
      defaultHeight: 40
    });
  }
  return result;
}

module.exports = {
  templates: templates,
  generateTemplate: generateTemplate,
  generateTemplateRooms: generateTemplateRooms
};
