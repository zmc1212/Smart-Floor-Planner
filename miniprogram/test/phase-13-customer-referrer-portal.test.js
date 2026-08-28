const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('phase 13 registers the customer project index and referrer read-only routes', () => {
  const config = JSON.parse(source('app.json'));
  const businessPages = config.subPackages.find((entry) => entry.root === 'packages/business').pages;
  assert.deepEqual(
    businessPages.filter((page) => page.includes('customer-projects') || page.includes('referrer-progress') || page.includes('referrer-earnings')),
    ['referrer-progress/referrer-progress', 'referrer-earnings/referrer-earnings', 'customer-projects/customer-projects']
  );
  const navigation = source('utils/identity-navigation.js');
  assert.match(navigation, /referrer-progress\/referrer-progress': 'referrer\.progress'/);
  assert.match(navigation, /referrer-earnings\/referrer-earnings': 'referrer\.earnings'/);
  assert.match(navigation, /customer-projects\/customer-projects': 'customer\.projects'/);
});

test('phase 13 portal pages use the scoped aggregate endpoints and preserve privacy-oriented copy', () => {
  const customer = source('packages/business/customer-projects/customer-projects.js');
  const progress = source('packages/business/referrer-progress/referrer-progress.js');
  const earnings = source('packages/business/referrer-earnings/referrer-earnings.js');
  const workbench = source('packages/business/referrer-workbench/referrer-workbench.wxml');
  const workbenchScript = source('packages/business/referrer-workbench/referrer-workbench.js');
  assert.match(customer, /\/miniprogram\/customer-projects/);
  assert.match(customer, /rankCustomerProjects/);
  assert.match(customer, /wx\.redirectTo/);
  assert.match(customer, /customer-project\/customer-project\?leadId=/);
  assert.match(customer, /wx\.switchTab\(\{\s*url:\s*['"]\/pages\/index\/index['"]/);
  assert.doesNotMatch(source('packages/business/customer-projects/customer-projects.wxml'), /project-list|project-card|我的项目/);
  assert.match(progress, /\/miniprogram\/referrer-progress/);
  assert.match(earnings, /\/miniprogram\/referrer-earnings/);
  assert.match(workbench, /仅展示当前企业的脱敏事实/);
  assert.match(workbenchScript, /\/miniprogram\/identity-contexts\/switch/);
  assert.match(workbenchScript, /referrerMembershipId: membership\.id/);
  assert.doesNotMatch(source('packages/business/referrer-progress/referrer-progress.wxml'), /手机号|精确地址|户型 graph|设计文件/);
  assert.doesNotMatch(source('packages/business/referrer-progress/referrer-progress.wxml'), /撤销测试线索/);
  assert.match(source('packages/business/referrer-progress/referrer-progress.wxml'), />撤回</);
  assert.match(source('packages/business/referrer-progress/referrer-progress.less'), /\.withdraw-btn\s*\{[\s\S]*background:\s*#18a94b/);
});

test('phase 13 pages use custom navigation so their capsule-safe headers are the only navigation bar', () => {
  assert.deepEqual(JSON.parse(source('packages/business/customer-projects/customer-projects.json')), {
    navigationStyle: 'custom',
  });
  for (const page of ['referrer-progress/referrer-progress', 'referrer-earnings/referrer-earnings']) {
    assert.deepEqual(JSON.parse(source(`packages/business/${page}.json`)), {
      navigationStyle: 'custom',
      usingComponents: { 'custom-tab-bar': '/custom-tab-bar/index' }
    });
  }
});

test('customer Service workspace mounts stage companion instead of staff workbench list', () => {
  const indexJs = source('pages/index/index.js');
  const indexWxml = source('pages/index/index.wxml');
  const indexJson = JSON.parse(source('pages/index/index.json'));
  const companion = source('components/customer-service-home/customer-service-home.js');
  assert.match(indexJs, /\['customer', 'designer', 'measurer', 'enterprise_admin'\]/);
  assert.equal(
    indexJson.usingComponents['customer-service-home'],
    '/components/customer-service-home/customer-service-home'
  );
  assert.match(indexWxml, /<customer-service-home wx:if="\{\{roleWorkbenchRole === 'customer'\}\}"\s*\/>/);
  assert.match(indexWxml, /<role-workbench wx:elif="\{\{roleWorkbenchRole\}\}"[^>]*focus="overview"/);
  assert.doesNotMatch(indexJs, /customer-projects\/customer-projects/);
  assert.match(companion, /['"`]\/miniprogram\/customer-projects['"`]/);
});

test('referrer customers page packages a standalone transparent Xiao K cutout', () => {
  const wxml = source('packages/business/referrer-progress/referrer-progress.wxml');
  const relative = 'packages/business/assets/referrer-customers-v1/xiao-k-customer-dossier.png';
  const bytes = fs.readFileSync(path.join(root, relative));
  assert.match(wxml, /referrer-customers-v1\/xiao-k-customer-dossier\.png/);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(bytes.length <= 300 * 1024, 'xiao-k-customer-dossier.png exceeds 300KB');
  assert.ok(bytes.includes(Buffer.from('tRNS')) || [4, 6].includes(bytes[25]), 'cutout must retain transparency');
});
