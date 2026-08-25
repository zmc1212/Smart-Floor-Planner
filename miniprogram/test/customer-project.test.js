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
  assert.match(wxml, />测量师</);
  assert.match(wxml, /金牌设计师/);
  assert.match(wxml, /7年设计经验/);
  assert.match(wxml, /资深测量师/);
  assert.match(wxml, /7年量房经验/);
  assert.match(wxml, /已免费服务客户100\+/);
  assert.match(wxml, /designerPhone/);
  assert.match(wxml, /measurerPhone/);
  assert.match(wxml, /catchtap="callStaff"/);
  assert.match(wxml, /户型档案/);
  assert.match(wxml, /房屋现场图/);
  assert.match(wxml, /site-photo-grid/);
  assert.match(page, /sitePhotoService/);
  assert.match(page, /loadSitePhotos/);
  assert.match(wxml, /交付方案/);
  assert.match(wxml, /查看高清户型图/);
  assert.match(wxml, /featuredDelivery\.publishedLabel/);
  assert.match(wxml, /bindtap="bookAppointment"/);
  assert.match(wxml, /预约量房/);
  assert.match(page, /已匹配测量员/);
  assert.doesNotMatch(wxml, /预约上门量房|上门量房预约|重新预约上门/);
  assert.doesNotMatch(page, /待上门量房|请选择上门量房时间/);
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
  assert.match(page, /item\.imageUrl && \/\^https\?:/);
  assert.match(page, /imagePath: item\.imageUrl/);
  assert.match(page, /imageState: 'loaded'/);
  assert.doesNotMatch(page, /floorPlanImagePath: '',\s*\n\s*floorPlanImageState: formalFloorPlan/);
  assert.match(cacheUtil, /responseType: 'arraybuffer'/);
  assert.match(cacheUtil, /wx\.getFileSystemManager\(\)\.writeFile/);
  assert.match(cacheUtil, /FILE_PREFIX = 'protected-img'/);
  assert.doesNotMatch(page, /showActionSheet|itemList: \['详情', '保存到相册'\]/);
  assert.match(page, /previewFeaturedDelivery\(\) \{[\s\S]*this\.openAiSchemes\(delivery\.id\)/);
  assert.match(wxml, /data-kind="delivery"/);
  assert.match(wxml, /bindtap="handleDossierRow"/);
  assert.match(page, /openAiSchemes\(/);
  assert.match(page, /customer-ai-schemes\/customer-ai-schemes/);
  assert.match(wxml, /data-kind="floor"/);
  assert.match(page, /handleDossierRow\(event\)/);
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

test('customer project V4 packages one coherent licensed icon family', () => {
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const assetRoot = path.join(root, 'packages', 'business', 'assets', 'customer-project-v4');
  const iconFiles = [
    'calendar-check.png',
    'designer-user.png',
    'measurer-ruler.png',
    'dossier-file.png',
    'dossier-image.png',
    'dossier-delivery.png',
    'phone.png',
    'message-circle-more.png',
  ];

  for (const fileName of iconFiles) {
    const icon = fs.readFileSync(path.join(assetRoot, fileName));
    assert.equal(icon.subarray(1, 4).toString(), 'PNG', `${fileName} must be PNG`);
    assert.ok(icon.length <= 300 * 1024, `${fileName} exceeds the generated-artwork budget`);
    assert.ok(wxml.includes(`/packages/business/assets/customer-project-v4/${fileName}`), `${fileName} is not mapped in WXML`);
  }

  assert.doesNotMatch(wxml, /images\/ai-design-icons\/(?:floor-plan|reference|palette)\.png/);
  assert.doesNotMatch(wxml, /images\/leads-v4\/(?:phone|ruler-green)\.png/);
  assert.doesNotMatch(wxml, /promotion-detail\/designer\.png/);
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
  for (const className of ['project-hero-card', 'timeline-row', 'booking-panel', 'personnel-grid', 'person-card', 'dossier-book', 'dossier-row', 'footer-bar']) {
    assert.match(wxml, new RegExp(`class="[^\"]*${className}`));
    assert.match(less, new RegExp(`\\.${className}(?:[\\s,{])`));
  }
  assert.match(wxml, /\/images\/airy-v1\/project-delivery-xiao-k\.png/);
  assert.doesNotMatch(wxml, /xiao-k-mascot-3d\.png/);
  assert.doesNotMatch(wxml, /packages\/business\/assets\/customer-project-v1\/project-delivery-xiao-k\.png/);
  assert.doesNotMatch(wxml, /formal-floor-plan-archive\.png/);
  assert.match(wxml, /sitePhotoManagerOpen/);
  assert.match(less, /\.booking-action,\s*\n?\.booking-secondary \{[\s\S]*?border-radius: 999rpx;[\s\S]*?\}/);
  assert.match(less, /\.booking-action,\s*\n?\.booking-secondary \{[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?\}/);
  assert.match(less, /\.booking-actions \{[\s\S]*?flex-direction: row;[\s\S]*?gap: 16rpx;/);
  assert.match(less, /\.booking-action,\s*\n?\.booking-secondary \{[\s\S]*?width: auto;[\s\S]*?flex: 1;/);
  assert.match(less, /\.booking-actions > \.booking-action \+ \.booking-secondary[\s\S]*?margin-left: 16rpx;/);
  assert.match(less, /\.footer-outline,\s*\.footer-primary \{[^}]*display: flex;[^}]*align-items: center;[^}]*justify-content: center;/);
  assert.match(less, /\.booking-badge \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;/);
  assert.match(less, /\.person-professional-proof \{[\s\S]*?font-size: 24rpx;/);
  assert.match(wxml, /person-phone-button[\s\S]*\/packages\/business\/assets\/customer-project-v4\/phone\.png/);
  assert.match(wxml, /footer-contact-icon[\s\S]*\/packages\/business\/assets\/customer-project-v4\/message-circle-more\.png/);
  assert.match(wxml, /booking-secondary sfp-icon-action[\s\S]*\/packages\/business\/assets\/promotion-detail\/calendar\.png[\s\S]*查看预约/);
  assert.match(wxml, /bindtap="reschedule"[\s\S]*calendar\.png[\s\S]*改期/);
});

test('V4 archive keeps one compact dossier book with differentiated status colors', () => {
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  const less = fs.readFileSync(lessPath, 'utf8');
  assert.equal((wxml.match(/class="dossier-book"/g) || []).length, 1);
  assert.equal((wxml.match(/class="dossier-row"/g) || []).length, 3);
  assert.match(wxml, /完成正式量房后自动归档/);
  assert.match(wxml, /量房前后都可补充/);
  assert.match(wxml, /设计师发布后可查看与分享/);
  assert.match(less, /\.dossier-status\.is-site \{[\s\S]*#fff2d9/);
  assert.match(less, /\.dossier-status\.is-delivery \{[\s\S]*#e7f3f6/);
  assert.match(less, /\.dossier-divider \{[\s\S]*transform: scaleY\(\.5\)/);
  assert.match(less, /\.dossier-row \{[\s\S]*min-height: 110rpx;[\s\S]*padding: 16rpx 20rpx 16rpx 72rpx;/);
  assert.match(less, /\.hero-title \{[\s\S]*font-size: 44rpx/);
  assert.match(less, /\.booking-title \{[\s\S]*font-size: 34rpx/);
  assert.match(less, /\.group-title \{[\s\S]*font-size: 32rpx/);
});
