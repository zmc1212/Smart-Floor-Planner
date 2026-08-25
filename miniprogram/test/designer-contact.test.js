const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const utilPath = path.join(root, 'utils', 'designerContact.js');
const sheetRoot = path.join(root, 'components', 'designer-contact-sheet');

test('designerContact helpers prioritize QR contact and document copy fallback', () => {
  const source = fs.readFileSync(utilPath, 'utf8');
  assert.match(source, /function hasDesignerContact/);
  assert.match(source, /function customerProjectFromApiResponse/);
  assert.match(source, /function designerShortcutDescription/);
  assert.match(source, /扫码添加微信好友/);
  assert.match(source, /微信号可复制联系/);
  assert.match(source, /function loadDesignerQrToTempFile/);
  assert.match(source, /function copyDesignerWechatId/);
  assert.match(source, /withSearchHint/);
  assert.match(source, /请打开微信，通过搜索添加设计师为好友/);
});

test('designer-contact-sheet restores the approved Xiao K QR-first contact design', () => {
  const js = fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.less'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.json'), 'utf8'));
  const xiaoKPath = path.join(root, 'images', 'designer-contact', 'xiao-k-peeking.png');
  const closeIconPath = path.join(root, 'images', 'designer-contact', 'close.png');
  const professionalIconPaths = [
    'professional-badge.png',
    'professional-experience.png',
    'professional-service.png',
  ].map((fileName) => path.join(root, 'images', 'designer-contact', fileName));

  assert.equal(json.component, true);
  assert.match(js, /loadDesignerQrToTempFile/);
  assert.match(js, /copyDesignerWechatId/);
  assert.match(js, /wx\.previewImage/);
  assert.match(js, /openSheet/);
  assert.match(js, /sheetMotion/);
  assert.match(wxml, /长按二维码，加设计师微信/);
  assert.match(wxml, /按住二维码 2 秒/);
  assert.match(wxml, /你的专属设计师/);
  assert.match(wxml, /wx:if="\{\{!professionalTitleVisible\}\}"[\s\S]*\{\{displayName\}\}/);
  assert.match(wxml, /\{\{professionalTitle\}\} · \{\{displayName\}\}/);
  assert.doesNotMatch(wxml, /属于您的顾问/);
  assert.match(js, /professionalTitleVisible/);
  assert.match(js, /professionalExperienceLabel/);
  assert.match(js, /professionalServiceLabel/);
  assert.match(wxml, /dcs-professional-proof/);
  assert.match(wxml, /professionalExperienceLabel/);
  assert.match(wxml, /professionalServiceLabel/);
  assert.match(wxml, /professional-badge\.png/);
  assert.match(wxml, /professional-experience\.png/);
  assert.match(wxml, /professional-service\.png/);
  assert.doesNotMatch(wxml, /dcs-professional-dot/);
  assert.match(wxml, /xiao-k-peeking\.png/);
  assert.match(wxml, /dcs-hero/);
  assert.match(wxml, /dcs-hold-pill/);
  assert.match(wxml, /show-menu-by-longpress/);
  assert.match(wxml, /微信号　\{\{wechatId\}\}/);
  assert.match(wxml, />复制</);
  assert.match(wxml, /bindtap="onPreviewQr"/);
  assert.match(wxml, /dcs-dialog \{\{dialogOpen \? 'open' : ''\}\}/);
  assert.match(less, /\.dcs-dialog/);
  assert.match(less, /\.dcs-xiao-k/);
  assert.match(less, /position:\s*absolute/);
  assert.match(less, /\.dcs-spatial-mark/);
  assert.match(less, /align-items:\s*center/);
  assert.match(less, /justify-content:\s*center/);
  assert.doesNotMatch(less, /align-items:\s*flex-end/);
  assert.doesNotMatch(less, /translateY\(100%\)/);
  assert.match(less, /\.dcs-qr/);
  assert.match(less, /\.dcs-professional-proof/);
  assert.match(less, /\.dcs-professional-badge/);
  assert.ok(fs.statSync(xiaoKPath).size <= 300 * 1024);
  assert.deepEqual([...fs.readFileSync(xiaoKPath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.deepEqual([...fs.readFileSync(closeIconPath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  professionalIconPaths.forEach((iconPath) => {
    assert.ok(fs.statSync(iconPath).size <= 10 * 1024);
    assert.deepEqual([...fs.readFileSync(iconPath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });
});

test('customer project API wrapper still exposes designer contact for existing-service hydration', () => {
  const {
    hasDesignerContact,
    customerProjectFromApiResponse,
  } = require('../utils/designerContact.js');
  const wrapped = {
    success: true,
    data: {
      designer: { id: '7', displayName: '林设计', wechatId: 'wx-lin' },
      serviceStageLabel: '新线索',
    },
  };

  assert.equal(hasDesignerContact(wrapped.designer), false);
  const project = customerProjectFromApiResponse(wrapped);
  assert.equal(project.designer.wechatId, 'wx-lin');
  assert.equal(hasDesignerContact(project.designer), true);
  assert.deepEqual(customerProjectFromApiResponse(null), {});
  assert.equal(
    customerProjectFromApiResponse({ designer: { wechatId: 'wx-direct' } }).designer.wechatId,
    'wx-direct'
  );
});

test('free-design claim success auto-opens the shared sheet and keeps QR out of the result page', () => {
  const claimRoot = path.join(root, 'packages', 'business', 'free-design-service');
  const js = fs.readFileSync(path.join(claimRoot, 'free-design-service.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(claimRoot, 'free-design-service.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(claimRoot, 'free-design-service.json'), 'utf8'));
  assert.match(json.usingComponents['designer-contact-sheet'], /designer-contact-sheet/);
  assert.match(js, /onOpenContactSheet/);
  assert.match(js, /hasDesignerContact/);
  assert.match(js, /showContactSheet:\s*Boolean\(designerProfile && contactAvailable\)/);
  assert.match(wxml, /查看设计师微信/);
  assert.match(wxml, /查看服务档案/);
  assert.match(wxml, /claim-action success-project-action[\s\S]*查看服务档案<\/button>\s*<button[\s\S]*claim-action-outline success-contact-action/);
  assert.doesNotMatch(wxml, /designer-qr-block|show-menu-by-longpress/);
  assert.match(wxml, /designer-contact-sheet/);
});
