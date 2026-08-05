const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorDir = path.join(miniRoot, 'pages', 'surveying-editor');
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
  assert.doesNotMatch(editorScript, /SURVEYING_ONBOARDING_STEPS|onOnboardingNext|onOnboardingSkip/);
  assert.doesNotMatch(editorWxml, /onboardingProgress|onboarding-next|survey-onboarding/);
  assert.doesNotMatch(editorWxml, /class="survey-guide-layer/);
  assert.doesNotMatch(editorWxml, /surveyGuideFocusVisible|survey-guide-focus/);
  assert.match(editorWxml, /wx:for="\{\{surveyGuideBodyLines\}\}"/);
  assert.match(editorScript, /onGuideDismiss\(\)/);
  assert.match(editorWxml, /catchtap="onGuideDismiss"/);
  assert.match(editorWxss, /\.survey-guide-overlay\s*\{[\s\S]*pointer-events:\s*none;/);
  assert.match(editorWxss, /\.survey-guide-body\s*\{[\s\S]*font-size:\s*24rpx;/);
});

test('contextual guide uses three transparent Xiao K pointing poses', () => {
  ['left', 'right', 'down'].forEach((pose) => {
    const asset = fs.readFileSync(path.join(miniRoot, 'images', `surveying-guide-k-${pose}.png`));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.ok(asset.length > 1024);
    assert.match(editorScript, new RegExp(`/images/surveying-guide-k-${pose}\\.png`));
  });
  assert.match(editorWxml, /surveyGuideCharacterSrc/);
  assert.match(editorWxml, /survey-guide-path/);
  assert.match(editorWxml, /survey-guide-target-halo/);
  assert.doesNotMatch(editorWxml, /\/images\/surveying-onboarding-k\.png/);
});

test('turning off guide copy preserves closure and measurement-side controls', () => {
  assert.match(editorScript, /closeAction:\s*closure && closure\.action/);
  assert.match(editorScript, /if \(measureControl && !showGuide\) \{[\s\S]*measureControl\.tip = null;[\s\S]*measureControl\.pointer = null;/);
  assert.match(editorScript, /closeHint:\s*showGuide && closure && closure\.hint/);
  assert.match(editorWxml, /wx:if="\{\{closeActionVisible\}\}"[\s\S]*catchtap="onConfirmClose"/);
});
