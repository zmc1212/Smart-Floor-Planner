const { getActiveFloor } = require('../core/draft.js');
const { nodeIntersections } = require('./node-intersections.js');
const { syncFloorSpaces } = require('./wall-mutation-helpers.js');
const { completeSessionAfterClosure, prepareExactClosureFaces } = require('./closure.js');
const { extractFaces } = require('../topology/face-extractor.js');

function finalizeCommittedTopology(next, previousCount) {
  const floor = getActiveFloor(next);
  const measuredEndNodeId = floor.session.anchorNodeId;
  nodeIntersections(floor);
  const hasNewFace = extractFaces(floor).faces.length > previousCount;
  syncFloorSpaces(floor, hasNewFace ? prepareExactClosureFaces(floor) : null);
  delete floor.session.fullValidationAfterClosedSplit;
  const closed = floor.spaces.filter(space => space.closed);
  const anchor = floor.session.anchorNodeId;
  const incident = floor.walls.filter(wall => wall.startNodeId === anchor || wall.endNodeId === anchor);
  if (closed.length > previousCount && incident.length && incident.every(wall =>
    closed.some(space => space.wallIds.includes(wall.id)))) {
    completeSessionAfterClosure(floor, floor.session, measuredEndNodeId);
    floor.session.partitionSourceSpaceId = '';
  }
  return next;
}

module.exports = { finalizeCommittedTopology };
