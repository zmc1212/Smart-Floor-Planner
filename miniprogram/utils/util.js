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
 * 多边形面积（Shoelace 公式）
 * @param {Array<{x,y}>} vertices 多边形顶点序列
 * @returns {number} 面积（单位与坐标相同的平方单位）
 */
function polygonArea(vertices) {
  var n = vertices.length;
  if (n < 3) return 0;
  var area = 0;
  for (var i = 0; i < n; i++) {
    var j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * 计算多边形顶点的包围盒
 * @param {Array<{x,y}>} vertices
 * @returns {{minX,minY,maxX,maxY,width,height}}
 */
function polygonBoundingBox(vertices) {
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (var i = 0; i < vertices.length; i++) {
    if (vertices[i].x < minX) minX = vertices[i].x;
    if (vertices[i].y < minY) minY = vertices[i].y;
    if (vertices[i].x > maxX) maxX = vertices[i].x;
    if (vertices[i].y > maxY) maxY = vertices[i].y;
  }
  return { minX: minX, minY: minY, maxX: maxX, maxY: maxY, width: maxX - minX, height: maxY - minY };
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
  CREAMY: '轻法式奶油',
  NEW_CHINESE: '新中式',
  WABI_SABI: '侘寂风',
  NORDIC: '北欧简约',
  LIGHT_LUXURY: '精致轻奢',
  INDUSTRIAL: '工业复古',
  JAPANDI: '原木风'
};

const StyleMetadata = [
  { key: 'MODERN', label: '现代简约', color: '#f8f9fa', textColor: '#333' },
  { key: 'CREAMY', label: '轻法式奶油', color: '#fdf5e6', textColor: '#8b4513' },
  { key: 'NEW_CHINESE', label: '新中式', color: '#fff5f5', textColor: '#a52a2a' },
  { key: 'WABI_SABI', label: '侘寂风', color: '#ecebe4', textColor: '#4a4a4a' },
  { key: 'NORDIC', label: '北欧简约', color: '#e0f2f1', textColor: '#00695c' },
  { key: 'LIGHT_LUXURY', label: '精致轻奢', color: '#fafafa', textColor: '#daa520' },
  { key: 'INDUSTRIAL', label: '工业复古', color: '#f5f5f5', textColor: '#37474f' },
  { key: 'JAPANDI', label: '原木风', color: '#fdfbf7', textColor: '#5d4037' }
];

const RoomTypes = ['客厅', '主卧', '次卧', '儿童房', '书房', '餐厅', '厨房', '主卫', '客卫', '阳台', '玄关'];

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
  polygonArea,
  polygonBoundingBox,
  ToolType,
  StyleType,
  StyleMetadata,
  RoomTypes,
  RoomColors,
  RoomColorsSolid
};
