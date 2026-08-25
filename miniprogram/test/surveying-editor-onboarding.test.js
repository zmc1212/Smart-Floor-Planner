const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorDir = path.join(miniRoot, 'packages', 'surveying', 'editor');
const editorScript = fs.readFileSync(path.join(editorDir, 'surveying-editor.js'), 'utf8');
const editorWxml = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxml'), 'utf8');
const editorWxss = fs.readFileSync(path.join(editorDir, 'surveying-editor.less'), 'utf8');
const navigationScript = fs.readFileSync(path.join(miniRoot, 'utils', 'surveyNavigation.js'), 'utf8');
const planRoute = fs.readFileSync(
  path.join(miniRoot, '..', 'admin', 'src', 'app', 'api', 'floorplans', '[id]', 'route.ts'),
  'utf8'
);

test('opening a lead without floorPlanId still loads that lead\'s existing cloud plan', () => {
  assert.match(editorScript, /resolveLeadFloorPlan\(leadId\)/);
  assert.match(editorScript, /if \(this\.serverDraftId\) this\.loadFormalFloorPlan\(this\.serverDraftId\);\s*else if \(leadId && !startNewSurvey\) this\.resolveLeadFloorPlan\(leadId\);/);
  assert.match(editorScript, /api\.request\(`\/leads\/\$\{leadId\}`, 'GET'\)/);
  assert.match(editorScript, /readLeadFloorPlanId\(/);
});

test('formal surveying titles resolve to the linked community instead of a formal-survey label', () => {
  assert.match(navigationScript, /communityName: opts\.communityName \|\| ''/);
  assert.match(editorScript, /title: context\.communityName \|\| '未填写小区'/);
  assert.match(editorScript, /title: communityName \|\| '未填写小区'/);
  assert.match(planRoute, /findByFloorPlanId\(plan\.id\)/);
  assert.match(planRoute, /lead: lead/);
  assert.match(editorWxss, /\.page-title\s*\{[\s\S]*text-overflow:\s*ellipsis;/);
});

test('formal surveying uses a persistent state-following guide mode instead of a paged tour', () => {
  assert.match(editorScript, /SURVEYING_GUIDE_ENABLED_KEY/);
  assert.match(editorScript, /loadGuideEnabled\(\)/);
  assert.match(editorScript, /persistGuideEnabled\(enabled\)/);
  assert.match(editorScript, /onGuideToggle\(\)/);
  assert.match(editorScript, /resolveSurveyGuide\(\{/);
  assert.match(editorWxml, /class="topbar-chip guide-trigger \{\{guideEnabled \? 'active' : ''\}\}"/);
  assert.match(editorWxml, /bindtap="onGuideToggle"/);
  assert.match(editorScript, /this\.surveyGuideCanvasModel = \{/);
  assert.match(editorScript, /drawSurveyGuideCanvas\(\)/);
  assert.doesNotMatch(editorWxml, /<cover-view[\s\S]*class="survey-guide-overlay"/);
  assert.doesNotMatch(editorWxml, /class="cursor-lens/);
  assert.doesNotMatch(editorWxml, /<cover-view[\s\S]*class="cursor-drag-lens-layer"/);
  assert.match(editorWxml, /id="cursor-drag-control"/);
  assert.match(editorScript, /query\.select\('#cursor-drag-control'\)/);
  assert.doesNotMatch(editorScript, /query\.select\('\.cursor-fab-drop'\)/);
  assert.match(editorScript, /hasUsablePagePoint = pageX !== null && pageY !== null/);
  assert.match(editorScript, /const movedWithoutTouchMove = !wasDragging && dragWasPending/);
  assert.match(editorScript, /Canvas owns the lens chrome\. Only publish the dragging state once/);
  assert.match(editorScript, /isCursorLensActive\(\) \{[\s\S]*this\.cursorPlacementState === 'dragging' \|\| this\.canvasCursorLensActive/);
  assert.match(editorScript, /this\.draft = surveyGraph\.startPreview\(this\.draft, snappedMm\);[\s\S]*surveyGraph\.getCursorDisplayPoint\(previewFloor, previewFloor\.session\)[\s\S]*this\.queueWallDragRedraw\(/);
  assert.match(editorScript, /if \(movedWall\) \{[\s\S]*this\.clearCanvasCursorLens\(\);/);
  assert.match(editorScript, /lensMeta: this\.cursorLensMeta/);
  assert.doesNotMatch(editorScript, /SURVEYING_ONBOARDING_STEPS|onOnboardingNext|onOnboardingSkip/);
  assert.doesNotMatch(editorWxml, /onboardingProgress|onboarding-next|survey-onboarding/);
  assert.doesNotMatch(editorWxml, /class="survey-guide-layer/);
  assert.doesNotMatch(editorWxml, /surveyGuideFocusVisible|survey-guide-focus/);
  assert.match(editorScript, /wrapSurveyGuideCanvasBody\(/);
  assert.match(editorScript, /ctx\.measureText\(nextLine\)\.width > maxWidth/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible && topMetricVisible && topMetricLength && cursorPlacementState === 'placed'\}\}"/);
  assert.doesNotMatch(editorWxml, /class="measurement-bubble"/);
  assert.doesNotMatch(editorWxml, /survey-guide-(?:card|path|target-halo)/);
  assert.doesNotMatch(editorWxss, /\.survey-guide-overlay\s*\{/);
  assert.doesNotMatch(editorWxss, /\.cursor-drag-lens-layer\s*\{/);
  assert.match(editorScript, /ctx\.fillText\(line, card\.left \+ 16/);
});

test('contextual guide uses three transparent Xiao K pointing poses', () => {
  const dimensions = {
    left: [452, 439],
    right: [459, 433],
    down: [398, 437]
  };
  Object.entries(dimensions).forEach(([pose, [width, height]]) => {
    const asset = fs.readFileSync(path.join(miniRoot, 'packages', 'surveying', 'assets', `surveying-guide-k-${pose}-v3.png`));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(asset.readUInt32BE(16), width);
    assert.equal(asset.readUInt32BE(20), height);
    assert.ok([3, 6].includes(asset[25]));
    assert.ok(asset.length > 1024);
    assert.match(editorScript, new RegExp(`/packages/surveying/assets/surveying-guide-k-${pose}-v3\\.png`));
  });
  assert.match(editorScript, /drawSurveyGuideCanvas\(\)/);
  assert.match(editorScript, /getSurveyGuideCanvasImage/);
  assert.match(editorScript, /bezierCurveTo/);
  assert.match(editorScript, /setLineDash\(\[5, 4\]\)/);
  assert.match(editorWxml, /guide-help\.png/);
  assert.doesNotMatch(editorWxml, /survey-guide-(?:card|path|target-halo)/);
  assert.doesNotMatch(editorWxml, /\/packages\/surveying\/assets\/surveying-onboarding-k\.png/);
});

test('surveying toolbar uses the approved rail cuts and stateful BLE icons', () => {
  const iconPaths = [
    'icons/guide-help.png',
    'icons/save-draft.png',
    'icons/ble-green.png',
    'icons/ble-muted.png',
    'icons/cursor-reticle.png',
    'icons/editor-rail/align.png',
    'icons/editor-rail/align-active.png',
    'icons/editor-rail/annotation.png',
    'icons/editor-rail/annotation-active.png',
    'icons/editor-rail/layers.png',
    'icons/editor-rail/display.png'
  ];
  iconPaths.forEach((relativePath) => {
    const asset = fs.readFileSync(path.join(miniRoot, 'packages', 'surveying', 'assets', relativePath));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    if (relativePath === 'icons/cursor-reticle.png') {
      assert.equal(asset.readUInt32BE(16), 128);
      assert.equal(asset.readUInt32BE(20), 128);
    } else {
      assert.equal(asset.readUInt32BE(16), 48);
      assert.equal(asset.readUInt32BE(20), 48);
    }
    assert.ok([3, 6].includes(asset[25]));
  });
  assert.match(editorScript, /key: 'straight'[\s\S]*\? 'align-active' : 'align'/);
  assert.match(editorScript, /key: 'diagonal'[\s\S]*\? 'annotation-active' : 'annotation'/);
  assert.match(editorScript, /key: 'thickness'[\s\S]*icon: 'layers'/);
  assert.match(editorScript, /key: 'input'[\s\S]*icon: 'display'/);
  assert.match(editorWxml, /guide-help\.png/);
  assert.match(editorWxml, /save-draft\.png/);
  assert.match(editorWxml, /ble-\{\{bleConnected \? 'green' : 'muted'\}\}\.png/);
  assert.match(editorWxml, /editor-rail\/\{\{item\.icon\}\}\.png/);
  assert.match(editorWxml, /cursor-reticle\.png/);
});

test('selected walls do not replace the right rail with a contextual action panel', () => {
  assert.doesNotMatch(editorWxml, /class="tool-group primary-tools object-tools"/);
  assert.match(editorWxml, /wx:if="\{\{!selectedOpening\}\}" class="tool-group primary-tools"/);
  assert.doesNotMatch(editorScript, /OBJECT_TOOLS|objectToolsVisible|objectTools:/);
  assert.doesNotMatch(editorWxss, /object-tools|tool-helper/);
});

test('cursor magnifier uses one Canvas panel instead of a second native cover layer', () => {
  assert.doesNotMatch(editorWxml, /cursor-lens/);
  assert.doesNotMatch(editorWxss, /\.cursor-lens/);
  assert.match(editorScript, /this\.cursorLensMeta = \{[\s\S]*coordinateLabel:/);
  assert.match(editorScript, /const CURSOR_LENS_SIZE_PX = 120/);
});

test('cursor magnifier blits a formal crop without the canvas reticle and overlays a small crosshair', () => {
  assert.match(editorScript, /omitCursor:\s*this\.isCursorLensActive\(\)/);
  assert.match(editorScript, /surveyCanvasRenderer\.drawCursor\(\s*this\.surveyCtx,\s*this\.surveyRenderScene/);
  assert.match(
    editorScript,
    /this\.cursorPlacementState = 'dragging';\s*this\.pendingDockAimPoint = this\.toDockAimPoint\(point\);\s*if \(!wasDragging\) \{\s*this\.drawSurveyCanvas\(\);/
  );
});

test('dock cursor drag aims upper-left of the finger; wall drag uses sticky grab', () => {
  assert.match(editorScript, /require\('\.\.\/utils\/surveyCursorAim\.js'\)/);
  assert.match(editorScript, /toDockAimPoint\(touchPoint\) \{\s*return toAimClientPoint\(touchPoint, this\.canvasRect\) \|\| touchPoint;/);
  assert.match(editorScript, /this\.pendingDockAimPoint = this\.toDockAimPoint\(point\)/);
  assert.match(editorScript, /this\.queueDockCursorAim\(\)/);
  assert.match(editorScript, /flushDockCursorAim\(true\)/);
  assert.match(editorScript, /Cover-view touchmove is denser than paint frames/);
  assert.match(editorScript, /rawReleasePoint\s*\? this\.toDockAimPoint\(rawReleasePoint\)/);
  assert.match(editorScript, /Math\.hypot\(rawReleasePoint\.x - startPoint\.x, rawReleasePoint\.y - startPoint\.y\)/);
  assert.match(editorScript, /自由放置跟随瞄准点/);
  assert.match(
    editorScript,
    /wallGrabDelta: cursorSource[\s\S]*wallGrabDelta\(this\.mmToClientPoint\(cursorSource\), point\)/
  );
  assert.match(editorScript, /toWallGrabAimPoint\(point, this\.touchState\.wallGrabDelta\)/);
  assert.match(
    editorScript,
    /const currentMm = this\.canvasPointToMm\(\s*this\.touchState\.wallGrabDelta \? wallAimPoint : point/
  );
  assert.match(editorScript, /this\.queueWallDragRedraw\(wallAimPoint, previewPointMm, previewTarget\)/);
  assert.match(editorScript, /return isNearCursorHit\(localPoint, cursorPoint\)/);
  assert.doesNotMatch(editorScript, /distancePx\(cursorPoint, localPoint\) <= 44/);
  assert.doesNotMatch(editorScript, /startPreview\(this\.draft, toAimClientPoint/);
});

test('formal surveying fixed chrome follows the compact high-fidelity reference geometry', () => {
  assert.match(editorWxss, /\.survey-topbar\s*\{[\s\S]*height:\s*160rpx;/);
  assert.match(editorWxss, /\.topbar-right\s*\{[\s\S]*top:\s*94rpx;[\s\S]*right:\s*28rpx;/);
  assert.match(editorWxss, /\.right-rail\s*\{[\s\S]*right:\s*34rpx;[\s\S]*width:\s*88rpx;/);
  assert.match(editorWxss, /\.history-action-bar\.bottom-control-dock\s*\{[\s\S]*width:\s*575rpx;[\s\S]*height:\s*108rpx;/);
  assert.match(editorWxml, /测距\{\{bleConnected \? ' · 已连接' : ''\}\}/);
  assert.match(editorWxml, /wx:if="\{\{bleConnected\}\}" class="dock-status-dot"/);
  assert.match(editorWxss, /\.dock-status-dot\s*\{[\s\S]*?margin-left:\s*12rpx;/);
  assert.match(editorScript, /rect\.width \/ 390/);
  assert.match(editorWxml, /class="page-subtitle-text"/);
  assert.match(editorWxss, /\.topbar-right \.topbar-chip \+ \.topbar-chip\s*\{[\s\S]*margin-left:\s*20rpx;/);
  assert.match(editorScript, /title:\s*'小K提示'/);
  assert.match(editorScript, /tailHalfWidth = 8 \* scale/);
  assert.match(editorScript, /stroking only the two sides/);
  assert.match(editorScript, /bodyBottomPadding = 22 \* designScale/);
  assert.match(editorScript, /const sparkleX = labelX \+ labelWidth \+ 16/);
  assert.match(editorScript, /ctx\.textAlign = 'center'/);
  assert.doesNotMatch(editorWxml, /surveyGuidePhaseLabel|survey-guide-phase/);
});

test('selected doors and windows use the unified delete-only inspector', () => {
  const objectRailAssets = ['opening', 'edit', 'delete-danger', 'continue-wall'];
  objectRailAssets.forEach((name) => {
    const asset = fs.readFileSync(path.join(miniRoot, 'packages', 'surveying', 'assets', 'icons', 'object-rail', `${name}.png`));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(asset.readUInt32BE(16), 48);
    assert.equal(asset.readUInt32BE(20), 48);
    assert.ok([3, 6].includes(asset[25]));
  });
  assert.match(editorWxml, /right-rail native-canvas-overlay \{\{selectedOpening \? 'with-opening' : ''\}\}/);
  assert.match(editorWxml, /class="opening-title"[\s\S]*门 · 窗/);
  assert.match(editorWxml, /class="opening-field-label">宽/);
  assert.match(editorWxml, /class="opening-field-label">高/);
  assert.match(editorWxml, /wx:if="\{\{selectedOpening\.type === 'door'\}\}" class="opening-direction"/);
  assert.match(editorWxml, /opening-direction-title">开启方式[\s\S]*class="opening-direction-options"/);
  assert.match(editorWxml, /data-direction="inside"[\s\S]*data-direction="outside"/);
  assert.match(editorWxml, /opening-direction-label">内开[\s\S]*opening-direction-label">外开/);
  assert.doesNotMatch(editorWxml, /opening-direction-title">窗位|opening-fixed-option|opening-direction-label">固定/);
  assert.match(editorWxml, /class="opening-context[\s\S]*class="opening-primary-action"[\s\S]*opening-action-label">编辑[\s\S]*class="opening-delete-divider"[\s\S]*class="opening-delete-action"[\s\S]*删除门窗/);
  assert.match(editorWxml, /class="opening-delete-action" data-tool="object-delete"/);
  assert.match(editorWxml, /object-rail\/delete-danger\.png/);
  assert.match(editorWxml, /class="opening-resume-action" bindtap="onResumeWallDrawing" aria-role="button" aria-label="继续测墙"[\s\S]*class="opening-resume-content"[\s\S]*object-rail\/continue-wall\.png[\s\S]*opening-resume-label">继续测墙/);
  assert.doesNotMatch(editorWxml, /openingSecondaryTools|opening-secondary-tools|opening-secondary-action/);
  assert.doesNotMatch(editorScript, /OPENING_SECONDARY_TOOLS|openingSecondaryTools/);
  assert.match(editorScript, /onOpeningDirectionTap\(e\)[\s\S]*selectedOpening\.openDirection === direction/);
  assert.match(editorScript, /width:\s*formatCompactMm\(opening\.widthMm\)/);
  assert.match(editorScript, /height:\s*formatCompactMm\(opening\.heightMm\)/);
  assert.match(editorWxss, /\.right-rail\.with-opening\s*\{[\s\S]*right:\s*24rpx;[\s\S]*width:\s*194rpx;/);
  assert.match(editorWxss, /\.opening-primary-action\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*58rpx;/);
  assert.doesNotMatch(editorWxss, /\.opening-fixed-option/);
  assert.match(editorWxss, /\.opening-direction-label\s*\{[\s\S]*width:\s*100%;[\s\S]*line-height:\s*52rpx;[\s\S]*text-align:\s*center;/);
  assert.match(editorWxss, /\.opening-resume-action\s*\{[\s\S]*width:\s*100%;[\s\S]*height:\s*60rpx;[\s\S]*margin:\s*28rpx 0 0;[\s\S]*border:\s*1rpx solid rgba\(8, 160, 61, 0\.42\);[\s\S]*background:\s*rgba\(255, 255, 255, 0\.98\);/);
  assert.match(editorWxss, /\.opening-resume-content\s*\{[\s\S]*justify-content:\s*center;[\s\S]*width:\s*100%;/);
  assert.match(editorWxss, /\.opening-resume-icon\s*\{[\s\S]*width:\s*28rpx;[\s\S]*margin-right:\s*10rpx;/);
  assert.match(editorWxss, /\.opening-resume-label\s*\{[\s\S]*color:\s*#087f38;[\s\S]*font-size:\s*24rpx;[\s\S]*text-align:\s*center;/);
  assert.doesNotMatch(editorWxss, /\.right-rail\.with-opening > \.opening-resume-action/);
  assert.match(editorWxss, /\.opening-delete-divider\s*\{[\s\S]*height:\s*1px;[\s\S]*scaleY\(0\.5\)/);
  assert.match(editorWxss, /\.opening-delete-action\s*\{[\s\S]*height:\s*60rpx;[\s\S]*color:\s*#df2c24;/);
  assert.doesNotMatch(editorWxss, /\.opening-secondary-tools|\.opening-secondary-action/);
});

test('Xiao K is the only explanatory callout while closure and measurement-side controls remain', () => {
  assert.match(editorScript, /closeAction:\s*closure && closure\.action/);
  assert.match(editorScript, /measurePosition:\s*measureControl/);
  assert.doesNotMatch(editorScript, /drawCanvasCallout|buildAnchoredCallout|buildClosureHint/);
  assert.doesNotMatch(editorScript, /切换内外墙方向，红线为测量位置/);
  assert.doesNotMatch(editorScript, /closeHint:/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible && closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
});

test('closed-boundary first previews expose the current measurement-position action', () => {
  assert.match(editorScript, /isFirstMeasurePositionStage\(floor, session\)[\s\S]*canSetInitialMeasurementSide\(floor, session\)/);
  assert.match(editorScript, /const startPoint = segment && \(segment\.measurementStartPoint \|\| segment\.startPoint\)/);
  assert.match(editorScript, /const endPoint = segment && \(segment\.measurementEndPoint \|\| segment\.endPoint\)/);
  assert.match(editorScript, /const measurementSide = segment && segment\.measurementSide/);
  assert.match(editorScript, /const currentSide = session\.previewPoint[\s\S]*session\.previewMeasurementSide \|\| session\.measurementSide/);
  assert.match(editorScript, /setMeasurementSide\(this\.draft, nextSide, activeWallId\)/);
});

test('the measurement-position control draws a vector arrow along the wall normal', () => {
  assert.match(editorScript, /arrowAxis: sideNormal/);
  assert.match(editorScript, /const arrowAngle = Math\.atan2\(arrowAxis\.y, arrowAxis\.x\)/);
  assert.match(editorScript, /ctx\.rotate\(arrowAngle\)/);
  assert.doesNotMatch(editorScript, /ctx\.fillText\(measure\.label/);
});

test('native preview rendering uses effective measurement endpoints', () => {
  assert.match(editorScript, /measurementStartInsetMm: session\.previewMeasurementStartInsetMm \|\| 0/);
  assert.match(editorScript, /measurementEndInsetMm: session\.previewMeasurementEndInsetMm \|\| 0/);
  assert.match(editorScript, /const renderStart = geometry && geometry\.start \? geometry\.start : start/);
  assert.match(editorScript, /const renderEnd = geometry && geometry\.end \? geometry\.end : end/);
});

test('bottom-dock guide targets hand off from canvas to the native control layer', () => {
  assert.match(editorScript, /const BOTTOM_DOCK_GUIDE_GEOMETRY_RPX = Object\.freeze\(\{[\s\S]*bottom:\s*64,[\s\S]*height:\s*108,[\s\S]*actionHeight:\s*82/);
  assert.match(editorScript, /cursorCenterOffsetX:\s*0\.5,[\s\S]*cursorWidth:\s*128/);
  assert.match(editorScript, /measureCenterOffsetX:\s*168\.5,[\s\S]*measureWidth:\s*192/);
  assert.match(editorScript, /BOTTOM_DOCK_GUIDE_GEOMETRY_RPX\.bottom \+ BOTTOM_DOCK_GUIDE_GEOMETRY_RPX\.height \/ 2/);
  assert.match(editorScript, /nativeOverlay:\s*true/);
  assert.match(editorScript, /if \(!target\.nativeOverlay\)/);
  assert.match(editorScript, /preferCharacterBelowCard:\s*!!target\.nativeOverlay/);
  assert.match(editorScript, /buildDirectGuideConnector\([\s\S]*target\.y - target\.height \/ 2 - 5 \* designScale/);
  assert.match(editorScript, /const connectorTarget = connector && connector\.target \? connector\.target : target/);
  assert.match(editorWxml, /surveyGuideTarget === 'dock-cursor' \? 'guide-target-control' : ''/);
  assert.match(editorWxml, /surveyGuideTarget === 'measure' \? 'guide-target-control' : ''/);
  assert.equal((editorWxml.match(/class="dock-guide-native-marker"/g) || []).length, 3);
  assert.match(editorWxml, /class="dock-guide-native-pointer"/);
  assert.match(editorWxss, /\.bottom-control-dock \.guide-target-control\s*\{[\s\S]*z-index:\s*26;[\s\S]*overflow:\s*visible;/);
  assert.match(editorWxss, /\.dock-guide-native-marker\s*\{[\s\S]*border:\s*3rpx solid #00b94d;[\s\S]*pointer-events:\s*none;/);
  assert.doesNotMatch(editorWxml, /class="dock-guide-overlay"/);
});

test('cursor placement removes the stale top measurement shell', () => {
  assert.match(editorScript, /const topMetricSuppressed = cursorPlacementState !== 'placed' \|\| this\.canvasCursorLensActive/);
  assert.match(editorScript, /topMetricVisible:\s*!topMetricSuppressed && renderData\.topMetricVisible/);
  assert.match(editorScript, /cursorPlacementState:\s*'dragging',[\s\S]*topMetricVisible:\s*false,[\s\S]*topMetricLength:\s*''/);
  assert.match(editorWxml, /topMetricVisible && topMetricLength && cursorPlacementState === 'placed'/);
  assert.match(editorWxss, /background:\s*rgba\(255, 255, 255, 0\.96\);\s*color:\s*#17345e;/);
  assert.match(editorWxss, /\.top-measure-bubble \.top-measure-angle\s*\{[\s\S]*?border-left-color:\s*rgba\(23, 52, 94, 0\.16\);[\s\S]*?color:\s*#17345e;/);
  assert.match(editorWxss, /\.top-measure-bubble \.top-measure-angle\.actionable\s*\{[\s\S]*?color:\s*#c4550f;/);
});

test('canvas cursor lens survives formal redraws and owns the upper-left measurement lane', () => {
  assert.match(
    editorScript,
    /Canvas-originated wall drags[\s\S]*?if \(!this\.isCursorLensActive\(\)\) \{[\s\S]*?this\.clearCursorDragCanvas\(\{ force: true \}\);/
  );
  assert.match(
    editorScript,
    /topMetricSuppressed = cursorPlacementState !== 'placed' \|\| this\.canvasCursorLensActive/
  );
});

test('surveying topbar back control sits above the title overlay with a 44px-class hit target', () => {
  const topbarMarkup = editorWxml.split('class="survey-topbar')[1].split('<!--  右侧工具栏')[0];
  const titleIdx = topbarMarkup.indexOf('class="title-group"');
  const backIdx = topbarMarkup.indexOf('class="back-button"');
  assert.ok(titleIdx > -1 && backIdx > titleIdx, 'cover-view back control must paint after the centered title overlay');
  assert.match(topbarMarkup, /class="back-button"[^>]*catchtap="onBack"/);
  assert.match(topbarMarkup, /class="topbar-icon topbar-back-icon"[^>]*catchtap="onBack"/);
  assert.match(
    editorWxss,
    /\.back-button\s*\{[^{}]*position:\s*absolute;[^{}]*width:\s*88rpx;[^{}]*height:\s*88rpx;/
  );
});
