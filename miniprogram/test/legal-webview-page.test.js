const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadPage() {
  const pagePath = require.resolve('../packages/business/legal-webview/legal-webview.js');
  const originalPage = global.Page;
  const originalGetApp = global.getApp;
  let definition;
  global.Page = (next) => {
    definition = next;
  };
  global.getApp = () => ({ globalData: {} });
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  global.getApp = originalGetApp;
  return definition;
}

test('legal webview page is registered and hosts a url-driven web-view', () => {
  const appConfig = JSON.parse(source('app.json'));
  const businessPackage = appConfig.subPackages.find(
    (item) => item.root === 'packages/business'
  );
  const wxml = source('packages/business/legal-webview/legal-webview.wxml');
  const json = JSON.parse(source('packages/business/legal-webview/legal-webview.json'));
  const js = source('packages/business/legal-webview/legal-webview.js');

  assert.ok(businessPackage.pages.includes('legal-webview/legal-webview'));
  assert.match(wxml, /<web-view[\s\S]*src="\{\{url\}\}"/);
  assert.equal(json.navigationStyle, undefined);
  assert.equal(json.navigationBarTitleText, '查看文档');
  assert.match(js, /parseWebviewOptions/);
  assert.doesNotMatch(js, /navigationStyle/);
});

test('legal webview page loads only an https url from the query', () => {
  const definition = loadPage();
  const titles = [];
  const toasts = [];
  const originalWx = global.wx;
  global.wx = {
    ...(originalWx || {}),
    setNavigationBarTitle(options) {
      titles.push(options.title);
    },
    showToast(options) {
      toasts.push(options);
    }
  };

  try {
    const context = {
      data: { ...definition.data },
      setData(next) {
        Object.assign(this.data, next);
      }
    };

    definition.onLoad.call(context, {
      url: encodeURIComponent(encodeURIComponent('https://cdn.example.com/user-agreement.html')),
      title: encodeURIComponent(encodeURIComponent('用户协议'))
    });
    assert.equal(context.data.url, 'https://cdn.example.com/user-agreement.html');
    assert.equal(titles[0], '用户协议');

    const rejected = {
      data: { url: '' },
      setData(next) {
        Object.assign(this.data, next);
      }
    };
    definition.onLoad.call(rejected, { url: 'http://insecure.example/x.html' });
    assert.equal(rejected.data.url, '');
    assert.equal(toasts[0].title, '链接无效');
  } finally {
    global.wx = originalWx;
  }
});
