const { wrapOperation } = require('./transaction.js');
const { createWallDeletionOperations } = require('./wall-deletion.js');

function createWallOperations(kernel) {
  const deletions = createWallDeletionOperations();
  return {
    commitPreviewLength: wrapOperation('commitPreviewLength', kernel.commitPreviewLength, (draft) => {
      const floor = kernel.getActiveFloor(draft);
      const session = floor.session || {};
      const mode = session.fullValidationAfterClosedSplit ? 'full' : 'quick';
      delete session.fullValidationAfterClosedSplit;
      return {
        mode,
        allowPendingClosure: mode === 'full' && session.closeCandidateType === 'partition'
      };
    }),
    confirmClosure: wrapOperation('confirmClosure', kernel.confirmClosure, { mode: 'full' }),
    deleteWall: deletions.deleteWall,
    deleteClosedSpace: deletions.deleteClosedSpace,
    snapCursorToWall: wrapOperation('snapCursorToWall', kernel.snapCursorToWall),
    remeasureSelectedWall: wrapOperation('remeasureSelectedWall', kernel.remeasureSelectedWall, { mode: 'full' })
  };
}

module.exports = { createWallOperations };
