const { wrapOperation } = require('./transaction.js');
const { getActiveFloor } = require('../core/draft.js');
const { adaptLegacySurveyOperation } = require('../compat/legacy-error-messages.js');
const { commitPreviewLength } = require('./commit-preview.js');
const { snapCursorToWall } = require('./cursor.js');
const { createWallDeletionOperations } = require('./wall-deletion.js');

function createWallOperations() {
  const deletions = createWallDeletionOperations();
  return {
    commitPreviewLength: wrapOperation('commitPreviewLength', adaptLegacySurveyOperation(commitPreviewLength), draft => {
      const session = getActiveFloor(draft).session || {};
      const mode = session.fullValidationAfterClosedSplit ? 'full' : 'quick';
      delete session.fullValidationAfterClosedSplit;
      return { mode, allowPendingClosure: mode === 'full' && session.closeCandidateType === 'partition' };
    }),
    deleteWall: deletions.deleteWall,
    deleteClosedSpace: deletions.deleteClosedSpace,
    snapCursorToWall: wrapOperation('snapCursorToWall', adaptLegacySurveyOperation(snapCursorToWall))
  };
}

module.exports = { createWallOperations };
