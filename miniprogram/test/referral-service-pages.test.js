const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

const referralAssets = [
  'thumbs-up-xiao-k.png',
  'onsite-measurement.png',
  'designer-service.png',
  'phone-authorization.png',
  'designer-matching.png',
  'privacy-lock.png',
  'xiao-k-existing-service.png',
  'xiao-k-onboarding-welcome.png',
  'xiao-k-onboarding-recovery.png',
];

test('staff activity code reuses the promotion visual language and may show the enterprise name', () => {
  const wxml = source('packages/business/staff-activity-code/staff-activity-code.wxml');
  const js = source('packages/business/staff-activity-code/staff-activity-code.js');
  const less = source('packages/business/staff-activity-code/staff-activity-code.less');

  assert.match(wxml, /免费设计服务/);
  assert.match(wxml, /免费上门量房 · 专业设计师服务/);
  assert.match(wxml, /请客户扫描此码/);
  assert.match(wxml, /让客户扫码领取/);
  assert.match(wxml, /enterpriseName/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(js, /\/miniprogram\/staff-activity-code/);
  assert.match(js, /staff-activity-code\/image/);
  assert.match(js, /free-design-service\/free-design-service\?token=/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*292rpx/);
});

test('promotion service screen keeps the public presentation anonymous and scanable', () => {
  const wxml = source('packages/business/promotion-service-code/promotion-service-code.wxml');
  const js = source('packages/business/promotion-service-code/promotion-service-code.js');
  const less = source('packages/business/promotion-service-code/promotion-service-code.less');

  assert.match(wxml, /免费设计服务/);
  assert.match(wxml, /免费上门量房 · 专业设计师服务/);
  assert.match(wxml, /请客户扫描此码/);
  assert.match(wxml, /0元服务/);
  assert.match(wxml, /设计师匹配/);
  assert.match(wxml, /让客户扫码领取/);
  assert.match(wxml, /open-type="share"/);
  assert.match(wxml, /referral-service-v1\/thumbs-up-xiao-k\.png/);
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(js, /promotion-code\/image/);
  assert.match(js, /free-design-service\/free-design-service\?token=/);
  assert.match(js, /responseType:\s*'arraybuffer'/);
  assert.match(less, /\.qr-stage\s*\{[\s\S]*width:\s*292rpx/);
  assert.doesNotMatch(wxml, /装修公司|企业名称|enterpriseName|企业选择/);
});

test('free design service resolves into phone authorization and renders truthful outcomes', () => {
  const wxml = source('packages/business/free-design-service/free-design-service.wxml');
  const js = source('packages/business/free-design-service/free-design-service.js');
  const less = source('packages/business/free-design-service/free-design-service.less');

  assert.match(wxml, /open-type="getPhoneNumber"/);
  assert.match(wxml, /允许微信授权手机号/);
  assert.match(wxml, /pageState === 'phoneAuth'/);
  assert.match(wxml, /专属设计师已为你匹配/);
  assert.match(wxml, /服务已建立/);
  assert.match(wxml, /success-title/);
  assert.match(wxml, /服务已领取/);
  assert.match(wxml, /我们正在为你匹配合适的设计师/);
  assert.doesNotMatch(wxml, /pageState === 'ready'/);
  assert.doesNotMatch(wxml, /一键授权手机号/);
  assert.doesNotMatch(wxml, /我已阅读并同意/);
  for (const asset of referralAssets.slice(1)) {
    if (
      asset === 'designer-matching.png'
      || asset === 'privacy-lock.png'
      || asset === 'designer-service.png'
      || asset === 'xiao-k-onboarding-welcome.png'
      || asset === 'xiao-k-onboarding-recovery.png'
    ) {
      continue;
    }
    assert.match(wxml, new RegExp(`referral-service-v1/${asset.replace('.', '\\.')}`));
  }
  assert.match(wxml, /home-ip-v1\/brand-logo\.png/);
  assert.match(js, /\/miniprogram\/codes\/resolve/);
  assert.match(js, /\/miniprogram\/referrals\/authorize-and-create-lead/);
  assert.match(js, /kind !== 'referral' && response.data.kind !== 'staff_activity'/);
  assert.match(js, /'Idempotency-Key'/);
  assert.match(js, /response\.existingAttribution/);
  assert.match(js, /pageState:\s*'existing'/);
  assert.match(js, /pageState:\s*'phoneAuth'/);
  assert.match(js, /pageState:\s*designerProfile\s*\?\s*'success'\s*:\s*'pending'/);
  assert.match(js, /wechat_user_mismatch/);
  assert.match(js, /staff_phone_linked_to_other_user/);
  assert.match(js, /该手机号已绑定其他微信账号/);
  assert.doesNotMatch(js, /onStartPhoneAuth/);
  assert.doesNotMatch(js, /agreed/);
  assert.match(js, /pageState !== 'phoneAuth'/);
  assert.match(wxml, /pageState === 'existing'/);
  assert.match(wxml, /你已有进行中的服务/);
  assert.match(wxml, /联系当前设计师/);
  assert.match(wxml, /当前服务归属已保留/);
  assert.match(wxml, /xiao-k-existing-service\.png/);
  assert.match(wxml, /clipboard-pen\.png/);
  assert.match(js, /onContactDesigner/);
  assert.match(js, /hydrateExistingAttribution/);
  assert.match(js, /服务已存在/);
  assert.doesNotMatch(wxml, /本次扫码不会重复领取/);
  assert.match(js, /wx\.setClipboardData/);
  assert.match(js, /wx\.saveImageToPhotosAlbum/);
  assert.match(less, /@media \(max-width:\s*360px\)/);
  assert.match(less, /\.claim-action\s*\{[^}]*align-self:\s*stretch/);
  assert.match(less, /\.claim-action\s*\{[^}]*min-width:\s*100%/);
  assert.match(less, /\.success-title\s*\{[^}]*color:\s*#00c365/);
  assert.match(less, /\.existing-note\s*\{[^}]*background:\s*#f1f5f2/);
  assert.doesNotMatch(wxml, /装修公司/);
  assert.match(wxml, /enterpriseName/);
});

test('Antigravity referral assets are transparent PNG files within the package limit', () => {
  for (const asset of referralAssets) {
    const assetPath = path.join(miniRoot, 'packages/business/assets/referral-service-v1', asset);
    const bytes = fs.readFileSync(assetPath);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.ok(bytes.length <= 300 * 1024, `${asset} exceeds 300KB`);
    assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), `${asset} must retain transparency`);
  }
});

test('referral service primary copy respects the Mini Program type floor', () => {
  const styles = [
    source('packages/business/promotion-service-code/promotion-service-code.less'),
    source('packages/business/staff-activity-code/staff-activity-code.less'),
    source('packages/business/free-design-service/free-design-service.less')
  ].join('\n');
  assert.doesNotMatch(styles, /font-size:\s*(?:1[0-9]|[0-9])rpx/);
  assert.doesNotMatch(styles, /transform:\s*scale\(/);
});
