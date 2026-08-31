function distanceMm(first, second) {
  if (!first || !second) return Infinity;
  const dx = Number(first.xMm) - Number(second.xMm);
  const dy = Number(first.yMm) - Number(second.yMm);
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

function roundPoint(point) {
  if (!point) return null;
  return {
    xMm: Math.round(Number(point.xMm)),
    yMm: Math.round(Number(point.yMm))
  };
}

function unprojectCanvasPoint(scene, point) {
  if (!scene || !point) return null;
  const rect = scene.rect || { width: 0, height: 0 };
  const viewport = scene.viewport || { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.max(0.000001, Number(viewport.scale) || 1);
  return {
    xMm: (Number(point.x) - Number(rect.width || 0) / 2 - Number(viewport.offsetX || 0)) / scale,
    yMm: (Number(point.y) - Number(rect.height || 0) / 2 - Number(viewport.offsetY || 0)) / scale
  };
}

function projectPointToSegment(point, start, end) {
  if (!point || !start || !end) return null;
  const dx = Number(end.xMm) - Number(start.xMm);
  const dy = Number(end.yMm) - Number(start.yMm);
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return null;
  const rawT = (
    (Number(point.xMm) - Number(start.xMm)) * dx +
    (Number(point.yMm) - Number(start.yMm)) * dy
  ) / lengthSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = {
    xMm: Math.round(Number(start.xMm) + dx * t),
    yMm: Math.round(Number(start.yMm) + dy * t)
  };
  return {
    pointMm: projected,
    t,
    distanceMm: distanceMm(point, projected)
  };
}

function tracesClosedWallChain(wallIds, wallById, reverseFirstWall) {
  if (!Array.isArray(wallIds) || wallIds.length < 3) return false;
  const firstWall = wallById.get(wallIds[0]);
  if (!firstWall) return false;
  const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
  let currentNodeId = initialNodeId;
  for (let index = 0; index < wallIds.length; index += 1) {
    const wall = wallById.get(wallIds[index]);
    if (!wall) return false;
    if (wall.startNodeId === currentNodeId) {
      currentNodeId = wall.endNodeId;
    } else if (wall.endNodeId === currentNodeId) {
      currentNodeId = wall.startNodeId;
    } else {
      return false;
    }
  }
  return currentNodeId === initialNodeId;
}

function hasClosedWallChain(wallIds, wallById) {
  return tracesClosedWallChain(wallIds, wallById, false) ||
    tracesClosedWallChain(wallIds, wallById, true);
}

function addAlignmentTarget(targets, seen, pointMm, nodeId, wallId, snapLine) {
  if (!pointMm || !nodeId || !wallId) return;
  const rounded = roundPoint(pointMm);
  const key = `${rounded.xMm}:${rounded.yMm}:${nodeId}:${snapLine}`;
  if (seen.has(key)) return;
  seen.add(key);
  targets.push({
    pointMm: rounded,
    nodeId,
    wallId,
    snapLine
  });
}

function createCursorPlacementIndex(input) {
  const options = input || {};
  const floor = options.floor || {};
  const scene = options.scene || {};
  const floorWalls = Array.isArray(floor.walls) ? floor.walls : [];
  const floorNodes = Array.isArray(floor.nodes) ? floor.nodes : [];
  const sceneWalls = Array.isArray(scene.walls) ? scene.walls : [];
  const wallById = new Map();
  const sceneWallById = new Map();
  const nodeById = new Map();
  floorWalls.forEach((wall) => {
    if (wall && wall.id) wallById.set(wall.id, wall);
  });
  sceneWalls.forEach((wall) => {
    if (wall && wall.id) sceneWallById.set(wall.id, wall);
  });
  floorNodes.forEach((node) => {
    if (node && node.id) nodeById.set(node.id, node);
  });

  const referencedNodeIds = new Set();
  floorWalls.forEach((wall) => {
    if (!wall) return;
    referencedNodeIds.add(wall.startNodeId);
    referencedNodeIds.add(wall.endNodeId);
  });
  const innerVertices = floorNodes.filter((node) => node && referencedNodeIds.has(node.id))
    .map((node) => ({
      type: 'vertex',
      pointMm: roundPoint(node),
      nodeId: node.id
    }));

  const walls = [];
  const wallsById = new Map();
  const outerVertices = [];
  floorWalls.forEach((wall) => {
    const sceneWall = wall && sceneWallById.get(wall.id);
    const topologyStart = sceneWall && sceneWall.topologyStart
      ? sceneWall.topologyStart
      : nodeById.get(wall && wall.startNodeId);
    const topologyEnd = sceneWall && sceneWall.topologyEnd
      ? sceneWall.topologyEnd
      : nodeById.get(wall && wall.endNodeId);
    const rawOuterStart = sceneWall && unprojectCanvasPoint(scene, sceneWall.rawOuterStart);
    const rawOuterEnd = sceneWall && unprojectCanvasPoint(scene, sceneWall.rawOuterEnd);
    const outerStart = sceneWall && unprojectCanvasPoint(scene, sceneWall.outerStart);
    const outerEnd = sceneWall && unprojectCanvasPoint(scene, sceneWall.outerEnd);
    if (!wall || !topologyStart || !topologyEnd || !rawOuterStart || !rawOuterEnd || !outerStart || !outerEnd) {
      return;
    }
    const entry = {
      id: wall.id,
      wall,
      innerStart: roundPoint(topologyStart),
      innerEnd: roundPoint(topologyEnd),
      outerStart,
      outerEnd,
      guideOuterStart: roundPoint(outerStart),
      guideOuterEnd: roundPoint(outerEnd),
      projectionOuterStart: rawOuterStart,
      projectionOuterEnd: rawOuterEnd
    };
    walls.push(entry);
    wallsById.set(entry.id, entry);
    outerVertices.push(
      {
        type: 'vertex',
        pointMm: roundPoint(outerStart),
        topologyPointMm: entry.innerStart,
        nodeId: wall.startNodeId,
        wallId: wall.id,
        snapLine: 'outer',
        t: 0
      },
      {
        type: 'vertex',
        pointMm: roundPoint(outerEnd),
        topologyPointMm: entry.innerEnd,
        nodeId: wall.endNodeId,
        wallId: wall.id,
        snapLine: 'outer',
        t: 1
      }
    );
  });

  const closedWallIds = new Set();
  const alignmentClosedWallIds = new Set();
  (floor.spaces || []).forEach((space) => {
    if (!space || !space.closed || !Array.isArray(space.wallIds)) return;
    space.wallIds.forEach((wallId) => closedWallIds.add(wallId));
    if (!hasClosedWallChain(space.wallIds, wallById)) return;
    space.wallIds.forEach((wallId) => alignmentClosedWallIds.add(wallId));
  });

  const incidentClosedThicknessByNodeId = new Map();
  floorWalls.forEach((wall) => {
    if (!wall || !closedWallIds.has(wall.id)) return;
    const thicknessMm = Number(wall.thicknessMm) || 200;
    [wall.startNodeId, wall.endNodeId].forEach((nodeId) => {
      const values = incidentClosedThicknessByNodeId.get(nodeId) || [];
      values.push(thicknessMm);
      incidentClosedThicknessByNodeId.set(nodeId, values);
    });
  });

  const alignmentTargets = [];
  const alignmentSeen = new Set();
  floorWalls.forEach((wall) => {
    if (!wall || !alignmentClosedWallIds.has(wall.id)) return;
    const entry = wallsById.get(wall.id);
    if (!entry) return;
    addAlignmentTarget(alignmentTargets, alignmentSeen, entry.innerStart, wall.startNodeId, wall.id, 'inner');
    addAlignmentTarget(alignmentTargets, alignmentSeen, entry.innerEnd, wall.endNodeId, wall.id, 'inner');
    addAlignmentTarget(alignmentTargets, alignmentSeen, entry.guideOuterStart, wall.startNodeId, wall.id, 'outer');
    addAlignmentTarget(alignmentTargets, alignmentSeen, entry.guideOuterEnd, wall.endNodeId, wall.id, 'outer');
  });

  return {
    complete: walls.length === floorWalls.length,
    floor,
    innerVertices,
    outerVertices,
    walls,
    wallsById,
    alignmentTargets,
    incidentClosedThicknessByNodeId
  };
}

function innerVertexPreferenceRadiusMm(index, vertex, maxDistanceMm) {
  if (!index || !vertex || !vertex.nodeId) return 0;
  const thicknesses = index.incidentClosedThicknessByNodeId.get(vertex.nodeId) || [];
  const radiusMm = thicknesses.length ? Math.max.apply(null, thicknesses) : 200;
  return Math.min(Number.isFinite(maxDistanceMm) ? maxDistanceMm : 350, radiusMm);
}

function shouldPreferOuterVertex(index, innerVertex, outerVertex, maxDistanceMm) {
  if (!outerVertex) return false;
  if (!innerVertex) return true;
  const innerRadiusMm = innerVertexPreferenceRadiusMm(index, innerVertex, maxDistanceMm);
  const outerTerminalBandMm = innerRadiusMm * 0.4;
  if (
    innerVertex.distanceMm <= innerRadiusMm &&
    outerVertex.distanceMm > outerTerminalBandMm
  ) {
    return false;
  }
  return outerVertex.distanceMm < innerVertex.distanceMm;
}

function findNearestVertex(vertices, point, limit) {
  let best = null;
  (vertices || []).forEach((vertex) => {
    const candidateDistance = distanceMm(point, vertex.pointMm);
    if (candidateDistance > limit) return;
    if (!best || candidateDistance < best.distanceMm) {
      best = Object.assign({}, vertex, { distanceMm: candidateDistance });
    }
  });
  return best;
}

function findNearestWallProjection(index, point) {
  let best = null;
  (index.walls || []).forEach((wall) => {
    [
      { snapLine: 'inner', start: wall.innerStart, end: wall.innerEnd },
      { snapLine: 'outer', start: wall.projectionOuterStart, end: wall.projectionOuterEnd }
    ].forEach((segment) => {
      const projection = projectPointToSegment(point, segment.start, segment.end);
      if (!projection) return;
      const candidate = {
        type: 'wall',
        pointMm: projection.pointMm,
        wallId: wall.id,
        snapLine: segment.snapLine,
        distanceMm: projection.distanceMm
      };
      if (!best || candidate.distanceMm < best.distanceMm) best = candidate;
    });
  });
  return best;
}

function findNearestAlignment(index, point, limit) {
  let best = null;
  (index.alignmentTargets || []).forEach((target) => {
    ['x', 'y'].forEach((axis) => {
      const axisKey = axis === 'x' ? 'xMm' : 'yMm';
      const perpendicularKey = axis === 'x' ? 'yMm' : 'xMm';
      const axisDistanceMm = Math.abs(Number(point[axisKey]) - Number(target.pointMm[axisKey]));
      if (axisDistanceMm > limit) return;
      const perpendicularDistanceMm = Math.abs(
        Number(point[perpendicularKey]) - Number(target.pointMm[perpendicularKey])
      );
      const candidate = Object.assign({}, target, {
        type: 'alignment',
        axis,
        axisDistanceMm,
        perpendicularDistanceMm,
        referencePoint: roundPoint(target.pointMm),
        pointMm: axis === 'x'
          ? { xMm: target.pointMm.xMm, yMm: Math.round(Number(point.yMm)) }
          : { xMm: Math.round(Number(point.xMm)), yMm: target.pointMm.yMm }
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

function resolveCursorPlacementTarget(index, point, maxDistanceMm) {
  if (!index || !index.complete || !point) return null;
  const limit = Number.isFinite(maxDistanceMm) ? maxDistanceMm : 350;
  const freeTarget = {
    type: 'free',
    pointMm: roundPoint(point),
    distanceMm: 0
  };
  if (!index.walls.length) return freeTarget;

  let nearestVertex = findNearestVertex(index.innerVertices, point, limit);
  const nearestOuterVertex = findNearestVertex(index.outerVertices, point, limit);
  if (shouldPreferOuterVertex(index, nearestVertex, nearestOuterVertex, limit)) {
    nearestVertex = nearestOuterVertex;
  }

  const projection = findNearestWallProjection(index, point);
  const innerPreferenceRadiusMm = nearestVertex && !nearestVertex.snapLine
    ? innerVertexPreferenceRadiusMm(index, nearestVertex, limit)
    : 0;
  const outerProjectionWins = nearestVertex && projection &&
    projection.snapLine === 'outer' &&
    projection.distanceMm <= limit &&
    nearestVertex.distanceMm > innerPreferenceRadiusMm &&
    projection.distanceMm < nearestVertex.distanceMm;
  if (nearestVertex && !outerProjectionWins) return nearestVertex;

  if (!projection || projection.distanceMm > limit) {
    return findNearestAlignment(index, point, limit) || freeTarget;
  }
  return projection;
}

function targetPriority(target) {
  if (!target) return 0;
  if (target.type === 'vertex') return 3;
  if (target.type === 'wall') return 2;
  if (target.type === 'alignment') return 1;
  return 0;
}

function resolveCursorPlacementLock(index, point, candidate, maxDistanceMm, acquireDistanceMm) {
  if (!index || !index.complete || !point || !candidate) return null;
  const limit = Number.isFinite(maxDistanceMm) ? maxDistanceMm : 350;
  if (candidate.type !== 'vertex' && Number.isFinite(acquireDistanceMm)) {
    const upgrade = resolveCursorPlacementTarget(index, point, acquireDistanceMm);
    if (targetPriority(upgrade) > targetPriority(candidate)) return upgrade;
  }
  if (candidate.type === 'vertex') {
    const candidateDistance = distanceMm(point, candidate.pointMm);
    return candidateDistance <= limit
      ? Object.assign({}, candidate, { distanceMm: candidateDistance })
      : null;
  }
  if (candidate.type === 'alignment') {
    const axis = candidate.axis === 'x' ? 'x' : 'y';
    const referencePoint = candidate.referencePoint || candidate.pointMm;
    if (!referencePoint) return null;
    const axisKey = axis === 'x' ? 'xMm' : 'yMm';
    const axisDistanceMm = Math.abs(Number(point[axisKey]) - Number(referencePoint[axisKey]));
    if (axisDistanceMm > limit) return null;
    return Object.assign({}, candidate, {
      pointMm: axis === 'x'
        ? { xMm: Math.round(Number(referencePoint.xMm)), yMm: Math.round(Number(point.yMm)) }
        : { xMm: Math.round(Number(point.xMm)), yMm: Math.round(Number(referencePoint.yMm)) },
      axisDistanceMm
    });
  }
  if (candidate.type !== 'wall' || !candidate.wallId) return null;
  const wall = index.wallsById.get(candidate.wallId);
  if (!wall) return null;
  const outer = candidate.snapLine === 'outer';
  const projection = projectPointToSegment(
    point,
    outer ? wall.projectionOuterStart : wall.innerStart,
    outer ? wall.projectionOuterEnd : wall.innerEnd
  );
  if (!projection || projection.distanceMm > limit) return null;
  return Object.assign({}, candidate, {
    pointMm: projection.pointMm,
    distanceMm: projection.distanceMm,
    snapLine: outer ? 'outer' : 'inner'
  });
}

function getCursorPlacementGuideSegment(index, candidate) {
  if (!index || !candidate || !candidate.wallId) return null;
  const wall = index.wallsById.get(candidate.wallId);
  if (!wall) return null;
  return candidate.snapLine === 'outer'
    ? { startMm: wall.guideOuterStart, endMm: wall.guideOuterEnd }
    : { startMm: wall.innerStart, endMm: wall.innerEnd };
}

module.exports = {
  createCursorPlacementIndex,
  resolveCursorPlacementTarget,
  resolveCursorPlacementLock,
  getCursorPlacementGuideSegment
};
