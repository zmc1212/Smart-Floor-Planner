const test = require('node:test');
const assert = require('node:assert/strict');
const surveyGraph = require('../utils/surveyWallGraph.js');
const { normalizeOpeningToWall } = require('../utils/survey/domain/opening');

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
