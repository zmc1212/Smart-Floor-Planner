const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const surveyBleDirectionOptions = require('../packages/surveying/utils/surveyBleDirectionOptions.js');
const surveyDeviceOrientation = require('../packages/surveying/utils/surveyDeviceOrientation.js');
const surveyLayout = require('../utils/surveyLayout.js');

function createCornerDraft() {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.commitPreviewLength(
    surveyGraph.startPreview(draft, { xMm: 3000, yMm: 0 }),
    3000,
    'manual'
  );
  return draft;
}

function getSession(draft) {
  return surveyGraph.getActiveFloor(draft).session;
}

function getAnchor(draft) {
  const floor = surveyGraph.getActiveFloor(draft);
  return surveyGraph.getNode(floor, floor.session.anchorNodeId);
}

test('buildBleDirectionOptions exposes four orthogonal directions on the first wall', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  const floor = surveyGraph.getActiveFloor(draft);
  const anchor = getAnchor(draft);

  const options = surveyBleDirectionOptions.buildBleDirectionOptions({
    anchor,
    floor,
    session: floor.session
  });

  assert.equal(options.length, 4);
  assert.deepEqual(options.map((item) => item.key), ['east', 'south', 'west', 'north']);
  assert.equal(options[0].bearingDeg, 0);
  assert.deepEqual(options[0].unitVector, { x: 1, y: 0 });
});

test('buildBleDirectionOptions excludes the backtrack direction after a corner', () => {
  const draft = createCornerDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  const anchor = getAnchor(draft);

  const options = surveyBleDirectionOptions.buildBleDirectionOptions({
    anchor,
    floor,
    session: floor.session
  });

  assert.equal(options.length, 3);
  assert.equal(options.some((item) => item.key === 'west'), false);
  assert.deepEqual(
    options.map((item) => item.key).sort(),
    ['east', 'north', 'south']
  );
});

test('buildBleDirectionOptions returns no options outside straight mode', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  const floor = surveyGraph.getActiveFloor(draft);

  const options = surveyBleDirectionOptions.buildBleDirectionOptions({
    anchor: getAnchor(draft),
    floor,
    session: floor.session
  });

  assert.deepEqual(options, []);
});

test('buildBleDirectionOptions projects arrow tips into screen space', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  const floor = surveyGraph.getActiveFloor(draft);
  const anchor = getAnchor(draft);

  const options = surveyBleDirectionOptions.buildBleDirectionOptions({
    anchor,
    floor,
    session: floor.session,
    viewport: {
      scale: 0.05,
      offsetX: 0,
      offsetY: 0,
      rotationRad: 0
    },
    rect: { width: 390, height: 844 },
    arrowLengthMm: 1000
  });

  const east = options.find((item) => item.key === 'east');
  assert.ok(east);
  assert.deepEqual(east.tipPointMm, { xMm: 1000, yMm: 0 });
  assert.deepEqual(east.screenPoint, { x: 245, y: 422 });
});

test('mapDeviceHeadingToWorldBearing maps compass cardinals into canvas bearings', () => {
  const mapCompass = (directionDeg, rotationDeg = 0) => (
    surveyBleDirectionOptions.mapDeviceHeadingToWorldBearing(
      surveyDeviceOrientation.compassDirectionToAlpha(directionDeg),
      rotationDeg,
      0
    )
  );
  assert.equal(mapCompass(0), 270);
  assert.equal(mapCompass(90), 0);
  assert.equal(mapCompass(180), 90);
  assert.equal(mapCompass(270), 180);
  assert.equal(mapCompass(90, 90), 270);
});

test('pickDirectionWithHysteresis waits for activation before the first auto pick', () => {
  const candidates = [
    { key: 'east', bearingDeg: 0 },
    { key: 'north', bearingDeg: -90 }
  ];

  assert.equal(
    surveyBleDirectionOptions.pickDirectionWithHysteresis(candidates, 20, null, { activateDeg: 12 }),
    null
  );
  assert.equal(
    surveyBleDirectionOptions.pickDirectionWithHysteresis(candidates, 8, null, { activateDeg: 12 }),
    'east'
  );
});

test('pickDirectionWithHysteresis keeps the current direction until the lead exceeds switchDeg', () => {
  const candidates = [
    { key: 'east', bearingDeg: 0 },
    { key: 'north', bearingDeg: -90 },
    { key: 'south', bearingDeg: 90 }
  ];

  assert.equal(
    surveyBleDirectionOptions.pickDirectionWithHysteresis(
      candidates,
      50,
      'east',
      { activateDeg: 12, switchDeg: 15 }
    ),
    'east'
  );
  assert.equal(
    surveyBleDirectionOptions.pickDirectionWithHysteresis(
      candidates,
      70,
      'east',
      { activateDeg: 12, switchDeg: 15 }
    ),
    'south'
  );
});

test('lockPreviewBearing records direction without moving the cursor or walls', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 1000, yMm: 2000 });
  draft = surveyGraph.lockPreviewBearing(draft, 0);
  draft = surveyGraph.lockPreviewBearing(draft, 90);

  const floor = surveyGraph.getActiveFloor(draft);
  const session = floor.session;
  const anchor = surveyGraph.getNode(floor, session.anchorNodeId);

  assert.equal(session.state, 'awaitingLength');
  assert.equal(session.previewPoint, null);
  assert.equal(session.bleLockedBearingDeg, 90);
  assert.equal(anchor.xMm, 1000);
  assert.equal(anchor.yMm, 2000);
  assert.equal(floor.walls.length, 0);
});

test('formal layout serialization strips the transient BLE direction lock', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.lockPreviewBearing(draft, 90);

  const layout = surveyLayout.createFormalSurveyLayout(draft, 'draft');
  const floor = surveyGraph.getActiveFloor(layout.surveyGraph);
  assert.equal(Object.hasOwn(floor.session, 'bleLockedBearingDeg'), false);
});

test('commitPreviewLength materializes a locked bearing before committing', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.lockPreviewBearing(draft, 0);

  draft = surveyGraph.commitPreviewLength(draft, 2100, 'ble');
  const floor = surveyGraph.getActiveFloor(draft);
  const lastWall = floor.walls[floor.walls.length - 1];

  assert.equal(lastWall.lengthMm, 2100);
  assert.equal(lastWall.inputSource, 'ble');
  assert.equal(Object.hasOwn(floor.session, 'bleLockedBearingDeg'), false);
});

test('startPreviewFromBearing creates an orthogonal preview without drag', () => {
  const draft = createCornerDraft();
  const previewDraft = surveyGraph.startPreviewFromBearing(draft, 90);
  const floor = surveyGraph.getActiveFloor(previewDraft);
  const anchor = getAnchor(previewDraft);

  assert.equal(floor.session.state, 'wallPreview');
  assert.equal(floor.session.previewPoint.xMm, anchor.xMm);
  assert.equal(floor.session.previewPoint.yMm, anchor.yMm + surveyGraph.MIN_WALL_LENGTH_MM);
  assert.equal(floor.session.previewAngleDeg, 90);
});

test('startPreviewFromBearing reuses the existing preview length as the stub', () => {
  let draft = createCornerDraft();
  draft = surveyGraph.startPreview(draft, { xMm: 3000, yMm: 2500 });
  const previousLength = getSession(draft).previewLengthMm;

  const previewDraft = surveyGraph.startPreviewFromBearing(draft, -90);
  const session = getSession(previewDraft);

  assert.equal(session.state, 'wallPreview');
  assert.equal(session.previewLengthMm, previousLength);
  assert.equal(session.previewPoint.yMm, getAnchor(previewDraft).yMm - previousLength);
});

test('startPreviewFromBearing flows through holdPreviewForInput and commitPreviewLength', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  draft = surveyGraph.startPreviewFromBearing(draft, 0);
  draft = surveyGraph.holdPreviewForInput(draft);

  assert.equal(getSession(draft).state, 'awaitingLength');

  draft = surveyGraph.commitPreviewLength(draft, 2100, 'ble');
  const floor = surveyGraph.getActiveFloor(draft);
  const lastWall = floor.walls[floor.walls.length - 1];

  assert.equal(floor.session.state, 'wallCommitted');
  assert.equal(lastWall.lengthMm, 2100);
  assert.equal(lastWall.inputSource, 'ble');
  assert.equal(lastWall.mode, 'straight');
});

test('startPreviewFromBearing rejects non-orthogonal bearings in straight mode', () => {
  const draft = createCornerDraft();
  assert.throws(
    () => surveyGraph.startPreviewFromBearing(draft, 45),
    /horizontal or vertical/
  );
});

test('startPreviewFromBearing rejects diagonal mode', () => {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setMode(draft, 'diagonal');
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });

  assert.throws(
    () => surveyGraph.startPreviewFromBearing(draft, 0),
    /straight mode/
  );
});

test('drawBleDirectionArrows paints the approved wide shaftless triangular pointers', () => {
  const surveyCanvasRenderer = require('../packages/surveying/utils/surveyCanvasRenderer.js');
  const calls = [];
  const ctx = {
    save() { calls.push('save'); },
    restore() { calls.push('restore'); },
    beginPath() { calls.push('beginPath'); },
    moveTo() { calls.push('moveTo'); },
    lineTo() { calls.push('lineTo'); },
    closePath() { calls.push('closePath'); },
    stroke() { calls.push('stroke'); },
    fill() { calls.push('fill'); },
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: ''
  };

  surveyCanvasRenderer.drawBleDirectionArrows(ctx, { x: 100, y: 200 }, [
    { tipX: 160, tipY: 200, selected: false },
    { tipX: 100, tipY: 140, selected: true }
  ]);

  assert.equal(calls.filter((name) => name === 'stroke').length, 2);
  assert.equal(calls.filter((name) => name === 'fill').length, 2);
  assert.equal(calls.filter((name) => name === 'moveTo').length, 2);
  assert.equal(calls.filter((name) => name === 'lineTo').length, 4);
});
