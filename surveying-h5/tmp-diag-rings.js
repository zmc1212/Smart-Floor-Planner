const surveyGraph = require('../miniprogram/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../miniprogram/packages/surveying/utils/surveyCanvasRenderer.js');
const { createScenarioCatalog } = require('./src/scenarios.js');

function pointInPoly(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const current = polygon[i];
    const previous = polygon[j];
    const intersects = ((current.yMm > point.yMm) !== (previous.yMm > point.yMm)) &&
      (point.xMm < (previous.xMm - current.xMm) * (point.yMm - current.yMm) / ((previous.yMm - current.yMm) || 1) + previous.xMm);
    if (intersects) inside = !inside;
  }
  return inside;
}

function toMm(scene, pt) {
  const vp = scene.viewport;
  const rect = scene.rect;
  return {
    xMm: (pt.x - rect.width / 2 - vp.offsetX) / vp.scale,
    yMm: (pt.y - rect.height / 2 - vp.offsetY) / vp.scale
  };
}

function inspect(key) {
  const catalog = createScenarioCatalog(surveyGraph);
  const scenario = catalog.find((item) => item.key === key);
  let draft = scenario.build();
  if (key === 'outer-face-mid-wall-closure') {
    const floor0 = surveyGraph.getActiveFloor(draft);
    const shared = floor0.spaces[0].wallIds.find((id) => floor0.spaces[1].wallIds.includes(id));
    draft = surveyGraph.deleteWall(draft, shared);
  }
  const floor = surveyGraph.getActiveFloor(draft);
  const scene = surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: { scale: 0.05, offsetX: 0, offsetY: 0 },
    rect: { width: 800, height: 800 }
  });
  const space = floor.spaces.find((item) => item.closed);
  const inner = surveyGraph.buildSpaceDimensionPlan(floor, space).innerBoundaryPoints;
  console.log('\n====', key, '====');
  console.log('walls', floor.walls.length, 'rings', (scene.wallSolidPlans.closed.rings || []).length,
    'joins', (scene.wallSolidPlan.joinPolygons || []).length);
  scene.walls.forEach((wall) => {
    const ss = toMm(scene, wall.solidStartPoint);
    const se = toMm(scene, wall.solidEndPoint);
    const os = toMm(scene, wall.solidOuterStart);
    const oe = toMm(scene, wall.solidOuterEnd);
    const mo = toMm(scene, wall.outerStart);
    const me = toMm(scene, wall.outerEnd);
    console.log(wall.id, {
      joined: [wall.startJoined, wall.endJoined],
      open: [wall.startOpen, wall.endOpen],
      topoSrc: wall.wall.topologySourceWallId || '',
      solid: [Math.round(ss.xMm), Math.round(ss.yMm), Math.round(se.xMm), Math.round(se.yMm)].join('>'),
      solidOuter: [Math.round(os.xMm), Math.round(os.yMm), Math.round(oe.xMm), Math.round(oe.yMm)].join('>'),
      miterOuter: [Math.round(mo.xMm), Math.round(mo.yMm), Math.round(me.xMm), Math.round(me.yMm)].join('>')
    });
  });
  (scene.wallSolidPlans.closed.rings || []).forEach((ring, index) => {
    const pts = ring.map((pt) => toMm(scene, pt));
    console.log('ring', index, pts.map((pt) => Math.round(pt.xMm) + ',' + Math.round(pt.yMm)).join(' | '));
  });
  (scene.wallSolidPlan.joinPolygons || []).forEach((poly, index) => {
    const pts = poly.map((pt) => toMm(scene, pt)).map((pt) => Math.round(pt.xMm) + ',' + Math.round(pt.yMm));
    console.log('join', index, pts);
  });
  console.log('overrides', space.wallFaceOverrides || {});
  console.log('overrideBoundaries', (scene.wallFaceOverrideBoundaries || []).length);
  console.log('dims', (scene.dimensions || []).map((d) => d.label + ':' + d.kind));
}

inspect('l-shape');
inspect('outer-face-mid-wall-closure');
inspect('outer-face-mid-wall-deletion');
