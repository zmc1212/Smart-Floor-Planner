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
  assert.match(page, /decoratePublishedSchemes\(project\.publishedSchemes, project\.publishedDesigns\)/);
  assert.match(wxml, /designer && designer\.displayName/);
  assert.match(wxml, /measurerName \|\| '待分配'/);
  assert.match(wxml, /预约量房/);
  assert.match(page, /appointment-booking\/appointment-booking\?leadId=.*mode=customer/);
  assert.match(page, /onShareAppMessage\(\)/);
  assert.match(page, /appointment-detail\/appointment-detail\?mode=customer&leadId=/);
  assert.match(wxml, /正式量房形成的户型档案/);
  assert.match(wxml, /仅展示设计师主动发布的方案/);
  assert.match(wxml, /publishedSchemes/);
  assert.match(wxml, /scheme\.title/);
});

test('customer published designs use the protected endpoint as authenticated bytes, then preview only app-local images', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  assert.match(page, /responseType: 'arraybuffer'/);
  assert.match(page, /wx\.getFileSystemManager\(\)\.writeFile/);
  assert.match(page, /customer-project-design-\$\{safeKey/);
  assert.match(page, /contentType\.includes\('png'\)/);
  assert.match(page, /contentType\.includes\('jpeg'\)/);
  assert.match(page, /wx\.previewImage\(\{ current: design\.imagePath, urls \}\)/);
  assert.match(wxml, /data-scheme-index/);
});

test('customer project keeps the three reviewed PNG source assets extracted from the Phase 6 asset board', () => {
  const assetRoot = path.join(root, 'packages', 'business', 'assets', 'customer-project-v1');
  const files = ['project-delivery-xiao-k.png', 'formal-floor-plan-archive.png', 'published-design-folio.png'];
  for (const file of files) {
    const buffer = fs.readFileSync(path.join(assetRoot, file));
    assert.equal(buffer.subarray(1, 4).toString(), 'PNG');
    assert.ok(buffer.length <= 300 * 1024, `${file} exceeds the generated-artwork budget`);
  }
});

test('customer-facing project surfaces hide enterprise branding', () => {
  const index = fs.readFileSync(path.join(root, 'packages', 'business', 'customer-projects', 'customer-projects.wxml'), 'utf8');
  const folio = fs.readFileSync(wxmlPath, 'utf8');
  const workbench = fs.readFileSync(path.join(root, 'components', 'role-workbench', 'role-workbench.js'), 'utf8');
  assert.match(index, /免费设计与量房/);
  assert.doesNotMatch(index, /item\.enterprise\.name/);
  assert.match(folio, /免费设计与量房服务/);
  assert.doesNotMatch(folio, /enterpriseName|\{\{enterpriseName\}\}/);
  assert.match(workbench, /title: '我的装修服务'/);
  assert.doesNotMatch(workbench, /project\.enterprise\s*&&\s*project\.enterprise\.name/);
});
