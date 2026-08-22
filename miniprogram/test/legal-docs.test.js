const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const legal = require('../utils/legal-docs.js');

const docsRoot = path.resolve(__dirname, '..', '..', 'docs', 'legal');

test('legal docs helper builds an https webview query and rejects empty or http urls', () => {
  assert.equal(legal.LEGAL_WEBVIEW_ROUTE, '/packages/business/legal-webview/legal-webview');
  assert.equal(legal.isHttpsUrl('https://cdn.example.com/user-agreement.html'), true);
  assert.equal(legal.isHttpsUrl('http://cdn.example.com/user-agreement.html'), false);
  assert.equal(legal.isHttpsUrl(''), false);

  const built = legal.buildLegalWebviewUrl({
    title: '用户协议',
    url: 'https://cdn.example.com/user-agreement.html?v=1'
  });
  assert.match(built, /^\/packages\/business\/legal-webview\/legal-webview\?/);
  assert.match(built, /url=/);
  assert.match(built, /title=/);
  assert.doesNotMatch(built, /\?url=https:\/\//);
  assert.match(built, /%253A%252F%252F/);

  assert.equal(legal.buildLegalWebviewUrl({ title: '用户协议', url: '' }), null);
  assert.equal(legal.buildLegalWebviewUrl({ title: '隐私政策', url: 'http://insecure.example/p.html' }), null);

  const href = 'https://cdn.example.com/privacy-policy.html';
  assert.equal(
    legal.parseWebviewOptions({ url: href, title: '隐私政策' }).url,
    href
  );
  assert.equal(
    legal.parseWebviewOptions({
      url: encodeURIComponent(href),
      title: encodeURIComponent('隐私政策')
    }).url,
    href
  );
  assert.equal(
    legal.parseWebviewOptions({
      url: encodeURIComponent(encodeURIComponent(href)),
      title: encodeURIComponent(encodeURIComponent('隐私政策'))
    }).title,
    '隐私政策'
  );
  assert.equal(
    legal.parseWebviewOptions({
      url: encodeURIComponent(encodeURIComponent(href))
    }).url,
    href
  );
  assert.equal(legal.parseWebviewOptions({ url: 'ftp://x' }).url, '');
});

test('https url check does not use URL constructor so WeChat can open legal docs', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'utils', 'legal-docs.js'), 'utf8');
  assert.doesNotMatch(source, /new URL\(/);
  assert.equal(legal.isHttpsUrl('https://smartfloor.zlyun168.com/user-agreement.html'), true);
});

test('login legal kinds resolve to the configured user agreement and privacy policy', () => {
  assert.equal(legal.resolveLegalDoc('user').title, '用户协议');
  assert.equal(legal.resolveLegalDoc('privacy').title, '隐私政策');
  assert.equal(
    legal.resolveLegalDoc('user').url,
    'https://smartfloor.zlyun168.com/user-agreement.html'
  );
  assert.equal(
    legal.resolveLegalDoc('privacy').url,
    'https://smartfloor.zlyun168.com/privacy-policy.html'
  );
  assert.equal(legal.resolveLegalDoc('unknown'), null);
  assert.match(legal.buildLegalWebviewUrl(legal.resolveLegalDoc('user')), /legal-webview/);
});

test('uploadable legal H5 files describe the current 家客来 Mini Program', () => {
  const agreement = fs.readFileSync(path.join(docsRoot, 'user-agreement.html'), 'utf8');
  const privacy = fs.readFileSync(path.join(docsRoot, 'privacy-policy.html'), 'utf8');

  assert.match(agreement, /家客来用户协议/);
  assert.match(agreement, /微信小程序/);
  assert.match(agreement, /手机号/);
  assert.match(agreement, /量房/);
  assert.match(agreement, /AI/);

  assert.match(privacy, /家客来隐私政策/);
  assert.match(privacy, /openid|OpenID/);
  assert.match(privacy, /蓝牙|测距/);
  assert.match(privacy, /位置|定位/);
  assert.match(privacy, /微信公众平台/);
});
