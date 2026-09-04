const { getActiveFloor: findActiveFloor } = require('../core/draft.js');
const getActiveFloor = (draft) => findActiveFloor(draft, { requireFloorList: true });
const { buildSpaceWallFaceSegments, buildFaceBoundaryPlan } = require('./space-boundary.js');
const { distanceMm } = require('../geometry/vector2.js');
const { area: calculatePolygonAreaMm2 } = require('../geometry/polygon.js');

function buildPlanEdgeSegments(faces, boundaryPoints, edgeFaceIndexes) {
  const points = (boundaryPoints || []).filter((point) => (
    point && Number.isFinite(Number(point.xMm)) && Number.isFinite(Number(point.yMm))
  ));
  if (points.length < 2) return [];
  return points.map((start, index) => {
    const faceIndex = Array.isArray(edgeFaceIndexes)
      ? edgeFaceIndexes[index]
      : index;
    const face = Number.isInteger(faceIndex)
      ? (faces || [])[faceIndex]
      : null;
    return {
      wallId: (face && face.wallId) || '',
      start,
      end: points[(index + 1) % points.length]
    };
  });
}

function calculateBoundaryBounds(points) {
  if (!Array.isArray(points) || !points.length) {
    return { widthMm: 0, heightMm: 0 };
  }
  const xs = points.map((point) => Number(point.xMm));
  const ys = points.map((point) => Number(point.yMm));
  return {
    widthMm: Math.round(Math.max(...xs) - Math.min(...xs)),
    heightMm: Math.round(Math.max(...ys) - Math.min(...ys))
  };
}

function buildSpaceDimensionPlan(floor, spaceOrWallIds) {
  const wallIds = Array.isArray(spaceOrWallIds)
    ? spaceOrWallIds
    : (spaceOrWallIds && spaceOrWallIds.wallIds);
  const wallFaceOverrides = !Array.isArray(spaceOrWallIds) && spaceOrWallIds
    ? spaceOrWallIds.wallFaceOverrides
    : null;
  if (!floor || !Array.isArray(wallIds)) return null;
  const faces = buildSpaceWallFaceSegments(floor, wallIds, wallFaceOverrides);
  if (faces.length < 3) return null;
  const innerBoundary = buildFaceBoundaryPlan(faces, 'innerStart', 'innerEnd');
  const outerBoundary = buildFaceBoundaryPlan(faces, 'oppositeStart', 'oppositeEnd');
  const innerBoundaryPoints = innerBoundary.points;
  const outerBoundaryPoints = outerBoundary.points;
  if (innerBoundaryPoints.length < 3 || outerBoundaryPoints.length < 3) return null;
  const innerBounds = calculateBoundaryBounds(innerBoundaryPoints);
  const outerBounds = calculateBoundaryBounds(outerBoundaryPoints);
  return {
    innerBoundaryPoints,
    outerBoundaryPoints,
    innerSegments: buildPlanEdgeSegments(faces, innerBoundaryPoints, innerBoundary.edgeFaceIndexes),
    inner: Object.assign({}, innerBounds, {
      areaMm2: Math.round(calculatePolygonAreaMm2(innerBoundaryPoints))
    }),
    outer: Object.assign({}, outerBounds, {
      areaMm2: Math.round(calculatePolygonAreaMm2(outerBoundaryPoints))
    }),
    wallThicknessSegments: faces.map((face) => {
      const start = {
        xMm: (face.innerStart.xMm + face.innerEnd.xMm) / 2,
        yMm: (face.innerStart.yMm + face.innerEnd.yMm) / 2
      };
      const end = {
        xMm: (face.oppositeStart.xMm + face.oppositeEnd.xMm) / 2,
        yMm: (face.oppositeStart.yMm + face.oppositeEnd.yMm) / 2
      };
      return {
        wallId: face.wallId,
        kind: 'wall-thickness',
        start,
        end,
        lengthMm: Math.round(distanceMm(start, end))
      };
    })
  };
}

function calculateSpaceAreaMm2(draft, spaceId) {
  const floor = getActiveFloor(draft);
  const closedSpace = floor.spaces.find((space) => (
    space.closed && (!spaceId || space.id === spaceId)
  ));
  if (!closedSpace) return 0;
  const plan = buildSpaceDimensionPlan(floor, closedSpace);
  return plan ? plan.inner.areaMm2 : 0;
}

module.exports = {
  buildSpaceDimensionPlan,
  calculateSpaceAreaMm2
};
