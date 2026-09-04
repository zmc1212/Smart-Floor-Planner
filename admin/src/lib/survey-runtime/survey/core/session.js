const { DEFAULT_THICKNESS_MM } = require('./constants.js');
const { SESSION_FIELD_GROUPS, readSessionGroups } = require('../session/field-groups.js');

const SESSION_STATES = Object.freeze({
  IDLE: 'idle',
  CURSOR_PLACED: 'cursorPlaced',
  WALL_PREVIEW: 'wallPreview',
  AWAITING_LENGTH: 'awaitingLength',
  WALL_COMMITTED: 'wallCommitted',
  CLOSING: 'closing',
  MERGE_CLOSING: 'mergeClosing',
  SPACE_CLOSED: 'spaceClosed',
  WALL_SELECTED: 'wallSelected',
  WALL_SNAP_PENDING: 'wallSnapPending',
  REMEASURE_AWAITING_INPUT: 'remeasureAwaitingInput'
});

const SESSION_DEFAULTS = Object.freeze({
  state: SESSION_STATES.IDLE,
  anchorNodeId: '',
  previewPoint: null,
  previewAngleDeg: 0,
  previewLengthMm: 0,
  previewAngleSource: '',
  previewInteriorAngleDeg: null,
  mode: 'straight',
  thicknessMm: DEFAULT_THICKNESS_MM,
  measurementSide: 'left',
  pendingWallId: '',
  selectedWallId: '',
  selectedOpeningId: '',
  selectedSpaceId: '',
  closeCandidateNodeId: '',
  closeCandidatePoint: null,
  closeCandidateType: '',
  closeCandidateSharedWallId: '',
  alignmentSnapGuide: null,
  activeSpaceStartNodeId: '',
  activeSpaceStartWallIndex: 0,
  activeSpaceSharedWallId: '',
  activeSpaceSharedStartT: null,
  activeSpaceSharedWallMiddle: false,
  activeSpaceSharedSnapLine: '',
  partitionSourceSpaceId: '',
  lastWallSnapNodeId: '',
  lastWallSnapWallId: '',
  lastWallSnapT: null,
  lastWallSnapWallMiddle: false,
  lastWallSnapLine: '',
  previewMeasurementSide: '',
  previewBodyNormalSide: '',
  measurementSideUserSet: false,
  previewMeasurementStartInsetMm: 0,
  previewMeasurementStartExtensionMm: 0,
  previewMeasurementEndInsetMm: 0,
  previewOuterFaceWallId: ''
});

const OPTIONAL_SESSION_FIELDS = Object.freeze([
  'bleLockedBearingDeg',
  'closedFromNodeId',
  'fixedNodeId',
  'fullValidationAfterClosedSplit'
]);

const NODE_REFERENCE_FIELDS = Object.freeze([
  'anchorNodeId',
  'closeCandidateNodeId',
  'activeSpaceStartNodeId',
  'lastWallSnapNodeId',
  'fixedNodeId'
]);

const WALL_REFERENCE_FIELDS = Object.freeze([
  'pendingWallId',
  'selectedWallId',
  'closeCandidateSharedWallId',
  'activeSpaceSharedWallId',
  'lastWallSnapWallId'
]);

const TRANSIENT_WALL_REFERENCE_FIELDS = Object.freeze(['previewOuterFaceWallId']);
const OPENING_REFERENCE_FIELDS = Object.freeze(['selectedOpeningId']);
const SPACE_REFERENCE_FIELDS = Object.freeze(['selectedSpaceId', 'partitionSourceSpaceId']);

function createSession(defaultThicknessMm) {
  return Object.assign({}, SESSION_DEFAULTS, {
    thicknessMm: Number.isFinite(Number(defaultThicknessMm))
      ? Number(defaultThicknessMm)
      : SESSION_DEFAULTS.thicknessMm
  });
}

function ensureSessionSpaceTracking(floor, defaultThicknessMm) {
  const session = floor.session || createSession(defaultThicknessMm);
  floor.session = session;
  if (typeof session.activeSpaceStartNodeId !== 'string') {
    session.activeSpaceStartNodeId = '';
  }
  if (!Number.isInteger(session.activeSpaceStartWallIndex) || session.activeSpaceStartWallIndex < 0) {
    session.activeSpaceStartWallIndex = 0;
  }
  if (session.activeSpaceStartWallIndex > floor.walls.length) {
    session.activeSpaceStartWallIndex = floor.walls.length;
  }
  if (typeof session.activeSpaceSharedWallId !== 'string') {
    session.activeSpaceSharedWallId = '';
  }
  if (typeof session.activeSpaceSharedStartT !== 'number') {
    session.activeSpaceSharedStartT = null;
  }
  if (typeof session.activeSpaceSharedWallMiddle !== 'boolean') {
    session.activeSpaceSharedWallMiddle = false;
  }
  if (typeof session.activeSpaceSharedSnapLine !== 'string') {
    session.activeSpaceSharedSnapLine = '';
  }
  if (typeof session.partitionSourceSpaceId !== 'string') {
    session.partitionSourceSpaceId = '';
  }
  if (typeof session.lastWallSnapNodeId !== 'string') {
    session.lastWallSnapNodeId = '';
  }
  if (typeof session.lastWallSnapWallId !== 'string') {
    session.lastWallSnapWallId = '';
  }
  if (typeof session.lastWallSnapT !== 'number') {
    session.lastWallSnapT = null;
  }
  if (typeof session.lastWallSnapWallMiddle !== 'boolean') {
    session.lastWallSnapWallMiddle = false;
  }
  if (typeof session.lastWallSnapLine !== 'string') {
    session.lastWallSnapLine = '';
  }
  if (typeof session.previewMeasurementSide !== 'string') {
    session.previewMeasurementSide = '';
  }
  if (typeof session.previewBodyNormalSide !== 'string') {
    session.previewBodyNormalSide = '';
  }
  if (typeof session.measurementSideUserSet !== 'boolean') {
    session.measurementSideUserSet = false;
  }
  if (!Number.isFinite(Number(session.previewMeasurementStartInsetMm))) {
    session.previewMeasurementStartInsetMm = 0;
  }
  if (!Number.isFinite(Number(session.previewMeasurementStartExtensionMm))) {
    session.previewMeasurementStartExtensionMm = 0;
  }
  if (!Number.isFinite(Number(session.previewMeasurementEndInsetMm))) {
    session.previewMeasurementEndInsetMm = 0;
  }
  if (typeof session.previewOuterFaceWallId !== 'string') {
    session.previewOuterFaceWallId = '';
  }
  if (typeof session.selectedSpaceId !== 'string') {
    session.selectedSpaceId = '';
  }
  if (typeof session.previewAngleSource !== 'string') {
    session.previewAngleSource = '';
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'previewInteriorAngleDeg')) {
    session.previewInteriorAngleDeg = null;
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'closeCandidatePoint')) {
    session.closeCandidatePoint = null;
  }
  if (typeof session.closeCandidateType !== 'string') {
    session.closeCandidateType = '';
  }
  if (typeof session.closeCandidateSharedWallId !== 'string') {
    session.closeCandidateSharedWallId = '';
  }
  if (!Object.prototype.hasOwnProperty.call(session, 'alignmentSnapGuide')) {
    session.alignmentSnapGuide = null;
  }
  return session;
}

function collectSessionReferences(session, options) {
  const source = session || {};
  const includeTransient = !!(options && options.includeTransient);
  const wallFields = includeTransient
    ? WALL_REFERENCE_FIELDS.concat(TRANSIENT_WALL_REFERENCE_FIELDS)
    : WALL_REFERENCE_FIELDS;
  return {
    nodeIds: NODE_REFERENCE_FIELDS.map((field) => ({ field, id: source[field] })).filter((item) => item.id),
    wallIds: wallFields.map((field) => ({ field, id: source[field] })).filter((item) => item.id),
    openingIds: OPENING_REFERENCE_FIELDS
      .map((field) => ({ field, id: source[field] }))
      .filter((item) => item.id),
    spaceIds: SPACE_REFERENCE_FIELDS
      .map((field) => ({ field, id: source[field] }))
      .filter((item) => item.id)
  };
}

module.exports = {
  SESSION_FIELD_GROUPS,
  readSessionGroups,
  SESSION_STATES,
  SESSION_DEFAULTS,
  OPTIONAL_SESSION_FIELDS,
  NODE_REFERENCE_FIELDS,
  WALL_REFERENCE_FIELDS,
  TRANSIENT_WALL_REFERENCE_FIELDS,
  OPENING_REFERENCE_FIELDS,
  SPACE_REFERENCE_FIELDS,
  createSession,
  ensureSessionSpaceTracking,
  collectSessionReferences
};
