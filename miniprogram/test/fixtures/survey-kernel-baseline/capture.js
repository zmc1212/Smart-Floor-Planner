const {
  REPRESENTATIVE_FIXTURES,
  createOperationCases,
  surveyGraph
} = require('./representative-fixtures.js');
const { normalizeDraft, normalizeForDraft } = require('./normalize.js');

function captureValidation(draft) {
  return {
    quick: normalizeForDraft(surveyGraph.validateSurveyDraft(draft, { mode: 'quick' }), draft),
    full: normalizeForDraft(surveyGraph.validateSurveyDraft(draft, { mode: 'full' }), draft)
  };
}

function captureReadModels(draft) {
  const before = JSON.stringify(draft);
  const floor = surveyGraph.getActiveFloor(draft);
  const walls = floor.walls.map((wall) => {
    const start = surveyGraph.getNode(floor, wall.startNodeId);
    const end = surveyGraph.getNode(floor, wall.endNodeId);
    const topologyLengthMm = start && end ? surveyGraph.distanceMm(start, end) : 0;
    return {
      id: wall.id,
      measuredReadingMm: surveyGraph.measuredReadingMm(topologyLengthMm, wall),
      projectedFaces: surveyGraph.projectWallFaces(
        wall,
        start,
        end,
        wall.thicknessMm,
        null
      ),
      snapGeometry: surveyGraph.buildWallSnapGeometry(floor, wall),
      renderGeometry: surveyGraph.buildWallRenderGeometry(floor, wall),
      workingFace: surveyGraph.projectWorkingFace(wall, start, end)
    };
  });
  const spaces = floor.spaces
    .filter((space) => space && space.closed)
    .map((space) => ({
      id: space.id,
      topologyBoundary: surveyGraph.buildSpaceBoundaryPoints(floor, space.wallIds),
      innerBoundary: surveyGraph.buildSpaceInnerBoundaryPoints(floor, space),
      renderBoundary: surveyGraph.buildSpaceRenderBoundaryPoints(floor, space),
      dimensionPlan: surveyGraph.buildSpaceDimensionPlan(floor, space),
      areaMm2: surveyGraph.calculateSpaceAreaMm2(draft, space.id)
    }));
  if (JSON.stringify(draft) !== before) {
    throw new Error('Read-model capture mutated its source draft');
  }
  return normalizeForDraft({ walls, spaces }, draft);
}

function captureFixture(fixture) {
  const draft = fixture.build();
  return {
    label: fixture.label,
    validationMode: fixture.validationMode,
    draft: normalizeDraft(draft),
    validation: captureValidation(draft),
    readModels: captureReadModels(draft)
  };
}

function captureError(error, input) {
  return normalizeForDraft({
    name: error && error.name ? error.name : 'Error',
    code: error && error.code ? error.code : null,
    message: error && error.message ? error.message : String(error),
    operationName: error && error.operationName ? error.operationName : null,
    validation: error && error.validation ? error.validation : null
  }, input);
}

function captureOperation(operationCase) {
  const prepared = operationCase.prepare();
  const inputBefore = JSON.stringify(prepared.input);
  const normalizedInput = normalizeDraft(prepared.input);
  const args = normalizeForDraft(prepared.args, prepared.input);
  let outcome;
  try {
    const output = prepared.execute();
    const normalizedOutput = normalizeDraft(output);
    outcome = {
      kind: JSON.stringify(normalizedOutput) === JSON.stringify(normalizedInput) ? 'noop' : 'success',
      output: normalizedOutput,
      session: normalizeForDraft(surveyGraph.getActiveFloor(output).session, output),
      validation: captureValidation(output)
    };
  } catch (error) {
    outcome = {
      kind: 'error',
      error: captureError(error, prepared.input)
    };
  }
  const inputUnchanged = JSON.stringify(prepared.input) === inputBefore;
  return {
    operation: operationCase.riskOperation,
    publicOperation: operationCase.publicOperation || operationCase.riskOperation,
    expectedOutcome: operationCase.expectedOutcome,
    args,
    input: normalizedInput,
    inputSession: normalizeForDraft(
      surveyGraph.getActiveFloor(prepared.input).session,
      prepared.input
    ),
    inputUnchanged,
    outcome
  };
}

function captureSurveyKernelBaseline() {
  return {
    schemaVersion: 1,
    normalization: {
      collectionOrder: 'preserved',
      entityIds: 'mapped by floor collection order',
      floatingPointPrecision: 6,
      volatileTimestamps: '<timestamp>'
    },
    fixtures: Object.fromEntries(REPRESENTATIVE_FIXTURES.map((fixture) => [
      fixture.id,
      captureFixture(fixture)
    ])),
    operations: Object.fromEntries(createOperationCases().map((operationCase) => [
      operationCase.id,
      captureOperation(operationCase)
    ]))
  };
}

module.exports = {
  captureFixture,
  captureOperation,
  captureReadModels,
  captureSurveyKernelBaseline,
  captureValidation
};
