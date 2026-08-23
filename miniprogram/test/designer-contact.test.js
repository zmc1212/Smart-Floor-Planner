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

test('designer-contact-sheet shows QR with long-press hint and copy wechat fallback', () => {
  const js = fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.wxml'), 'utf8');
  const less = fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.less'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(sheetRoot, 'designer-contact-sheet.json'), 'utf8'));

  assert.equal(json.component, true);
  assert.match(js, /loadDesignerQrToTempFile/);
  assert.match(js, /copyDesignerWechatId/);
  assert.match(js, /wx\.previewImage/);
  assert.match(js, /openSheet/);
  assert.match(js, /sheetMotion/);
  assert.match(wxml, /长按识别二维码，添加设计师为好友/);
  assert.match(wxml, /show-menu-by-longpress/);
  assert.match(wxml, /微信号：\{\{wechatId\}\}/);
  assert.match(wxml, /复制微信号/);
  assert.match(wxml, /bindtap="onPreviewQr"/);
  assert.match(wxml, /dcs-dialog \{\{dialogOpen \? 'open' : ''\}\}/);
  assert.match(less, /\.dcs-dialog/);
  assert.match(less, /align-items:\s*center/);
  assert.match(less, /justify-content:\s*center/);
  assert.doesNotMatch(less, /align-items:\s*flex-end/);
  assert.doesNotMatch(less, /translateY\(100%\)/);
  assert.match(less, /\.dcs-qr/);
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

test('free-design claim success reuses designer-contact-sheet and inline QR', () => {
  const claimRoot = path.join(root, 'packages', 'business', 'free-design-service');
  const js = fs.readFileSync(path.join(claimRoot, 'free-design-service.js'), 'utf8');
  const wxml = fs.readFileSync(path.join(claimRoot, 'free-design-service.wxml'), 'utf8');
  const json = JSON.parse(fs.readFileSync(path.join(claimRoot, 'free-design-service.json'), 'utf8'));
  assert.match(json.usingComponents['designer-contact-sheet'], /designer-contact-sheet/);
  assert.match(js, /onOpenContactSheet/);
  assert.match(js, /hasDesignerContact/);
  assert.match(wxml, /designer-qr-block/);
  assert.match(wxml, /designer-contact-sheet/);
});
