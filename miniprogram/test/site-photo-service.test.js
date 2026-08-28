const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('site photo capture requires a room tag and exposes living-room/bathroom quick chips', () => {
  const service = read('utils/sitePhotoService.js');
  const grid = read('components/site-photo-grid/site-photo-grid.js');
  const template = read('components/site-photo-grid/site-photo-grid.wxml');

  assert.match(service, /key: 'living_room', label: '客厅', quick: true/);
  assert.match(service, /key: 'master_bedroom', label: '主卧', quick: true/);
  assert.match(service, /key: 'secondary_bedroom', label: '次卧', quick: true/);
  assert.match(service, /key: 'master_bathroom', label: '主卫', quick: true/);
  assert.match(service, /key: 'secondary_bathroom', label: '次卫', quick: true/);
  assert.match(service, /if \(!spaceTag\) return Promise\.reject\(\{ error: '请选择房间标签' \}\)/);
  assert.match(service, /\/miniprogram\/leads\/\$\{encodeURIComponent\(leadId\)\}\/site-photos/);
  assert.match(service, /formData: \{ source, spaceTag \}/);
  assert.match(service, /itemList: \['拍照', '从微信相册选择', '从本户现场图选择'\]/);
  assert.doesNotMatch(service, /manual_upload/);

  assert.match(template, /这张是哪个空间？/);
  assert.match(template, /选好后再拍照或从相册上传/);
  assert.match(template, /<root-portal wx:if="\{\{tagMounted\}\}"/);
  assert.match(grid, /pendingSource/);
  assert.match(grid, /captureAndUpload\(this\.properties\.leadId, \{ source, spaceTag \}\)/);
  assert.match(grid, /openTagSheet\(\)/);
  assert.match(grid, /emitSheetChange\(true\)/);
  assert.match(grid, /triggerEvent\('sheetchange'/);

  const styles = read('components/site-photo-grid/site-photo-grid.less');
  assert.match(styles, /\.spg-sheet-root\s*\{[^}]*z-index:\s*2000;/s);
});

test('AI confirm and scheme studio reuse gallery asset ids instead of a second upload', () => {
  const confirm = read('packages/ai-workflow/recipe-confirm/recipe-confirm.js');
  const studio = read('packages/ai-workflow/scheme-studio/scheme-studio.js');
  assert.match(confirm, /chooseAiSource/);
  assert.match(confirm, /spaceAssetId: photo\.assetId/);
  assert.doesNotMatch(confirm, /wx\.chooseMedia/);
  assert.match(studio, /chooseAiSource/);
  assert.match(studio, /id: assetId/);
  assert.match(studio, /uploadStudioAsset\(filePath\)/);
  assert.doesNotMatch(studio, /wx\.chooseMedia/);
});
