const surveyGraph = require('../miniprogram/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../miniprogram/packages/surveying/utils/surveyCanvasRenderer.js');
const { createScenarioCatalog } = require('./src/scenarios.js');

const catalog = createScenarioCatalog(surveyGraph);
const scenario = catalog.find((item) => item.key === 'outer-face-mid-wall-closure');
const source = scenario.build();
const floor0 = surveyGraph.getActiveFloor(source);

function dump(label, draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  console.log('\n==== ' + label + ' ====');
  console.log('walls', floor.walls.length, 'nodes', floor.nodes.length, 'closed spaces',
    (floor.spaces || []).filter((s) => s.closed).length, 'state', floor.session.state);
  (floor.spaces || []).forEach((space, i) => {
    console.log(' space', i, space.name, 'closed=' + space.closed, 'wallIds', space.wallIds.join(','));
    if (space.wallFaceOverrides) console.log('  faceOverrides', space.wallFaceOverrides);
  });
  floor.walls.forEach((wall) => {
    const a = surveyGraph.getNode(floor, wall.startNodeId);
    const b = surveyGraph.getNode(floor, wall.endNodeId);
    const geom = surveyGraph.buildWallRenderGeometry(floor, wall);
    console.log({
      id: wall.id,
      len: wall.lengthMm,
      inset: [wall.measurementStartInsetMm || 0, wall.measurementEndInsetMm || 0],
      ext: wall.measurementStartExtensionMm || 0,
      side: wall.measurementSide,
      body: wall.bodyNormalSide,
      topoSrc: wall.topologySourceWallId || '',
      nodes: (a ? a.xMm + ',' + a.yMm : '?') + ' -> ' + (b ? b.xMm + ',' + b.yMm : '?'),
      render: geom ? {
        start: geom.start.xMm + ',' + geom.start.yMm,
        end: geom.end.xMm + ',' + geom.end.yMm,
        outerS: geom.outerStart.xMm + ',' + geom.outerStart.yMm,
        outerE: geom.outerEnd.xMm + ',' + geom.outerEnd.yMm
      } : null
    });
  });
  const closed = (floor.spaces || []).filter((s) => s.closed);
  closed.forEach((space) => {
    const pts = surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds)
      .map((p) => p.xMm + ',' + p.yMm);
    const plan = surveyGraph.buildSpaceDimensionPlan(floor, space);
    console.log(' boundary', space.name, pts);
    console.log(' inner', plan && plan.innerBoundaryPoints.map((p) => Math.round(p.xMm) + ',' + Math.round(p.yMm)));
  });
}

dump('BEFORE delete', source);

const shared = floor0.spaces[0].wallIds.filter((id) => floor0.spaces[1].wallIds.includes(id));
console.log('\nshared wall ids', shared);
shared.forEach((id) => {
  const w = surveyGraph.getWall(floor0, id);
  const a = surveyGraph.getNode(floor0, w.startNodeId);
  const b = surveyGraph.getNode(floor0, w.endNodeId);
  console.log(' shared', id, a.xMm + ',' + a.yMm, '->', b.xMm + ',' + b.yMm, 'len', w.lengthMm);
});

const merged = surveyGraph.deleteWall(source, shared[0]);
dump('AFTER delete shared[0]', merged);

const mergedFloor = surveyGraph.getActiveFloor(merged);
const scene = surveyCanvasRenderer.createSurveyRenderScene({
  floor: mergedFloor,
  session: mergedFloor.session,
  viewport: mergedFloor.viewport || { scale: 0.05, offsetX: 0, offsetY: 0 },
  rect: { width: 800, height: 800 }
});
console.log('\nscene walls', scene.walls.map((w) => ({
  id: w.id,
  start: Math.round(w.startPoint.x) + ',' + Math.round(w.startPoint.y),
  end: Math.round(w.endPoint.x) + ',' + Math.round(w.endPoint.y),
  solidS: Math.round(w.solidStartPoint.x) + ',' + Math.round(w.solidStartPoint.y),
  solidE: Math.round(w.solidEndPoint.x) + ',' + Math.round(w.solidEndPoint.y),
  outerS: Math.round(w.outerStart.x) + ',' + Math.round(w.outerStart.y),
  outerE: Math.round(w.outerEnd.x) + ',' + Math.round(w.outerEnd.y),
  thicknessPx: Math.round(w.thicknessPx),
  closed: w.closed
})));
console.log('fill rings', scene.closedSpaceFills.map((f) => f.points.length));
