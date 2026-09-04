const { getNode, getWall } = require('../core/graph-query.js');
const { projectPointToSegment: projectPointToWallSegment } = require('../geometry/segment.js');
const { findTargetWallProjection, findWallSnapProjection } = require('../snap/wall-targets.js');
const { projectionIntent } = require('./projection-intent.js');

function planWallSnap(floor, point, target) {
  const explicitWall = target && target.wallId
    ? getWall(floor, target.wallId)
    : (target && target.nodeId
      ? (floor.walls || []).find((wall) => (
        wall.startNodeId === target.nodeId || wall.endNodeId === target.nodeId
      ))
      : null);
  const explicitStart = explicitWall ? getNode(floor, explicitWall.startNodeId) : null;
  const explicitEnd = explicitWall ? getNode(floor, explicitWall.endNodeId) : null;
  const explicitTarget = target && target.nodeId && explicitWall
    ? Object.assign({}, target, {
      point: target.pointMm || point,
      t: typeof target.t === 'number' ? target.t : (
        explicitStart && explicitEnd && target.pointMm
          ? projectPointToWallSegment(target.pointMm, explicitStart, explicitEnd).t
          : 0
      ),
      wall: explicitWall,
      start: explicitStart,
      end: explicitEnd,
      node: getNode(floor, target.nodeId)
    })
    : null;
  const projection = explicitTarget && explicitTarget.wall
    ? explicitTarget
    : (findTargetWallProjection(floor, point, target) || findWallSnapProjection(floor, point));
  // Outer-edge hit testing is a presentation/measurement-side choice. The
  // graph itself is centerline-topological, so keep the snapped node on the
  // source wall centerline; otherwise preview closure points use the centerline
  // while the anchor remains one wall thickness away and the chain disconnects.
  const topologyProjection = projection && projection.snapLine === 'outer' && !projection.node
    ? Object.assign({}, projectPointToWallSegment(projection.point, projection.start, projection.end), {
      wall: projection.wall,
      start: projection.start,
      end: projection.end,
      snapLine: 'inner'
    })
    : projection;

  return { projection: projectionIntent(projection), topologyProjection: projectionIntent(topologyProjection) };
}

module.exports = { planWallSnap };
