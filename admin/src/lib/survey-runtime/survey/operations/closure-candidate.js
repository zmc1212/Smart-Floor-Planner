function applyClosureCandidatePlan(session, plan) {
  if (!session || !plan || !plan.sessionPatch) {
    throw new TypeError('闭合候选计划无效');
  }
  Object.assign(session, JSON.parse(JSON.stringify(plan.sessionPatch)));
  return session;
}

module.exports = { applyClosureCandidatePlan };
