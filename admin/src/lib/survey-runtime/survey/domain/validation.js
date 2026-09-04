const {
  MIN_OPENING_SIZE_MM,
  MIN_THICKNESS_MM,
  MIN_WALL_LENGTH_MM
} = require('../core/constants.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: CODES,
  createSurveyDomainError
} = require('./errors.js');

function reject(code, details) {
  throw createSurveyDomainError(code, details);
}

function validateInteriorAngle(angle) {
  const parsed = Number(angle);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 180) {
    reject(CODES.INVALID_INTERIOR_ANGLE, { value: angle, minExclusive: 0, maxExclusive: 180 });
  }
  return Math.round(parsed * 10) / 10;
}

function validateLength(lengthMm) {
  const parsed = Number(lengthMm);
  if (!Number.isInteger(parsed) || parsed < MIN_WALL_LENGTH_MM) {
    reject(CODES.INVALID_WALL_LENGTH, { value: lengthMm, minimumMm: MIN_WALL_LENGTH_MM });
  }
  return parsed;
}

function validateThickness(thicknessMm) {
  const parsed = Number(thicknessMm);
  if (!Number.isInteger(parsed) || parsed < MIN_THICKNESS_MM) {
    reject(CODES.INVALID_WALL_THICKNESS, { value: thicknessMm, minimumMm: MIN_THICKNESS_MM });
  }
  return parsed;
}

function validateOpeningSize(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_OPENING_SIZE_MM) {
    reject(CODES.INVALID_OPENING_SIZE, {
      value,
      label: label || 'opening size',
      minimumMm: MIN_OPENING_SIZE_MM
    });
  }
  return parsed;
}

function validateOpeningDepth(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_THICKNESS_MM) {
    reject(CODES.INVALID_OPENING_DEPTH, { value, minimumMm: MIN_THICKNESS_MM });
  }
  return parsed;
}

function validateOpeningSillHeight(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    reject(CODES.INVALID_OPENING_SILL_HEIGHT, { value, minimumMm: 0 });
  }
  return parsed;
}

function validateOpeningOffset(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    reject(CODES.INVALID_OPENING_OFFSET, { value });
  }
  return parsed;
}

module.exports = {
  validateInteriorAngle,
  validateLength,
  validateThickness,
  validateOpeningSize,
  validateOpeningDepth,
  validateOpeningSillHeight,
  validateOpeningOffset
};
