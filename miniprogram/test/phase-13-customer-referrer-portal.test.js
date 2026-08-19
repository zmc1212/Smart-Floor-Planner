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
  assert.match(progress, /\/miniprogram\/referrer-progress/);
  assert.match(earnings, /\/miniprogram\/referrer-earnings/);
  assert.match(workbench, /仅展示当前企业的脱敏事实/);
  assert.match(workbenchScript, /\/miniprogram\/identity-contexts\/switch/);
  assert.match(workbenchScript, /referrerMembershipId: membership\.id/);
  assert.doesNotMatch(source('packages/business/referrer-progress/referrer-progress.wxml'), /手机号|精确地址|户型 graph|设计文件/);
});

test('phase 13 pages use custom navigation so their capsule-safe headers are the only navigation bar', () => {
  assert.deepEqual(JSON.parse(source('packages/business/customer-projects/customer-projects.json')), {
    navigationStyle: 'custom',
    usingComponents: { 'custom-tab-bar': '/custom-tab-bar/index' },
  });
  for (const page of ['referrer-progress/referrer-progress', 'referrer-earnings/referrer-earnings']) {
    assert.deepEqual(JSON.parse(source(`packages/business/${page}.json`)), {
      navigationStyle: 'custom',
      usingComponents: { 'custom-tab-bar': '/custom-tab-bar/index' }
    });
  }
});

test('customer Service workspace reads only the owned project index instead of the staff workbench', () => {
  const index = source('pages/index/index.js');
  const workbench = source('components/role-workbench/role-workbench.js');
  assert.match(index, /\['customer', 'designer', 'measurer', 'enterprise_admin'\]/);
  assert.match(workbench, /isCustomer \? '\/miniprogram\/customer-projects' : '\/miniprogram\/workbench'/);
  assert.match(workbench, /action === 'customer-project'/);
});
