const NODE_REFERENCE_FIELDS = [
  'anchorNodeId',
  'closeCandidateNodeId',
  'activeSpaceStartNodeId',
  'lastWallSnapNodeId',
  'fixedNodeId'
];

const WALL_REFERENCE_FIELDS = [
  'pendingWallId',
  'selectedWallId',
  'closeCandidateSharedWallId',
  'activeSpaceSharedWallId',
  'lastWallSnapWallId'
];

function collectSessionReferences(session) {
  const source = session || {};
  return {
    nodeIds: NODE_REFERENCE_FIELDS.map((field) => ({ field, id: source[field] })).filter((item) => item.id),
    wallIds: WALL_REFERENCE_FIELDS.map((field) => ({ field, id: source[field] })).filter((item) => item.id),
    openingIds: source.selectedOpeningId
      ? [{ field: 'selectedOpeningId', id: source.selectedOpeningId }]
      : []
  };
}

module.exports = {
  NODE_REFERENCE_FIELDS,
  WALL_REFERENCE_FIELDS,
  collectSessionReferences
};
