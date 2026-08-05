const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorDir = path.join(miniRoot, 'packages', 'surveying', 'editor');
const editorScript = fs.readFileSync(path.join(editorDir, 'surveying-editor.js'), 'utf8');
const editorWxml = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxml'), 'utf8');
const editorWxss = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxss'), 'utf8');
const navigationScript = fs.readFileSync(path.join(miniRoot, 'utils', 'surveyNavigation.js'), 'utf8');
const planRoute = fs.readFileSync(
  path.join(miniRoot, '..', 'admin', 'src', 'app', 'api', 'floorplans', '[id]', 'route.ts'),
  'utf8'
);

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
  assert.match(editorWxml, /wx:if="\{\{surveyGuideVisible\}\}"/);
  assert.match(editorWxml, /<block wx:if="\{\{surveyGuideVisible\}\}">/);
  assert.doesNotMatch(editorWxml, /<cover-view[\s\S]*class="survey-guide-overlay"/);
  assert.match(editorWxml, /<block wx:if="\{\{cursorPlacementState === 'dragging' && !numberPadVisible\}\}">/);
  assert.doesNotMatch(editorWxml, /<cover-view[\s\S]*class="cursor-drag-lens-layer"/);
  assert.match(editorWxml, /id="cursor-drag-control"/);
  assert.match(editorScript, /query\.select\('#cursor-drag-control'\)/);
  assert.doesNotMatch(editorScript, /query\.select\('\.cursor-fab-drop'\)/);
  assert.match(editorScript, /hasUsablePagePoint = pageX !== null && pageY !== null/);
  assert.match(editorScript, /const movedWithoutTouchMove = !wasDragging && dragWasPending/);
  assert.doesNotMatch(editorScript, /SURVEYING_ONBOARDING_STEPS|onOnboardingNext|onOnboardingSkip/);
  assert.doesNotMatch(editorWxml, /onboardingProgress|onboarding-next|survey-onboarding/);
  assert.doesNotMatch(editorWxml, /class="survey-guide-layer/);
  assert.doesNotMatch(editorWxml, /surveyGuideFocusVisible|survey-guide-focus/);
  assert.match(editorWxml, /wx:for="\{\{surveyGuideBodyLines\}\}"/);
  assert.match(editorScript, /onGuideDismiss\(\)/);
  assert.match(editorWxml, /catchtap="onGuideDismiss"/);
  assert.doesNotMatch(editorWxss, /\.survey-guide-overlay\s*\{/);
  assert.doesNotMatch(editorWxss, /\.cursor-drag-lens-layer\s*\{/);
  assert.match(editorWxss, /\.survey-guide-body\s*\{[\s\S]*font-size:\s*24rpx;/);
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
  assert.match(editorWxml, /surveyGuideCharacterSrc/);
  assert.match(editorWxml, /survey-guide-path/);
  assert.match(editorWxml, /survey-guide-target-halo/);
  assert.match(editorWxml, /survey-guide-kicker-icon/);
  assert.match(editorWxml, /guide-help\.png/);
  assert.match(editorWxml, /tail-\{\{surveyGuidePointerDirection\}\}/);
  assert.doesNotMatch(editorWxml, /\/packages\/surveying\/assets\/surveying-onboarding-k\.png/);
});

test('surveying toolbar uses the approved rail cuts and stateful BLE icons', () => {
  const iconPaths = [
    'icons/guide-help.png',
    'icons/save-draft.png',
    'icons/ble-green.png',
    'icons/ble-muted.png',
    'icons/editor-rail/straight.png',
    'icons/editor-rail/straight-active.png',
    'icons/editor-rail/diagonal.png',
    'icons/editor-rail/diagonal-active.png',
    'icons/editor-rail/thickness.png',
    'icons/editor-rail/input.png'
  ];
  iconPaths.forEach((relativePath) => {
    const asset = fs.readFileSync(path.join(miniRoot, 'packages', 'surveying', 'assets', relativePath));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(asset.readUInt32BE(16), 48);
    assert.equal(asset.readUInt32BE(20), 48);
    assert.ok([3, 6].includes(asset[25]));
  });
  assert.match(editorScript, /icon: activeTool === 'straight' \? 'straight-active' : 'straight'/);
  assert.match(editorScript, /icon: activeTool === 'diagonal' \? 'diagonal-active' : 'diagonal'/);
  assert.match(editorWxml, /guide-help\.png/);
  assert.match(editorWxml, /save-draft\.png/);
  assert.match(editorWxml, /ble-\{\{bleConnected \? 'green' : 'muted'\}\}\.png/);
  assert.doesNotMatch(editorScript, /icon: 'align'|icon: 'annotation'|icon: 'layers'|icon: 'display'/);
});

test('turning off guide copy preserves closure and measurement-side controls', () => {
  assert.match(editorScript, /closeAction:\s*closure && closure\.action/);
  assert.match(editorScript, /if \(measureControl && !showGuide\) \{[\s\S]*measureControl\.tip = null;[\s\S]*measureControl\.pointer = null;/);
  assert.match(editorScript, /closeHint:\s*showGuide && closure && closure\.hint/);
  assert.match(editorWxml, /wx:if="\{\{closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
});
