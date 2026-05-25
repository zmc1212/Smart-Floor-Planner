var DEFAULT_OPENING_WIDTHS = {
  DOOR: 10,
  WINDOW: 15
};

var DEFAULT_OPENING_HEIGHTS = {
  DOOR: 20,
  WINDOW: 12
};

var EPSILON = 0.0001;

function toNumber(value, fallback) {
  var num = parseFloat(value);
  return isFinite(num) ? num : fallback;
}

function round(value, precision) {
  var factor = Math.pow(10, precision || 2);
  return Math.round(value * factor) / factor;
}

function distance(p1, p2) {
  var dx = p2.x - p1.x;
  var dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeToolType(toolType) {
  return toolType === 'DOOR' ? 'DOOR' : 'WINDOW';
}

function getDefaultOpeningWidth(toolType) {
  return DEFAULT_OPENING_WIDTHS[normalizeToolType(toolType)] || DEFAULT_OPENING_WIDTHS.WINDOW;
}

function getDefaultOpeningHeight(toolType) {
  return DEFAULT_OPENING_HEIGHTS[normalizeToolType(toolType)] || DEFAULT_OPENING_HEIGHTS.WINDOW;
}

function buildWall(room, type, side, index, localP1, localP2) {
  var rx = toNumber(room.x, 0);
  var ry = toNumber(room.y, 0);
  var p1 = { x: rx + localP1.x, y: ry + localP1.y };
  var p2 = { x: rx + localP2.x, y: ry + localP2.y };
  var len = distance(p1, p2);
  var angleRad = Math.atan2(p2.y - p1.y, p2.x - p1.x);

  return {
    roomId: room.id,
    type: type,
    side: side || '',
    index: index,
    localP1: localP1,
    localP2: localP2,
    p1: p1,
    p2: p2,
    length: len,
    angleRad: angleRad,
    angleDeg: angleRad * 180 / Math.PI,
    rotation: Math.abs(p2.y - p1.y) > Math.abs(p2.x - p1.x) ? 90 : 0
  };
}

function getRectWalls(room) {
  var width = toNumber(room.width !== undefined ? room.width : room.w, toNumber(room.defaultWidth, 40));
  var height = toNumber(room.height !== undefined ? room.height : room.h, toNumber(room.defaultHeight, 40));

  return [
    buildWall(room, 'rect', 'top', 0, { x: 0, y: 0 }, { x: width, y: 0 }),
    buildWall(room, 'rect', 'right', 1, { x: width, y: 0 }, { x: width, y: height }),
    buildWall(room, 'rect', 'bottom', 2, { x: 0, y: height }, { x: width, y: height }),
    buildWall(room, 'rect', 'left', 3, { x: 0, y: 0 }, { x: 0, y: height })
  ];
}

function getPolygonWalls(room) {
  var poly = room.polygon || [];
  var walls = [];
  if (poly.length < 2) return walls;

  var edgeCount = room.polygonClosed ? poly.length : poly.length - 1;
  for (var i = 0; i < edgeCount; i++) {
    var next = (i + 1) % poly.length;
    walls.push(buildWall(room, 'polygon', '', i, poly[i], poly[next]));
  }
  return walls;
}

function getRoomWalls(room) {
  if (room && room.polygon && room.polygon.length >= 2) {
    return getPolygonWalls(room);
  }
  return getRectWalls(room || {});
}

function projectPointToWall(point, wall) {
  var dx = wall.p2.x - wall.p1.x;
  var dy = wall.p2.y - wall.p1.y;
  var lenSq = dx * dx + dy * dy;
  if (lenSq <= EPSILON) {
    return {
      point: { x: wall.p1.x, y: wall.p1.y },
      along: 0,
      t: 0,
      distance: distance(point, wall.p1)
    };
  }

  var rawT = ((point.x - wall.p1.x) * dx + (point.y - wall.p1.y) * dy) / lenSq;
  var t = clamp(rawT, 0, 1);
  var projected = {
    x: wall.p1.x + dx * t,
    y: wall.p1.y + dy * t
  };

  return {
    point: projected,
    along: wall.length * t,
    t: t,
    distance: distance(point, projected)
  };
}

function findNearestWall(rooms, point, currentRoomId, tolerance) {
  var best = null;
  var maxDistance = tolerance || 15;
  var sourceRooms = Array.isArray(rooms) ? rooms : [];

  for (var i = 0; i < sourceRooms.length; i++) {
    var room = sourceRooms[i];
    if (currentRoomId && room.id !== currentRoomId) continue;

    var walls = getRoomWalls(room);
    for (var j = 0; j < walls.length; j++) {
      var wall = walls[j];
      if (!wall.length) continue;
      var projected = projectPointToWall(point, wall);
      if (projected.distance <= maxDistance && (!best || projected.distance < best.distance)) {
        best = {
          room: room,
          wall: wall,
          point: projected.point,
          along: projected.along,
          distance: projected.distance,
          reference: projected.along <= wall.length / 2 ? 'start' : 'end'
        };
      }
    }
  }

  return best;
}

function getWallLabel(wall) {
  if (!wall) return '';
  if (wall.type === 'polygon') return '\u7b2c ' + (wall.index + 1) + ' \u6bb5\u5899';
  var labels = {
    top: '\u4e0a\u5899',
    right: '\u53f3\u5899',
    bottom: '\u4e0b\u5899',
    left: '\u5de6\u5899'
  };
  return labels[wall.side] || wall.side || '';
}

function serializeWall(wall) {
  return {
    type: wall.type,
    side: wall.side || '',
    index: wall.index,
    length: round(wall.length, 2),
    start: { x: round(wall.localP1.x, 2), y: round(wall.localP1.y, 2) },
    end: { x: round(wall.localP2.x, 2), y: round(wall.localP2.y, 2) }
  };
}

function pointAtWallOffset(wall, offset) {
  var safeOffset = wall.length <= EPSILON ? 0 : clamp(offset, 0, wall.length);
  var ratio = wall.length <= EPSILON ? 0 : safeOffset / wall.length;
  return {
    local: {
      x: wall.localP1.x + (wall.localP2.x - wall.localP1.x) * ratio,
      y: wall.localP1.y + (wall.localP2.y - wall.localP1.y) * ratio
    },
    global: {
      x: wall.p1.x + (wall.p2.x - wall.p1.x) * ratio,
      y: wall.p1.y + (wall.p2.y - wall.p1.y) * ratio
    }
  };
}

function startOffsetFromReference(wall, ref, measuredOffset, openingWidth) {
  if (ref === 'end') {
    return wall.length - measuredOffset - openingWidth;
  }
  return measuredOffset;
}

function validateMeasuredOpening(wall, measuredOffset, openingWidth) {
  if (!wall || !wall.length) return 'No wall selected';
  if (!isFinite(measuredOffset) || measuredOffset < 0) return 'Invalid offset';
  if (!isFinite(openingWidth) || openingWidth <= 0) return 'Invalid width';
  if (openingWidth > wall.length + EPSILON) return 'Opening is wider than wall';
  if (measuredOffset + openingWidth > wall.length + EPSILON) return 'Opening exceeds wall length';
  return '';
}

function buildOpeningFromMeasurement(room, wall, options) {
  var toolType = normalizeToolType(options.toolType);
  var measuredOffset = toNumber(options.measuredOffset, 0);
  var openingWidth = toNumber(options.width, getDefaultOpeningWidth(toolType));
  var ref = options.ref === 'end' ? 'end' : 'start';
  var validationError = validateMeasuredOpening(wall, measuredOffset, openingWidth);
  if (validationError) return { error: validationError };

  var startOffset = startOffsetFromReference(wall, ref, measuredOffset, openingWidth);
  if (startOffset < -EPSILON || startOffset + openingWidth > wall.length + EPSILON) {
    return { error: 'Opening exceeds wall length' };
  }

  startOffset = clamp(startOffset, 0, Math.max(0, wall.length - openingWidth));
  var centerOffset = startOffset + openingWidth / 2;
  var point = pointAtWallOffset(wall, centerOffset);

  return {
    opening: {
      id: options.id,
      type: toolType,
      x: round(point.local.x, 2),
      y: round(point.local.y, 2),
      rotation: wall.rotation,
      angle: round(wall.angleDeg, 3),
      width: round(openingWidth, 2),
      height: getDefaultOpeningHeight(toolType),
      wall: serializeWall(wall),
      ref: ref,
      offset: round(centerOffset, 2),
      measuredOffset: round(measuredOffset, 2),
      source: options.source || 'ble',
      measuredAt: options.measuredAt || new Date().toISOString()
    },
    startOffset: startOffset,
    centerOffset: centerOffset
  };
}

function buildOpeningAtPoint(room, wall, point, toolType, id) {
  var normalizedTool = normalizeToolType(toolType);
  var width = getDefaultOpeningWidth(normalizedTool);
  var projected = projectPointToWall(point, wall);
  var centerOffset = projected.along;
  if (wall.length > width) {
    centerOffset = clamp(centerOffset, width / 2, wall.length - width / 2);
  } else {
    centerOffset = wall.length / 2;
    width = wall.length;
  }

  var ref = centerOffset <= wall.length / 2 ? 'start' : 'end';
  var measuredOffset = ref === 'end'
    ? Math.max(0, wall.length - centerOffset - width / 2)
    : Math.max(0, centerOffset - width / 2);
  var built = buildOpeningFromMeasurement(room, wall, {
    id: id,
    toolType: normalizedTool,
    width: width,
    measuredOffset: measuredOffset,
    ref: ref,
    source: 'manual'
  });

  return built.opening;
}

function getOpeningAngleRad(opening) {
  if (opening && isFinite(parseFloat(opening.angle))) {
    return parseFloat(opening.angle) * Math.PI / 180;
  }
  return opening && opening.rotation === 90 ? Math.PI / 2 : 0;
}

function getOpeningEndpoints(room, opening) {
  var rx = toNumber(room && room.x, 0);
  var ry = toNumber(room && room.y, 0);
  var centerX = rx + toNumber(opening && opening.x, 0);
  var centerY = ry + toNumber(opening && opening.y, 0);
  var width = toNumber(opening && opening.width, 0);
  var angle = getOpeningAngleRad(opening || {});
  var ux = Math.cos(angle);
  var uy = Math.sin(angle);

  return {
    start: {
      x: centerX - ux * width / 2,
      y: centerY - uy * width / 2
    },
    end: {
      x: centerX + ux * width / 2,
      y: centerY + uy * width / 2
    },
    center: { x: centerX, y: centerY },
    angleRad: angle
  };
}

function getRectWallTypeForOpening(room, opening) {
  var width = toNumber(room && room.width, 0);
  var height = toNumber(room && room.height, 0);
  if (opening && opening.wall && opening.wall.type === 'rect' && opening.wall.side) {
    return opening.wall.side;
  }
  if (opening && opening.rotation === 90) {
    return toNumber(opening.x, 0) < width / 2 ? 'left' : 'right';
  }
  return toNumber(opening && opening.y, 0) < height / 2 ? 'top' : 'bottom';
}

function getWallCutStart(opening, length, wallType) {
  var width = toNumber(opening && opening.width, 0);
  if (opening && opening.wall && opening.wall.type === 'polygon' && isFinite(parseFloat(opening.offset))) {
    return clamp(toNumber(opening.offset, 0) - width / 2, 0, Math.max(0, length - width));
  }

  if (wallType === 'top') return clamp(toNumber(opening.x, 0) - width / 2, 0, Math.max(0, length - width));
  if (wallType === 'bottom') return clamp(length - (toNumber(opening.x, 0) + width / 2), 0, Math.max(0, length - width));
  if (wallType === 'left') return clamp(length - (toNumber(opening.y, 0) + width / 2), 0, Math.max(0, length - width));
  return clamp(toNumber(opening.y, 0) - width / 2, 0, Math.max(0, length - width));
}

module.exports = {
  getDefaultOpeningWidth: getDefaultOpeningWidth,
  getDefaultOpeningHeight: getDefaultOpeningHeight,
  getRoomWalls: getRoomWalls,
  findNearestWall: findNearestWall,
  getWallLabel: getWallLabel,
  projectPointToWall: projectPointToWall,
  buildOpeningFromMeasurement: buildOpeningFromMeasurement,
  buildOpeningAtPoint: buildOpeningAtPoint,
  getOpeningAngleRad: getOpeningAngleRad,
  getOpeningEndpoints: getOpeningEndpoints,
  getRectWallTypeForOpening: getRectWallTypeForOpening,
  getWallCutStart: getWallCutStart
};
