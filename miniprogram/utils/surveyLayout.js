const FORMAL_LAYOUT_VERSION = 4;
const FORMAL_MEASUREMENT_MODE = 'surveying';
const FORMAL_LAYOUT_KEYS = ['version', 'measurementMode', 'surveyGraph'];

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

function clonePersistableSurveyGraph(surveyGraphData) {
  const graph = clone(surveyGraphData);
  const floors = graph && Array.isArray(graph.floors) ? graph.floors : [];
  floors.forEach((floor) => {
    if (floor && floor.session) delete floor.session.bleLockedBearingDeg;
  });
  return graph;
}

function isFormalSurveyLayout(layoutData) {
  return !!(
    layoutData &&
    typeof layoutData === 'object' &&
    !Array.isArray(layoutData) &&
    Object.keys(layoutData).every((key) => FORMAL_LAYOUT_KEYS.includes(key)) &&
    layoutData.version === FORMAL_LAYOUT_VERSION &&
    layoutData.measurementMode === FORMAL_MEASUREMENT_MODE &&
    layoutData.surveyGraph &&
    layoutData.surveyGraph.kind === 'survey-wall-graph'
  );
}

function parseFormalSurveyLayout(layoutData) {
  let parsed = layoutData;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch (err) {
      return null;
    }
  }
  return isFormalSurveyLayout(parsed) ? parsed : null;
}

function createFormalSurveyLayout(surveyGraphData, status) {
  const graph = clonePersistableSurveyGraph(surveyGraphData);
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) {
    throw new Error('createFormalSurveyLayout requires a survey wall graph');
  }
  graph.status = status === 'completed' ? 'completed' : 'draft';
  graph.updatedAt = new Date().toISOString();
  return {
    version: FORMAL_LAYOUT_VERSION,
    measurementMode: FORMAL_MEASUREMENT_MODE,
    surveyGraph: graph
  };
}

function getActiveFloorFromGraph(graph) {
  const floors = graph && Array.isArray(graph.floors) ? graph.floors : [];
  if (!floors.length) return null;
  return floors.find((floor) => floor && floor.id === graph.activeFloorId) || floors[0];
}

function getActiveFloor(layoutData) {
  const layout = parseFormalSurveyLayout(layoutData);
  if (!layout) return null;
  return getActiveFloorFromGraph(layout.surveyGraph);
}

module.exports = {
  FORMAL_LAYOUT_VERSION,
  FORMAL_MEASUREMENT_MODE,
  isFormalSurveyLayout,
  parseFormalSurveyLayout,
  clonePersistableSurveyGraph,
  createFormalSurveyLayout,
  getActiveFloor
};
