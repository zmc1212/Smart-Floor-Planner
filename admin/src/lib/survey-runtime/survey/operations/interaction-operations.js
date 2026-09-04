const actions = require('./session-actions.js');
const preview = require('./preview.js');
const cursor = require('./cursor.js');
const viewport = require('./viewport.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');

// Public compatibility adapters only. Input interpretation lives in interaction;
// draft/session application and graph edits live in operations.
module.exports = {
  setMode: actions.setMode,
  placeCursor: cursor.placeCursor,
  placeNewWallChainCursor: cursor.placeNewWallChainCursor,
  startPreview: preview.startPreview,
  startPreviewFromBearing: adaptLegacySurveyOperation(preview.startPreviewFromBearing),
  lockPreviewBearing: adaptLegacySurveyOperation(actions.lockPreviewBearing),
  clearBleLockedBearing: actions.clearBleLockedBearing,
  materializeLockedPreview: adaptLegacySurveyOperation(preview.materializeLockedPreview),
  holdPreviewForInput: actions.holdPreviewForInput,
  applyPreviewInteriorAngle: adaptLegacySurveyOperation(preview.applyPreviewInteriorAngle),
  reopenLastDiagonalWallForAngle: adaptLegacySurveyOperation(preview.reopenLastDiagonalWallForAngle),
  cancelPending: actions.cancelPending,
  selectWall: actions.selectWall,
  selectOpening: actions.selectOpening,
  selectSpace: actions.selectSpace,
  startWallSnap: actions.startWallSnap,
  startRemeasure: actions.startRemeasure,
  setFixedNode: actions.setFixedNode,
  resetCursor: cursor.resetCursor,
  updateViewport: viewport.updateViewport
};
