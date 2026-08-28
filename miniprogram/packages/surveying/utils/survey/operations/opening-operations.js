const { wrapOperation } = require('./transaction.js');

function createOpeningOperations(kernel) {
  return {
    addOpeningToWall: wrapOperation('addOpeningToWall', kernel.addOpeningToWall),
    updateOpening: wrapOperation('updateOpening', kernel.updateOpening),
    deleteOpening: wrapOperation('deleteOpening', kernel.deleteOpening)
  };
}

module.exports = { createOpeningOperations };
