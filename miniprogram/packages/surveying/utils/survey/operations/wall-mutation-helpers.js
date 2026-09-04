const { syncClosedSpacesFromFaces } = require('../topology/space-sync.js');
const { nextId } = require('../core/runtime-id.js');
const { getWall, getNode } = require('../core/graph-query.js');
const { MIN_OPENING_SIZE_MM, MAX_OPENING_WALL_RATIO } = require('../core/constants.js');
const { buildBaseWallSegment } = require('../read-model/wall-geometry.js');

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

const dot = vector2.dot;

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
  syncFloorSpaces,
  ensureOpenings,
  getOpening,
  normalizeOpeningToWall,
  refreshWallMetrics,
  removeUnreferencedNodes,
  oppositeMeasurementSide,
  reverseWallDirection,
  setWallEndpointInset,
  recomputeSplitNodeBodyInsets
};
