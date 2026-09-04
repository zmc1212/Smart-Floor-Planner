const test = require('node:test');
const assert = require('node:assert/strict');

function loadPage(name) {
  let definition;
  const saved = global.Page;
  global.Page = (page) => { definition = page; };
  const file = require.resolve(`../packages/business/${name}/${name}.js`);
  try {
    delete require.cache[file];
    require(file);
  } finally {
    global.Page = saved;
  }
  return definition;
}

for (const fromHome of [false, true]) {
  test(`customer empty state opens the signed enterprise code and returns to customers (${fromHome ? 'home shortcut' : 'tab root'})`, (t) => {
    const saved = { wx: global.wx, getApp: global.getApp, getCurrentPages: global.getCurrentPages };
    t.after(() => Object.assign(global, saved));
    const customerRoute = 'packages/business/referrer-progress/referrer-progress';
    const stack = fromHome ? [{ route: 'packages/business/referrer-workbench/referrer-workbench' }] : [];
    stack.push({ route: customerRoute });
    const initialDepth = stack.length;
    const current = { context: { referrerMembershipId: 'current-enterprise' } };
    global.getApp = () => ({ globalData: { bootstrap: { current } } });
    global.getCurrentPages = () => stack;
    global.wx = {
      navigateTo({ url }) {
        assert.equal(url, '/packages/business/promotion-service-code/promotion-service-code?membershipId=current-enterprise');
        stack.push({ route: url.slice(1).split('?')[0] });
      },
      navigateBack() { stack.pop(); }
    };
    const customers = loadPage('referrer-progress');
    // A stale local selection must not override the active signed identity.
    customers.showServiceCode.call({ data: { selectedMembershipId: 'old-enterprise' } });
    assert.equal(stack.length, initialDepth + 1);
    const presenter = loadPage('promotion-service-code');
    presenter.onBack.call(presenter);
    assert.equal(stack.length, initialDepth);
    assert.equal(stack.at(-1).route, customerRoute);
  });
}

test('missing signed membership and navigation failure show feedback without leaving customers', (t) => {
  const saved = { wx: global.wx, getApp: global.getApp };
  t.after(() => Object.assign(global, saved));
  let current = null;
  let navigations = 0;
  const messages = [];
  global.getApp = () => ({ globalData: { bootstrap: { current } } });
  global.wx = {
    showToast({ title, icon }) { assert.equal(icon, 'none'); messages.push(title); },
    navigateTo({ fail }) { navigations += 1; fail(); }
  };
  const customers = loadPage('referrer-progress');
  customers.showServiceCode();
  assert.equal(navigations, 0);
  assert.match(messages[0], /重新选择推广身份/);
  current = { context: { referrerMembershipId: 'current-enterprise' } };
  customers.showServiceCode();
  assert.equal(navigations, 1);
  assert.match(messages[1], /打开失败/);
});
