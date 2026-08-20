const { validateSurveyDraft } = require('../invariants/floor-plan-validator.js');

const TRANSACTION_DRAFT_SYMBOL = Symbol.for('smart-floor-planner.survey-transaction-draft');

class SurveyInvariantError extends Error {
  constructor(operationName, validation) {
    const first = validation.errors[0];
    super(first ? first.message : `量房操作 ${operationName} 未通过拓扑校验`);
    this.name = 'SurveyInvariantError';
    this.code = first ? first.code : 'SURVEY_INVARIANT_FAILED';
    this.operationName = operationName;
    this.validation = validation;
  }
}

function runSurveyTransaction(draft, operationName, mutator, options) {
  if (!draft || typeof mutator !== 'function') throw new TypeError('量房事务参数无效');
  const transactionTime = new Date().toISOString();
  const workingDraft = JSON.parse(JSON.stringify(draft));
  Object.defineProperty(workingDraft, TRANSACTION_DRAFT_SYMBOL, {
    value: true,
    configurable: true,
    enumerable: false
  });
  const nextDraft = mutator(workingDraft) || workingDraft;
  if (nextDraft && nextDraft[TRANSACTION_DRAFT_SYMBOL]) {
    delete nextDraft[TRANSACTION_DRAFT_SYMBOL];
  }
  nextDraft.updatedAt = transactionTime;
  const resolvedOptions = typeof options === 'function' ? (options(nextDraft) || {}) : (options || {});
  const validation = validateSurveyDraft(nextDraft, { mode: resolvedOptions.mode || 'quick' });
  if (!validation.valid) throw new SurveyInvariantError(operationName, validation);
  return nextDraft;
}

function wrapOperation(operationName, operation, options) {
  return function transactionalOperation(draft, ...args) {
    return runSurveyTransaction(draft, operationName, (source) => operation(source, ...args), options);
  };
}

module.exports = {
  SurveyInvariantError,
  runSurveyTransaction,
  wrapOperation
};
