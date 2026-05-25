var util = require('./util.js');

var WHOLE_HOME_MODE = 'whole_home';
var LAYOUT_VERSION = 2;
var CLOSE_TOLERANCE = 2; // 0.20m because internal geometry is 1m = 10 units.
var DEFAULT_ROOM_NAMES = ['客餐厅', '主卧', '次卧', '厨房', '卫生间', '阳台', '玄关', '储物间'];

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function toNumber(value, fallback) {
  var num = parseFloat(value);
  return isFinite(num) ? num : fallback;
}

function parseLayoutData(layoutData) {
  var parsed = layoutData;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      parsed = [];
    }
  }

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return {
      version: parsed.version || 1,
      measurementMode: parsed.measurementMode || 'room',
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
      homeOutline: parsed.homeOutline || null,
      partitions: Array.isArray(parsed.partitions) ? parsed.partitions : [],
      draftState: parsed.draftState || null
    };
  }

  return {
    version: 1,
    measurementMode: 'room',
    rooms: Array.isArray(parsed) ? parsed : (parsed ? [parsed] : []),
    homeOutline: null,
    partitions: [],
    draftState: null
  };
}

function createEmptyLayout(rooms) {
  return {
    version: LAYOUT_VERSION,
    measurementMode: WHOLE_HOME_MODE,
    rooms: Array.isArray(rooms) ? rooms : [],
    homeOutline: null,
    partitions: [],
    draftState: null
  };
}

function distance(a, b) {
  var dx = (b.x || 0) - (a.x || 0);
  var dy = (b.y || 0) - (a.y || 0);
  return Math.sqrt(dx * dx + dy * dy);
}

function polygonBoundingBox(points) {
  if (!points || !points.length) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, height: 1 };
  }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach(function (p) {
    minX = Math.min(minX, toNumber(p.x, 0));
    minY = Math.min(minY, toNumber(p.y, 0));
    maxX = Math.max(maxX, toNumber(p.x, 0));
    maxY = Math.max(maxY, toNumber(p.y, 0));
  });
  return {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function snapClosedPoints(points, tolerance) {
  var pts = clone(points || []);
  var closeTolerance = tolerance === undefined ? CLOSE_TOLERANCE : tolerance;
  if (pts.length < 4) {
    return { points: pts, closed: false, gap: Infinity };
  }

  var gap = distance(pts[0], pts[pts.length - 1]);
  if (gap <= closeTolerance) {
    pts.pop();
    return { points: pts, closed: true, gap: gap };
  }

  return { points: pts, closed: false, gap: gap };
}

function buildOutlineFromPoints(points, options) {
  var opts = options || {};
  var rawPoints = clone(points || []);
  var bbox = polygonBoundingBox(rawPoints);
  var polygon = rawPoints.map(function (p) {
    return {
      x: Math.round((toNumber(p.x, 0) - bbox.minX) * 100) / 100,
      y: Math.round((toNumber(p.y, 0) - bbox.minY) * 100) / 100
    };
  });

  return {
    id: opts.id || 'home-outline',
    name: opts.name || '全屋外轮廓',
    x: Math.round(bbox.minX * 100) / 100,
    y: Math.round(bbox.minY * 100) / 100,
    width: Math.max(1, Math.round(bbox.width * 100) / 100),
    height: Math.max(1, Math.round(bbox.height * 100) / 100),
    polygon: polygon,
    polygonClosed: !!opts.closed,
    measured: !!opts.closed,
    height3D: opts.height3D || 0,
    color: 'rgba(219, 234, 254, 0.24)',
    startMarker: {
      type: 'entry',
      pointIndex: 0,
      direction: 'clockwise'
    }
  };
}

function getAbsolutePolygon(outline) {
  if (!outline || !Array.isArray(outline.polygon)) return [];
  var ox = toNumber(outline.x, 0);
  var oy = toNumber(outline.y, 0);
  return outline.polygon.map(function (p) {
    return { x: ox + toNumber(p.x, 0), y: oy + toNumber(p.y, 0) };
  });
}

function makeOutlineRoom(outline) {
  if (!outline) return null;
  return Object.assign({}, outline, {
    id: outline.id || 'home-outline',
    name: outline.name || '全屋外轮廓',
    isHomeOutline: true,
    measured: !!outline.polygonClosed,
    color: outline.color || 'rgba(219, 234, 254, 0.22)'
  });
}

function normalizePartition(points, id) {
  var pts = clone(points || []);
  if (pts.length < 2) return null;
  return {
    id: id || util.generateUUID(),
    points: [
      { x: Math.round(toNumber(pts[0].x, 0) * 100) / 100, y: Math.round(toNumber(pts[0].y, 0) * 100) / 100 },
      { x: Math.round(toNumber(pts[1].x, 0) * 100) / 100, y: Math.round(toNumber(pts[1].y, 0) * 100) / 100 }
    ],
    source: 'manual',
    wallType: 'interior'
  };
}

function uniqueSorted(values) {
  var rounded = {};
  values.forEach(function (value) {
    var key = Math.round(value * 100) / 100;
    rounded[key] = true;
  });
  return Object.keys(rounded).map(Number).sort(function (a, b) { return a - b; });
}

function buildRoomsFromOutlineAndPartitions(outline, partitions, existingRooms) {
  if (!outline || !outline.polygon || outline.polygon.length < 3 || !outline.polygonClosed) {
    return Array.isArray(existingRooms) ? existingRooms : [];
  }

  var absPoly = getAbsolutePolygon(outline);
  var bbox = polygonBoundingBox(absPoly);
  var xs = [bbox.minX, bbox.maxX];
  var ys = [bbox.minY, bbox.maxY];
  var safePartitions = Array.isArray(partitions) ? partitions : [];

  safePartitions.forEach(function (partition) {
    var pts = partition.points || [];
    if (pts.length < 2) return;
    var a = pts[0];
    var b = pts[1];
    var dx = Math.abs(toNumber(a.x, 0) - toNumber(b.x, 0));
    var dy = Math.abs(toNumber(a.y, 0) - toNumber(b.y, 0));
    if (dx <= 1 && dy > 5) {
      var x = (toNumber(a.x, 0) + toNumber(b.x, 0)) / 2;
      if (x > bbox.minX + 1 && x < bbox.maxX - 1) xs.push(x);
    } else if (dy <= 1 && dx > 5) {
      var y = (toNumber(a.y, 0) + toNumber(b.y, 0)) / 2;
      if (y > bbox.minY + 1 && y < bbox.maxY - 1) ys.push(y);
    }
  });

  xs = uniqueSorted(xs);
  ys = uniqueSorted(ys);

  var previousRooms = (Array.isArray(existingRooms) ? existingRooms : []).filter(function (room) {
    return !room.isHomeOutline;
  });
  var rooms = [];

  for (var yi = 0; yi < ys.length - 1; yi++) {
    for (var xi = 0; xi < xs.length - 1; xi++) {
      var x1 = xs[xi];
      var x2 = xs[xi + 1];
      var y1 = ys[yi];
      var y2 = ys[yi + 1];
      if (x2 - x1 < 5 || y2 - y1 < 5) continue;
      var centerX = (x1 + x2) / 2;
      var centerY = (y1 + y2) / 2;
      if (!util.isPointInPolygon(absPoly, centerX, centerY)) continue;

      var previous = previousRooms[rooms.length] || {};
      rooms.push({
        id: previous.id || util.generateUUID(),
        name: previous.name || DEFAULT_ROOM_NAMES[rooms.length] || ('空间 ' + (rooms.length + 1)),
        x: Math.round(x1 * 100) / 100,
        y: Math.round(y1 * 100) / 100,
        width: Math.round((x2 - x1) * 100) / 100,
        height: Math.round((y2 - y1) * 100) / 100,
        polygon: [
          { x: 0, y: 0 },
          { x: Math.round((x2 - x1) * 100) / 100, y: 0 },
          { x: Math.round((x2 - x1) * 100) / 100, y: Math.round((y2 - y1) * 100) / 100 },
          { x: 0, y: Math.round((y2 - y1) * 100) / 100 }
        ],
        polygonClosed: true,
        measured: true,
        color: previous.color || 'rgba(255, 255, 255, 0.8)',
        height3D: previous.height3D || outline.height3D || 28,
        openings: previous.openings || []
      });
    }
  }

  if (!rooms.length) {
    var singlePrevious = previousRooms[0] || {};
    rooms.push({
      id: singlePrevious.id || util.generateUUID(),
      name: singlePrevious.name || DEFAULT_ROOM_NAMES[0],
      x: outline.x,
      y: outline.y,
      width: outline.width,
      height: outline.height,
      polygon: clone(outline.polygon),
      polygonClosed: true,
      measured: true,
      color: singlePrevious.color || 'rgba(255, 255, 255, 0.8)',
      height3D: singlePrevious.height3D || outline.height3D || 28,
      openings: singlePrevious.openings || []
    });
  }

  return rooms;
}

function buildLayoutData(state, status) {
  var draftState = null;
  if (status === 'draft') {
    draftState = {
      stage: state.wholeHomeStage || 'outline',
      measurePoints: state.measurePoints || [],
      guidedEdgeIndex: state.guidedEdgeIndex,
      currentGuidedRoomId: state.currentGuidedRoomId || '',
      pendingDirection: state.pendingDirection || '',
      lastMeasuredDirection: state.lastMeasuredDirection || '',
      activePartitionId: state.activePartitionId || '',
      wholeHomeHeight3D: state.wholeHomeHeight3D || 0
    };
  }

  return {
    version: LAYOUT_VERSION,
    measurementMode: WHOLE_HOME_MODE,
    rooms: state.rooms || [],
    homeOutline: state.homeOutline || null,
    partitions: state.partitions || [],
    draftState: draftState
  };
}

module.exports = {
  WHOLE_HOME_MODE: WHOLE_HOME_MODE,
  LAYOUT_VERSION: LAYOUT_VERSION,
  CLOSE_TOLERANCE: CLOSE_TOLERANCE,
  parseLayoutData: parseLayoutData,
  createEmptyLayout: createEmptyLayout,
  snapClosedPoints: snapClosedPoints,
  buildOutlineFromPoints: buildOutlineFromPoints,
  getAbsolutePolygon: getAbsolutePolygon,
  makeOutlineRoom: makeOutlineRoom,
  normalizePartition: normalizePartition,
  buildRoomsFromOutlineAndPartitions: buildRoomsFromOutlineAndPartitions,
  buildLayoutData: buildLayoutData
};
