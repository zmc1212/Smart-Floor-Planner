const surveyGraph = require('../../../packages/surveying/utils/surveyWallGraph.js');

const FIXTURE_SOURCE = 'phase0-baseline';

function commitPoint(draft, pointMm, inputSource = FIXTURE_SOURCE) {
  const preview = surveyGraph.startPreview(draft, pointMm);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(
    preview,
    floor.session.previewLengthMm,
    inputSource
  );
}

function buildOpenChain(points, options = {}) {
  let draft = surveyGraph.createSurveyDraft();
  if (options.mode) draft = surveyGraph.setMode(draft, options.mode);
  if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);
  draft = surveyGraph.placeCursor(draft, points[0]);
  points.slice(1).forEach((point) => {
    draft = commitPoint(draft, point);
  });
  return draft;
}

function buildClosingPolygon(points, options = {}) {
  return buildOpenChain(points, options);
}

function buildClosedPolygon(points, options = {}) {
  return surveyGraph.confirmClosure(buildClosingPolygon(points, options));
}

function buildRectangle(widthMm = 6000, heightMm = 4000) {
  return buildClosedPolygon([
    { xMm: 0, yMm: 0 },
    { xMm: widthMm, yMm: 0 },
    { xMm: widthMm, yMm: heightMm },
    { xMm: 0, yMm: heightMm },
    { xMm: 0, yMm: 0 }
  ]);
}

function snapCursor(draft, pointMm) {
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(
    floor,
    pointMm,
    surveyGraph.CLOSE_TOLERANCE_MM
  );
  if (!target || !target.pointMm || target.type === 'free') {
    throw new Error(`Phase 0 fixture could not snap at ${pointMm.xMm},${pointMm.yMm}`);
  }
  return surveyGraph.snapCursorToWall(
    surveyGraph.startWallSnap(draft),
    target.pointMm,
    target
  );
}

function closeIfAvailable(draft) {
  const state = surveyGraph.getActiveFloor(draft).session.state;
  return state === 'closing' || state === 'mergeClosing'
    ? surveyGraph.confirmClosure(draft)
    : draft;
}

function addPartition(draft, startMm, endMm) {
  let next = snapCursor(draft, startMm);
  next = commitPoint(next, endMm);
  return closeIfAvailable(next);
}

function findSharedWallId(draft, firstSpaceIndex = 0, secondSpaceIndex = 1) {
  const floor = surveyGraph.getActiveFloor(draft);
  const first = floor.spaces[firstSpaceIndex];
  const second = floor.spaces[secondSpaceIndex];
  if (!first || !second) return '';
  return first.wallIds.find((wallId) => second.wallIds.includes(wallId)) || '';
}

function buildEmptyGraph() {
  return surveyGraph.createSurveyDraft();
}

function buildSingleWall() {
  return buildOpenChain([
    { xMm: 0, yMm: 0 },
    { xMm: 4200, yMm: 0 }
  ]);
}

function buildContinuousWalls() {
  return buildOpenChain([
    { xMm: 0, yMm: 0 },
    { xMm: 4200, yMm: 0 },
    { xMm: 4200, yMm: 2800 },
    { xMm: 1600, yMm: 2800 }
  ]);
}

function buildClosedRectangle() {
  return buildRectangle(6000, 4000);
}

function buildLShape() {
  return buildClosedPolygon([
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 1800 },
    { xMm: 3600, yMm: 1800 },
    { xMm: 3600, yMm: 4200 },
    { xMm: 0, yMm: 4200 },
    { xMm: 0, yMm: 0 }
  ]);
}

function buildSharedWall() {
  let draft = buildRectangle(3200, 3600);
  draft = snapCursor(draft, { xMm: 3200, yMm: 0 });
  draft = commitPoint(draft, { xMm: 6400, yMm: 0 });
  draft = commitPoint(draft, { xMm: 6400, yMm: 3600 });
  draft = commitPoint(draft, { xMm: 3200, yMm: 3600 });
  return surveyGraph.confirmClosure(draft);
}

function buildDiagonalWall() {
  return buildOpenChain([
    { xMm: 0, yMm: 0 },
    { xMm: 3600, yMm: 2200 }
  ], { mode: 'diagonal' });
}

function buildWallWithOpenings() {
  let draft = buildRectangle(5200, 3600);
  let floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.addOpeningToWall(draft, floor.walls[0].id, 'door');
  floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.updateOpening(draft, floor.openings[0].id, {
    widthMm: 1000,
    centerOffsetMm: 1800,
    entryDoor: true
  });
  floor = surveyGraph.getActiveFloor(draft);
  draft = surveyGraph.addOpeningToWall(draft, floor.walls[2].id, 'window');
  floor = surveyGraph.getActiveFloor(draft);
  return surveyGraph.updateOpening(draft, floor.openings[1].id, {
    widthMm: 1600,
    centerOffsetMm: 2700,
    sillHeightMm: 900
  });
}

function buildSplitWall() {
  let draft = buildRectangle(6000, 4000);
  draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
  return commitPoint(draft, { xMm: 3000, yMm: -2000 });
}

function buildMultipleSpaces() {
  let draft = buildRectangle(9000, 3600);
  draft = addPartition(draft, { xMm: 3000, yMm: 0 }, { xMm: 3000, yMm: 3600 });
  return addPartition(draft, { xMm: 6000, yMm: 0 }, { xMm: 6000, yMm: 3600 });
}

function buildRemeasuredWall() {
  let draft = buildSingleWall();
  const wallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.selectWall(draft, wallId);
  draft = surveyGraph.startRemeasure(draft);
  return surveyGraph.remeasureSelectedWall(draft, 3900, 'manual');
}

const REPRESENTATIVE_FIXTURES = [
  { id: 'empty-graph', label: '空图', validationMode: 'quick', build: buildEmptyGraph },
  { id: 'single-wall', label: '单墙', validationMode: 'quick', build: buildSingleWall },
  { id: 'continuous-walls', label: '连续墙', validationMode: 'quick', build: buildContinuousWalls },
  { id: 'closed-rectangle', label: '闭合矩形', validationMode: 'full', build: buildClosedRectangle },
  { id: 'l-shaped-space', label: 'L 形空间', validationMode: 'full', build: buildLShape },
  { id: 'shared-wall', label: '共享墙', validationMode: 'full', build: buildSharedWall },
  { id: 'diagonal-wall', label: '斜墙', validationMode: 'quick', build: buildDiagonalWall },
  { id: 'wall-with-openings', label: '带门窗墙', validationMode: 'full', build: buildWallWithOpenings },
  { id: 'split-wall', label: '分裂墙', validationMode: 'full', build: buildSplitWall },
  { id: 'multiple-spaces', label: '多空间', validationMode: 'full', build: buildMultipleSpaces },
  { id: 'remeasured-wall', label: '复尺墙', validationMode: 'full', build: buildRemeasuredWall }
];

function buildPendingWallInput() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  return surveyGraph.startPreview(draft, { xMm: 4200, yMm: 0 });
}

function buildClosingRectangleInput() {
  return buildClosingPolygon([
    { xMm: 0, yMm: 0 },
    { xMm: 6000, yMm: 0 },
    { xMm: 6000, yMm: 4000 },
    { xMm: 0, yMm: 4000 },
    { xMm: 0, yMm: 0 }
  ]);
}

function buildSplitCommitInput(withOpening) {
  let draft = buildRectangle(6000, 4000);
  if (withOpening) {
    const hostWallId = surveyGraph.getActiveFloor(draft).walls[0].id;
    draft = surveyGraph.addOpeningToWall(draft, hostWallId, 'door');
  }
  draft = snapCursor(draft, { xMm: 3000, yMm: 0 });
  return surveyGraph.startPreview(draft, { xMm: 3000, yMm: -2000 });
}

function buildRemeasureInput() {
  let draft = buildSingleWall();
  const wallId = surveyGraph.getActiveFloor(draft).walls[0].id;
  draft = surveyGraph.selectWall(draft, wallId);
  return surveyGraph.startRemeasure(draft);
}

function createOperationCases() {
  return [
    {
      id: 'commit-wall-success',
      riskOperation: 'commitPreviewLength',
      expectedOutcome: 'success',
      prepare() {
        const input = buildPendingWallInput();
        return {
          input,
          args: [4200, 'manual'],
          execute: () => surveyGraph.commitPreviewLength(input, 4200, 'manual')
        };
      }
    },
    {
      id: 'commit-wall-without-preview-error',
      riskOperation: 'commitPreviewLength',
      expectedOutcome: 'error',
      prepare() {
        const input = surveyGraph.createSurveyDraft();
        return {
          input,
          args: [4200, 'manual'],
          execute: () => surveyGraph.commitPreviewLength(input, 4200, 'manual')
        };
      }
    },
    {
      id: 'confirm-closure-success',
      riskOperation: 'confirmClosure',
      expectedOutcome: 'success',
      prepare() {
        const input = buildClosingRectangleInput();
        return { input, args: [], execute: () => surveyGraph.confirmClosure(input) };
      }
    },
    {
      id: 'confirm-incomplete-chain-error',
      riskOperation: 'confirmClosure',
      expectedOutcome: 'error',
      prepare() {
        const input = buildSingleWall();
        const floor = surveyGraph.getActiveFloor(input);
        floor.session.state = 'mergeClosing';
        floor.session.closeCandidateNodeId = floor.walls[0].startNodeId;
        return { input, args: [], execute: () => surveyGraph.confirmClosure(input) };
      }
    },
    {
      id: 'split-wall-success',
      riskOperation: 'splitWallAtNodes',
      publicOperation: 'commitPreviewLength',
      expectedOutcome: 'success',
      prepare() {
        const input = buildSplitCommitInput(false);
        const lengthMm = surveyGraph.getActiveFloor(input).session.previewLengthMm;
        return {
          input,
          args: [lengthMm, FIXTURE_SOURCE],
          execute: () => surveyGraph.commitPreviewLength(input, lengthMm, FIXTURE_SOURCE)
        };
      }
    },
    {
      id: 'split-wall-opening-conflict-error',
      riskOperation: 'splitWallAtNodes',
      publicOperation: 'commitPreviewLength',
      expectedOutcome: 'error',
      prepare() {
        const input = buildSplitCommitInput(true);
        const lengthMm = surveyGraph.getActiveFloor(input).session.previewLengthMm;
        return {
          input,
          args: [lengthMm, FIXTURE_SOURCE],
          execute: () => surveyGraph.commitPreviewLength(input, lengthMm, FIXTURE_SOURCE)
        };
      }
    },
    {
      id: 'delete-shared-wall-success',
      riskOperation: 'deleteWall',
      expectedOutcome: 'success',
      prepare() {
        const input = buildSharedWall();
        const wallId = findSharedWallId(input);
        return { input, args: [wallId], execute: () => surveyGraph.deleteWall(input, wallId) };
      }
    },
    {
      id: 'delete-missing-wall-noop',
      riskOperation: 'deleteWall',
      expectedOutcome: 'noop',
      prepare() {
        const input = buildSingleWall();
        return { input, args: ['missing-wall'], execute: () => surveyGraph.deleteWall(input, 'missing-wall') };
      }
    },
    {
      id: 'delete-closed-space-success',
      riskOperation: 'deleteClosedSpace',
      expectedOutcome: 'success',
      prepare() {
        const input = buildSharedWall();
        const spaceId = surveyGraph.getActiveFloor(input).spaces[0].id;
        return { input, args: [spaceId], execute: () => surveyGraph.deleteClosedSpace(input, spaceId) };
      }
    },
    {
      id: 'delete-missing-space-noop',
      riskOperation: 'deleteClosedSpace',
      expectedOutcome: 'noop',
      prepare() {
        const input = buildClosedRectangle();
        return { input, args: ['missing-space'], execute: () => surveyGraph.deleteClosedSpace(input, 'missing-space') };
      }
    },
    {
      id: 'remeasure-wall-success',
      riskOperation: 'remeasureSelectedWall',
      expectedOutcome: 'success',
      prepare() {
        const input = buildRemeasureInput();
        return {
          input,
          args: [3900, 'manual'],
          execute: () => surveyGraph.remeasureSelectedWall(input, 3900, 'manual')
        };
      }
    },
    {
      id: 'remeasure-zero-length-error',
      riskOperation: 'remeasureSelectedWall',
      expectedOutcome: 'error',
      prepare() {
        const input = buildRemeasureInput();
        return {
          input,
          args: [0, 'manual'],
          execute: () => surveyGraph.remeasureSelectedWall(input, 0, 'manual')
        };
      }
    },
    {
      id: 'add-opening-success',
      riskOperation: 'addOpeningToWall',
      expectedOutcome: 'success',
      prepare() {
        const input = buildSingleWall();
        const wallId = surveyGraph.getActiveFloor(input).walls[0].id;
        return { input, args: [wallId, 'door'], execute: () => surveyGraph.addOpeningToWall(input, wallId, 'door') };
      }
    },
    {
      id: 'add-opening-without-wall-error',
      riskOperation: 'addOpeningToWall',
      expectedOutcome: 'error',
      prepare() {
        const input = surveyGraph.createSurveyDraft();
        return { input, args: ['', 'door'], execute: () => surveyGraph.addOpeningToWall(input, '', 'door') };
      }
    },
    {
      id: 'update-opening-success',
      riskOperation: 'updateOpening',
      expectedOutcome: 'success',
      prepare() {
        const input = buildWallWithOpenings();
        const openingId = surveyGraph.getActiveFloor(input).openings[0].id;
        const patch = { widthMm: 1200, centerOffsetMm: 2200, openDirection: 'outside' };
        return { input, args: [openingId, patch], execute: () => surveyGraph.updateOpening(input, openingId, patch) };
      }
    },
    {
      id: 'update-opening-invalid-width-error',
      riskOperation: 'updateOpening',
      expectedOutcome: 'error',
      prepare() {
        const input = buildWallWithOpenings();
        const openingId = surveyGraph.getActiveFloor(input).openings[0].id;
        const patch = { widthMm: 99 };
        return { input, args: [openingId, patch], execute: () => surveyGraph.updateOpening(input, openingId, patch) };
      }
    },
    {
      id: 'delete-opening-success',
      riskOperation: 'deleteOpening',
      expectedOutcome: 'success',
      prepare() {
        const input = buildWallWithOpenings();
        const openingId = surveyGraph.getActiveFloor(input).openings[0].id;
        return { input, args: [openingId], execute: () => surveyGraph.deleteOpening(input, openingId) };
      }
    },
    {
      id: 'delete-missing-opening-noop',
      riskOperation: 'deleteOpening',
      expectedOutcome: 'noop',
      prepare() {
        const input = buildWallWithOpenings();
        return { input, args: ['missing-opening'], execute: () => surveyGraph.deleteOpening(input, 'missing-opening') };
      }
    }
  ];
}

function createLargeGridDraft(columns = 20, rows = 12) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const roomWidthMm = 3600;
  const roomHeightMm = 3000;
  const nodeId = (column, row) => `grid-node-${row}-${column}`;
  const horizontalWallId = (column, row) => `grid-wall-h-${row}-${column}`;
  const verticalWallId = (column, row) => `grid-wall-v-${row}-${column}`;

  floor.nodes = [];
  floor.walls = [];
  floor.openings = [];
  floor.spaces = [];

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      floor.nodes.push({
        id: nodeId(column, row),
        xMm: column * roomWidthMm,
        yMm: row * roomHeightMm
      });
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      floor.walls.push({
        id: horizontalWallId(column, row),
        startNodeId: nodeId(column, row),
        endNodeId: nodeId(column + 1, row),
        mode: 'straight',
        lengthMm: roomWidthMm,
        angleDeg: 0,
        thicknessMm: 200,
        measurementSide: 'left',
        measurementStartInsetMm: 0,
        measurementStartExtensionMm: 0,
        measurementEndInsetMm: 0,
        inputSource: FIXTURE_SOURCE,
        status: 'confirmed'
      });
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      floor.walls.push({
        id: verticalWallId(column, row),
        startNodeId: nodeId(column, row),
        endNodeId: nodeId(column, row + 1),
        mode: 'straight',
        lengthMm: roomHeightMm,
        angleDeg: 90,
        thicknessMm: 200,
        measurementSide: 'left',
        measurementStartInsetMm: 0,
        measurementStartExtensionMm: 0,
        measurementEndInsetMm: 0,
        inputSource: FIXTURE_SOURCE,
        status: 'confirmed'
      });
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      floor.spaces.push({
        id: `grid-space-${row}-${column}`,
        name: `R${row + 1}-${column + 1}`,
        wallIds: [
          horizontalWallId(column, row),
          verticalWallId(column + 1, row),
          horizontalWallId(column, row + 1),
          verticalWallId(column, row)
        ],
        closed: true,
        wallFaceOverrides: {}
      });
    }
  }

  floor.session.state = 'spaceClosed';
  floor.session.anchorNodeId = '';
  floor.session.activeSpaceStartWallIndex = floor.walls.length;
  return draft;
}

module.exports = {
  FIXTURE_SOURCE,
  REPRESENTATIVE_FIXTURES,
  addPartition,
  buildClosedRectangle,
  buildClosingRectangleInput,
  buildMultipleSpaces,
  buildSharedWall,
  buildSingleWall,
  buildSplitCommitInput,
  buildWallWithOpenings,
  commitPoint,
  createLargeGridDraft,
  createOperationCases,
  findSharedWallId,
  snapCursor,
  surveyGraph
};
