const { wrapOperation } = require('./transaction.js');

function createWallOperations(kernel) {
  return {
    commitPreviewLength: wrapOperation('commitPreviewLength', kernel.commitPreviewLength, (draft) => {
      const floor = kernel.getActiveFloor(draft);
      const session = floor.session || {};
      const mode = session.fullValidationAfterClosedSplit ? 'full' : 'quick';
      delete session.fullValidationAfterClosedSplit;
      return { mode };
    }),
    confirmClosure: wrapOperation('confirmClosure', kernel.confirmClosure, { mode: 'full' }),
    deleteWall: wrapOperation('deleteWall', kernel.deleteWall, { mode: 'full' }),
    snapCursorToWall: wrapOperation('snapCursorToWall', kernel.snapCursorToWall),
    remeasureSelectedWall: wrapOperation('remeasureSelectedWall', kernel.remeasureSelectedWall)
  };
}

module.exports = { createWallOperations };
