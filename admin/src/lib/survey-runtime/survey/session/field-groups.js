const { copySessionValue } = require('../core/session-value.js');

// Logical ownership only: the persisted 38 defaults + 5 optional keys remain
// flat. Optional absence and unknown forward-compatible keys are preserved.
const SESSION_FIELD_GROUPS = Object.freeze({
  preview: Object.freeze([
    'state', 'anchorNodeId', 'previewPoint', 'previewAngleDeg', 'previewLengthMm',
    'previewAngleSource', 'previewInteriorAngleDeg', 'mode', 'pendingWallId', 'bleLockedBearingDeg'
  ]),
  selection: Object.freeze(['selectedWallId', 'selectedOpeningId', 'selectedSpaceId']),
  closure: Object.freeze([
    'closeCandidateNodeId', 'closeCandidatePoint', 'closeCandidateType', 'closeCandidateSharedWallId',
    'activeSpaceStartNodeId', 'activeSpaceStartWallIndex', 'activeSpaceSharedWallId',
    'activeSpaceSharedStartT', 'activeSpaceSharedWallMiddle', 'activeSpaceSharedSnapLine',
    'partitionSourceSpaceId', 'lastWallSnapNodeId', 'lastWallSnapWallId', 'lastWallSnapT',
    'lastWallSnapWallMiddle', 'lastWallSnapLine', 'closedFromNodeId', 'fullValidationAfterClosedSplit', 'pendingMeasuredClosure'
  ]),
  measurement: Object.freeze([
    'thicknessMm', 'measurementSide', 'previewMeasurementSide', 'previewBodyNormalSide',
    'measurementSideUserSet', 'previewMeasurementStartInsetMm', 'previewMeasurementStartExtensionMm',
    'previewMeasurementEndInsetMm', 'previewOuterFaceWallId', 'fixedNodeId'
  ]),
  viewport: Object.freeze(['alignmentSnapGuide'])
});

// The viewport itself stays in floor.viewport. Native view rotation, touch
// hysteresis and device callbacks remain editor state, outside this contract.
function readSessionGroups(session) {
  const source = session || {};
  const groups = {};
  for (const [group, fields] of Object.entries(SESSION_FIELD_GROUPS)) {
    groups[group] = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(source, field)) {
        groups[group][field] = copySessionValue(source[field]);
      }
    }
  }
  return groups;
}

module.exports = { SESSION_FIELD_GROUPS, readSessionGroups };
