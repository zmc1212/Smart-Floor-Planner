const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSurveyGuide,
  chooseGuidePlacement,
  chooseGuideCharacter,
  solveGuideLayout,
  buildDirectGuideConnector,
  wrapGuideBody
} = require('../packages/surveying/utils/surveyGuide');

function resolve(state, overrides) {
  const floor = {
    walls: [],
    spaces: [],
    session: Object.assign({
      state,
      mode: 'straight',
      selectedWallId: '',
      selectedOpeningId: '',
      closeCandidateNodeId: '',
      closeCandidatePoint: null
    }, overrides && overrides.session)
  };
  return resolveSurveyGuide(Object.assign({
    guideEnabled: true,
    floor,
    session: floor.session,
    cursorPlacementState: 'placed',
    bleConnected: true,
    canSetInitialMeasurementSide: false
  }, overrides || {}));
}

test('guide mode is enabled by presentation state and never mutates the wall graph', () => {
  const guide = resolve('cursorPlaced');
  assert.equal(guide.key, 'first-wall');
  assert.equal(guide.target, 'cursor');
  assert.equal(guide.showCharacter, true);
  assert.equal(resolveSurveyGuide({ guideEnabled: false }), null);
});

test('ble input mode replaces drag guidance with direction-arrow copy', () => {
  const firstWall = resolve('cursorPlaced', { bleInputMode: true });
  assert.equal(firstWall.key, 'ble-first-wall');
  assert.match(firstWall.body, /方向箭头/);

  const manual = resolve('wallCommitted', {
    floor: { walls: [{ id: 'w1' }], spaces: [], session: { state: 'wallCommitted', mode: 'straight' } },
    session: { state: 'wallCommitted', mode: 'straight' },
    bleInputMode: true,
    bleDirectionMode: 'manual'
  });
  assert.equal(manual.key, 'ble-manual-direction');

  const auto = resolve('wallCommitted', {
    floor: { walls: [{ id: 'w1' }], spaces: [], session: { state: 'wallCommitted', mode: 'straight' } },
    session: { state: 'wallCommitted', mode: 'straight' },
    bleInputMode: true,
    bleDirectionMode: 'auto'
  });
  assert.equal(auto.key, 'ble-auto-direction');
});

test('preview direction and BLE length states use the real measurement flow', () => {
  assert.equal(resolve('wallPreview').key, 'confirm-direction');
  assert.match(resolve('wallPreview', { session: { state: 'wallPreview', mode: 'diagonal' } }).body, /斜墙/);
  assert.match(resolve('awaitingLength').body, /读取设备/);
  assert.match(resolve('awaitingLength', { bleConnected: false }).body, /连接设备/);
  assert.equal(resolve('remeasureAwaitingInput').key, 'remeasure-length');
});

test('closure candidates outrank direction and length guidance', () => {
  const previewClose = resolve('wallPreview', {
    session: { state: 'wallPreview', closeCandidateNodeId: 'node-1' }
  });
  const lengthClose = resolve('awaitingLength', {
    session: { state: 'awaitingLength', closeCandidatePoint: { xMm: 0, yMm: 0 } }
  });
  assert.equal(previewClose.key, 'close-space');
  assert.equal(lengthClose.key, 'close-space');
  assert.equal(resolve('closing').key, 'close-space');
  assert.match(previewClose.body, /松手闭合|「合」即可闭合当前空间/);
});

test('the initial measurement side outranks continuation guidance', () => {
  const guide = resolve('wallCommitted', {
    floor: undefined,
    canSetInitialMeasurementSide: true
  });
  assert.equal(guide.key, 'confirm-measure-side');
});

test('cursor placement uses the live snap label while dragging', () => {
  const guide = resolve('wallSnapPending', {
    cursorPlacementState: 'dragging',
    cursorSnapLabel: '外边吸附'
  });
  assert.equal(guide.key, 'place-next-start');
  assert.equal(guide.dynamicCursorLabel, true);
  assert.match(guide.body, /外边吸附/);
});

test('selected objects and closed rooms receive contextual next actions', () => {
  assert.equal(resolve('wallSelected', {
    session: { state: 'wallSelected', selectedWallId: 'wall-1' }
  }).key, 'edit-wall');
  assert.equal(resolve('wallSelected', {
    session: { state: 'wallSelected', selectedWallId: 'wall-1', selectedOpeningId: 'opening-1' }
  }).key, 'edit-opening');
  assert.equal(resolve('spaceClosed').key, 'room-closed');
});

test('every contextual operation guide uses the Xiao K companion', () => {
  const guides = [
    resolve('wallPreview'),
    resolve('awaitingLength'),
    resolve('wallCommitted', { canSetInitialMeasurementSide: true }),
    resolve('wallSelected', { session: { state: 'wallSelected', selectedWallId: 'wall-1' } }),
    resolve('spaceClosed'),
    resolve('cursorPlaced', { completed: true })
  ];
  assert.ok(guides.every((guide) => guide.showCharacter));
});

test('panels suppress the main guide and completion owns the final state', () => {
  assert.equal(resolve('awaitingLength', { numberPadVisible: true }), null);
  assert.equal(resolve('wallSelected', { componentEditorVisible: true }), null);
  assert.equal(resolve('cursorPlaced', { completed: true }).key, 'completed');
});

test('guide placement stays inside safe chrome and avoids the active wall when possible', () => {
  const placement = chooseGuidePlacement({
    target: { x: 190, y: 420 },
    safeArea: { left: 12, top: 120, right: 282, bottom: 716 },
    cardWidth: 260,
    cardHeight: 102,
    gap: 24,
    obstacles: [{ left: 12, top: 294, right: 282, bottom: 410 }]
  });
  assert.equal(placement.top, 444);
  assert.equal(placement.pointerDirection, 'up');
  assert.ok(placement.left >= 12);
  assert.ok(placement.left + 260 <= 282);
});

test('a 360px device normalizes guide geometry back to the 390px reference anchors', () => {
  const scale = 360 / 390;
  const safeArea = {
    left: 12 * scale,
    top: 130 * scale,
    right: 360 - (105 + 12) * scale,
    bottom: 800 - 128 * scale
  };
  const placement = chooseGuidePlacement({
    target: { x: 219 * scale, y: 444 * scale },
    safeArea,
    cardWidth: 180 * scale,
    cardHeight: 130 * scale,
    gap: 124 * scale,
    obstacles: []
  });
  assert.ok(Math.abs(placement.left / scale - 93) < 0.5);
  assert.ok(Math.abs(placement.top / scale - 190) < 0.5);
});

test('Xiao K pose and dotted path resolve from the real card and target geometry', () => {
  const safeArea = { left: 12, top: 120, right: 282, bottom: 716 };
  const card = { left: 56, top: 320, width: 168, height: 76 };
  const right = chooseGuideCharacter({
    card,
    target: { x: 140, y: 540 },
    safeArea,
    characterSize: 64
  });
  assert.equal(right.pose, 'right');
  assert.ok(right.top + right.size <= safeArea.bottom);
  assert.ok(right.pathLength > 12);
  assert.ok(right.handX <= 140, 'right-pointing hand stays on the target’s left side');
  assert.equal(right.top, card.top + card.height + 16 * (64 / 70));

  const left = chooseGuideCharacter({
    card,
    target: { x: 20, y: 248 },
    safeArea,
    characterSize: 64
  });
  assert.equal(left.pose, 'left');
  assert.ok(left.left >= safeArea.left);
  assert.ok(left.top >= safeArea.top);
  assert.ok(left.handX >= 20, 'left-pointing hand stays on the target’s right side');
});

test('cursor guidance uses the right-pointing Xiao K pose and a curved path direction', () => {
  const character = chooseGuideCharacter({
    card: { left: 92, top: 180, width: 180, height: 112 },
    target: { x: 196, y: 432 },
    safeArea: { left: 12, top: 120, right: 282, bottom: 716 },
    characterSize: 70,
    preferredPose: 'right'
  });

  assert.equal(character.pose, 'right');
  assert.equal(character.pathDirection, 'down-right');
  assert.ok(character.pathWidth > 12);
  assert.ok(character.pathHeight > 12);
  assert.ok(character.top >= 308, 'cursor pose stays below the speech bubble instead of being covered by it');
  assert.ok(character.handX <= 196, 'right-pointing hand faces the actual cursor target');
});

test('compound guide layout never lets the card cover Xiao K near a constrained edge', () => {
  const safeArea = { left: 12, top: 120, right: 282, bottom: 716 };
  const layout = solveGuideLayout({
    target: { x: 260, y: 430, width: 52, height: 52 },
    safeArea,
    cardWidth: 180,
    cardHeight: 112,
    characterSize: 70,
    gap: 124,
    obstacles: [
      {
        left: 165,
        right: 245,
        top: 350,
        bottom: 376,
        hard: true,
        pathHard: true,
        pathWeight: 2400
      }
    ]
  });

  assert.ok(layout);
  const card = {
    left: layout.card.left,
    right: layout.card.left + layout.card.width,
    top: layout.card.top,
    bottom: layout.card.top + layout.card.height
  };
  const character = {
    left: layout.character.left,
    right: layout.character.left + layout.character.size,
    top: layout.character.top,
    bottom: layout.character.top + layout.character.size
  };
  const overlaps = !(
    card.right + 7 <= character.left ||
    card.left - 7 >= character.right ||
    card.bottom + 7 <= character.top ||
    card.top - 7 >= character.bottom
  );
  assert.equal(overlaps, false);
  assert.ok(character.left >= safeArea.left && character.right <= safeArea.right);
  assert.ok(character.top >= safeArea.top && character.bottom <= safeArea.bottom);
});

test('bottom-control guide keeps Xiao K below the card and uses a straight connector', () => {
  const layout = solveGuideLayout({
    target: { x: 195, y: 716, width: 66, height: 42 },
    safeArea: { left: 12, top: 120, right: 378, bottom: 780 },
    cardWidth: 180,
    cardHeight: 142,
    characterSize: 70,
    gap: 124,
    obstacles: [],
    preferCharacterBelowCard: true
  });

  assert.ok(layout);
  assert.ok(
    layout.character.top >= layout.card.top + layout.card.height,
    'Xiao K should sit below the card so the button path does not loop around it'
  );

  const target = { x: 195, y: 688 };
  const connector = buildDirectGuideConnector(
    { x: layout.character.handX, y: layout.character.handY },
    target
  );
  assert.ok(connector);
  assert.deepEqual(connector.target, target);
  const controlOneCross =
    (connector.controlOne.x - connector.start.x) * (connector.target.y - connector.start.y) -
    (connector.controlOne.y - connector.start.y) * (connector.target.x - connector.start.x);
  const controlTwoCross =
    (connector.controlTwo.x - connector.start.x) * (connector.target.y - connector.start.y) -
    (connector.controlTwo.y - connector.start.y) * (connector.target.x - connector.start.x);
  assert.ok(Math.abs(controlOneCross) < 1e-9);
  assert.ok(Math.abs(controlTwoCross) < 1e-9);
});

test('reset-cursor dock guide stays visible after a closed room fills the canvas with hard labels', () => {
  assert.equal(resolve('wallSnapPending', {
    cursorPlacementState: 'awaitingWallDrop',
    floor: {
      walls: [{ id: 'w1' }, { id: 'w2' }, { id: 'w3' }, { id: 'w4' }],
      spaces: [{ closed: true }],
      session: { state: 'wallSnapPending', mode: 'straight' }
    }
  }).key, 'place-next-start');

  const safeArea = { left: 12, top: 130, right: 273, bottom: 716 };
  const closedRoomObstacles = [
    { left: 90, right: 250, top: 280, bottom: 520, hard: true, padding: 6, pathHard: true, pathWeight: 2200, kind: 'room-label' },
    { left: 80, right: 260, top: 250, bottom: 270, hard: true, padding: 5, pathHard: true, pathWeight: 2400, kind: 'dimension-label' },
    { left: 80, right: 260, top: 530, bottom: 550, hard: true, padding: 5, pathHard: true, pathWeight: 2400, kind: 'dimension-label' },
    { left: 55, right: 80, top: 280, bottom: 520, hard: true, padding: 5, pathHard: true, pathWeight: 2400, kind: 'dimension-label' },
    { left: 255, right: 280, top: 280, bottom: 520, hard: true, padding: 5, pathHard: true, pathWeight: 2400, kind: 'dimension-label' },
    { left: 70, right: 270, top: 220, bottom: 245, hard: true, padding: 5, pathHard: true, pathWeight: 2400, kind: 'dimension-label' },
    { left: 70, right: 270, top: 555, bottom: 580, hard: true, padding: 5, pathHard: true, pathWeight: 2400, kind: 'dimension-label' }
  ];
  const layout = solveGuideLayout({
    target: { x: 195, y: 700, width: 66, height: 42, nativeOverlay: true },
    safeArea,
    cardWidth: 180,
    cardHeight: 142,
    characterSize: 70,
    gap: 124,
    obstacles: closedRoomObstacles,
    preferCharacterBelowCard: true
  });

  assert.ok(layout, 'reset-cursor tip must not disappear behind closed-room dimension labels');
  assert.ok(layout.card);
  assert.ok(layout.character);
  assert.ok(layout.character.top >= layout.card.top + layout.card.height - 1);
});

test('connector routing detours around hard measurement labels', () => {
  const label = {
    left: 70,
    right: 282,
    top: 178,
    bottom: 202,
    hard: true,
    pathHard: true,
    pathPadding: 6,
    pathWeight: 2400,
    kind: 'dimension-label'
  };
  const layout = solveGuideLayout({
    target: { x: 250, y: 146, width: 48, height: 48 },
    safeArea: { left: 12, top: 120, right: 282, bottom: 716 },
    cardWidth: 180,
    cardHeight: 112,
    characterSize: 70,
    gap: 124,
    obstacles: [label]
  });

  assert.ok(layout);
  assert.equal(layout.connector.hardHits, 0);
  assert.equal(layout.connector.type, 'polyline');
  layout.connector.pathSamples.slice(1, -1).forEach((point) => {
    assert.equal(
      point.x >= label.left - 6 && point.x <= label.right + 6 &&
      point.y >= label.top - 6 && point.y <= label.bottom + 6,
      false
    );
  });
});

test('connector is omitted instead of crossing an unavoidable hard label', () => {
  const layout = solveGuideLayout({
    target: { x: 195, y: 420, width: 48, height: 48 },
    safeArea: { left: 12, top: 80, right: 378, bottom: 700 },
    cardWidth: 180,
    cardHeight: 110,
    characterSize: 70,
    gap: 80,
    obstacles: [
      {
        left: 130,
        right: 260,
        top: 365,
        bottom: 475,
        hard: true,
        pathHard: true,
        padding: 5,
        pathPadding: 5,
        pathWeight: 2400,
        kind: 'dimension-label'
      }
    ]
  });

  assert.ok(layout, 'the card and Xiao K can still use a safe placement');
  assert.equal(layout.connector, null, 'an unsafe connector must not be painted through the label');
});

test('guide copy is split into native-cover-view-safe lines', () => {
  const lines = wrapGuideBody('从画布光标沿第一面墙方向拖动，松手后测量长度。', 14);
  assert.deepEqual(lines, ['从画布光标沿第一面墙方向拖动，', '松手后测量长度。']);
  assert.ok(lines.every((line) => Array.from(line).length <= 15));
});
