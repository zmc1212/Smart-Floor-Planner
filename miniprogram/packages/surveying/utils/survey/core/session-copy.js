const { ensureSessionSpaceTracking } = require('./session.js');
const { copySessionValue } = require('./session-value.js');
function copySession(session) { return copySessionValue(session); }
function copyTrackedSession(floor) {
  return ensureSessionSpaceTracking(Object.assign({}, floor, { session: copySession(floor.session) }));
}

module.exports = {
  copySessionValue,
  copySession,
  copyTrackedSession
};
