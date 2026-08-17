const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

test('promotion service screen keeps the public presentation anonymous and scanable', () => {
  const wxml = source('packages/business/promotion-service-code/promotion-service-code.wxml');
  const js = source('packages/business/promotion-service-code/promotion-service-code.js');
  const wxss = source('packages/business/promotion-service-code/promotion-service-code.wxss');

  assert.match(wxml, /免费上门测量/);
  assert.match(wxml, /免费设计师服务/);
  assert.match(wxml, /微信扫码领取服务/);
  assert.match(wxml, /0元服务/);
  assert.match(js, /promotion-code\/image/);
  assert.match(js, /free-design-service\/free-design-service\?token=/);
  assert.match(js, /responseType:\s*'arraybuffer'/);
  assert.match(wxss, /\.qr-stage\s*\{[\s\S]*width:\s*396rpx/);
  assert.doesNotMatch(wxml, /装修公司|企业名称|enterpriseName|企业选择/);
});

test('free design service resolves before phone authorization and renders truthful outcomes', () => {
  const wxml = source('packages/business/free-design-service/free-design-service.wxml');
  const js = source('packages/business/free-design-service/free-design-service.js');
  const wxss = source('packages/business/free-design-service/free-design-service.wxss');

  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /我已阅读并同意/);
  assert.match(wxml, /设计师已为你分配/);
  assert.match(wxml, /服务档案已建立/);
  assert.match(wxml, /设计师正在分配中/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/referrals\/authorize-and-create-lead/);
  assert.match(js, /'Idempotency-Key'/);
  assert.match(js, /pageState:\s*designerProfile\s*\?\s*'success'\s*:\s*'pending'/);
  assert.match(js, /wx\.setClipboardData/);
  assert.match(js, /wx\.saveImageToPhotosAlbum/);
  assert.match(wxss, /@media \(max-width:\s*360px\)/);
  assert.doesNotMatch(wxml, /装修公司|企业名称|enterpriseName|企业选择/);
});

test('referral service primary copy respects the Mini Program type floor', () => {
  const styles = [
    source('packages/business/promotion-service-code/promotion-service-code.wxss'),
    source('packages/business/free-design-service/free-design-service.wxss')
  ].join('\n');
  assert.doesNotMatch(styles, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
  assert.doesNotMatch(styles, /transform:\s*scale\(/);
});
