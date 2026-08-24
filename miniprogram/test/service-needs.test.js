const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('customer service needs page is packaged and uses the customer project capability', () => {
  const pageRoot = path.join(root, 'packages', 'business', 'service-needs');
  const wxml = fs.readFileSync(path.join(pageRoot, 'service-needs.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(pageRoot, 'service-needs.js'), 'utf8');
  const less = fs.readFileSync(path.join(pageRoot, 'service-needs.less'), 'utf8');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const navigation = require('../utils/identity-navigation.js');

  assert.ok(app.subPackages.find((item) => item.root === 'packages/business').pages.includes('service-needs/service-needs'));
  assert.match(wxml, /补充服务记录/);
  assert.match(wxml, /暂时没有其他需求/);
  assert.match(wxml, /保存服务需求/);
  assert.match(js, /customer-projects\/\$\{encodeURIComponent\(this\.data\.leadId\)\}\/service-needs/);
  assert.match(js, /'PUT'/);
  assert.match(less, /\.needs-footer\s*\{[\s\S]*position:\s*fixed/);
  assert.equal(
    navigation.canAccessRoute('/packages/business/service-needs/service-needs', { mode: 'customer' }),
    true,
  );
});
