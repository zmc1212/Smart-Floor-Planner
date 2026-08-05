const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveSurveyGuide, chooseGuidePlacement, chooseGuideCharacter, wrapGuideBody } = require('../packages/surveying/utils/surveyGuide');

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

test('Xiao K pose and dotted path resolve from the real card and target geometry', () => {
  const safeArea = { left: 12, top: 120, right: 282, bottom: 716 };
  const card = { left: 56, top: 320, width: 168, height: 76 };
  const down = chooseGuideCharacter({
    card,
    target: { x: 140, y: 540 },
    safeArea,
    characterSize: 64
  });
  assert.equal(down.pose, 'down');
  assert.ok(down.top + down.size <= safeArea.bottom);
  assert.ok(down.pathLength > 12);
  assert.ok(down.left + down.size < 140, 'down pose keeps the target clear of the character');

  const left = chooseGuideCharacter({
    card,
    target: { x: 20, y: 248 },
    safeArea,
    characterSize: 64
  });
  assert.equal(left.pose, 'left');
  assert.ok(left.left >= safeArea.left);
  assert.ok(left.top >= safeArea.top);
});

test('guide copy is split into native-cover-view-safe lines', () => {
  const lines = wrapGuideBody('从画布光标沿第一面墙方向拖动，松手后测量长度。', 14);
  assert.deepEqual(lines, ['从画布光标沿第一面墙方向拖动，', '松手后测量长度。']);
  assert.ok(lines.every((line) => Array.from(line).length <= 15));
});
