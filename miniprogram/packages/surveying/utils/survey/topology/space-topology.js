const { buildSpaceNodeCycle } = require('../domain/space.js');

function isClosedSpace(space, index) {
  return !!(space && space.closed && buildSpaceNodeCycle(space, index).length >= 3);
}

module.exports = { isClosedSpace };
