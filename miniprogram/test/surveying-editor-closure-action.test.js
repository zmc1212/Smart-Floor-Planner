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
  path.join(__dirname, '..', 'packages', 'surveying', 'editor', 'surveying-editor.less'),
  'utf8'
);

test('the close action follows the graph minimum-wall rule for standalone and shared starts', () => {
  assert.match(
    editorScript,
    /const minimumActiveWallCount = surveyGraph\.getMinimumActiveCloseWallCount\(floor, session\)/
  );
  assert.match(
    editorScript,
    /const directCloseReady = !!\([\s\S]*?surveyGraph\.isDirectClosureHit\(floor, session, session\.previewPoint\)/
  );
  assert.match(
    editorScript,
    /const actionVisible = !directCloseReady && \([\s\S]*?session\.state === 'closing' \|\|[\s\S]*?session\.state === 'mergeClosing'/
  );
  assert.match(editorScript, /const action = actionVisible \? \{ cx: actionX, cy: actionY \} : null/);
  assert.match(editorScript, /left:\$\{roundPx\(actionX - actionRadius\)\}px; top:\$\{roundPx\(actionY - actionRadius\)\}px;/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible && closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
  assert.match(editorWxml, /aria-label="闭合当前空间"[\s\S]*<cover-view class="closure-action-label">合<\/cover-view>/);
  assert.match(editorWxss, /\.closure-action\s*\{[\s\S]*?width: 56rpx;[\s\S]*?height: 56rpx;[\s\S]*?border: 0;[\s\S]*?border-radius: 50%;[\s\S]*?background: transparent;[\s\S]*?opacity: 0;/);
  assert.match(editorScript, /if \(controls\.closeAction\) \{/);
  assert.match(editorScript, /closeActionVisible: renderData\.closeActionVisible && !this\.isCursorLensActive\(\)/);
  assert.doesNotMatch(
    editorScript,
    /snapGuide: this\.cursorDragSnapGuide,\s*closeAction: this\.canvasControls && this\.canvasControls\.closeAction/
  );
  assert.match(editorScript, /surveyCanvasRenderer\.drawCloseAction\(ctx, controls\.closeAction\)/);
  assert.match(editorScript, /drawViewportInteractionControls\(viewport\)/);
  assert.match(
    editorScript,
    /surveyCanvasRenderer\.projectInteractionPoint\([\s\S]*?x: close\.cx, y: close\.cy[\s\S]*?transform[\s\S]*?cx: closePoint\.x,[\s\S]*?cy: closePoint\.y/
  );
});

test('the right rail exposes a separately confirmed canvas-reset action', () => {
  assert.match(editorWxml, /class="rail-reset-canvas"[\s\S]*?bindtap="onRequestResetCanvas"/);
  assert.match(editorWxml, /aria-label="清空画布后重新测量"[\s\S]*?rail-reset-canvas-label">清空</);
  assert.doesNotMatch(editorWxml, /清空重做/);
  assert.match(editorScript, /onRequestResetCanvas\(\) \{[\s\S]*?wx\.showModal\([\s\S]*?this\.onResetCanvas\(\);/);
  assert.match(editorScript, /confirmText: '清空重做'/);
  assert.match(editorScript, /onResetCanvas\(\) \{[\s\S]*?this\.history = \{ undo: \[\], redo: \[\] \};[\s\S]*?this\.pendingMeasurementRecords = \[\];/);
  assert.match(editorWxss, /\.rail-reset-canvas\s*\{[\s\S]*?height:\s*102rpx;[\s\S]*?border:\s*0;[\s\S]*?color:\s*#b42318;/);
  assert.match(editorWxss, /\.rail-reset-canvas-icon\s*\{[\s\S]*?width:\s*36rpx;/);
  assert.doesNotMatch(editorWxss, /rail-reset-canvas[\s\S]{0,220}border-top:/);
});

test('a placed cursor keeps its guide visibility when the canvas render data is returned', () => {
  assert.match(editorScript, /return \{\s*cursorVisible,\s*guideVisible,/);
});

test('BLE direction arrows remain available while the close action is shown', () => {
  const start = editorScript.indexOf('shouldShowBleDirectionArrows(floor, session) {');
  const end = editorScript.indexOf('buildBleDirectionSceneData', start);
  assert.ok(start >= 0 && end > start, 'direction visibility helper should remain present');
  const visibility = editorScript.slice(start, end);
  assert.match(visibility, /session\.state === 'closing'/);
  assert.match(visibility, /session\.state === 'mergeClosing'/);
  assert.doesNotMatch(
    visibility,
    /\['spaceClosed', 'wallSelected', 'remeasureAwaitingInput', 'closing', 'mergeClosing'\]/
  );
});

test('wall dragging starts from the rendered cursor face instead of its hidden topology node', () => {
  assert.match(
    editorScript,
    /const cursorSource = surveyGraph\.getCursorDisplayPoint\(floor, session\) \|\| anchor/
  );
});

test('wall-snapped cursor drops clear a late transient frame after the formal canvas redraw', () => {
  assert.match(
    editorScript,
    /this\.drawSurveyCanvas\(\{ renderRevision \}\);\s*\/\/ A cursor-drag frame[\s\S]*?this\.clearCursorDragCanvas\(\{ force: true \}\);/
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
    /updateCanvasCursorLens\(clientPoint, pointMm, target\)[\s\S]*?buildCursorLens\(\s*pointMm,\s*\(target && target\.type\) \|\| 'free'/
  );
  assert.match(
    editorScript,
    /resolvePreviewLensTarget\(session, previewPointMm\)[\s\S]*alignmentSnapGuide[\s\S]*closeCandidateType/
  );
  assert.match(
    editorScript,
    /updateCanvasCursorLens\(clientPoint, pointMm, target\)[\s\S]*?queueCursorDragCanvas\(clientPoint, \{ showCursor: false, sync: true \}\)/
  );
  assert.match(
    editorScript,
    /showCursor: this\.cursorDragCanvasShowCursor/
  );
  assert.match(editorScript, /queueWallDragRedraw\(/);
  assert.match(editorScript, /resolveCursorLensSample\(/);
  assert.match(editorScript, /Canvas owns the lens chrome\. Only publish the dragging state once/);
});

test('cursor release commits the last visible snap candidate instead of reclassifying the raw touchend point', () => {
  assert.match(
    editorScript,
    /this\.cursorDragCandidate = isSnapped && candidate\.pointMm[\s\S]*?const candidate = this\.cursorDragCandidate \|\| this\.getCursorPlacementCandidate\(releasePoint, \{ useHysteresis: true \}\);/
  );
  assert.match(editorScript, /this\.cursorDragCandidate = null;[\s\S]*?this\.cursorDragPending = true;/);
});

test('wall-drop state does not place the cursor from a canvas tap', () => {
  assert.match(
    editorScript,
    /if \(touchState\.mode === 'wallSnapPending'\) \{[\s\S]*?Waiting-to-drop is intentionally drag-only[\s\S]*?hitTestClosedSpaceAtClientPoint\(touchState\.startPoint\)/
  );
  assert.match(
    editorScript,
    /if \(touchState\.mode === 'wallSnapPending'\) \{[\s\S]*?请拖动光标到画布放置/
  );
  assert.doesNotMatch(
    editorScript,
    /if \(touchState\.mode === 'wallSnapPending'\) \{[\s\S]*?getCursorPlacementCandidate\(touchState\.startPoint\)/
  );
});

test('wallSnapPending tap selects a closed space fill when wall/vertex snap misses', () => {
  assert.match(
    editorScript,
    /if \(touchState\.mode === 'wallSnapPending'\) \{[\s\S]*?hitTestWallAtClientPoint\(touchState\.startPoint\)[\s\S]*?surveyGraph\.selectWall\(this\.draft, wallHit\.wallId\)[\s\S]*?hitTestClosedSpaceAtClientPoint\(touchState\.startPoint\)[\s\S]*?surveyGraph\.selectSpace\(this\.draft, spaceHit\.spaceId\)[\s\S]*?请拖动光标到画布放置/
  );
  assert.match(
    editorWxml,
    /data-tool="space-rename"[\s\S]*?catchtap="onToolTap"[\s\S]*?data-tool="space-delete"[\s\S]*?catchtap="onToolTap"/
  );
  assert.match(
    editorScript,
    /if \(tool && \(tool\.indexOf\('object-'\) === 0 \|\| tool\.indexOf\('space-'\) === 0\)\)/
  );
});

test('space name sheet hides native canvas dock cover-views so they cannot stack above the view sheet', () => {
  assert.match(
    editorWxml,
    /wx:if="\{\{!numberPadVisible && !spaceNameSheetVisible\}\}" class="history-action-bar bottom-control-dock/
  );
  assert.match(
    editorWxml,
    /wx:if="\{\{!numberPadVisible && !spaceNameSheetVisible\}\}"[\s\S]*?class="cursor-dock-helper/
  );
  assert.match(editorWxml, /wx:if="\{\{spaceNameSheetVisible\}\}" class="space-name-sheet/);
});

test('closing a room automatically enters the reset-cursor wall-drop state', () => {
  assert.match(
    editorScript,
    /enterResetCursorAfterClose\(draft\) \{[\s\S]*?session\.state !== 'spaceClosed'[\s\S]*?this\.cursorPlacementState = 'awaitingWallDrop'[\s\S]*?surveyGraph\.startWallSnap\(draft\)/
  );
  assert.match(
    editorScript,
    /surveyGraph\.isDirectClosureHit\(floor, session, releasePointMm\)[\s\S]*?this\.enterResetCursorAfterClose\(\s*surveyGraph\.confirmClosure\(this\.draft\)\)/
  );
  assert.match(
    editorScript,
    /onConfirmClose\(\) \{[\s\S]*?this\.enterResetCursorAfterClose\(\s*surveyGraph\.confirmClosure\(this\.draft\)\)/
  );
  assert.match(
    editorScript,
    /applyBleReadingToPendingWall\(distanceInMeters\) \{[\s\S]*?maybeAutoConfirmSharedBoundaryClose\([\s\S]*?this\.enterResetCursorAfterClose\(nextDraft\)/
  );
  assert.match(
    editorScript,
    /maybeAutoConfirmSharedBoundaryClose\(\s*surveyGraph\.commitPreviewLength\(this\.draft, session\.previewLengthMm, 'preview'\)[\s\S]*?this\.enterResetCursorAfterClose\(nextDraft\)/
  );
  assert.match(
    editorScript,
    /maybeAutoConfirmSharedBoundaryClose\(\s*surveyGraph\.commitPreviewLength\(this\.draft, value, lengthInputSource\)[\s\S]*?this\.enterResetCursorAfterClose\(nextDraft\)/
  );
  assert.match(
    editorScript,
    /resolveCursorPlacementState\(floor, session\) \{[\s\S]*?session\.state === 'wallSnapPending'/
  );
  assert.match(
    editorScript,
    /if \(this\.touchState\.mode === 'wallSnapPending'\) \{[\s\S]*?this\.touchState\.mode = 'pan';[\s\S]*?this\.beginViewportInteraction\(this\.touchState\.startViewport\);/
  );
  assert.match(editorScript, /wx\.showToast\(\{ title: '请拖动光标到墙体', icon: 'none' \}\)/);
  assert.match(editorWxml, /wx:if="\{\{cursorPlacementState === 'placed'\}\}"[\s\S]*?cursor-action-reset[\s\S]*?cursor-reticle\.png/);
  assert.match(editorWxml, /cursor-action-drag[\s\S]*?dock-cursor-icon-ghost[\s\S]*?dock-cursor-origin[\s\S]*?cursor-dock-helper-label[\s\S]*?光标拖动到墙体/);
  assert.match(editorWxml, /cursorPlacementState === 'placed' \? '重置光标' : '光标拖动到墙体'/);
  assert.match(editorWxml, /cursor-reticle\.png/);
  assert.match(editorWxss, /\.cursor-action-drag\s*\{[\s\S]*?background:\s*#f3fbf5;/);
  assert.match(editorWxss, /\.dock-action cover-image\.dock-cursor-icon\s*\{[\s\S]*?width:\s*108rpx;/);
  assert.match(editorWxss, /\.cursor-dock-helper\s*\{[\s\S]*?width:\s*232rpx;[\s\S]*?pointer-events:\s*none;/);
  assert.match(editorWxss, /\.cursor-dock-helper-label\s*\{[\s\S]*?text-align:\s*center;/);
});

test('restoring a saved closed room resumes at the next-room wall-drop state', () => {
  assert.match(
    editorScript,
    /normalizeRestoredFormalDraft\(draft\) \{[\s\S]*?session\.state === 'spaceClosed'[\s\S]*?surveyGraph\.startWallSnap\(restored\)/
  );
});

test('viewport gestures render on the primary canvas instead of the cursor overlay', () => {
  assert.match(
    editorScript,
    /drawViewportInteractionFrame\(viewport\)[\s\S]*?this\.surveyCtx,[\s\S]*?dpr: this\.surveyCanvasDpr \|\| 1[\s\S]*?this\.drawViewportInteractionControls\(viewport\)/
  );
});

test('releasing a straight-wall drag on any valid closure target closes immediately', () => {
  assert.match(
    editorScript,
    /surveyGraph\.isDirectClosureHit\(floor, session, releasePointMm\)[\s\S]*?surveyGraph\.confirmClosure\(this\.draft\)[\s\S]*?已吸附闭合点并闭合/
  );
  assert.match(
    editorScript,
    /maybeAutoConfirmSharedBoundaryClose\(\s*surveyGraph\.commitPreviewLength\(this\.draft, session\.previewLengthMm, 'preview'\)/
  );
});

test('opening split conflicts reuse the existing non-layout closure toast path', () => {
  assert.match(
    editorScript,
    /if \(directClosureHit\) \{[\s\S]*?surveyGraph\.confirmClosure\(this\.draft\)[\s\S]*?catch \(err\) \{\s*wx\.showToast\(\{ title: err\.message \|\| '闭合失败，请重新测量', icon: 'none' \}\);/
  );
  assert.match(
    editorScript,
    /onConfirmClose\(\) \{[\s\S]*?surveyGraph\.confirmClosure\(this\.draft\)[\s\S]*?catch \(err\) \{\s*wx\.showToast\(\{ title: err\.message \|\| '闭合失败，请重新测量', icon: 'none' \}\);/
  );
  assert.match(
    editorScript,
    /applyBleReadingToPendingWall\(distanceInMeters\) \{[\s\S]*?surveyGraph\.commitPreviewLength\(this\.draft, valueMm, 'ble'\)[\s\S]*?catch \(err\) \{\s*wx\.showToast\(\{ title: err\.message \|\| '更新墙体失败', icon: 'none' \}\);/
  );
  assert.match(
    editorScript,
    /if \(session\.state === 'awaitingLength' \|\| session\.state === 'wallPreview'\) \{[\s\S]*?surveyGraph\.commitPreviewLength\(this\.draft, value, lengthInputSource\)[\s\S]*?catch \(err\) \{\s*wx\.showToast\(\{ title: err\.message \|\| '输入无效', icon: 'none' \}\);/
  );
});
