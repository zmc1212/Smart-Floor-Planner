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

test('unsigned visitors reuse the customer XiaoK/Service/Mine navigation', () => {
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
    assert.deepEqual(component.data.list.map((item) => item.key), ['xiaok', 'service', 'mine']);
    assert.equal(component.data.list[0].pagePath, '/pages/index/index');
    assert.equal(component.data.list[2].pagePath, '/pages/mine/mine');
    assert.equal(component.data.suppressed, true);
    assert.equal(component.data.customerNavigation, true);
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
    assert.deepEqual(component.data.list.map((item) => item.key), ['xiaok', 'service', 'mine']);
    assert.equal(component.data.list.some((item) => item.key === 'measure'), false);
    assert.equal(component.data.list.some((item) => item.key === 'leads'), false);

    globalData.bootstrap = { current: { role: 'referrer', capabilities: ['referrer.promotion', 'referrer.progress', 'referrer.earnings', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['promotion', 'progress', 'earnings', 'mine']);

    for (const role of ['designer', 'enterprise_admin']) {
      globalData.bootstrap = { current: { role, capabilities: ['construction.projects', 'account'] } };
      definition.methods.syncSelected.call(component);
      assert.deepEqual(component.data.list.map(item => item.text), ['小K', '工作台', '我的']);
      assert.equal(component.data.staffNavigation, true);
      assert.equal(component.data.selected, 2);
      assert.equal(component.data.twoTabs, false);
    }

    globalData.bootstrap = { current: { role: 'construction_staff', capabilities: ['construction.projects', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map(item => item.text), ['工地', '我的']);
    assert.deepEqual(component.data.list.map(item => item.key), ['site', 'mine']);
    assert.equal(component.data.list.some(item => item.key === 'xiaok'), false);
    assert.equal(component.data.staffNavigation, true);
    assert.equal(component.data.selected, 1);
    assert.equal(component.data.twoTabs, true);

    globalData.bootstrap = { current: { role: 'designer', capabilities: ['staff.leads', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['mine']);
    assert.equal(component.data.staffNavigation, true);

    globalData.bootstrap = { current: { role: 'measurer', capabilities: ['staff.schedule', 'staff.data', 'staff.tasks', 'staff.surveying', 'staff.earnings', 'account'] } };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['workbench', 'data', 'customers', 'earnings', 'mine']);
    assert.equal(component.data.list[0].pagePath, '/pages/index/index');

    globalData.bootstrap = {
      current: {
        role: 'salesperson',
        capabilities: ['promotion.records', 'promotion.commissions', 'account'],
      },
    };
    definition.methods.syncSelected.call(component);
    assert.deepEqual(component.data.list.map((item) => item.key), ['promotion', 'mine']);
    assert.equal(
      component.data.list[0].pagePath,
      '/packages/business/promotion-records/promotion-records'
    );
    assert.equal(component.data.list[0].text, '报备');
    assert.equal(component.data.list[0].iconPath, '/images/mine-icons/tab-home.png');
    assert.equal(component.data.list[1].pagePath, '/pages/mine/mine');
  } finally {
    restore();
  }
});

test('unchanged roles retain earnings icons and native tool pages stay registered', () => {
  const { ROLE_ITEMS } = require(tabBarPath);
  const assetRoot = path.resolve(__dirname, '..', 'images', 'mine-icons');
  const expectedAssets = [
    'earn-g.png',
    'earn-a.png',
  ];

  for (const filename of expectedAssets) {
    const asset = fs.readFileSync(path.join(assetRoot, filename));
    assert.equal(asset.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(asset.readUInt32BE(16), 96);
    assert.equal(asset.readUInt32BE(20), 96);
    assert.ok(asset.length <= 10 * 1024, `${filename} exceeds the 10KB icon budget`);
  }

  for (const role of ['referrer', 'measurer']) {
    const earnings = ROLE_ITEMS[role].find((item) => item.key === 'earnings');
    assert.equal(earnings.iconPath, '/images/mine-icons/earn-g.png');
    assert.equal(earnings.selectedIconPath, '/images/mine-icons/earn-a.png');
  }

  assert.equal(ROLE_ITEMS.measurer.length, 5);
  const data = ROLE_ITEMS.measurer.find((item) => item.key === 'data');
  assert.equal(data.capability, 'staff.data');
  assert.equal(data.text, '数据');
  assert.equal(data.pagePath, '/pages/enterprise-operations/enterprise-operations');
  assert.equal(data.tab, true);
  const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'app.json'), 'utf8'));
  assert.ok(
    appConfig.tabBar.list.some((item) => item.pagePath === 'pages/enterprise-operations/enterprise-operations'),
    'wx.switchTab requires the operations page in native tabBar.list'
  );
});

test('staff XiaoK and workbench switch on the shared native tab and Mine remains a separate tab', async () => {
  const globalData = {
    userInfo: { role: 'staff', mode: 'staff', staffRole: 'enterprise_admin' },
    bootstrap: {
      current: {
        role: 'enterprise_admin',
        capabilities: ['construction.projects', 'account']
      }
    }
  };
  const { definition, restore } = loadTabBarComponent(globalData);
  const navigations = [];
  global.wx.switchTab = (options) => {
    navigations.push(['switchTab', options.url]);
  };
  global.wx.reLaunch = (options) => {
    navigations.push(['reLaunch', options.url]);
  };

  try {
    const component = {
      data: JSON.parse(JSON.stringify(definition.data)),
      setData(update) { this.data = { ...this.data, ...update }; },
      syncSelected() { definition.methods.syncSelected.call(this); }
    };
    definition.methods.syncSelected.call(component);
    const index = component.data.list.findIndex((item) => item.key === 'workbench');
    assert.ok(index >= 0);
    await definition.methods.switchTab.call(component, { currentTarget: { dataset: { index } } });
    assert.deepEqual(navigations, [['switchTab', '/pages/index/index']]);
    assert.equal(globalData.siteWorkbenchTab, 'workbench');
    const page = { route: 'pages/index/index', setData(update, callback) { this.update = update; callback(); } };
    global.getCurrentPages = () => [page];
    await definition.methods.switchTab.call(component, { currentTarget: { dataset: { index: 0 } } });
    assert.deepEqual(page.update, { siteWorkbenchTab: 'xiaok' });
    assert.equal(component.data.selected, 0);
    await definition.methods.switchTab.call(component, { currentTarget: { dataset: { index: 2 } } });
    assert.deepEqual(navigations.at(-1), ['switchTab', '/pages/mine/mine']);
  } finally {
    restore();
  }
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
    assert.deepEqual(component.data.list.map((item) => item.key), ['xiaok', 'workbench', 'mine']);
  } finally {
    restore();
  }
});

test('new site navigation omits old lead and appointment badges', () => {
  const globalData = {
    userInfo: { role: 'staff', mode: 'staff', staffRole: 'designer' },
    bootstrap: {
      current: { role: 'designer', capabilities: ['construction.projects', 'account'] },
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
    assert.equal(workbench.badgeText, '');
    assert.ok(component.data.list.every(item => !item.badgeText));
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
