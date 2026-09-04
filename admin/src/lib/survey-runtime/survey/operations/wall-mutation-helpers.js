const { syncClosedSpacesFromFaces } = require('../topology/space-sync.js');
const { nextId } = require('../core/runtime-id.js');
const { getWall, getNode } = require('../core/graph-query.js');
const {
  MIN_OPENING_SIZE_MM,
  MAX_OPENING_WALL_RATIO,
  WALL_EXTENSION_DIRECTION_TOLERANCE_DEG
} = require('../core/constants.js');
const { buildBaseWallSegment } = require('../read-model/wall-geometry.js');
const segmentGeometry = require('../geometry/segment.js');

const openingDomain = require('../domain/opening.js');

const wallDomain = require('../domain/wall.js');
const getMeasuredWallLength = wallDomain.measuredLengthMm;
const vector2 = require('../geometry/vector2.js');
const angleDeg = vector2.angleDeg;
const syncWallAdjustmentAfterMetricChange = wallDomain.syncAdjustmentAfterMetricChange;
const getWallCoordinateLength = wallDomain.coordinateLengthMm;
const getWallMeasurementInsets = wallDomain.measurementInsets;
const normalizeMeasurementInset = wallDomain.normalizeMeasurementAdjustment;
const distanceMm = vector2.distanceMm;
const normalizeSignedAngle = vector2.normalizeSignedAngleDeg;

const dot = vector2.dot;

function addNode(floor, point) {
  const node = {
    id: nextId('node'),
    xMm: Math.round(point.xMm),
    yMm: Math.round(point.yMm),
    createdAt: new Date().toISOString()
  };
  floor.nodes.push(node);
  return node;
}

function getOrCreateSnapNode(floor, projection) {
  if (!projection) return null;
  if (projection.node) return projection.node;
  const centerline = projection.snapLine === 'outer' && projection.start && projection.end
    ? segmentGeometry.projectPointToSegment(projection.point, projection.start, projection.end)
    : null;
  const point = centerline && centerline.point ? centerline.point : projection.point;
  const t = centerline && typeof centerline.t === 'number' ? centerline.t : projection.t;
  if (t <= 0.0001) return projection.start;
  if (t >= 0.9999) return projection.end;
  if (!point) return null;
  const existing = floor.nodes.find((node) => distanceMm(node, point) <= 1);
  return existing || addNode(floor, point);
}

function getOrCreateWallCenterNode(floor, wallId, point) {
  const wall = getWall(floor, wallId);
  if (!wall || !point) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  const projection = segmentGeometry.projectPointToSegment(point, start, end);
  if (!projection) return null;
  if (projection.t <= 0.0001) return start;
  if (projection.t >= 0.9999) return end;
  const existing = floor.nodes.find((node) => distanceMm(node, projection.point) <= 1);
  return existing || addNode(floor, projection.point);
}

function syncFloorSpaces(floor, inheritOverrides) {
  return syncClosedSpacesFromFaces(floor, {
    nextId,
    inheritOverrides: inheritOverrides || null
  });
}

function ensureOpenings(floor) {
  if (!Array.isArray(floor.openings)) {
    floor.openings = [];
  }
  return floor.openings;
}

function getOpening(floor, openingId) {
  return ensureOpenings(floor).find((opening) => opening.id === openingId);
}

function normalizeOpeningToWall(floor, opening) {
  const wall = getWall(floor, opening.wallId);
  return openingDomain.normalizeOpeningToWall(opening, wall, {
    minimumSizeMm: MIN_OPENING_SIZE_MM,
    maximumWallRatio: MAX_OPENING_WALL_RATIO
  });
}

function refreshWallMetrics(floor) {
  floor.walls.forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    wall.lengthMm = getMeasuredWallLength(floor, wall);
    wall.angleDeg = angleDeg(start, end);
    syncWallAdjustmentAfterMetricChange(wall);
  });
}

function removeUnreferencedNodes(floor) {
  const used = {};
  floor.walls.forEach((wall) => {
    used[wall.startNodeId] = true;
    used[wall.endNodeId] = true;
  });
  const session = floor.session || {};
  if (session.anchorNodeId) used[session.anchorNodeId] = true;
  floor.nodes = floor.nodes.filter((node) => used[node.id]);
}

function oppositeMeasurementSide(side) {
  if (side === 'left') return 'right';
  if (side === 'right') return 'left';
  return side || '';
}

function reverseWallDirection(floor, wall) {
  const startNodeId = wall.startNodeId;
  const coordinateLength = getWallCoordinateLength(floor, wall);
  wall.startNodeId = wall.endNodeId;
  wall.endNodeId = startNodeId;
  const startInset = wall.measurementStartInsetMm || 0;
  wall.measurementStartInsetMm = wall.measurementEndInsetMm || 0;
  wall.measurementEndInsetMm = startInset;
  wall.measurementSide = oppositeMeasurementSide(wall.measurementSide);
  wall.bodyNormalSide = oppositeMeasurementSide(wall.bodyNormalSide);
  wall.angleDeg = angleDeg(getNode(floor, wall.startNodeId), getNode(floor, wall.endNodeId));
  (floor.openings || []).forEach((opening) => {
    if (opening.wallId !== wall.id) return;
    opening.centerOffsetMm = Math.round(coordinateLength - (opening.centerOffsetMm || 0));
  });
}

function canExtendLastWall(floor, session, anchor, endPoint, measurementSide, isClosingCurrentSpace) {
  if (isClosingCurrentSpace || !anchor || !endPoint) return false;
  const lastWallIndex = floor.walls.length - 1;
  const lastWall = floor.walls[lastWallIndex];
  if (!lastWall || lastWallIndex < session.activeSpaceStartWallIndex || lastWall.endNodeId !== anchor.id) {
    return false;
  }
  if (lastWall.status !== 'confirmed' || lastWall.mode !== session.mode ||
      Number(lastWall.thicknessMm) !== Number(session.thicknessMm)) {
    return false;
  }
  if (floor.spaces.some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(lastWall.id) !== -1
  ))) {
    return false;
  }
  const anchorReferenceCount = floor.walls.reduce((count, wall) => (
    count + (wall.startNodeId === anchor.id ? 1 : 0) + (wall.endNodeId === anchor.id ? 1 : 0)
  ), 0);
  if (anchorReferenceCount !== 1) return false;
  const lastStart = getNode(floor, lastWall.startNodeId);
  if (!lastStart) return false;
  const previousAngle = angleDeg(lastStart, anchor);
  const extensionAngle = angleDeg(anchor, endPoint);
  return Math.abs(normalizeSignedAngle(extensionAngle - previousAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

function nodeIncidentWallCount(floor, nodeId) {
  return (floor.walls || []).reduce((count, wall) => (
    count + ((wall.startNodeId === nodeId || wall.endNodeId === nodeId) ? 1 : 0)
  ), 0);
}

function wallBelongsToClosedSpace(floor, wallId) {
  return (floor.spaces || []).some((space) => (
    space && space.closed && Array.isArray(space.wallIds) && space.wallIds.indexOf(wallId) !== -1
  ));
}

function isForwardCollinearOpenPair(floor, first, second) {
  if (!first || !second || first.endNodeId !== second.startNodeId) return false;
  if (first.status !== 'confirmed' || second.status !== 'confirmed') return false;
  if (first.mode !== second.mode) return false;
  if (Number(first.thicknessMm) !== Number(second.thicknessMm)) return false;
  if (nodeIncidentWallCount(floor, first.endNodeId) !== 2) return false;
  if (wallBelongsToClosedSpace(floor, first.id) || wallBelongsToClosedSpace(floor, second.id)) return false;
  const firstStart = getNode(floor, first.startNodeId);
  const joint = getNode(floor, first.endNodeId);
  const secondEnd = getNode(floor, second.endNodeId);
  if (!firstStart || !joint || !secondEnd) return false;
  const previousAngle = angleDeg(firstStart, joint);
  const extensionAngle = angleDeg(joint, secondEnd);
  return Math.abs(normalizeSignedAngle(extensionAngle - previousAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

function absorbForwardCollinearWall(floor, first, second) {
  const originalKeepLength = getWallCoordinateLength(floor, first);
  const firstHasMetadata = Object.prototype.hasOwnProperty.call(first, 'rawMeasuredLengthMm') ||
    Object.prototype.hasOwnProperty.call(first, 'closureAdjustmentMm');
  const secondHasMetadata = Object.prototype.hasOwnProperty.call(second, 'rawMeasuredLengthMm') ||
    Object.prototype.hasOwnProperty.call(second, 'closureAdjustmentMm');
  const preserveAdjustmentMetadata = firstHasMetadata || secondHasMetadata;
  const firstRawMeasuredLengthMm = Number.isFinite(Number(first.rawMeasuredLengthMm))
    ? Math.round(Number(first.rawMeasuredLengthMm))
    : Math.round(getMeasuredWallLength(floor, first));
  const secondRawMeasuredLengthMm = Number.isFinite(Number(second.rawMeasuredLengthMm))
    ? Math.round(Number(second.rawMeasuredLengthMm))
    : Math.round(getMeasuredWallLength(floor, second));
  const adjustmentSources = [first.adjustmentSource, second.adjustmentSource]
    .filter((source) => typeof source === 'string' && source);
  first.endNodeId = second.endNodeId;
  first.measurementEndInsetMm = second.measurementEndInsetMm || 0;
  first.lengthMm = getMeasuredWallLength(floor, first);
  first.angleDeg = angleDeg(getNode(floor, first.startNodeId), getNode(floor, first.endNodeId));
  if (preserveAdjustmentMetadata) {
    first.rawMeasuredLengthMm = firstRawMeasuredLengthMm + secondRawMeasuredLengthMm;
    first.closureAdjustmentMm = Math.round(first.lengthMm - first.rawMeasuredLengthMm);
    if (adjustmentSources.length) {
      first.adjustmentSource = adjustmentSources.includes('closure-balance')
        ? 'closure-balance'
        : (adjustmentSources.includes('remeasure-balance')
          ? 'remeasure-balance'
          : adjustmentSources[0]);
    } else {
      delete first.adjustmentSource;
    }
  } else {
    delete first.rawMeasuredLengthMm;
    delete first.closureAdjustmentMm;
    delete first.adjustmentSource;
  }
  if (
    first.inputSource === 'closure-merge' ||
    first.inputSource === 'closure-preview' ||
    second.inputSource === 'closure-merge' ||
    second.inputSource === 'closure-preview'
  ) {
    first.inputSource = 'closure-merge';
  }
  (floor.openings || []).forEach((opening) => {
    if (opening.wallId !== second.id) return;
    opening.wallId = first.id;
    opening.centerOffsetMm = Math.round((opening.centerOffsetMm || 0) + originalKeepLength);
  });
  (floor.spaces || []).forEach((space) => {
    if (!Array.isArray(space.wallIds)) return;
    space.wallIds = space.wallIds.filter((wallId) => wallId !== second.id);
  });
  floor.walls = floor.walls.filter((wall) => wall.id !== second.id);
}

function orientWallEndToNode(floor, wall, nodeId) {
  if (!wall || !nodeId) return false;
  if (wall.endNodeId === nodeId) return true;
  if (wall.startNodeId !== nodeId) return false;
  reverseWallDirection(floor, wall);
  return wall.endNodeId === nodeId;
}

function orientWallStartToNode(floor, wall, nodeId) {
  if (!wall || !nodeId) return false;
  if (wall.startNodeId === nodeId) return true;
  if (wall.endNodeId !== nodeId) return false;
  reverseWallDirection(floor, wall);
  return wall.startNodeId === nodeId;
}

function isCollinearThroughNode(floor, first, second, nodeId) {
  if (!first || !second || !nodeId) return false;
  if (first.status !== 'confirmed' || second.status !== 'confirmed') return false;
  if (first.mode !== second.mode) return false;
  if (Number(first.thicknessMm) !== Number(second.thicknessMm)) return false;
  const firstOtherId = first.startNodeId === nodeId ? first.endNodeId : (
    first.endNodeId === nodeId ? first.startNodeId : ''
  );
  const secondOtherId = second.startNodeId === nodeId ? second.endNodeId : (
    second.endNodeId === nodeId ? second.startNodeId : ''
  );
  if (!firstOtherId || !secondOtherId || firstOtherId === secondOtherId) return false;
  const firstOther = getNode(floor, firstOtherId);
  const joint = getNode(floor, nodeId);
  const secondOther = getNode(floor, secondOtherId);
  if (!firstOther || !joint || !secondOther) return false;
  const incomingAngle = angleDeg(firstOther, joint);
  const outgoingAngle = angleDeg(joint, secondOther);
  return Math.abs(normalizeSignedAngle(outgoingAngle - incomingAngle)) <= WALL_EXTENSION_DIRECTION_TOLERANCE_DEG;
}

function mergeCollinearOpenChain(floor, fromIndex) {
  let index = Math.max(0, fromIndex || 0);
  while (index < (floor.walls || []).length - 1) {
    const first = floor.walls[index];
    const second = floor.walls[index + 1];
    if (!isForwardCollinearOpenPair(floor, first, second)) {
      index += 1;
      continue;
    }
    absorbForwardCollinearWall(floor, first, second);
  }
}

function mergeCollinearDegree2Walls(floor) {
  let merged = true;
  while (merged) {
    merged = false;
    const nodes = floor.nodes || [];
    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex += 1) {
      const node = nodes[nodeIndex];
      if (!node || !node.id) continue;
      const incident = (floor.walls || []).filter((wall) => (
        wall.startNodeId === node.id || wall.endNodeId === node.id
      ));
      if (incident.length !== 2) continue;
      const first = incident[0];
      const second = incident[1];
      if (!isCollinearThroughNode(floor, first, second, node.id)) continue;
      if (!orientWallEndToNode(floor, first, node.id)) continue;
      if (!orientWallStartToNode(floor, second, node.id)) continue;
      if (first.endNodeId !== second.startNodeId) continue;
      absorbForwardCollinearWall(floor, first, second);
      merged = true;
      break;
    }
  }
}

function setWallEndpointInset(floor, wall, nodeId, insetMm, onlyIncrease) {
  if (!floor || !wall || !nodeId) return;
  const coordinateLength = getWallCoordinateLength(floor, wall);
  const currentInsets = getWallMeasurementInsets(wall);
  const absoluteOpeningOffsets = ensureOpenings(floor)
    .filter((opening) => opening.wallId === wall.id)
    .map((opening) => ({
      opening,
      absoluteOffsetMm: (opening.centerOffsetMm || 0) + currentInsets.start
    }));
  const isStart = wall.startNodeId === nodeId;
  const isEnd = wall.endNodeId === nodeId;
  if (!isStart && !isEnd) return;

  const oppositeInset = isStart ? currentInsets.end : currentInsets.start;
  const maximumInset = Math.max(0, coordinateLength - oppositeInset - 1);
  const nextInset = Math.min(
    maximumInset,
    onlyIncrease
      ? Math.max(isStart ? currentInsets.start : currentInsets.end, normalizeMeasurementInset(insetMm))
      : normalizeMeasurementInset(insetMm)
  );
  if (isStart) {
    wall.measurementStartInsetMm = nextInset;
  } else {
    wall.measurementEndInsetMm = nextInset;
  }
  wall.lengthMm = getMeasuredWallLength(floor, wall);
  syncWallAdjustmentAfterMetricChange(wall);

  const nextStartInset = getWallMeasurementInsets(wall).start;
  absoluteOpeningOffsets.forEach(({ opening, absoluteOffsetMm }) => {
    opening.centerOffsetMm = Math.round(absoluteOffsetMm - nextStartInset);
    normalizeOpeningToWall(floor, opening);
  });
}

function recomputeSplitNodeBodyInsets(floor, nodeId) {
  if (!floor || !nodeId) return [];
  const node = getNode(floor, nodeId);
  if (!node) return [];
  const incidentWalls = (floor.walls || []).filter((wall) => (
    wall && (wall.startNodeId === nodeId || wall.endNodeId === nodeId)
  ));
  const sourceGroups = new Map();
  incidentWalls.forEach((wall) => {
    if (!wall.topologySourceWallId) return;
    if (!sourceGroups.has(wall.topologySourceWallId)) {
      sourceGroups.set(wall.topologySourceWallId, []);
    }
    sourceGroups.get(wall.topologySourceWallId).push(wall);
  });

  const repairedWallIds = [];
  sourceGroups.forEach((sourceWalls, topologySourceWallId) => {
    if (sourceWalls.length < 2) return;
    sourceWalls.forEach((wall) => {
      const oppositeNode = getNode(
        floor,
        wall.startNodeId === nodeId ? wall.endNodeId : wall.startNodeId
      );
      if (!oppositeNode) return;
      const length = distanceMm(node, oppositeNode);
      if (!length) return;
      const awayDirection = {
        x: (oppositeNode.xMm - node.xMm) / length,
        y: (oppositeNode.yMm - node.yMm) / length
      };
      let nextInsetMm = 0;
      incidentWalls.forEach((sourceWall) => {
        if (sourceWall.id === wall.id || sourceWall.topologySourceWallId === topologySourceWallId) {
          return;
        }
        const sourceSegment = buildBaseWallSegment(floor, sourceWall);
        if (!sourceSegment) return;
        const coverageRate = dot(awayDirection, sourceSegment.normal);
        if (coverageRate <= 0.25) return;
        nextInsetMm = Math.max(
          nextInsetMm,
          Math.ceil(sourceSegment.thicknessMm / coverageRate)
        );
      });
      const currentInsets = getWallMeasurementInsets(wall);
      const currentInsetMm = wall.startNodeId === nodeId ? currentInsets.start : currentInsets.end;
      if (currentInsetMm === nextInsetMm) return;
      setWallEndpointInset(floor, wall, nodeId, nextInsetMm, false);
      repairedWallIds.push(wall.id);
    });
  });
  return repairedWallIds;
}

module.exports = {
  addNode,
  getOrCreateSnapNode,
  getOrCreateWallCenterNode,
  syncFloorSpaces,
  ensureOpenings,
  getOpening,
  normalizeOpeningToWall,
  refreshWallMetrics,
  removeUnreferencedNodes,
  oppositeMeasurementSide,
  reverseWallDirection,
  canExtendLastWall,
  mergeCollinearOpenChain,
  mergeCollinearDegree2Walls,
  setWallEndpointInset,
  recomputeSplitNodeBodyInsets
};
