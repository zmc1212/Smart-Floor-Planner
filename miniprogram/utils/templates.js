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

var shapeTemplates = [
  {
    id: 'rect',
    name: '矩形空间',
    points: [
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }
    ]
  },
  {
    id: 'l-shape',
    name: 'L型空间',
    points: [
      { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 25, y: 25 }, { x: 25, y: 40 }, { x: 0, y: 40 }
    ]
  },
  {
    id: 'u-shape',
    name: 'U型空间',
    points: [
      { x: 0, y: 0 }, { x: 45, y: 0 }, { x: 45, y: 40 }, { x: 30, y: 40 }, { x: 30, y: 15 }, { x: 15, y: 15 }, { x: 15, y: 40 }, { x: 0, y: 40 }
    ]
  }
];

function generateShapeRoom(shapeId, type, startX, startY) {
  var shape = shapeTemplates.find(s => s.id === shapeId);
  if (!shape) return null;

  return {
    id: util.generateUUID(),
    name: type,
    x: startX,
    y: startY,
    polygon: JSON.parse(JSON.stringify(shape.points)),
    color: 'rgba(255, 255, 255, 0.8)',
    measured: false,
    openings: []
  };
}

function generateTemplateRooms(templateId) {
  var template = templates.find(t => t.id === templateId);
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
  shapeTemplates: shapeTemplates,
  generateTemplate: generateTemplate,
  generateTemplateRooms: generateTemplateRooms,
  generateShapeRoom: generateShapeRoom
};
