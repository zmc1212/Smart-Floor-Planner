const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const pagePath = path.join(__dirname, '..', 'packages', 'business', 'customer-project', 'customer-project.js');
const wxmlPath = path.join(__dirname, '..', 'packages', 'business', 'customer-project', 'customer-project.wxml');

test('customer appointment card consumes the owner-only project aggregate and its existing service rows use real staff data', () => {
  const page = fs.readFileSync(pagePath, 'utf8');
  const wxml = fs.readFileSync(wxmlPath, 'utf8');
  assert.match(page, /\/miniprogram\/customer-projects\/\$\{encodeURIComponent\(this\.data\.leadId\)\}/);
  assert.match(page, /designer:\s*project\.designer \|\| null/);
  assert.match(wxml, /designer && designer\.displayName/);
  assert.match(wxml, /appointment\.measurerName/);
});
