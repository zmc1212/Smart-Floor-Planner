const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorScript = fs.readFileSync(
  path.join(miniRoot, 'packages', 'surveying', 'editor', 'surveying-editor.js'),
  'utf8'
);
const editorWxml = fs.readFileSync(
  path.join(miniRoot, 'packages', 'surveying', 'editor', 'surveying-editor.wxml'),
  'utf8'
);
const editorWxss = fs.readFileSync(
  path.join(miniRoot, 'packages', 'surveying', 'editor', 'surveying-editor.less'),
  'utf8'
);

function componentEditorMarkup() {
  return editorWxml.split('<!--  门窗构件编辑器（全屏覆盖）')[1]
    .split('<!--  数字键盘弹层')[0];
}

test('opening editor v1 exposes dimension-only fields for doors and windows', () => {
  for (const label of ['门宽', '门高', '墙厚', '距左', '距右', '窗宽', '窗高', '窗台高']) {
    assert.match(editorScript, new RegExp(`label: '${label}'`));
  }

  const markup = componentEditorMarkup();
  assert.match(markup, /wx:for="\{\{componentSpecOptions\}\}"/);
  assert.match(markup, /class="component-spec-tab-value">\{\{item\.value\}\}/);
  assert.doesNotMatch(markup, /component-panel-tabs|component-flip|component-library|设为入户门/);
  assert.doesNotMatch(markup, />翻转<|>模型</);
});

test('opening editor uses the persistent dock as its only ranging action', () => {
  const markup = componentEditorMarkup();
  assert.doesNotMatch(markup, /component-spec-measure|triggerComponentSpecBluetoothMeasure/);
  assert.match(markup, /已选中\{\{componentSpecLabel\}\}，可手输或使用底部测距/);
  assert.match(editorWxml, /class="dock-measure[^"]*" bindtap="onBottomMeasure"/);
  assert.match(
    editorScript,
    /onBottomMeasure\(\)\s*\{\s*if \(this\.data\.componentEditorVisible\) \{\s*this\.triggerComponentSpecBluetoothMeasure\(\);\s*return;/
  );
});

test('wall-thickness synchronization is disclosed only for the active thickness field', () => {
  const markup = componentEditorMarkup();
  assert.match(markup, /wx:if="\{\{componentSpecMode === 'depth'\}\}" class="component-sync-row"/);
  assert.match(markup, /aria-role="checkbox" aria-checked="\{\{componentSyncWallThickness\}\}"/);
});

test('opening editor keeps readable touch targets and removes the obsolete lock control', () => {
  const markup = componentEditorMarkup();
  assert.doesNotMatch(markup, /component-lock/);
  assert.match(markup, /<cover-view class="component-topbar"/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible\}\}" class="survey-topbar/);
  assert.match(editorWxml, /wx:if="\{\{!componentEditorVisible\}\}" class="right-rail/);
  assert.match(editorScript, /title: selectedOpening \? `编辑\$\{typeLabel\}` : '编辑门窗'/);
  assert.match(editorWxss, /\.keyboard-key\s*\{[^}]*height:\s*84rpx;/s);
  assert.match(editorWxss, /\.component-panel\s*\{[^}]*height:\s*calc\(736rpx \+ env\(safe-area-inset-bottom\)\);/s);
});
