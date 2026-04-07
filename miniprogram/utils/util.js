/**
 * 工具函数
 */

/**
 * 生成 UUID v4
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * 将房间数据格式化为面积文本 (m²)
 */
function formatArea(width, height) {
  return ((width * height) / 100).toFixed(2);
}

/**
 * 格式化尺寸 (px → m)
 */
function formatDimension(px) {
  return (px / 10).toFixed(1);
}

/**
 * 网格吸附
 */
function snapToGrid(value, gridSize) {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * 枚举常量
 */
const ToolType = {
  SELECT: 'SELECT',
  ROOM: 'ROOM',
  WALL: 'WALL',
  DOOR: 'DOOR',
  WINDOW: 'WINDOW',
  ERASER: 'ERASER'
};

const StyleType = {
  MODERN: '现代简约',
  INDUSTRIAL: '工业风',
  CREAMY: '奶油风',
  JAPANDI: '原木风',
  EUROPEAN: '欧式',
  CHINESE: '中式'
};

const RoomTypes = ['客厅', '主卧', '次卧', '主卫', '次卫', '书房', '厨房'];

const RoomColors = [
  'rgba(255, 255, 255, 0.8)',
  'rgba(243, 244, 246, 0.8)',
  'rgba(219, 234, 254, 0.8)',
  'rgba(220, 252, 231, 0.8)',
  'rgba(254, 243, 199, 0.8)'
];

// 颜色 → Canvas 可用 (rgba 字符串可直接用于 Canvas fillStyle)
const RoomColorsSolid = [
  '#ffffff',
  '#f3f4f6',
  '#dbeafe',
  '#dcfce7',
  '#fef3c7'
];

module.exports = {
  generateUUID,
  formatArea,
  formatDimension,
  snapToGrid,
  ToolType,
  StyleType,
  RoomTypes,
  RoomColors,
  RoomColorsSolid
};
