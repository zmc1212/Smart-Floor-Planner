const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorDir = path.join(miniRoot, 'packages', 'surveying', 'editor');
const editorScript = fs.readFileSync(path.join(editorDir, 'surveying-editor.js'), 'utf8');
const editorWxml = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxml'), 'utf8');

function extractMethod(source, methodName) {
  const start = source.indexOf(`${methodName}() {`);
  assert.ok(start >= 0, `missing ${methodName}`);
  const next = source.indexOf('\n  async ', start + 1);
  const end = next >= 0 ? next : source.length;
  return source.slice(start, end);
}

test('top-bar Save persists a draft then navigates back on cloud success', () => {
  assert.match(editorWxml, /class="topbar-chip save-draft" bindtap="onSaveDraft"/);

  const method = extractMethod(editorScript, 'async onSaveDraft');
  assert.match(method, /await this\.saveFormalFloorPlan\('draft'\)/);
  assert.match(method, /wx\.showToast\(\{ title: '已保存草稿', icon: 'success' \}\)/);
  assert.match(
    method,
    /setTimeout\(\(\) => \{\s*wx\.navigateBack\(\{\s*fail: \(\) => \{\s*wx\.switchTab\(\{ url: '\/pages\/index\/index' \}\)/
  );

  const cloudCatchMarker = "console.error('Save surveying draft to cloud failed:'";
  const cloudCatchStart = method.indexOf(cloudCatchMarker);
  assert.ok(cloudCatchStart >= 0, 'missing cloud-save catch');
  const cloudCatchBlock = method.slice(cloudCatchStart);
  assert.match(cloudCatchBlock, /formalNotice: '本地草稿已保存，服务端保存失败'/);
  assert.match(cloudCatchBlock, /wx\.showToast\(\{ title: '服务端保存失败', icon: 'none' \}\)/);
  assert.doesNotMatch(cloudCatchBlock, /wx\.navigateBack/);
});
