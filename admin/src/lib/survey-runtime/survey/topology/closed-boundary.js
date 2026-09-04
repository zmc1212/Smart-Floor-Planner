const { getNode, getWall } = require('../core/graph-query.js');
const polygonGeometry = require('../geometry/polygon.js');

function findClosedSpaceForWall(floor, wallId) {
  if (!floor || !wallId || !Array.isArray(floor.spaces)) return null;
  return floor.spaces.find((space) => (
    space &&
    space.closed &&
    Array.isArray(space.wallIds) &&
    space.wallIds.indexOf(wallId) !== -1
  )) || null;
}

function findClosedSpacesForWall(floor, wallId) {
  if (!floor || !wallId || !Array.isArray(floor.spaces)) return [];
  return floor.spaces.filter((space) => (
    space &&
    space.closed &&
    Array.isArray(space.wallIds) &&
    space.wallIds.indexOf(wallId) !== -1
  ));
}

function calculateBoundaryCentroid(floor, wallIds) {
  const points = buildSpaceBoundaryPoints(floor, wallIds);
  return polygonGeometry.centroid(points);
}

function traceClosedSpaceWallChain(floor, wallIds, reverseFirstWall) {
  if (!floor || !Array.isArray(wallIds) || wallIds.length < 3) return [];
  const firstWall = getWall(floor, wallIds[0]);
  if (!firstWall) return [];

  const initialNodeId = reverseFirstWall ? firstWall.endNodeId : firstWall.startNodeId;
  let currentNodeId = initialNodeId;
  const chain = [];

  for (let index = 0; index < wallIds.length; index += 1) {
    const wall = getWall(floor, wallIds[index]);
    if (!wall) return [];
    let nextNodeId = '';
    if (wall.startNodeId === currentNodeId) {
      nextNodeId = wall.endNodeId;
    } else if (wall.endNodeId === currentNodeId) {
      nextNodeId = wall.startNodeId;
    } else {
      return [];
    }
    const start = getNode(floor, currentNodeId);
    const end = getNode(floor, nextNodeId);
    if (!start || !end) return [];
    chain.push({ wall, start, end, reversed: wall.endNodeId === currentNodeId });
    currentNodeId = nextNodeId;
  }

  return currentNodeId === initialNodeId ? chain : [];
}

function buildClosedSpaceWallChain(floor, wallIds) {
  const forward = traceClosedSpaceWallChain(floor, wallIds, false);
  return forward.length ? forward : traceClosedSpaceWallChain(floor, wallIds, true);
}

function buildSpaceBoundaryPoints(floor, wallIds) {
  const forward = traceClosedSpaceWallChain(floor, wallIds, false);
  const chain = forward.length ? forward : traceClosedSpaceWallChain(floor, wallIds, true);
  if (!chain.length) return [];
  return chain.map((entry) => entry.start);
}

module.exports = {
  findClosedSpaceForWall,
  findClosedSpacesForWall,
  calculateBoundaryCentroid,
  traceClosedSpaceWallChain,
  buildClosedSpaceWallChain,
  buildSpaceBoundaryPoints
};
