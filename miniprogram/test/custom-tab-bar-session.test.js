const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const tabBarPath = path.resolve(__dirname, '..', 'custom-tab-bar', 'index.js');
const tabBarStylePath = path.resolve(__dirname, '..', 'custom-tab-bar', 'index.wxss');
const appStylePath = path.resolve(__dirname, '..', 'app.wxss');

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

test('custom TabBar refreshes Design visibility after the active account changes', () => {
  const globalData = {
    userInfo: { role: 'staff', enterpriseId: '' }
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
    assert.equal(component.data.list.find((item) => item.key === 'ai-design').visible, false);
    assert.equal(component.data.list.filter((item) => item.visible).length, 4);
    assert.equal(component.data.compactMeasureTab, true);

    globalData.userInfo = { role: 'staff', enterpriseId: 'enterprise-1' };
    definition.methods.syncSelected.call(component);

    assert.equal(component.data.list.find((item) => item.key === 'ai-design').visible, true);
    assert.equal(component.data.list.filter((item) => item.visible).length, 5);
    assert.equal(component.data.compactMeasureTab, false);
    assert.equal(component.data.selected, 4);
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
});
