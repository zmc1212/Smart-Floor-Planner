const {
  canonicalizeSurveyValue,
  compareSurveyDrafts,
  compareSurveyValues,
  formatSurveyDifferences,
  inspectSurveyReferences
} = require('./survey-kernel-semantics.js');

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function exactSnapshot(value) {
  return JSON.stringify(value);
}

function captureError(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    code: error && error.code ? error.code : null,
    message: error && error.message ? error.message : String(error),
    operationName: error && error.operationName ? error.operationName : null,
    validation: error && error.validation ? error.validation : null
  };
}

function resolveOperation(implementation, operationName) {
  if (typeof implementation === 'function') return implementation;
  const operation = implementation && implementation[operationName];
  if (typeof operation !== 'function') {
    throw new TypeError(`Missing differential operation: ${operationName}`);
  }
  return operation;
}

function resolveValidator(side) {
  if (typeof side.validateSurveyDraft === 'function') return side.validateSurveyDraft;
  if (side.implementation && typeof side.implementation.validateSurveyDraft === 'function') {
    return side.implementation.validateSurveyDraft;
  }
  throw new TypeError(`Missing ${side.label} validateSurveyDraft`);
}

function getActiveSession(draft) {
  const floors = draft && Array.isArray(draft.floors) ? draft.floors : [];
  const floor = floors.find((entry) => entry && entry.id === draft.activeFloorId) || floors[0];
  return (floor && floor.session) || {};
}

function validationOptions(draft, mode) {
  const session = getActiveSession(draft);
  return {
    mode,
    allowPendingClosure: mode === 'full' &&
      session.state === 'closing' &&
      session.closeCandidateType === 'partition'
  };
}

function captureValidations(validator, draft) {
  const before = exactSnapshot(draft);
  const quick = validator(draft, validationOptions(draft, 'quick'));
  const afterQuick = exactSnapshot(draft);
  const full = validator(draft, validationOptions(draft, 'full'));
  return {
    quick,
    full,
    inputUnchanged: before === afterQuick && before === exactSnapshot(draft)
  };
}

function runSideOnce(side, operationName, sourceInput, sourceArgs, semanticOptions) {
  const input = clone(sourceInput);
  const args = clone(sourceArgs || []);
  const inputBefore = exactSnapshot(input);
  const argsBefore = exactSnapshot(args);
  const operation = resolveOperation(side.implementation, side.operationName || operationName);
  let output;
  let error = null;
  try {
    output = operation(input, ...args);
    if (!output || typeof output !== 'object') {
      throw new TypeError(`${side.label} ${operationName} did not return a survey draft`);
    }
  } catch (caught) {
    error = captureError(caught);
  }

  const inputUnchanged = inputBefore === exactSnapshot(input);
  const argsUnchanged = argsBefore === exactSnapshot(args);
  if (error) {
    return {
      label: side.label,
      inputUnchanged,
      argsUnchanged,
      outcome: { kind: 'error', error }
    };
  }

  const inputComparison = compareSurveyDrafts(sourceInput, output, semanticOptions);
  const validations = captureValidations(resolveValidator(side), output);
  const referenceIssues = inspectSurveyReferences(output);
  let readModels = null;
  let readModelInputUnchanged = true;
  if (typeof side.captureReadModels === 'function') {
    const outputBeforeRead = exactSnapshot(output);
    readModels = side.captureReadModels(output);
    readModelInputUnchanged = outputBeforeRead === exactSnapshot(output);
  }
  return {
    label: side.label,
    inputUnchanged,
    argsUnchanged,
    outputAliasesInput: output === input,
    outcome: {
      kind: inputComparison.equal ? 'noop' : 'success',
      draft: output,
      validations,
      referenceIssues,
      readModels,
      readModelInputUnchanged
    }
  };
}

function prefixDifferences(differences, comparison, scope) {
  return differences.map((difference) => Object.assign({}, difference, {
    comparison,
    scope
  }));
}

function compareArbitraryForDraft(leftValue, leftDraft, rightValue, rightDraft, options) {
  const left = canonicalizeSurveyValue(leftValue, leftDraft, options);
  const right = canonicalizeSurveyValue(rightValue, rightDraft, options);
  return compareSurveyValues(left, right, {
    numericTolerance: Number(options && options.numericTolerance) || 0
  });
}

function compareRunRecords(left, right, comparison, options) {
  const differences = [];
  if (left.outcome.kind !== right.outcome.kind) {
    differences.push({
      comparison,
      scope: 'outcome',
      path: 'kind',
      kind: 'value',
      expected: left.outcome.kind,
      actual: right.outcome.kind
    });
    if (left.outcome.kind === 'error' || right.outcome.kind === 'error') {
      return differences;
    }
  }
  if (left.outcome.kind === 'error') {
    const errorComparison = compareArbitraryForDraft(
      left.outcome.error,
      options.sourceInput,
      right.outcome.error,
      options.sourceInput,
      options.semanticOptions
    );
    return prefixDifferences(errorComparison.differences, comparison, 'error');
  }

  const graphComparison = compareSurveyDrafts(
    left.outcome.draft,
    right.outcome.draft,
    options.semanticOptions
  );
  differences.push(...prefixDifferences(graphComparison.differences, comparison, 'graph'));

  ['quick', 'full'].forEach((mode) => {
    const validationComparison = compareArbitraryForDraft(
      left.outcome.validations[mode],
      left.outcome.draft,
      right.outcome.validations[mode],
      right.outcome.draft,
      options.semanticOptions
    );
    differences.push(...prefixDifferences(
      validationComparison.differences,
      comparison,
      `validation.${mode}`
    ));
  });

  const referenceComparison = compareArbitraryForDraft(
    left.outcome.referenceIssues,
    left.outcome.draft,
    right.outcome.referenceIssues,
    right.outcome.draft,
    options.semanticOptions
  );
  differences.push(...prefixDifferences(referenceComparison.differences, comparison, 'references'));

  if (left.outcome.readModels !== null || right.outcome.readModels !== null) {
    const readModelComparison = compareArbitraryForDraft(
      left.outcome.readModels,
      left.outcome.draft,
      right.outcome.readModels,
      right.outcome.draft,
      Object.assign({}, options.semanticOptions, {
        numericTolerance: options.derivedTolerance
      })
    );
    differences.push(...prefixDifferences(readModelComparison.differences, comparison, 'readModels'));
  }
  return differences;
}

function guardDifference(comparison, scope, path, expected, actual) {
  return { comparison, scope, path, kind: 'value', expected, actual };
}

function collectRunGuards(record, runLabel, expectedOutcome) {
  const differences = [];
  if (!record.inputUnchanged) {
    differences.push(guardDifference(runLabel, 'immutability', 'input', true, false));
  }
  if (!record.argsUnchanged) {
    differences.push(guardDifference(runLabel, 'immutability', 'args', true, false));
  }
  if (expectedOutcome && record.outcome.kind !== expectedOutcome) {
    differences.push(guardDifference(
      runLabel,
      'outcome',
      'expectedKind',
      expectedOutcome,
      record.outcome.kind
    ));
  }
  if (record.outcome.kind === 'error') return differences;
  if (record.outputAliasesInput) {
    differences.push(guardDifference(runLabel, 'immutability', 'outputAliasesInput', false, true));
  }
  if (!record.outcome.validations.inputUnchanged) {
    differences.push(guardDifference(runLabel, 'immutability', 'validatorInput', true, false));
  }
  ['quick', 'full'].forEach((mode) => {
    if (!record.outcome.validations[mode].valid) {
      differences.push(guardDifference(
        runLabel,
        'validation',
        `${mode}.valid`,
        true,
        false
      ));
    }
  });
  if (record.outcome.referenceIssues.length) {
    differences.push(guardDifference(
      runLabel,
      'references',
      'issues',
      [],
      record.outcome.referenceIssues
    ));
  }
  if (!record.outcome.readModelInputUnchanged) {
    differences.push(guardDifference(runLabel, 'immutability', 'readModelInput', true, false));
  }
  return differences;
}

function runSurveyKernelDifferential(config) {
  if (!config || !config.operationName) throw new TypeError('Differential operationName is required');
  if (!config.legacy || !config.candidate) throw new TypeError('Differential sides are required');
  const sourceInput = clone(config.input);
  const sourceArgs = clone(config.args || []);
  const semanticOptions = { ignoredPaths: config.ignoredPaths || [] };
  const derivedTolerance = Number.isFinite(config.derivedTolerance)
    ? Math.max(0, config.derivedTolerance)
    : 1e-6;
  const sides = {
    legacy: Object.assign({ label: 'legacy' }, config.legacy),
    candidate: Object.assign({ label: 'candidate' }, config.candidate)
  };
  const runs = {
    legacy: {
      first: runSideOnce(sides.legacy, config.operationName, sourceInput, sourceArgs, semanticOptions),
      repeat: runSideOnce(sides.legacy, config.operationName, sourceInput, sourceArgs, semanticOptions)
    },
    candidate: {
      first: runSideOnce(sides.candidate, config.operationName, sourceInput, sourceArgs, semanticOptions),
      repeat: runSideOnce(sides.candidate, config.operationName, sourceInput, sourceArgs, semanticOptions)
    }
  };
  const compareOptions = { sourceInput, semanticOptions, derivedTolerance };
  const differences = [];
  differences.push(...compareRunRecords(
    runs.legacy.first,
    runs.candidate.first,
    'legacy↔candidate',
    compareOptions
  ));
  differences.push(...compareRunRecords(
    runs.legacy.first,
    runs.legacy.repeat,
    'legacy repeat',
    compareOptions
  ));
  differences.push(...compareRunRecords(
    runs.candidate.first,
    runs.candidate.repeat,
    'candidate repeat',
    compareOptions
  ));
  Object.entries(runs).forEach(([sideName, sideRuns]) => {
    Object.entries(sideRuns).forEach(([runName, record]) => {
      differences.push(...collectRunGuards(
        record,
        `${sideName}.${runName}`,
        config.expectedOutcome
      ));
    });
  });
  return {
    caseId: config.caseId || config.operationName,
    operationName: config.operationName,
    equivalent: differences.length === 0,
    differences,
    runs
  };
}

function formatDifferentialReport(report, options) {
  const decorated = report.differences.map((difference) => Object.assign({}, difference, {
    path: `[${difference.comparison} ${difference.scope}] ${difference.path}`
  }));
  return `Survey kernel differential failed for ${report.caseId} (${report.operationName})\n` +
    formatSurveyDifferences(decorated, options);
}

function assertSurveyKernelDifferential(config) {
  const report = runSurveyKernelDifferential(config);
  if (!report.equivalent) {
    const error = new Error(formatDifferentialReport(report));
    error.name = 'SurveyKernelDifferentialError';
    error.report = report;
    throw error;
  }
  return report;
}

module.exports = {
  assertSurveyKernelDifferential,
  captureError,
  formatDifferentialReport,
  runSurveyKernelDifferential
};
