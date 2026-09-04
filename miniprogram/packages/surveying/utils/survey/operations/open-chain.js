const { getNode, getLastWall, getWall } = require('../core/graph-query.js');
const { SESSION_STATES } = require('../core/session.js');
const { resolveStraightClosurePlan, findMergeClosureCandidate } = require('../topology/closure-queries.js');
const { CLOSE_TOLERANCE_MM } = require('../core/constants.js');
const { findWallPathBetweenNodes } = require('../topology/wall-path.js');
const { reverseWallDirection, refreshWallMetrics } = require('./wall-mutation-helpers.js');

const vector2 = require('../geometry/vector2.js');
const distanceMm = vector2.distanceMm;

function refreshStandaloneClosureSuggestion(floor, session) {
  session.closeCandidateNodeId = '';
  session.closeCandidatePoint = null;
  session.closeCandidateType = '';
  session.closeCandidateSharedWallId = '';
  const anchor = getNode(floor, session.anchorNodeId);
  const activeStartNode = getNode(floor, session.activeSpaceStartNodeId);
  const startWallIndex = Number.isInteger(session.activeSpaceStartWallIndex)
    ? session.activeSpaceStartWallIndex
    : 0;
  const activeWallCount = Math.max(0, (floor.walls || []).length - startWallIndex);
  if (!anchor || !activeStartNode || activeWallCount < 2) {
    session.state = SESSION_STATES.WALL_COMMITTED;
    return;
  }
  const lastWall = getLastWall(floor);
  const startClosurePlan = activeWallCount >= 3 && lastWall
    ? resolveStraightClosurePlan(floor, session, lastWall, activeStartNode)
    : null;
  if (startClosurePlan && (
    distanceMm(anchor, activeStartNode) <= CLOSE_TOLERANCE_MM ||
    startClosurePlan.type === 'orthogonal-adjustment'
  )) {
    session.state = SESSION_STATES.CLOSING;
    session.closeCandidateNodeId = activeStartNode.id;
    session.closeCandidateType = 'start';
    return;
  }
  const mergeCandidate = findMergeClosureCandidate(floor, session, anchor);
  if (mergeCandidate) {
    session.state = SESSION_STATES.MERGE_CLOSING;
    session.closeCandidateNodeId = mergeCandidate.id;
    session.closeCandidateType = 'merge';
    return;
  }
  session.state = SESSION_STATES.WALL_COMMITTED;
}

function restoreOpenedSpaceChain(floor, session, fromNodeId, toNodeId) {
  if (!floor || !session || !fromNodeId || !toNodeId || fromNodeId === toNodeId) return false;
  const pathWallIds = findWallPathBetweenNodes(floor, fromNodeId, toNodeId, {});
  if (pathWallIds.length < 2) return false;

  const pathIdSet = {};
  pathWallIds.forEach((wallId) => { pathIdSet[wallId] = true; });
  const otherWalls = (floor.walls || []).filter((wall) => !pathIdSet[wall.id]);
  const pathWalls = pathWallIds.map((wallId) => getWall(floor, wallId)).filter(Boolean);
  if (pathWalls.length !== pathWallIds.length) return false;

  const oriented = [];
  let previousNodeId = fromNodeId;
  for (let index = 0; index < pathWalls.length; index += 1) {
    const wall = pathWalls[index];
    if (wall.startNodeId === previousNodeId) {
      oriented.push({ wall, reverse: false });
      previousNodeId = wall.endNodeId;
    } else if (wall.endNodeId === previousNodeId) {
      oriented.push({ wall, reverse: true });
      previousNodeId = wall.startNodeId;
    } else {
      return false;
    }
  }
  if (previousNodeId !== toNodeId) return false;

  oriented.forEach((entry) => {
    if (entry.reverse) reverseWallDirection(floor, entry.wall);
  });
  floor.walls = otherWalls.concat(oriented.map((entry) => entry.wall));
  refreshWallMetrics(floor);
  session.activeSpaceStartNodeId = fromNodeId;
  session.activeSpaceStartWallIndex = otherWalls.length;
  session.activeSpaceSharedWallId = '';
  session.activeSpaceSharedStartT = null;
  session.activeSpaceSharedWallMiddle = false;
  session.activeSpaceSharedSnapLine = '';
  session.anchorNodeId = toNodeId;
  refreshStandaloneClosureSuggestion(floor, session);
  return true;
}

function findConnectedDanglingPartner(floor, nodeId) {
  if (!floor || !nodeId) return '';
  const degrees = {};
  (floor.walls || []).forEach((wall) => {
    if (!wall) return;
    degrees[wall.startNodeId] = (degrees[wall.startNodeId] || 0) + 1;
    degrees[wall.endNodeId] = (degrees[wall.endNodeId] || 0) + 1;
  });
  if ((degrees[nodeId] || 0) !== 1) return '';
  const connected = Object.keys(degrees).filter((otherId) => (
    otherId !== nodeId &&
    degrees[otherId] === 1 &&
    findWallPathBetweenNodes(floor, otherId, nodeId, {}).length >= 2
  ));
  return connected.length === 1 ? connected[0] : '';
}

function resumeOpenChainAtDanglingNode(floor, session, nodeId) {
  const partnerId = findConnectedDanglingPartner(floor, nodeId);
  return !!(partnerId && restoreOpenedSpaceChain(floor, session, partnerId, nodeId));
}

module.exports = {
  refreshStandaloneClosureSuggestion,
  restoreOpenedSpaceChain,
  findConnectedDanglingPartner,
  resumeOpenChainAtDanglingNode
};
