const { preferOuterVertex, preferOuterProjection } = require('./candidate-policy.js');
const { CLOSE_TOLERANCE_MM, DEFAULT_THICKNESS_MM, VERTEX_AXIS_SNAP_TOLERANCE_MM } = require('../core/constants.js');
const { buildClosedSpaceWallChain, findClosedSpaceForWall } = require('../topology/closed-boundary.js');
const { buildResolvedSegment, buildWallRenderGeometry } = require('../read-model/wall-geometry.js');
const { getNode, getNodeWallUseCount, getWall } = require('../core/graph-query.js');
const segmentGeometry = require('../geometry/segment.js');
const vector2 = require('../geometry/vector2.js');

const distanceMm = vector2.distanceMm;
const projectPointToWallSegment = segmentGeometry.projectPointToSegment;
function buildWallProjectionCandidate(wall, start, end, projection, snapLine) {
  if (!projection) return null;
  return {
    wall,
    start,
    end,
    point: projection.point,
    t: projection.t,
    distanceMm: projection.distanceMm,
    snapLine
  };
}

function findNearestWallProjection(floor, point) {
  if (!floor || !point) return null;
  let best = null;
  floor.walls.forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    const candidates = [
      buildWallProjectionCandidate(
        wall,
        start,
        end,
        projectPointToWallSegment(point, start, end),
        'inner'
      )
    ];
    const segment = buildResolvedSegment(floor, wall);
    if (segment && segment.outerStart && segment.outerEnd) {
      candidates.push(buildWallProjectionCandidate(
        wall,
        start,
        end,
        projectPointToWallSegment(point, segment.outerStart, segment.outerEnd),
        'outer'
      ));
    }

    candidates.filter(Boolean).forEach((projection) => {
      if (!best || projection.distanceMm < best.distanceMm) {
        best = projection;
      }
    });
  });
  return best;
}

function findNearestOuterVertex(floor, point, maxDistanceMm) {
  if (!floor || !point) return null;
  const limit = typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM;
  let best = null;

  (floor.walls || []).forEach((wall) => {
    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;

    [
      { pointMm: geometry.outerStart, nodeId: wall.startNodeId, t: 0 },
      { pointMm: geometry.outerEnd, nodeId: wall.endNodeId, t: 1 }
    ].forEach((candidate) => {
      const node = getNode(floor, candidate.nodeId);
      if (!candidate.pointMm || !node) return;
      const candidateDistance = distanceMm(point, candidate.pointMm);
      if (candidateDistance > limit) return;
      if (!best || candidateDistance < best.distanceMm) {
        best = {
          type: 'vertex',
          pointMm: {
            xMm: Math.round(candidate.pointMm.xMm),
            yMm: Math.round(candidate.pointMm.yMm)
          },
          topologyPointMm: { xMm: node.xMm, yMm: node.yMm },
          nodeId: node.id,
          wallId: wall.id,
          snapLine: 'outer',
          t: candidate.t,
          distanceMm: candidateDistance
        };
      }
    });
  });

  return best;
}

function collectVertexAxisTargets(floor) {
  if (!floor) return [];
  const targets = [];
  const seen = new Set();
  const closedWallIds = new Set();
  (floor.spaces || []).forEach((space) => {
    if (!space || !space.closed || !Array.isArray(space.wallIds)) return;
    if (!buildClosedSpaceWallChain(floor, space.wallIds).length) return;
    space.wallIds.forEach((wallId) => closedWallIds.add(wallId));
  });

  const addTarget = (pointMm, nodeId, wallId, snapLine) => {
    if (!pointMm || !nodeId || !wallId) return;
    const roundedPoint = {
      xMm: Math.round(pointMm.xMm),
      yMm: Math.round(pointMm.yMm)
    };
    const key = `${roundedPoint.xMm}:${roundedPoint.yMm}:${nodeId}:${snapLine}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      pointMm: roundedPoint,
      nodeId,
      wallId,
      snapLine
    });
  };

  (floor.walls || []).forEach((wall) => {
    if (!closedWallIds.has(wall.id)) return;
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;
    addTarget(start, start.id, wall.id, 'inner');
    addTarget(end, end.id, wall.id, 'inner');

    const geometry = buildWallRenderGeometry(floor, wall);
    if (!geometry) return;
    addTarget(geometry.outerStart, start.id, wall.id, 'outer');
    addTarget(geometry.outerEnd, end.id, wall.id, 'outer');
  });

  return targets;
}

function findNearestVertexAxisAlignment(floor, point, maxDistanceMm, preferredAxis) {
  if (!floor || !point) return null;
  const limit = typeof maxDistanceMm === 'number'
    ? maxDistanceMm
    : VERTEX_AXIS_SNAP_TOLERANCE_MM;
  const axes = preferredAxis === 'x' || preferredAxis === 'y'
    ? [preferredAxis]
    : ['x', 'y'];
  let best = null;

  collectVertexAxisTargets(floor).forEach((target) => {
    axes.forEach((axis) => {
      const axisKey = axis === 'x' ? 'xMm' : 'yMm';
      const perpendicularKey = axis === 'x' ? 'yMm' : 'xMm';
      const axisDistanceMm = Math.abs(point[axisKey] - target.pointMm[axisKey]);
      if (axisDistanceMm > limit) return;
      const perpendicularDistanceMm = Math.abs(
        point[perpendicularKey] - target.pointMm[perpendicularKey]
      );
      const candidate = Object.assign({}, target, {
        type: 'alignment',
        axis,
        axisDistanceMm,
        perpendicularDistanceMm,
        referencePoint: {
          xMm: target.pointMm.xMm,
          yMm: target.pointMm.yMm
        },
        pointMm: axis === 'x'
          ? { xMm: target.pointMm.xMm, yMm: Math.round(point.yMm) }
          : { xMm: Math.round(point.xMm), yMm: target.pointMm.yMm }
      });
      if (
        !best ||
        candidate.axisDistanceMm < best.axisDistanceMm ||
        (
          candidate.axisDistanceMm === best.axisDistanceMm &&
          candidate.perpendicularDistanceMm < best.perpendicularDistanceMm
        )
      ) {
        best = candidate;
      }
    });
  });

  return best;
}

function resolveInnerVertexPreferenceRadiusMm(floor, innerVertex, maxDistanceMm) {
  if (!floor || !innerVertex || !innerVertex.nodeId) return 0;
  const incidentThicknesses = (floor.walls || []).filter((wall) => (
    wall &&
    (wall.startNodeId === innerVertex.nodeId || wall.endNodeId === innerVertex.nodeId) &&
    !!findClosedSpaceForWall(floor, wall.id)
  )).map((wall) => Number(wall.thicknessMm) || DEFAULT_THICKNESS_MM);
  const radiusMm = incidentThicknesses.length
    ? Math.max(...incidentThicknesses)
    : DEFAULT_THICKNESS_MM;
  return Math.min(
    typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM,
    radiusMm
  );
}

function shouldPreferOuterVertex(floor, innerVertex, outerVertex, maxDistanceMm) {
  return preferOuterVertex(innerVertex, outerVertex,
    resolveInnerVertexPreferenceRadiusMm(floor, innerVertex, maxDistanceMm));
}

function findNearestSharedEndpointProjection(floor, point) {
  if (!floor || !point) return null;
  let best = null;

  (floor.walls || []).forEach((wall) => {
    const start = getNode(floor, wall.startNodeId);
    const end = getNode(floor, wall.endNodeId);
    if (!start || !end) return;

    [
      { node: start, t: 0 },
      { node: end, t: 1 }
    ].forEach((candidate) => {
      if (getNodeWallUseCount(floor, candidate.node.id) < 2) return;
      const candidateDistance = distanceMm(point, candidate.node);
      if (candidateDistance > CLOSE_TOLERANCE_MM) return;
      if (!best || candidateDistance < best.distanceMm) {
        best = {
          wall,
          start,
          end,
          point: { xMm: candidate.node.xMm, yMm: candidate.node.yMm },
          node: candidate.node,
          t: candidate.t,
          distanceMm: candidateDistance
        };
      }
    });
  });

  return best;
}

function findWallSnapProjection(floor, point) {
  return findNearestSharedEndpointProjection(floor, point) || findNearestWallProjection(floor, point);
}

function findTargetWallProjection(floor, point, target) {
  if (!floor || !point || !target || !target.wallId || !target.snapLine) return null;
  const wall = getWall(floor, target.wallId);
  if (!wall) return null;
  const start = getNode(floor, wall.startNodeId);
  const end = getNode(floor, wall.endNodeId);
  if (!start || !end) return null;

  if (
    target.snapLine === 'outer' &&
    target.nodeId &&
    (target.nodeId === wall.startNodeId || target.nodeId === wall.endNodeId)
  ) {
    const node = getNode(floor, target.nodeId);
    const geometry = buildWallRenderGeometry(floor, wall);
    const outerVertex = geometry && target.nodeId === wall.startNodeId
      ? geometry.outerStart
      : (geometry && geometry.outerEnd);
    if (!node || !outerVertex) return null;
    return {
      wall,
      start,
      end,
      point: { xMm: Math.round(outerVertex.xMm), yMm: Math.round(outerVertex.yMm) },
      node,
      t: target.nodeId === wall.startNodeId ? 0 : 1,
      distanceMm: distanceMm(point, outerVertex),
      snapLine: 'outer'
    };
  }

  if (target.snapLine === 'outer') {
    const segment = buildResolvedSegment(floor, wall);
    if (!segment || !segment.outerStart || !segment.outerEnd) return null;
    return buildWallProjectionCandidate(
      wall,
      start,
      end,
      projectPointToWallSegment(point, segment.outerStart, segment.outerEnd),
      'outer'
    );
  }

  return buildWallProjectionCandidate(
    wall,
    start,
    end,
    projectPointToWallSegment(point, start, end),
    'inner'
  );
}

function getWallSnapPoint(floor, point, maxDistanceMm) {
  const projection = findWallSnapProjection(floor, point);
  if (
    projection &&
    typeof maxDistanceMm === 'number' &&
    projection.distanceMm > maxDistanceMm
  ) {
    return null;
  }
  return projection ? projection.point : null;
}

function getCursorPlacementTarget(floor, point, maxDistanceMm) {
  if (!floor || !point) {
    return { type: 'none', pointMm: null, distanceMm: Infinity };
  }

  const freeTarget = {
    type: 'free',
    pointMm: { xMm: Math.round(point.xMm), yMm: Math.round(point.yMm) },
    distanceMm: 0
  };
  if (!Array.isArray(floor.walls) || !floor.walls.length) return freeTarget;

  const limit = typeof maxDistanceMm === 'number' ? maxDistanceMm : CLOSE_TOLERANCE_MM;
  const wallNodeIds = new Set();
  (floor.walls || []).forEach((wall) => {
    wallNodeIds.add(wall.startNodeId);
    wallNodeIds.add(wall.endNodeId);
  });
  let nearestVertex = null;
  (floor.nodes || []).forEach((node) => {
    if (!wallNodeIds.has(node.id)) return;
    const candidateDistance = distanceMm(point, node);
    if (candidateDistance > limit) return;
    if (!nearestVertex || candidateDistance < nearestVertex.distanceMm) {
      nearestVertex = {
        type: 'vertex',
        pointMm: { xMm: node.xMm, yMm: node.yMm },
        nodeId: node.id,
        distanceMm: candidateDistance
      };
    }
  });

  const nearestOuterVertex = findNearestOuterVertex(floor, point, limit);
  if (shouldPreferOuterVertex(floor, nearestVertex, nearestOuterVertex, limit)) {
    nearestVertex = nearestOuterVertex;
  }

  const projection = findNearestWallProjection(floor, point);
  const innerVertexPreferenceRadiusMm = nearestVertex && !nearestVertex.snapLine
    ? resolveInnerVertexPreferenceRadiusMm(floor, nearestVertex, limit)
    : 0;
  const outerProjectionWins = preferOuterProjection(nearestVertex, projection, limit,
    innerVertexPreferenceRadiusMm);
  if (nearestVertex && !outerProjectionWins) return nearestVertex;

  if (!projection || projection.distanceMm > limit) {
    const alignment = findNearestVertexAxisAlignment(floor, point, limit);
    return alignment || freeTarget;
  }

  return {
    type: 'wall',
    pointMm: projection.point,
    wallId: projection.wall && projection.wall.id,
    snapLine: projection.snapLine || 'inner',
    distanceMm: projection.distanceMm
  };
}

module.exports = {
  buildWallProjectionCandidate,
  findNearestWallProjection,
  findNearestOuterVertex,
  collectVertexAxisTargets,
  findNearestVertexAxisAlignment,
  resolveInnerVertexPreferenceRadiusMm,
  shouldPreferOuterVertex,
  findNearestSharedEndpointProjection,
  findWallSnapProjection,
  findTargetWallProjection,
  getWallSnapPoint,
  getCursorPlacementTarget
};
