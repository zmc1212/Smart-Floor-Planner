const test = require('node:test');
const assert = require('node:assert/strict');
const reference = require('./fixtures/survey-kernel-phase2/foundation-reference.js');
const draftCore = require('../packages/surveying/utils/survey/core/draft.js');
const segment = require('../packages/surveying/utils/survey/geometry/segment.js');
const wallDomain = require('../packages/surveying/utils/survey/domain/wall.js');
const kernel = require('../packages/surveying/utils/survey/legacy-kernel.js');
const facade = require('../packages/surveying/utils/surveyWallGraph.js');
const {
  SURVEY_DOMAIN_ERROR_CODES: CODES,
  createSurveyDomainError
} = require('../packages/surveying/utils/survey/domain/errors.js');
const {
  toLegacySurveyError,
  adaptLegacySurveyOperation
} = require('../packages/surveying/utils/survey/compat/legacy-error-messages.js');

test('legacy active-floor access preserves undefined and rejection while guarded core access stays nullable', () => {
  for (const api of [kernel, facade]) {
    assert.equal(api.getActiveFloor({ floors: [] }), undefined);
    assert.throws(() => api.getActiveFloor(null), TypeError);
    assert.throws(() => api.getActiveFloor({}), TypeError);
    const first = { id: 'first' };
    const active = { id: 'active' };
    assert.equal(api.getActiveFloor({ floors: [first, active], activeFloorId: 'active' }), active);
    assert.equal(api.getActiveFloor({ floors: [first], activeFloorId: 'missing' }), first);
  }
  assert.equal(draftCore.getActiveFloor(null), null);
  assert.equal(draftCore.getActiveFloor({}), null);
  assert.equal(draftCore.getActiveFloor({ floors: [] }), null);
});

test('remaining pure line and wall helpers exactly match the frozen Phase 1 formulas', () => {
  let seed = 0x50484132;
  const nextCoordinate = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed % 40001) - 20000;
  };
  const adjustmentCases = [
    [0, 0, 0], [100, 200, 50], [10.49, 20.5, 8.6],
    [-10, null, '8.6'], [undefined, NaN, -50], [20000, 20000, 0]
  ];
  for (let index = 0; index < 256; index += 1) {
    const start = Object.freeze({ xMm: nextCoordinate(), yMm: nextCoordinate() });
    const end = index % 16 === 0
      ? start
      : Object.freeze({ xMm: nextCoordinate(), yMm: nextCoordinate() });
    const point = Object.freeze({ xMm: nextCoordinate(), yMm: nextCoordinate() });
    assert.equal(
      segment.perpendicularDistanceToLineMm(point, start, end),
      reference.perpendicularDistanceToLineMm(point, start, end),
      `line distance case ${index}`
    );
    for (const side of ['left', 'right', '', undefined]) {
      assert.deepEqual(
        wallDomain.normalForMeasurementSide(start, end, side),
        reference.normalForMeasurementSide(start, end, side),
        `normal case ${index}/${side}`
      );
    }
    for (const adjustments of adjustmentCases) {
      assert.equal(
        wallDomain.measuredPreviewLengthMm(start, end, ...adjustments),
        reference.calculateMeasuredPreviewLength(start, end, ...adjustments),
        `preview length case ${index}`
      );
      for (const lengthMm of [100, 1234, 25000]) {
        assert.deepEqual(
          wallDomain.pointFromMeasuredLength(start, end, lengthMm, ...adjustments),
          reference.pointFromLength(start, end, lengthMm, ...adjustments),
          `measured endpoint case ${index}/${lengthMm}`
        );
      }
    }
  }
});

test('remaining pure helpers retain degenerate inputs and preview-versus-stored rounding policy', () => {
  const origin = Object.freeze({ xMm: 0, yMm: 0 });
  const end = Object.freeze({ xMm: 1000, yMm: 0 });
  assert.equal(segment.perpendicularDistanceToLineMm(null, origin, end), Infinity);
  assert.equal(segment.perpendicularDistanceToLineMm(end, null, origin), Infinity);
  assert.equal(segment.perpendicularDistanceToLineMm(end, origin, null), Infinity);
  assert.equal(segment.perpendicularDistanceToLineMm({ xMm: 1, yMm: 1 }, origin, origin), 1);
  assert.equal(wallDomain.normalForMeasurementSide(null, end, 'left'), null);
  assert.equal(wallDomain.normalForMeasurementSide(origin, origin, 'left'), null);
  assert.deepEqual(wallDomain.pointFromMeasuredLength(origin, origin, 100, 10.6, 20.4, 5.6), {
    xMm: 125, yMm: 0
  });
  assert.equal(wallDomain.measuredPreviewLengthMm(origin, end, 10.6, 20.4, 5.6), 975);
  // Stored-wall readings deliberately preserve fractions; preview adjustments
  // are rounded before arithmetic. Do not merge these historical policies.
  assert.equal(wallDomain.measuredReadingMm(1000, {
    measurementStartInsetMm: 10.6,
    measurementEndInsetMm: 20.4,
    measurementStartExtensionMm: 5.6
  }), 974.6);
});

test('every domain error maps to its exact historical message without leaking internal fields', () => {
  const messages = {
    INVALID_INTERIOR_ANGLE: 'Angle must be between 0 and 180 degrees',
    INVALID_WALL_LENGTH: '请输入不少于 100 mm 的整数长度',
    INVALID_WALL_THICKNESS: '请输入不少于 100 mm 的整数墙厚',
    INVALID_OPENING_SIZE: 'opening width must be an integer >= 100 mm',
    INVALID_OPENING_DEPTH: 'opening depth must be an integer >= 100 mm',
    INVALID_OPENING_SILL_HEIGHT: 'opening sill height must be an integer >= 0 mm',
    INVALID_OPENING_OFFSET: 'opening offset must be an integer',
    OPENING_SPLIT_CONFLICT: '分隔线压到门窗，请先调整门窗位置',
    CURSOR_REQUIRED_FOR_DIRECTION: 'Place the cursor before choosing a wall direction',
    STRAIGHT_MODE_REQUIRED_FOR_DIRECTION: 'Direction picking is only available in straight mode',
    ORTHOGONAL_DIRECTION_REQUIRED: 'Wall direction must be horizontal or vertical',
    DIAGONAL_PREVIEW_REQUIRED: 'A connected diagonal preview is required before measuring its angle',
    LATEST_DIAGONAL_NOT_EDITABLE: 'Only the latest unadorned diagonal wall can be remeasured by angle',
    LATEST_DIAGONAL_INCOMPLETE: 'The latest diagonal wall is incomplete',
    WALL_PREVIEW_REQUIRED: '请先拖出待确认墙体',
    WALL_OVERLAP: '当前墙与已测墙重叠，请从光标转角继续测量',
    CLOSURE_OUT_OF_TOLERANCE: '闭合误差超过 350 mm，请补测最后一面墙',
    UNSAFE_CLOSURE: '当前轮廓不能安全闭合，请继续补测墙体',
    PARTITION_SPLIT_UNSAFE: '当前分隔墙无法安全拆分房间，请重新从内部墙开始测量',
    SHARED_BOUNDARY_DISCONNECTED: '公共边未连通，请从相邻墙边重新吸附光标',
    CLOSED_SPACE_REQUIRED: 'Please select a closed room first',
    ROOM_NAME_REQUIRED: 'Room name cannot be empty',
    ROOM_NAME_TOO_LONG: 'Room name cannot exceed 20 characters',
    WALL_REQUIRED_FOR_OPENING: 'Please select a wall before adding an opening',
    OPENING_REQUIRED: 'Please select a door or window first',
    OPENING_REMEASURE_CONFLICT: '复尺后的墙长不足以容纳现有门窗，请先调整门窗位置',
    REMEASURE_SELECTION_REQUIRED: '请先选择需要复尺的墙体',
    SHARED_WALL_REMEASURE_UNSUPPORTED: '共用墙关联多个房间，暂不支持直接复尺，请先解除共用关系',
    CLOSED_REMEASURE_UNSAFE: '该闭合房间无法安全联动复尺，请先处理共享节点或斜墙',
    INVALID_REMEASURE_ENDPOINT: '复尺墙体端点无效',
    REMEASURE_CONNECTED_ENDPOINT: '该墙两端均连接其他墙，无法在不改变相邻实测值的情况下直接复尺',
    REMEASURE_LENGTH_TOO_SHORT: '复尺换算后的墙体长度不能少于 100 mm'
  };
  assert.deepEqual(Object.keys(messages).sort(), Object.values(CODES).sort());
  for (const [code, message] of Object.entries(messages)) {
    const details = {
      minimumMm: 100, toleranceMm: 350, maximumCharacters: 20, label: 'opening width',
      wallId: 'wall-1', openingId: 'opening-1', cutAlongMm: 900,
      clearanceMm: 50, prospectiveMeasuredLengthMm: 800, internalOnly: true
    };
    const error = createSurveyDomainError(code, details);
    const legacy = toLegacySurveyError(error);
    assert.equal(legacy.name, 'Error', code);
    assert.equal(legacy.message, message, code);
    const fields = code === CODES.OPENING_SPLIT_CONFLICT
      ? ['code', 'wallId', 'openingId', 'cutAlongMm', 'clearanceMm']
      : code === CODES.OPENING_REMEASURE_CONFLICT
        ? ['code', 'wallId', 'openingId', 'prospectiveMeasuredLengthMm']
        : [];
    assert.deepEqual(Object.keys(legacy).sort(), fields.sort(), code);
    for (const field of fields) assert.equal(legacy[field], field === 'code' ? code : details[field]);
    assert.equal(error.message, code);
    assert.deepEqual(error.details, details);
  }
});

test('legacy error adaptation preserves receiver, successful identity, and non-domain errors', () => {
  const receiver = { value: {} };
  const operation = adaptLegacySurveyOperation(function () { return this.value; });
  assert.equal(operation.call(receiver), receiver.value);
  const error = new TypeError('original native failure');
  const fail = adaptLegacySurveyOperation(() => { throw error; });
  assert.throws(fail, (actual) => actual === error);
});
