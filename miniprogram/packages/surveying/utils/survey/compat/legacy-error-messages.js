const {
  SURVEY_DOMAIN_ERROR_CODES: CODES,
  isSurveyDomainError
} = require('../domain/errors.js');

const MESSAGE_FACTORIES = Object.freeze({
  [CODES.INVALID_INTERIOR_ANGLE]: () => 'Angle must be between 0 and 180 degrees',
  [CODES.INVALID_WALL_LENGTH]: ({ minimumMm }) => `请输入不少于 ${minimumMm} mm 的整数长度`,
  [CODES.INVALID_WALL_THICKNESS]: ({ minimumMm }) => `请输入不少于 ${minimumMm} mm 的整数墙厚`,
  [CODES.INVALID_OPENING_SIZE]: ({ label, minimumMm }) => `${label || 'opening size'} must be an integer >= ${minimumMm} mm`,
  [CODES.INVALID_OPENING_DEPTH]: ({ minimumMm }) => `opening depth must be an integer >= ${minimumMm} mm`,
  [CODES.INVALID_OPENING_SILL_HEIGHT]: () => 'opening sill height must be an integer >= 0 mm',
  [CODES.INVALID_OPENING_OFFSET]: () => 'opening offset must be an integer',
  [CODES.OPENING_SPLIT_CONFLICT]: () => '分隔线压到门窗，请先调整门窗位置',
  [CODES.CURSOR_REQUIRED_FOR_DIRECTION]: () => 'Place the cursor before choosing a wall direction',
  [CODES.STRAIGHT_MODE_REQUIRED_FOR_DIRECTION]: () => 'Direction picking is only available in straight mode',
  [CODES.ORTHOGONAL_DIRECTION_REQUIRED]: () => 'Wall direction must be horizontal or vertical',
  [CODES.DIAGONAL_PREVIEW_REQUIRED]: () => 'A connected diagonal preview is required before measuring its angle',
  [CODES.LATEST_DIAGONAL_NOT_EDITABLE]: () => 'Only the latest unadorned diagonal wall can be remeasured by angle',
  [CODES.LATEST_DIAGONAL_INCOMPLETE]: () => 'The latest diagonal wall is incomplete',
  [CODES.WALL_PREVIEW_REQUIRED]: () => '请先拖出待确认墙体',
  [CODES.WALL_OVERLAP]: () => '当前墙与已测墙重叠，请从光标转角继续测量',
  [CODES.CLOSURE_OUT_OF_TOLERANCE]: ({ toleranceMm }) => `闭合误差超过 ${toleranceMm} mm，请补测最后一面墙`,
  [CODES.UNSAFE_CLOSURE]: () => '当前轮廓不能安全闭合，请继续补测墙体',
  [CODES.PARTITION_SPLIT_UNSAFE]: () => '当前分隔墙无法安全拆分房间，请重新从内部墙开始测量',
  [CODES.SHARED_BOUNDARY_DISCONNECTED]: () => '公共边未连通，请从相邻墙边重新吸附光标',
  [CODES.CLOSED_SPACE_REQUIRED]: () => 'Please select a closed room first',
  [CODES.ROOM_NAME_REQUIRED]: () => 'Room name cannot be empty',
  [CODES.ROOM_NAME_TOO_LONG]: ({ maximumCharacters }) => `Room name cannot exceed ${maximumCharacters} characters`,
  [CODES.WALL_REQUIRED_FOR_OPENING]: () => 'Please select a wall before adding an opening',
  [CODES.OPENING_REQUIRED]: () => 'Please select a door or window first',
  [CODES.OPENING_REMEASURE_CONFLICT]: () => '复尺后的墙长不足以容纳现有门窗，请先调整门窗位置',
  [CODES.REMEASURE_SELECTION_REQUIRED]: () => '请先选择需要复尺的墙体',
  [CODES.SHARED_WALL_REMEASURE_UNSUPPORTED]: () => '共用墙关联多个房间，暂不支持直接复尺，请先解除共用关系',
  [CODES.CLOSED_REMEASURE_UNSAFE]: () => '该闭合房间无法安全联动复尺，请先处理共享节点或斜墙',
  [CODES.INVALID_REMEASURE_ENDPOINT]: () => '复尺墙体端点无效',
  [CODES.REMEASURE_CONNECTED_ENDPOINT]: () => '该墙两端均连接其他墙，无法在不改变相邻实测值的情况下直接复尺',
  [CODES.REMEASURE_LENGTH_TOO_SHORT]: ({ minimumMm }) => `复尺换算后的墙体长度不能少于 ${minimumMm} mm`
});

const LEGACY_CODE_FIELDS = Object.freeze({
  [CODES.OPENING_SPLIT_CONFLICT]: ['wallId', 'openingId', 'cutAlongMm', 'clearanceMm'],
  [CODES.OPENING_REMEASURE_CONFLICT]: [
    'wallId',
    'openingId',
    'prospectiveMeasuredLengthMm'
  ]
});

function formatLegacySurveyError(error) {
  if (!isSurveyDomainError(error)) return error && error.message ? error.message : String(error);
  const format = MESSAGE_FACTORIES[error.code];
  return format ? format(error.details || {}) : error.code;
}

function toLegacySurveyError(error) {
  if (!isSurveyDomainError(error)) return error;
  const legacy = new Error(formatLegacySurveyError(error));
  const fields = LEGACY_CODE_FIELDS[error.code];
  if (fields) {
    legacy.code = error.code;
    fields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(error.details || {}, field)) {
        legacy[field] = error.details[field];
      }
    });
  }
  return legacy;
}

function adaptLegacySurveyOperation(operation) {
  return function legacySurveyOperation(...args) {
    try {
      return operation.apply(this, args);
    } catch (error) {
      throw toLegacySurveyError(error);
    }
  };
}

module.exports = {
  MESSAGE_FACTORIES,
  formatLegacySurveyError,
  toLegacySurveyError,
  adaptLegacySurveyOperation
};
