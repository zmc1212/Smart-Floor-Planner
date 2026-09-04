const { transitionSessionState } = require('../session/state-machine.js');

function applyClosureCandidatePlan(session, plan, event) {
  if (!session || !plan || !plan.sessionPatch) {
    throw new TypeError('闭合候选计划无效');
  }
  const patch = JSON.parse(JSON.stringify(plan.sessionPatch));
  if (Object.prototype.hasOwnProperty.call(patch, 'state')) {
    transitionSessionState(session, event || 'CLOSURE_CANDIDATE_RESOLVED', patch.state);
    delete patch.state;
  }
  Object.assign(session, patch);
  return session;
}

module.exports = { applyClosureCandidatePlan };
