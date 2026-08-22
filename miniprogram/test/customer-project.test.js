const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pagePath = path.join(root, 'packages', 'business', 'customer-project', 'customer-project.js');
const wxmlPath = path.join(root, 'packages', 'business', 'customer-project', 'customer-project.wxml');
const lessPath = path.join(root, 'packages', 'business', 'customer-project', 'customer-project.less');

test('customer project consumes only the owner-only aggregate and renders archive sections', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  assert.match(page, /\/miniprogram\/customer-projects\/\$\{encodeURIComponent\(this\.data\.leadId\)\}/);
  assert.match(page, /const formalFloorPlan = project\.formalFloorPlan/);
  assert.match(page, /decoratePublishedSchemes\(\s*project\.publishedSchemes,\s*project\.publishedDesigns/);
  assert.match(page, /project\.featuredScheme/);
  assert.match(page, /scheme\.finalized/);
  assert.match(page, /已定稿/);
  assert.match(page, /formalFloorPlan\.previewEndpoint/);
  assert.match(wxml, /我的服务档案/);
  assert.match(wxml, /专属设计师/);
  assert.match(wxml, /测量师师傅/);
  assert.match(wxml, /designerPhone/);
  assert.match(wxml, /measurerPhone/);
  assert.match(wxml, /catchtap="callStaff"/);
  assert.match(wxml, /户型档案/);
  assert.match(wxml, /交付方案/);
  assert.match(wxml, /查看高清户型图/);
  assert.match(wxml, /featuredDelivery\.publishedLabel/);
  assert.match(wxml, />详情</);
  assert.match(wxml, /bindtap="bookAppointment"/);
  assert.match(wxml, /预约上门量房/);
  assert.match(page, /appointment-booking\/appointment-booking\?leadId=.*mode=customer/);
  assert.doesNotMatch(page, /onShareAppMessage\(\)/);
  assert.match(page, /hideShareMenu/);
  assert.match(page, /showSchemePoster: true/);
  assert.match(page, /contactDesigner\(\)/);
  assert.match(page, /callStaff\(/);
  assert.match(page, /wx\.makePhoneCall/);
  assert.match(page, /label: '量房'/);
  assert.doesNotMatch(page, /label: '免费量房'/);
  assert.match(page, /showContactSheet/);
  assert.match(page, /hasDesignerContact/);
  assert.match(page, /copyDesignerWechatId/);
  assert.match(page, /buildPublishedSchemeLabel/);
  assert.match(wxml, /designer-contact-sheet/);
  assert.match(wxml, /scheme-share-poster/);
  assert.match(wxml, /bindtap="saveOrShareScheme"/);
  assert.doesNotMatch(wxml, /open-type="share"/);
  assert.match(wxml, /canContactDesigner/);
});

test('customer published designs and floor plan preview use protected endpoints as authenticated bytes', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const cacheUtil = fs.readFileSync(path.join(root, 'utils', 'protectedImageCache.js'), 'utf8');
  assert.match(page, /require\('\.\.\/\.\.\/\.\.\/utils\/protectedImageCache'\)/);
  assert.match(page, /load\(\{ silent: true \}\)/);
  assert.match(page, /_archiveReady/);
  assert.match(page, /readCachedProtectedImage/);
  assert.match(page, /floorPlanCacheKey/);
  assert.match(page, /sameFloorPlan/);
  assert.doesNotMatch(page, /floorPlanImagePath: '',\s*\n\s*floorPlanImageState: formalFloorPlan/);
  assert.match(cacheUtil, /responseType: 'arraybuffer'/);
  assert.match(cacheUtil, /wx\.getFileSystemManager\(\)\.writeFile/);
  assert.match(cacheUtil, /FILE_PREFIX = 'protected-img'/);
  assert.doesNotMatch(page, /showActionSheet|itemList: \['详情', '保存到相册'\]/);
  assert.match(page, /previewFeaturedDelivery\(\) \{[\s\S]*this\.openAiSchemes\(delivery\.id\)/);
  assert.match(wxml, /class="delivery-entry"/);
  assert.match(page, /openAiSchemes\(/);
  assert.match(page, /customer-ai-schemes\/customer-ai-schemes/);
  assert.match(wxml, /data-scheme-index/);
  assert.match(wxml, /bindtap="previewFloorPlan"/);
});

test('customer project keeps the packaged Phase 6 folio PNG and uses main-package Xiao K', () => {
  const assetRoot = path.join(root, 'packages', 'business', 'assets', 'customer-project-v1');
  const folio = fs.readFileSync(path.join(assetRoot, 'published-design-folio.png'));
  assert.equal(folio.subarray(1, 4).toString(), 'PNG');
  assert.ok(folio.length <= 300 * 1024, 'published-design-folio.png exceeds the generated-artwork budget');

  const airyMascot = fs.readFileSync(path.join(root, 'images', 'airy-v1', 'project-delivery-xiao-k.png'));
  assert.equal(airyMascot.subarray(1, 4).toString(), 'PNG');
  assert.equal(fs.existsSync(path.join(assetRoot, 'project-delivery-xiao-k.png')), false);
  assert.equal(fs.existsSync(path.join(assetRoot, 'formal-floor-plan-archive.png')), true);
});

test('customer-facing project surfaces hide enterprise branding', () => {
  const redirectShell = fs.readFileSync(path.join(root, 'packages', 'business', 'customer-projects', 'customer-projects.wxml'), 'utf8');
  const folio = fs.readFileSync(wxmlPath, 'utf8');
  const companion = fs.readFileSync(path.join(root, 'components', 'customer-service-home', 'customer-service-home.wxml'), 'utf8');
  const companionJs = fs.readFileSync(path.join(root, 'components', 'customer-service-home', 'customer-service-home.js'), 'utf8');
  assert.doesNotMatch(redirectShell, /project-list|project-card|enterprise\.name|item\.enterprise/);
  assert.match(folio, /免费量房与设计方案全纪录/);
  assert.doesNotMatch(folio, /enterpriseName|\{\{enterpriseName\}\}/);
  assert.match(companion, /家客来 · 服务向导|我的装修服务/);
  assert.doesNotMatch(companion, /enterprise\.name|enterpriseName/);
  assert.doesNotMatch(companionJs, /project\.enterprise\s*&&\s*project\.enterprise\.name|enterpriseName/);
});

test('customer project custom back leaves the archive when it is the stack root', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  assert.match(wxml, /bindtap="onBack"/);
  assert.match(page, /getCurrentPages\(\)\.length > 1/);
  assert.match(page, /wx\.navigateBack\(\{\s*fail:\s*\(\)\s*=>\s*wx\.switchTab\(\{\s*url:\s*'\/pages\/index\/index'\s*\}\)/);
  assert.match(page, /wx\.switchTab\(\{\s*url:\s*'\/pages\/index\/index'\s*\}\)/);
});

test('customer project template and stylesheet stay aligned for the restored archive layout', () => {
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const less = fs.readFileSync(lessPath, 'utf8');
  for (const className of ['project-hero-card', 'timeline-row', 'personnel-grid', 'person-card', 'section-card', 'floor-preview-container', 'delivery-image-frame', 'footer-bar']) {
    assert.match(wxml, new RegExp(`class="[^\"]*${className}`));
    assert.match(less, new RegExp(`\\.${className}(?:[\\s,{])`));
  }
  assert.match(wxml, /\/images\/airy-v1\/project-delivery-xiao-k\.png/);
  assert.doesNotMatch(wxml, /xiao-k-mascot-3d\.png/);
  assert.doesNotMatch(wxml, /packages\/business\/assets\/customer-project-v1\/project-delivery-xiao-k\.png/);
  assert.doesNotMatch(wxml, /formal-floor-plan-archive\.png/);
  assert.match(wxml, /floorPlanImageState === 'loading'/);
  assert.match(less, /\.booking-action,\s*\n?\.booking-secondary \{[\s\S]*?border-radius: 999rpx;[\s\S]*?\}/);
  assert.match(less, /\.booking-action,\s*\n?\.booking-secondary \{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?\}/);
  assert.match(less, /\.booking-actions \{[\s\S]*?flex-direction: row;[\s\S]*?gap: 16rpx;/);
  assert.match(less, /\.booking-action,\s*\n?\.booking-secondary \{[\s\S]*?flex: 1;[\s\S]*?width: auto;/);
  assert.match(less, /\.booking-actions > \.booking-action \+ \.booking-secondary[\s\S]*?margin-left: 16rpx;/);
  assert.match(less, /\.footer-outline, \.footer-primary \{[^}]*display: flex;[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(less, /\.section-badge \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;/);
  assert.match(less, /\.person-phone \{[\s\S]*?font-size: 24rpx;/);
  assert.match(wxml, /person-phone sfp-icon-action[\s\S]*\/images\/leads-v4\/phone\.png/);
  assert.match(wxml, /booking-secondary sfp-icon-action[\s\S]*\/packages\/business\/assets\/promotion-detail\/calendar\.png[\s\S]*查看预约/);
  assert.match(wxml, /bindtap="reschedule"[\s\S]*calendar\.png[\s\S]*改期/);
});
