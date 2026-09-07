const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../packages/surveying/utils/surveyWallGraph.js');
const { normalizeOpeningToWall } = require('../packages/surveying/utils/survey/domain/opening');
const { getOpeningHostBounds } = require('../packages/surveying/utils/survey/read-model/opening-bounds');
const { planAddOpening, planUpdateOpening } = require('../packages/surveying/utils/survey/operations/opening-operations');

function junctionDraft(length = 4000, startThickness = 200, endThickness = 300) {
  const draft = surveyGraph.createSurveyDraft();
  const floor = surveyGraph.getActiveFloor(draft);
  floor.nodes = [{ id: 'a', xMm: 0, yMm: 0 }, { id: 'b', xMm: length, yMm: 0 },
    { id: 'c', xMm: 0, yMm: 2000 }, { id: 'd', xMm: length, yMm: 2000 }];
  floor.walls = [
    { id: 'host', startNodeId: 'a', endNodeId: 'b', lengthMm: length, thicknessMm: 200, bodyNormalSide: 'right' },
    { id: 'left', startNodeId: 'a', endNodeId: 'c', lengthMm: 2000, thicknessMm: startThickness, bodyNormalSide: 'left' },
    { id: 'right', startNodeId: 'b', endNodeId: 'd', lengthMm: 2000, thicknessMm: endThickness, bodyNormalSide: 'right' }
  ];
  return draft;
}

test('door/window edits stop at both incident wall inner faces, including offset edits', () => {
  for (const type of ['door', 'window']) {
    const draft = junctionDraft();
    const floor = surveyGraph.getActiveFloor(draft);
    floor.openings.push(planAddOpening(draft, 'host', type).opening);
    const id = floor.openings[0].id;
    const original = JSON.stringify(draft);
    const wide = planUpdateOpening(draft, id, { widthMm: 9999 }).replacement;
    assert.equal(wide.widthMm, 3500);
    assert.equal(wide.centerOffsetMm, 1950);
    for (const [offset, expected] of [[-1000, 700], [9999, 3200]]) {
      const moved = planUpdateOpening(draft, id, { widthMm: 1000, centerOffsetMm: offset }).replacement;
      assert.equal(moved.centerOffsetMm, expected);
    }
    assert.equal(JSON.stringify(draft), original);
  }
});

test('junction bounds are rotation, reflection, direction and array-order invariant', () => {
  for (const mirror of [1, -1]) for (const angle of [0, Math.PI / 2, Math.PI / 4]) {
    const draft = junctionDraft();
    const floor = surveyGraph.getActiveFloor(draft);
    floor.nodes.forEach(n => {
      const x = n.xMm * mirror, y = n.yMm;
      n.xMm = x * Math.cos(angle) - y * Math.sin(angle) + 123;
      n.yMm = x * Math.sin(angle) + y * Math.cos(angle) - 456;
    });
    if (mirror < 0) floor.walls.forEach(w => { w.bodyNormalSide = w.bodyNormalSide === 'left' ? 'right' : 'left'; });
    const host = floor.walls[0];
    floor.walls.reverse();
    assert.deepEqual(getOpeningHostBounds(floor, host), { startMm: 200, endMm: 3700 });
    [host.startNodeId, host.endNodeId] = [host.endNodeId, host.startNodeId];
    host.bodyNormalSide = host.bodyNormalSide === 'left' ? 'right' : 'left';
    assert.deepEqual(getOpeningHostBounds(floor, host), { startMm: 300, endMm: 3800 });
  }
});

test('diagonal incident body reserves its clipped projection, not a fixed thickness', () => {
  const floor = surveyGraph.getActiveFloor(junctionDraft());
  floor.nodes.find(n => n.id === 'c').xMm = 2000;
  assert.deepEqual(getOpeningHostBounds(floor, floor.walls[0]), { startMm: 483, endMm: 3700 });
});

test('outward walls and collinear continuations do not subtract an arbitrary margin', () => {
  const floor = surveyGraph.getActiveFloor(junctionDraft());
  floor.walls[1].bodyNormalSide = 'right';
  floor.walls[2].bodyNormalSide = 'left';
  assert.deepEqual(getOpeningHostBounds(floor, floor.walls[0]), { startMm: 0, endMm: 4000 });
  floor.nodes.find(n => n.id === 'c').xMm = -2000;
  floor.nodes.find(n => n.id === 'c').yMm = 0;
  assert.deepEqual(getOpeningHostBounds(floor, floor.walls[0]), { startMm: 0, endMm: 4000 });
});

test('insufficient clear span rejects atomically and odd widths stay inside the junction', () => {
  const draft = junctionDraft(550);
  const before = JSON.stringify(draft);
  assert.throws(() => planAddOpening(draft, 'host', 'door'), { code: 'OPENING_HOST_TOO_SHORT' });
  assert.equal(JSON.stringify(draft), before);
  const odd = junctionDraft(4001);
  const opening = planAddOpening(odd, 'host', 'window').opening;
  surveyGraph.getActiveFloor(odd).openings.push(opening);
  const result = planUpdateOpening(odd, opening.id, { widthMm: 9999 }).replacement;
  assert.equal(result.widthMm, 3500);
  assert.ok(result.centerOffsetMm - result.widthMm / 2 >= 200);
  assert.ok(result.centerOffsetMm + result.widthMm / 2 <= 3701);
});

function commitPreview(draft, rawPoint) {
  const preview = surveyGraph.startPreview(draft, rawPoint);
  const floor = surveyGraph.getActiveFloor(preview);
  return surveyGraph.commitPreviewLength(preview, floor.session.previewLengthMm, 'manual');
}

function createWallDraft(lengthMm) {
  let draft = surveyGraph.createSurveyDraft();
  draft = surveyGraph.setThickness(draft, 200);
  draft = surveyGraph.placeCursor(draft, { xMm: 0, yMm: 0 });
  return commitPreview(draft, { xMm: lengthMm, yMm: 0 });
}

test('normalizeOpeningToWall keeps a width above 60% of the host wall', () => {
  const opening = { widthMm: 3500, centerOffsetMm: 2162 };
  normalizeOpeningToWall(opening, { lengthMm: 4325 }, { minimumSizeMm: 100 });
  assert.equal(opening.widthMm, 3500);
});

test('door and window width may occupy the host wall and never a 60% cap', () => {
  for (const openingType of ['door', 'window']) {
    let draft = createWallDraft(4325);
    let floor = surveyGraph.getActiveFloor(draft);
    const wallId = floor.walls[0].id;

    draft = surveyGraph.addOpeningToWall(draft, wallId, openingType);
    floor = surveyGraph.getActiveFloor(draft);
    const openingId = floor.openings.at(-1).id;

    draft = surveyGraph.updateOpening(draft, openingId, { widthMm: 3500 });
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(
      floor.openings[0].widthMm,
      3500,
      `${openingType} width 3500 on a 4325 mm wall must not clamp to 2595`
    );

    draft = surveyGraph.updateOpening(draft, openingId, { widthMm: 5000 });
    floor = surveyGraph.getActiveFloor(draft);
    assert.equal(
      floor.openings[0].widthMm,
      4325,
      `${openingType} width must clamp to the current host wall length`
    );
  }
});
