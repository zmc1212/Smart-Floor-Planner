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
  assert.match(wxml, /长按识别二维码，添加设计师为好友/);
  assert.match(wxml, /show-menu-by-longpress/);
  assert.match(wxml, /复制微信号/);
  assert.match(wxml, /bindtap="onPreviewQr"/);
  assert.match(less, /\.dcs-sheet/);
  assert.match(less, /\.dcs-qr/);
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
