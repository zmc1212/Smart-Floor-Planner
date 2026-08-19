const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.resolve(__dirname, '..');
const editorDir = path.join(miniRoot, 'packages', 'surveying', 'editor');
const editorScript = fs.readFileSync(path.join(editorDir, 'surveying-editor.js'), 'utf8');
const editorWxml = fs.readFileSync(path.join(editorDir, 'surveying-editor.wxml'), 'utf8');
const editorLess = fs.readFileSync(path.join(editorDir, 'surveying-editor.less'), 'utf8');
const apiScript = fs.readFileSync(path.join(miniRoot, 'utils', 'api.js'), 'utf8');

test('CAD control follows the completed cloud-plan state and uses the protected download endpoint', () => {
  assert.match(editorWxml, /class="topbar-chip cad-export \{\{floorPlanStatus === 'completed' \? '' : 'disabled'\}\}"/);
  assert.match(editorWxml, /bindtap="onExportCad"/);
  assert.match(editorLess, /\.topbar-chip\.cad-export\.disabled\s*\{[\s\S]*opacity:\s*0\.52/);
  assert.match(editorScript, /floorPlanStatus:\s*res\.data\.status \|\| 'draft'/);
  assert.match(editorScript, /floorPlanStatus:\s*'completed'/);
  assert.match(editorScript, /async onExportCad\(\) \{[\s\S]*this\.data\.floorPlanStatus !== 'completed'/);
  assert.match(editorScript, /api\.downloadFile\(`\/miniprogram\/floorplans\/\$\{floorPlanId\}\/export\/dxf`\)/);
});

test('CAD download persists locally and guides devices without a DXF handler', () => {
  assert.match(apiScript, /function downloadFile\(url, options = \{\}\)/);
  assert.match(apiScript, /Authorization: token \? `Bearer \$\{token\}` : ''/);
  assert.match(editorScript, /wx\.getFileSystemManager\(\)/);
  assert.match(editorScript, /fileManager\.saveFile\(/);
  assert.match(editorScript, /wx\.openDocument\([\s\S]*fileType: 'dxf'/);
  assert.match(editorScript, /当前设备无法直接打开 DXF，请将文件转发到 CAD 设备或在电脑端打开。/);
});
