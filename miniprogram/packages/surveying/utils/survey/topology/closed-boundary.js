const { getNode, getWall } = require('../core/graph-query.js');
const { traceSpaceBoundary } = require('../domain/space.js');
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
  if (!floor) return [];
  return traceSpaceBoundary(wallIds, id => getWall(floor, id),
    id => getNode(floor, id), reverseFirstWall);
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
