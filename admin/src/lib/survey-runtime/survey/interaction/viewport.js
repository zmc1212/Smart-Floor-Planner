const { copySessionValue } = require('../core/session-value.js');

function planViewport(floor, viewportPatch) {
  const patch = copySessionValue(Object.assign({}, viewportPatch || {}));
  delete patch.rotationRad;
  const viewport = Object.assign({}, copySessionValue(floor.viewport), patch);
  delete viewport.rotationRad;
  return { viewport };
}

module.exports = { planViewport };
