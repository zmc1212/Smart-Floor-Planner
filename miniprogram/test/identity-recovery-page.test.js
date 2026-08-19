const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'packages', 'business', 'identity-recovery', 'identity-recovery.wxml'), 'utf8');
const pageScript = fs.readFileSync(path.join(root, 'packages', 'business', 'identity-recovery', 'identity-recovery.js'), 'utf8');
const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));

test('invalid signed contexts enter the dedicated recovery page instead of a customer fallback', () => {
  assert.match(appSource, /identity-recovery\/identity-recovery\?reason=/);
  assert.match(appSource, /current\.includes\('\/identity-recovery'\)/);
  const businessPackage = appConfig.subPackages.find((item) => item.root === 'packages/business');
  assert.ok(businessPackage.pages.includes('identity-recovery/identity-recovery'));
});

test('identity recovery does not render stale enterprise or identity data', () => {
  assert.match(pageSource, /不会展示失效身份的数据/);
  assert.match(pageScript, /clearSession\(\);\s*goToLogin\(\);/);
  assert.doesNotMatch(pageSource, /enterpriseName|lastValidIdentityContext|referrerMembershipId/);
});
