const surveyGraph = require('./miniprogram/utils/surveyWallGraph.js');

function rectangle(widthMm, heightMm, origin, options = {}) {
  const { xMm, yMm } = origin || { xMm: 0, yMm: 0 };
  let draft = surveyGraph.resetCursor(surveyGraph.createSurveyDraft());
  if (options.thicknessMm) draft = surveyGraph.setThickness(draft, options.thicknessMm);
  const commitWall = (d, point) => {
    const prev = surveyGraph.startPreview(d, point);
    const f = surveyGraph.getActiveFloor(prev);
    return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'h5-scenario');
  };
  draft = surveyGraph.placeCursor(draft, { xMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm });
  draft = commitWall(draft, { xMm: xMm + widthMm, yMm: yMm + heightMm });
  draft = commitWall(draft, { xMm, yMm: yMm + heightMm });
  return surveyGraph.confirmClosure(draft);
}

function snapCursor(draft, point) {
  const floor = surveyGraph.getActiveFloor(draft);
  const target = surveyGraph.getCursorPlacementTarget(floor, point, surveyGraph.CLOSE_TOLERANCE_MM);
  if (!target || !target.pointMm || target.type === 'free') {
    throw new Error(`吸附失败: (${point.xMm}, ${point.yMm})`);
  }
  return surveyGraph.snapCursorToWall(surveyGraph.startWallSnap(draft), target.pointMm, target);
}

const commitWall = (d, pt) => {
  const prev = surveyGraph.startPreview(d, pt);
  const f = surveyGraph.getActiveFloor(prev);
  return surveyGraph.commitPreviewLength(prev, f.session.previewLengthMm, 'preview');
};

let draft = rectangle(6000, 4000, { xMm: 0, yMm: 0 }, { thicknessMm: 200 });
draft = snapCursor(draft, { xMm: 1000, yMm: -200 });
draft = commitWall(draft, { xMm: 1000, yMm: -2200 });
draft = commitWall(draft, { xMm: 3243, yMm: -2200 });

console.log('Draft created, 2 walls of new room committed');
