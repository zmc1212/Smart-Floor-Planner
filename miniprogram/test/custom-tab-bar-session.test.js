const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const tabBarPath = path.resolve(__dirname, '..', 'custom-tab-bar', 'index.js');
const tabBarStylePath = path.resolve(__dirname, '..', 'custom-tab-bar', 'index.less');
const appStylePath = path.resolve(__dirname, '..', 'app.less');

function loadTabBarComponent(globalData) {
  const originals = {
    Component: global.Component,
    getApp: global.getApp,
    getCurrentPages: global.getCurrentPages,
    wx: global.wx,
  };
  let definition;

  global.Component = (componentDefinition) => {
    definition = componentDefinition;
  };
  global.getApp = () => ({ globalData });
  global.getCurrentPages = () => [{ route: 'pages/mine/mine' }];
  global.wx = { getStorageSync: () => null };

  delete require.cache[tabBarPath];
  require(tabBarPath);

  return {
    definition,
    restore() {
      for (const [key, value] of Object.entries(originals)) {
        if (value === undefined) {
          delete global[key];
        } else {
          global[key] = value;
        }
      }
    }
  };
}

test('custom TabBar is hidden when no signed identity is available', () => {
  const globalData = {
    userInfo: null,
    bootstrap: null
  };
  const { definition, restore } = loadTabBarComponent(globalData);

  try {
    const component = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) {
        this.data = { ...this.data, ...update };
      }
    };

    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list, []);
    assert.equal(component.data.suppressed, true);
    assert.equal(component.data.badgeUnavailable, false);
  } finally {
    restore();
  }
});

test('custom TabBar uses the signed bootstrap role instead of the legacy staff split', () => {
  const globalData = {
    userInfo: { role: 'staff', enterpriseId: 'enterprise-1' },
    bootstrap: { current: { role: 'customer', capabilities: ['customer.service', 'customer.projects', 'account'] } }
  };
  const { definition, restore } = loadTabBarComponent(globalData);

  try {
    const component = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) { this.data = { ...this.data, ...update }; }
    };

    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['service', 'mine']);
    assert.equal(component.data.list.some((item) => item.key === 'measure'), false);
    assert.equal(component.data.list.some((item) => item.key === 'leads'), false);

    globalData.bootstrap = { current: { role: 'referrer', capabilities: ['referrer.promotion', 'referrer.progress', 'referrer.earnings', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['promotion', 'progress', 'earnings', 'mine']);

    globalData.bootstrap = { current: { role: 'designer', capabilities: ['staff.leads', 'staff.appointments', 'staff.design', 'staff.earnings', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['workbench', 'customers', 'design', 'earnings', 'mine']);
    assert.equal(component.data.list.some((item) => item.key === 'measure'), false);

    globalData.bootstrap = { current: { role: 'designer', capabilities: ['staff.leads', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['workbench', 'customers', 'mine']);

    globalData.bootstrap = { current: { role: 'measurer', capabilities: ['staff.schedule', 'staff.tasks', 'staff.surveying', 'staff.earnings', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['workbench', 'customers', 'earnings', 'mine']);
    assert.equal(component.data.list[0].pagePath, '/pages/index/index');

    globalData.bootstrap = { current: { role: 'enterprise_admin', capabilities: ['enterprise.operations', 'enterprise.customers', 'enterprise.appointments', 'enterprise.commissions', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['operations', 'customers', 'appointments', 'commissions', 'mine']);
  } finally {
    restore();
  }
});

test('earnings and appointments use paired TabBar icon states', () => {
  const { ROLE_ITEMS } = require(tabBarPath);
  const assetRoot = path.resolve(__dirname, '..', 'images', 'mine-icons');
  const expectedAssets = [
    'earn-g.png',
    'earn-a.png',
    'book-g.png',
    'book-a-active.png',
  ];

  for (const filename of expectedAssets) {
    const asset = fs.readFileSync(path.join(assetRoot, filename));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(asset.readUInt32BE(16), 96);
    assert.equal(asset.readUInt32BE(20), 96);
    assert.ok(asset.length <= 10 * 1024, `${filename} exceeds the 10KB icon budget`);
  }

  for (const role of ['referrer', 'designer', 'measurer', 'enterprise_admin']) {
    const key = role === 'enterprise_admin' ? 'commissions' : 'earnings';
    const earnings = ROLE_ITEMS[role].find((item) => item.key === key);
    assert.equal(earnings.iconPath, '/images/mine-icons/earn-g.png');
    assert.equal(earnings.selectedIconPath, '/images/mine-icons/earn-a.png');
  }

  const appointments = ROLE_ITEMS.enterprise_admin.find((item) => item.key === 'appointments');
  assert.equal(appointments.iconPath, '/images/mine-icons/book-g.png');
  assert.equal(appointments.selectedIconPath, '/images/mine-icons/book-a-active.png');
});

test('custom TabBar uses the stored signed role before bootstrap refresh completes', () => {
  const globalData = {
    userInfo: { role: 'staff', mode: 'staff', staffRole: 'designer' },
    bootstrap: null
  };
  const { definition, restore } = loadTabBarComponent(globalData);

  try {
    const component = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['workbench', 'customers', 'design', 'earnings', 'mine']);
  } finally {
    restore();
  }
});

test('custom TabBar paints server badge counts and never fills local zeros', () => {
  const globalData = {
    userInfo: { role: 'staff', mode: 'staff', staffRole: 'designer' },
    bootstrap: {
      current: { role: 'designer', capabilities: ['staff.leads', 'staff.appointments', 'staff.design', 'staff.earnings', 'account'] },
      badges: { status: 'ok', message: null, counts: { workbench: 6 } }
    }
  };
  const { definition, restore } = loadTabBarComponent(globalData);

  try {
    const component = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    definition.methods.syncSelected.call(component);
    const workbench = component.data.list.find((item) => item.key === 'workbench');
    const customers = component.data.list.find((item) => item.key === 'customers');
    assert.equal(workbench.badgeText, '6');
    assert.equal(customers.badgeText, '');
    assert.equal(component.data.badgeUnavailable, false);
    assert.equal(component.data.badgeUnavailableText, '');
  } finally {
    restore();
  }
});

test('custom TabBar shows recoverable unread copy instead of a local zero when badges fail', () => {
  const globalData = {
    userInfo: { role: 'user', mode: 'customer' },
    bootstrap: {
      current: { role: 'customer', capabilities: ['customer.service', 'customer.projects', 'account'] },
      badges: { status: 'unavailable', message: '暂时无法读取', counts: {} }
    }
  };
  const { definition, restore } = loadTabBarComponent(globalData);

  try {
    const component = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) { this.data = { ...this.data, ...update }; }
    };
    definition.methods.syncSelected.call(component);
    assert.equal(component.data.badgeUnavailable, true);
    assert.equal(component.data.badgeUnavailableText, '暂时无法读取');
    assert.equal(component.data.list.every((item) => !item.badgeText), true);
  } finally {
    restore();
  }
});

test('custom TabBar keeps the Measure label above iOS bottom safe areas', () => {
  const tabBarStyles = fs.readFileSync(tabBarStylePath, 'utf8');
  const appStyles = fs.readFileSync(appStylePath, 'utf8');

  assert.match(appStyles, /--sfp-custom-tabbar-height:\s*128rpx/);
  assert.match(appStyles, /constant\(safe-area-inset-bottom\)/);
  assert.match(appStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(tabBarStyles, /padding-bottom:\s*constant\(safe-area-inset-bottom\)/);
  assert.match(tabBarStyles, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.match(tabBarStyles, /\.tab-item\.center \.tab-text\s*\{[\s\S]*?top:\s*96rpx[\s\S]*?line-height:\s*28rpx/);
  const tabBarMarkup = fs.readFileSync(path.resolve(__dirname, '..', 'custom-tab-bar', 'index.wxml'), 'utf8');
  assert.match(tabBarMarkup, /item\.badgeText/);
  assert.match(tabBarMarkup, /badgeUnavailableText/);
  assert.match(tabBarStyles, /\.tab-badge\s*\{[\s\S]*?font-size:\s*20rpx/);
  assert.match(tabBarStyles, /\.tabbar-badge-error\s*\{[\s\S]*?font-size:\s*20rpx/);
});
