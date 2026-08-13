const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editorScript = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);
const editorWxml = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.wxml'),
  'utf8'
);
const editorWxss = fs.readFileSync(
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.wxss'),
  'utf8'
);

test('the close action follows the graph minimum-wall rule for standalone and shared starts', () => {
  assert.match(
    editorScript,
    /const minimumActiveWallCount = surveyGraph\.getMinimumClosureSuggestionWallCount\(floor, session\)/
  );
  assert.match(editorScript, /const actionVisible = session\.state === 'closing' \|\| session\.state === 'mergeClosing'/);
  assert.match(editorScript, /left:\$\{roundPx\(actionX - actionRadius\)\}px; top:\$\{roundPx\(actionY - actionRadius\)\}px;/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible && closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
  assert.match(editorWxml, /aria-label="闭合当前空间"[\s\S]*<cover-view class="closure-action-label">合<\/cover-view>/);
  assert.match(editorWxss, /\.closure-action\s*\{\s*width: 56rpx;\s*height: 56rpx;\s*border: 0;\s*border-radius: 50%;\s*background: var\(--brand-primary\);/);
});

test('a placed cursor keeps its guide visibility when the canvas render data is returned', () => {
  assert.match(editorScript, /return \{\s*cursorVisible,\s*guideVisible,/);
});

test('wall dragging starts from the rendered cursor face instead of its hidden topology node', () => {
  assert.match(
    editorScript,
    /const cursorSource = session\.state === 'awaitingLength' && session\.previewPoint[\s\S]*?surveyGraph\.getCursorDisplayPoint\(floor, session\) \|\| anchor/
  );
});

test('wall-snapped cursor drops clear a late transient frame after the formal canvas redraw', () => {
  assert.match(
    editorScript,
    /this\.drawSurveyCanvas\(\);\s*\/\/ A cursor-drag frame[\s\S]*?this\.clearCursorDragCanvas\(\{ force: true \}\);/
  );
});

test('cursor dragging forwards only active snap geometry and clears it on every exit path', () => {
  assert.match(
    editorScript,
    /snapGuide: this\.cursorDragSnapGuide/
  );
  assert.match(
    editorScript,
    /buildCursorDragSnapGuide\(candidate\)[\s\S]*?candidate\.type === 'free' \|\| candidate\.type === 'none'[\s\S]*?candidate\.type === 'alignment'[\s\S]*?candidate\.type === 'vertex'[\s\S]*?axis: 'both'/
  );
  assert.match(
    editorScript,
    /this\.cursorDragSnapGuide = this\.buildCursorDragSnapGuide\(candidate\)/
  );
  assert.match(
    editorScript,
    /clearCursorDragCanvas\(options\)[\s\S]*?this\.cursorDragSnapGuide = null;/
  );
  assert.match(
    editorScript,
    /applyDraft\(nextDraft, options\) \{[\s\S]*?this\.clearCursorDragCanvas\(\{ force: true \}\);/
  );
  assert.match(
    editorScript,
    /onUndo\(\) \{\s*this\.clearCursorDragCanvas\(\{ force: true \}\);\s*if \(!this\.history\.undo\.length\) return;/
  );
  assert.match(
    editorScript,
    /onRedoTap\(\) \{\s*this\.clearCursorDragCanvas\(\{ force: true \}\);\s*if \(!this\.history\.redo\.length\) return;/
  );
});

test('canvas cursor drags reuse the lens layer without painting a second drag cursor', () => {
  assert.match(
    editorScript,
    /updateCanvasCursorLens\(clientPoint, pointMm\)[\s\S]*?queueCursorDragCanvas\(clientPoint, \{ showCursor: false \}\)/
  );
  assert.match(
    editorScript,
    /showCursor: this\.cursorDragCanvasShowCursor/
  );
});

test('cursor release commits the last visible snap candidate instead of reclassifying the raw touchend point', () => {
  assert.match(
    editorScript,
    /this\.cursorDragCandidate = isSnapped && candidate\.pointMm[\s\S]*?const candidate = this\.cursorDragCandidate \|\| this\.getCursorPlacementCandidate\(releasePoint\);/
  );
  assert.match(editorScript, /this\.cursorDragCandidate = null;[\s\S]*?this\.cursorDragPending = true;/);
});

test('canvas wall snapping forwards the resolved vertex or wall candidate to the graph', () => {
  assert.match(
    editorScript,
    /const candidate = this\.getCursorPlacementCandidate\(touchState\.startPoint\);[\s\S]*?candidate\.type !== 'vertex' && candidate\.type !== 'wall'[\s\S]*?surveyGraph\.snapCursorToWall\(this\.draft, candidate\.pointMm, candidate\)/
  );
});

test('a placed cursor stays resettable after a room closes, then explicitly enters wall-drop mode', () => {
  assert.match(
    editorScript,
    /resolveCursorPlacementState\(floor, session\) \{[\s\S]*?session\.state === 'wallSnapPending'/
  );
  assert.doesNotMatch(editorScript, /session\.state === 'spaceClosed' \|\| session\.state === 'wallSnapPending'/);
  assert.match(editorScript, /wx\.showToast\(\{ title: '请拖动光标到墙体', icon: 'none' \}\)/);
  assert.match(editorWxml, /wx:if="\{\{cursorPlacementState === 'placed'\}\}"[\s\S]*?cursor-action-reset[\s\S]*?重置光标/);
  assert.match(editorWxml, /cursor-action-drag[\s\S]*?dock-cursor-icon-ghost[\s\S]*?dock-cursor-origin[\s\S]*?cursor-dock-helper-label[\s\S]*?光标拖动到墙体/);
  assert.match(editorWxss, /\.cursor-action-drag\s*\{[\s\S]*?background:\s*#f3fbf5;/);
  assert.match(editorWxss, /\.cursor-dock-helper\s*\{[\s\S]*?width:\s*232rpx;[\s\S]*?pointer-events:\s*none;/);
  assert.match(editorWxss, /\.cursor-dock-helper-label\s*\{[\s\S]*?text-align:\s*center;/);
});

test('viewport gestures render on the primary canvas instead of the cursor overlay', () => {
  assert.match(
    editorScript,
    /drawViewportInteractionFrame\(viewport\)[\s\S]*?this\.surveyCtx,[\s\S]*?dpr: this\.surveyCanvasDpr \|\| 1/
  );
});

test('releasing a straight-wall drag on any valid closure target closes immediately', () => {
  assert.match(
    editorScript,
    /surveyGraph\.isDirectClosureHit\(floor, session, releasePointMm\)[\s\S]*?surveyGraph\.confirmClosure\(this\.draft\)[\s\S]*?已吸附闭合点并闭合/
  );
});
