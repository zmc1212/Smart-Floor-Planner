const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'packages', 'business', 'customer-project', 'customer-project.js');
const wxmlPath = path.join(root, 'packages', 'business', 'customer-project', 'customer-project.wxml');

test('customer project consumes only the owner-only aggregate and renders appointment, formal-plan summary, and explicit publications', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  assert.match(page, /\/miniprogram\/customer-projects\/\$\{encodeURIComponent\(this\.data\.leadId\)\}/);
  assert.match(page, /const formalFloorPlan = project\.formalFloorPlan/);
  assert.match(page, /decoratePublishedDesigns\(project\.publishedDesigns\)/);
  assert.match(wxml, /designer && designer\.displayName/);
  assert.match(wxml, /appointment && appointment\.measurerName/);
  assert.match(wxml, /正式量房形成的户型档案/);
  assert.match(wxml, /仅展示设计师主动发布的方案/);
});

test('customer published designs use the protected endpoint as authenticated bytes, then preview only app-local images', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(page, /responseType: 'arraybuffer'/);
  assert.match(page, /wx\.getFileSystemManager\(\)\.writeFile/);
  assert.match(page, /customer-project-design-\$\{safeKey/);
  assert.match(page, /contentType\.includes\('png'\)/);
  assert.match(page, /contentType\.includes\('jpeg'\)/);
  assert.match(page, /wx\.previewImage\(\{ current: design\.imagePath, urls \}\)/);
});

test('customer project ships only the three reviewed PNG assets extracted from the Phase 6 asset board', () => {
  const assetRoot = path.join(root, 'packages', 'business', 'assets', 'customer-project-v1');
  const files = ['project-delivery-xiao-k.png', 'formal-floor-plan-archive.png', 'published-design-folio.png'];
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(assetRoot, file));
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
    assert.ok(buffer.length <= 300 * 1024, `${file} exceeds the generated-artwork budget`);
  }
});
