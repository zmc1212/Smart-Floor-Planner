import type { FormalSurveyLayout } from '@/lib/survey-graph';

import surveyValidator from '@/lib/survey-runtime/survey/invariants/floor-plan-validator.js';

export type FormalSurveyValidationMode = 'quick' | 'full';

export type FormalSurveyValidationIssue = {
  code: string;
  path: string;
  message: string;
  details?: unknown;
};

export type FormalSurveyWriteValidation = {
  mode: FormalSurveyValidationMode;
  errors: FormalSurveyValidationIssue[];
  stats: Record<string, unknown>;
};

type KernelValidationResult = {
  valid: boolean;
  errors: FormalSurveyValidationIssue[];
  stats: Record<string, unknown>;
};

const MISSING_CLOSED_SPACE: FormalSurveyValidationIssue = {
  code: 'MISSING_CLOSED_SPACE',
  path: 'surveyGraph.floors',
  message: '请先完成至少一个闭合空间',
};

function hasClosedSpace(layout: FormalSurveyLayout) {
  return layout.surveyGraph.floors.some((floor) =>
    (floor?.spaces || []).some((space) => space?.closed === true)
  );
}

export function validateFormalSurveyWrite(
  layout: FormalSurveyLayout,
  status: 'draft' | 'completed'
): FormalSurveyWriteValidation {
  const mode: FormalSurveyValidationMode = 'full';
  const result = surveyValidator.validateSurveyDraft(
    layout.surveyGraph,
    { mode, requireComplete: status === 'completed' }
  ) as KernelValidationResult;
  const errors = result.errors.slice();


  if (status === 'completed' && !hasClosedSpace(layout)) {
    errors.unshift(MISSING_CLOSED_SPACE);
  }

  return {
    mode,
    errors,
    stats: result.stats,
  };
}

export class FormalSurveyWriteValidationError extends Error {
  readonly status = 422;
  readonly code: string;
  readonly validation: FormalSurveyWriteValidation;

  constructor(validation: FormalSurveyWriteValidation) {
    const firstError = validation.errors[0];
    super(firstError?.message || '正式量房拓扑校验失败');
    this.name = 'FormalSurveyWriteValidationError';
    this.code = firstError?.code || 'INVALID_SURVEY_GRAPH';
    this.validation = validation;
  }
}

export function assertFormalSurveyWrite(
  layout: FormalSurveyLayout,
  status: 'draft' | 'completed'
) {
  const validation = validateFormalSurveyWrite(layout, status);
  if (validation.errors.length) {
    throw new FormalSurveyWriteValidationError(validation);
  }
  return validation;
}
