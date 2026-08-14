const { wrapOperation } = require('./transaction.js');

function createWallOperations(kernel) {
  return {
    commitPreviewLength: wrapOperation('commitPreviewLength', kernel.commitPreviewLength),
    confirmClosure: wrapOperation('confirmClosure', kernel.confirmClosure),
    deleteWall: wrapOperation('deleteWall', kernel.deleteWall),
    snapCursorToWall: wrapOperation('snapCursorToWall', kernel.snapCursorToWall),
    remeasureSelectedWall: wrapOperation('remeasureSelectedWall', kernel.remeasureSelectedWall)
  };
}

module.exports = { createWallOperations };
