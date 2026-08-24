const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('designer claim pool is registered and keeps the approved service-time polling contract', () => {
  const config = JSON.parse(read('app.json'));
  const business = config.subPackages.find((item) => item.root === 'packages/business');
  assert.ok(business.pages.includes('lead-claim-pool/lead-claim-pool'));
  const script = read('packages/business/lead-claim-pool/lead-claim-pool.js');
  assert.match(script, /\/lead-claim-pool/);
  assert.match(script, /serverNow/);
  assert.match(script, /setInterval\(\(\) => this\.load\(\{ silent: true \}\), 3000\)/);
  assert.match(script, /Idempotency-Key/);
  assert.match(script, /lead_already_claimed/);
});

test('claim pool masks customer identity before claim and exposes all approved states', () => {
  const template = read('packages/business/lead-claim-pool/lead-claim-pool.wxml');
  assert.doesNotMatch(template, /item\.name|item\.phone/);
  assert.match(template, /正在刷新线索池/);
  assert.match(template, /当前未开启抢单/);
  assert.match(template, /线索池暂时空空的/);
  assert.match(template, /立即抢单/);
  assert.match(template, /已失效/);
  assert.match(template, /开启抢单提醒/);
});

test('designer workbench surfaces the live claim count and route', () => {
  const script = read('components/role-workbench/role-workbench.js');
  const template = read('components/role-workbench/role-workbench.wxml');
  assert.match(script, /loadClaimPoolSummary/);
  assert.match(script, /packages\/business\/lead-claim-pool\/lead-claim-pool/);
  assert.match(template, /claimPoolSummary\.count/);
  assert.match(template, /去抢单/);
});
