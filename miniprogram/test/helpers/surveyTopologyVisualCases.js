const surveyGraph = require('../../utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../../packages/surveying/utils/surveyCanvasRenderer.js');

const RECT = { width: 520, height: 520 };

function commitPreview(draft, rawPoint) {
  const preview = surveyGraph.startPreview(draft, rawPoint);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(
    preview,
    floor.session.previewLengthMm,
    'visual-regression'
  );
}

function createScene(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: RECT
  });
}

function midpoint(first, second) {
  return {
    xMm: Math.round((first.xMm + second.xMm) / 2),
    yMm: Math.round((first.yMm + second.yMm) / 2)
  };
}

function wallTargetPoint(floor, wall, snapFace) {
  const start = surveyGraph.getNode(floor, wall.startNodeId);
  const end = surveyGraph.getNode(floor, wall.endNodeId);
  if (snapFace !== 'outer') return midpoint(start, end);
  const geometry = surveyGraph.buildWallRenderGeometry(floor, wall);
  return midpoint(geometry.outerStart, geometry.outerEnd);
}

function snapToWall(draft, wall, snapFace) {
  const floor = surveyGraph.getActiveFloor(draft);
  const targetPoint = wallTargetPoint(floor, wall, snapFace);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    targetPoint,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  return surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
}

function createClosedRectangle(thicknessMm) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, thicknessMm);
  draft = surveyGraph.placeCursor(draft, { xMm: -3000, yMm: -1800 });
  draft = commitPreview(draft, { xMm: 3000, yMm: -1800 });
  draft = commitPreview(draft, { xMm: 3000, yMm: 1800 });
  draft = commitPreview(draft, { xMm: -3000, yMm: 1800 });
  draft = commitPreview(draft, { xMm: -3000, yMm: -1800 });
  return surveyGraph.confirmClosure(draft);
}

function createTwoRoomDraft() {
  let draft = createClosedRectangle(200);
  let floor = surveyGraph.getActiveFloor(draft);
  draft = snapToWall(draft, floor.walls[0], 'inner');
  draft = commitPreview(draft, { xMm: 0, yMm: 1800 });
  floor = surveyGraph.getActiveFloor(draft);
  if (floor.session.state === 'closing') draft = surveyGraph.confirmClosure(draft);
  return draft;
}

function findWallByEndpoints(floor, first, second) {
  return floor.walls.find((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    return (
      (start.xMm === first.xMm && start.yMm === first.yMm &&
        end.xMm === second.xMm && end.yMm === second.yMm) ||
      (end.xMm === first.xMm && end.yMm === first.yMm &&
        start.xMm === second.xMm && start.yMm === second.yMm)
    );
  });
}

function createTwoRoomExteriorT() {
  let draft = createTwoRoomDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = findWallByEndpoints(
    floor,
    { xMm: -3000, yMm: 1800 },
    { xMm: 0, yMm: 1800 }
  );
  draft = snapToWall(draft, sourceWall, 'inner');
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  draft = commitPreview(draft, { xMm: -1500, yMm: 3300 });
  floor = surveyGraph.getActiveFloor(draft);
  return {
    name: 'two-room-exterior-t',
    draft,
    scene: createScene(draft),
    junctionNodeId,
    junction: surveyGraph.getNode(floor, junctionNodeId)
  };
}

function createSharedWallT() {
  let draft = createTwoRoomDraft();
  let floor = surveyGraph.getActiveFloor(draft);
  const wallUseCounts = {};
  floor.spaces.filter((space) => space.closed).forEach((space) => {
    space.wallIds.forEach((wallId) => {
      wallUseCounts[wallId] = (wallUseCounts[wallId] || 0) + 1;
    });
  });
  const sourceWall = floor.walls.find((wall) => wallUseCounts[wall.id] === 2);
  draft = snapToWall(draft, sourceWall, 'outer');
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  draft = commitPreview(draft, { xMm: 1800, yMm: 0 });
  floor = surveyGraph.getActiveFloor(draft);
  return {
    name: 'shared-wall-t',
    draft,
    scene: createScene(draft),
    junctionNodeId,
    junction: surveyGraph.getNode(floor, junctionNodeId)
  };
}

function createClosedExteriorT(options) {
  const opts = options || {};
  let draft = createClosedRectangle(opts.sourceThicknessMm || 200);
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  draft = surveyGraph.setThickness(draft, opts.branchThicknessMm || 200);
  draft = snapToWall(draft, sourceWall, opts.snapFace || 'inner');
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  draft = commitPreview(draft, { xMm: 0, yMm: -3300 });
  floor = surveyGraph.getActiveFloor(draft);
  const junction = surveyGraph.getNode(floor, junctionNodeId);
  return {
    name: opts.name || 'closed-exterior-t',
    draft,
    scene: createScene(draft),
    junctionNodeId,
    junction
  };
}

function createDiagonalT(options) {
  const opts = options || {};
  const angleRad = (opts.angleDeg || 35) * Math.PI / 180;
  const direction = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.setThickness(draft, opts.thicknessMm || 400);
  draft = surveyGraph.placeCursor(draft, {
    xMm: Math.round(-direction.x * 3000),
    yMm: Math.round(-direction.y * 3000)
  });
  draft = commitPreview(draft, {
    xMm: Math.round(direction.x * 3000),
    yMm: Math.round(direction.y * 3000)
  });
  let floor = surveyGraph.getActiveFloor(draft);
  const sourceWall = floor.walls[0];
  draft = snapToWall(draft, sourceWall, opts.snapFace || 'outer');
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  draft = commitPreview(draft, {
    xMm: Math.round(-direction.y * 1800),
    yMm: Math.round(direction.x * 1800)
  });
  floor = surveyGraph.getActiveFloor(draft);
  return {
    name: opts.name || 'diagonal-t',
    draft,
    scene: createScene(draft),
    junctionNodeId,
    junction: surveyGraph.getNode(floor, junctionNodeId)
  };
}

function createCross() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: -3000, yMm: 0 });
  draft = commitPreview(draft, { xMm: 3000, yMm: 0 });
  let floor = surveyGraph.getActiveFloor(draft);
  draft = snapToWall(draft, floor.walls[0], 'inner');
  floor = surveyGraph.getActiveFloor(draft);
  const junctionNodeId = floor.session.anchorNodeId;
  draft = commitPreview(draft, { xMm: 0, yMm: -1800 });
  floor = surveyGraph.getActiveFloor(draft);
  const junction = surveyGraph.getNode(floor, junctionNodeId);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    junction,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  draft = surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
  draft = commitPreview(draft, { xMm: 0, yMm: 1800 });
  floor = surveyGraph.getActiveFloor(draft);
  return {
    name: 'cross-junction',
    draft,
    scene: createScene(draft),
    junctionNodeId,
    junction: surveyGraph.getNode(floor, junctionNodeId)
  };
}

function deleteTBranch(sourceCase) {
  const floor = surveyGraph.getActiveFloor(sourceCase.draft);
  const branch = floor.walls.find((wall) => (
    (wall.startNodeId === sourceCase.junctionNodeId || wall.endNodeId === sourceCase.junctionNodeId) &&
    !wall.topologySourceWallId
  ));
  const draft = surveyGraph.deleteWall(sourceCase.draft, branch.id);
  return {
    name: 't-after-branch-delete',
    draft,
    scene: createScene(draft),
    junctionNodeId: sourceCase.junctionNodeId,
    junction: surveyGraph.getNode(surveyGraph.getActiveFloor(draft), sourceCase.junctionNodeId)
  };
}

function projectJunction(caseItem) {
  const viewport = caseItem.scene.viewport;
  return {
    x: RECT.width / 2 + viewport.offsetX + caseItem.junction.xMm * viewport.scale,
    y: RECT.height / 2 + viewport.offsetY + caseItem.junction.yMm * viewport.scale
  };
}

function buildVisualCases() {
  const equalT = createClosedExteriorT({ name: 'closed-exterior-t-200' });
  const unequalT = createClosedExteriorT({
    name: 'closed-exterior-t-100-400',
    sourceThicknessMm: 100,
    branchThicknessMm: 400,
    snapFace: 'outer'
  });
  return [
    equalT,
    unequalT,
    createDiagonalT({ name: 'diagonal-t-35deg-400', angleDeg: 35, thicknessMm: 400 }),
    createTwoRoomExteriorT(),
    createSharedWallT(),
    createCross(),
    deleteTBranch(equalT)
  ].map((caseItem) => ({ ...caseItem, junctionPx: projectJunction(caseItem) }));
}

module.exports = {
  RECT,
  buildVisualCases
};
