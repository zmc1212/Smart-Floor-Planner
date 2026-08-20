const kernel = require('./survey/legacy-kernel.js');
const { validateSurveyDraft } = require('./survey/invariants/floor-plan-validator.js');
const { createWallOperations } = require('./survey/operations/wall-operations.js');
const { createOpeningOperations } = require('./survey/operations/opening-operations.js');
const { createWallGeometryReadModel } = require('./survey/read-model/wall-geometry.js');
const { createSpaceBoundaryReadModel } = require('./survey/read-model/space-boundary.js');
const { createSpaceDimensionReadModel } = require('./survey/read-model/space-dimensions.js');

const transactionalWalls = createWallOperations(kernel);
const transactionalOpenings = createOpeningOperations(kernel);

module.exports = Object.assign(
  {},
  kernel,
  createWallGeometryReadModel(kernel),
  createSpaceBoundaryReadModel(kernel),
  createSpaceDimensionReadModel(kernel),
  transactionalWalls,
  transactionalOpenings,
  { validateSurveyDraft }
);
