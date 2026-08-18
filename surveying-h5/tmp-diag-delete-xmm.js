const surveyGraph = require('../miniprogram/utils/surveyWallGraph.js');
const surveyCanvasRenderer = require('../miniprogram/packages/surveying/utils/surveyCanvasRenderer.js');
const { createScenarioCatalog } = require('./src/scenarios.js');

function createScene(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyCanvasRenderer.createSurveyRenderScene({
    floor,
    session: floor.session,
    viewport: floor.viewport,
    rect: { width: 400, height: 400 }
  });
}

function inspectFloor(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  const missing = [];
  (floor.walls || []).forEach((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    if (!start || !end) {
      missing.push({
        wallId: wall.id,
        startNodeId: wall.startNodeId,
        endNodeId: wall.endNodeId,
        start: !!start,
        end: !!end
      });
    }
  });
  const danglingSpaces = (floor.spaces || []).filter((space) => (
    space && space.closed && Array.isArray(space.wallIds) &&
    space.wallIds.some((id) => !surveyGraph.getWall(floor, id))
  )).map((space) => ({
    id: space.id,
    name: space.name,
    missing: space.wallIds.filter((id) => !surveyGraph.getWall(floor, id))
  }));
  return {
    state: floor.session && floor.session.state,
    walls: (floor.walls || []).length,
    spaces: (floor.spaces || []).filter((s) => s.closed).length,
    missingWallNodes: missing,
    danglingSpaces,
    anchorNodeId: floor.session && floor.session.anchorNodeId,
    anchorExists: !!(floor.session && floor.session.anchorNodeId &&
      surveyGraph.getNode(floor, floor.session.anchorNodeId))
  };
}

function tryRender(label, draft) {
  try {
    const floor = surveyGraph.getActiveFloor(draft);
    (floor.spaces || []).filter((space) => space.closed).forEach((space) => {
      surveyGraph.calculateSpaceAreaMm2(draft, space.id);
    });
    createScene(draft);
    return null;
  } catch (error) {
    return {
      label,
      message: error && error.message,
      stack: error && error.stack,
      inspect: inspectFloor(draft)
    };
  }
}

const catalog = createScenarioCatalog(surveyGraph);
const failures = [];

catalog.forEach((scenario) => {
  const source = scenario.build();
  const floor = surveyGraph.getActiveFloor(source);
  const wallIds = (floor.walls || []).map((wall) => wall.id);
  wallIds.forEach((wallId, index) => {
    let next;
    try {
      next = surveyGraph.deleteWall(source, wallId);
    } catch (error) {
      failures.push({
        label: `${scenario.key} deleteWall[${index}] ${wallId}`,
        message: error && error.message,
        stack: error && error.stack,
        inspect: inspectFloor(source)
      });
      return;
    }
    const failure = tryRender(`${scenario.key} after delete[${index}] ${wallId}`, next);
    if (failure) failures.push(failure);
  });
});

console.log(JSON.stringify({
  scenarios: catalog.length,
  failures: failures.length,
  first: failures[0] || null
}, null, 2));
if (failures[0] && failures[0].stack) {
  console.error(failures[0].stack);
}
