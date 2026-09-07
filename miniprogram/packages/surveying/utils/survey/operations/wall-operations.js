const { wrapOperation } = require('./transaction.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { commitPreviewLength } = require('./commit-preview.js');
const { snapCursorToWall } = require('./cursor.js');
const { createWallDeletionOperations } = require('./wall-deletion.js');

function createWallOperations() {
  const deletions = createWallDeletionOperations();
  return {
    commitPreviewLength: wrapOperation('commitPreviewLength', adaptLegacySurveyOperation(commitPreviewLength), { mode: 'full' }),
    deleteWall: deletions.deleteWall,
    deleteClosedSpace: deletions.deleteClosedSpace,
    snapCursorToWall: wrapOperation('snapCursorToWall', adaptLegacySurveyOperation(snapCursorToWall))
  };
}

module.exports = { createWallOperations };
