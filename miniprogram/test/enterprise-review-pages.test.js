const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const miniRoot = path.join(__dirname, '..');
const reviewModel = require('../packages/platform/enterprise-review-model.js');

function read(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

test('platform enterprise review tab uses Mini platform APIs and operational list language', () => {
  const appConfig = JSON.parse(read('app.json'));
  const platform = appConfig.subPackages.find((item) => item.root === 'packages/platform');
  const tabBar = read('custom-tab-bar/index.js');
  const navigation = read('utils/identity-navigation.js');
  const listJs = read('packages/platform/enterprise-review/enterprise-review.js');
  const listWxml = read('packages/platform/enterprise-review/enterprise-review.wxml');
  const listJson = JSON.parse(read('packages/platform/enterprise-review/enterprise-review.json'));
  const detailJs = read('packages/platform/enterprise-review-detail/enterprise-review-detail.js');
  const detailWxml = read('packages/platform/enterprise-review-detail/enterprise-review-detail.wxml');
  const model = read('packages/platform/enterprise-review-model.js');

  assert.ok(platform.pages.includes('enterprise-review/enterprise-review'));
  assert.ok(platform.pages.includes('enterprise-review-detail/enterprise-review-detail'));
  assert.ok(platform.pages.includes('registration-code/registration-code'));
  assert.equal(platform.independent, undefined);
  assert.equal(listJson.usingComponents['custom-tab-bar'], '/custom-tab-bar/index');
  assert.match(listWxml, /<custom-tab-bar\s*\/>/);
  assert.doesNotMatch(detailWxml, /<custom-tab-bar\s*\/>/);
  assert.doesNotMatch(JSON.stringify(appConfig.tabBar), /enterprise-review/);
  assert.doesNotMatch(JSON.stringify(appConfig.pages), /enterprise-review/);

  assert.match(tabBar, /key: 'review', capability: 'platform\.review'/);
  assert.match(tabBar, /pagePath: '\/packages\/platform\/enterprise-review\/enterprise-review'/);
  assert.match(tabBar, /pagePath: '\/packages\/platform\/devices\/devices'/);
  assert.match(tabBar, /text: '审核'/);
  assert.match(navigation, /platform_admin: \['platform\.review', 'platform\.devices', 'account'\]/);
  assert.match(navigation, /platform_admin: '\/packages\/platform\/devices\/devices'/);
  assert.match(navigation, /enterprise-review\/enterprise-review': 'platform\.review'/);
  assert.match(navigation, /registration-code\/registration-code': 'platform\.review'/);
  assert.match(navigation, /devices\/devices': 'platform\.devices'/);

  assert.match(listJs, /['"`]\/miniprogram\/platform\/enterprises/);
  assert.match(listJs, /appendQuery/);
  assert.match(listJs, /onLoadMore/);
  assert.match(listWxml, /bindscrolltolower="onLoadMore"/);
  assert.match(listJs, /wx\.showModal/);
  assert.match(listJs, /validateReason/);
  assert.match(listJs, /openRegistrationCode/);
  assert.match(listWxml, /wx\.makePhoneCall|callPhone/);
  assert.match(listWxml, /请填写 4–200 字原因/);
  assert.match(listWxml, /按名称、电话或信用代码/);
  assert.match(listWxml, /出示开户码|开户码/);
  assert.doesNotMatch(JSON.stringify(appConfig.tabBar), /registration-code/);
  assert.doesNotMatch(JSON.stringify(appConfig.pages), /registration-code/);
  assert.match(detailJs, /['"`]\/miniprogram\/platform\/enterprises\//);
  assert.match(detailJs, /resubmit_review/);
  assert.match(detailWxml, /data-action="disable"/);
  assert.match(detailWxml, /直接通过|通过/);
  assert.match(detailWxml, /重新提交审核/);
  assert.match(detailWxml, /停用/);
  assert.match(detailWxml, /启用/);
  const visibleList = listWxml.replace(/<!--[\s\S]*?-->/g, '');
  const visibleDetail = detailWxml.replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(visibleList, /aiConfig|pollinations|自动化/);
  assert.doesNotMatch(visibleDetail, /aiConfig|pollinations|自动化/);
  assert.match(model, /扫码自助/);
  assert.match(model, /后台手工/);
  assert.match(model, /key: 'pending_approval', label: '待审核'/);
  assert.match(model, /key: 'all', label: '全部'/);
  assert.match(model, /key: 'rejected', label: '已拒绝'/);
  assert.match(model, /key: 'disabled', label: '已停用'/);
});

test('enterprise review model validates reason length and decorates operational facts', () => {
  assert.deepEqual(reviewModel.validateReason('abc'), {
    ok: false,
    message: '操作原因需为 4-200 个字符',
  });
  assert.deepEqual(reviewModel.validateReason('信用代码无法核验'), {
    ok: true,
    reason: '信用代码无法核验',
  });
  assert.equal(reviewModel.validateReason('x'.repeat(201)).ok, false);

  const decorated = reviewModel.decorateEnterprise({
    _id: '41',
    name: '杭州市西湖装修有限公司',
    status: 'pending_approval',
    registrationMode: 'self_service',
    contactPerson: { name: '王经理', phone: '13800138000' },
    createdAt: '2026-08-20T02:00:00.000Z',
    allowedActions: ['approve', 'reject'],
  });
  assert.equal(decorated.statusLabel, '待审核');
  assert.equal(decorated.registrationLabel, '扫码自助');
  assert.equal(decorated.canApprove, true);
  assert.equal(decorated.canReject, true);
  assert.equal(decorated.canDisable, false);
  assert.equal(decorated.canEnable, false);
  assert.equal(decorated.canResubmit, false);
});

test('platform registration-code page is a read-only subpackage presenter', () => {
  const appConfig = JSON.parse(read('app.json'));
  const js = read('packages/platform/registration-code/registration-code.js');
  const wxml = read('packages/platform/registration-code/registration-code.wxml');
  const json = JSON.parse(read('packages/platform/registration-code/registration-code.json'));
  const mineWxml = read('pages/mine/mine.wxml');
  const mineJs = read('pages/mine/mine.js');
  const mineModel = require('../pages/mine/mine-model.js');

  assert.equal(json.navigationStyle, 'custom');
  assert.equal(json.enableShareAppMessage, undefined);
  assert.match(js, /['"`]\/miniprogram\/platform\/enterprise-registration-code/);
  assert.match(js, /enterprise-registration-code\/image/);
  assert.match(js, /variant=poster/);
  assert.match(js, /responseType:\s*'arraybuffer'/);
  assert.match(js, /当前有效 · 未换新/);
  assert.doesNotMatch(js, /rotate|disable/);
  assert.match(wxml, /出示开户码/);
  assert.match(wxml, /poster-image/);
  assert.doesNotMatch(wxml, /\/images\/mine-icons\/scan\.png/);
  assert.doesNotMatch(wxml.replace(/<!--[\s\S]*?-->/g, ''), /packages\/business/);
  assert.doesNotMatch(JSON.stringify(appConfig.tabBar), /registration-code/);
  assert.match(mineWxml, /bindtap="onOpenRegistrationCode"/);
  assert.match(mineWxml, /出示开户码/);
  assert.match(mineJs, /onOpenRegistrationCode\(\)[\s\S]*registration-code\/registration-code/);
  assert.equal(mineModel.canShowPlatformRegistrationCode('platform_admin', {
    current: { capabilities: ['platform.review', 'platform.devices', 'account'] },
  }), true);
  assert.equal(mineModel.canShowPlatformRegistrationCode('designer', {
    current: { capabilities: ['staff.leads'] },
  }), false);
});
