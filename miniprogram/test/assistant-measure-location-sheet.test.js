const { test } = require('node:test');
const assert = require('node:assert/strict');

// 预约量房面板经 wx.chooseLocation 跨原生地图页往返时必须保持打开：
// 地图页压栈会触发聊天页 onHide，其 closeSheet() 曾把 sheet 关掉，
// 选完地点回来卡片就消失了。一次性标记让该次 onHide 保留面板。
test('choosing a measure location across the native map page keeps the booking sheet open', async () => {
  const previousWx = global.wx, previousPages = global.getCurrentPages;
  let chooser;
  const storage = new Map([['token', 'session-a']]);
  global.wx = {
    getStorageSync: key => storage.get(key),
    hideKeyboard: () => {},
    chooseLocation: options => { chooser = options; },
  };
  global.getCurrentPages = () => [];
  try {
    const page = require('../packages/assistant/chat/chat-definition')();
    const locations = [];
    Object.assign(page, {
      _alive: true, _shown: true,
      controller: { conversationId: '11', hide() {}, set() {}, citationRequest: 0 },
      followups: { hide() {}, clearSource() {} },
      referenceImages: { clear() {} },
      siteRecords: { clear() {} },
      recommendations: { clear() {} },
      measureBooking: { setLocation(input) { locations.push(input); } },
      setData(patch, callback) { Object.assign(this.data, patch); if (callback) callback(); },
    });
    page.data.sheet = 'measure';
    page.data.sheetOpen = true;

    page.chooseMeasureLocation();
    assert.equal(page._measureLocationChoosing, true);

    page.onHide(); // 原生地图页压栈，触发聊天页 onHide
    assert.equal(page.data.sheet, 'measure');
    assert.equal(page.data.sheetOpen, true);
    assert.equal(page._measureLocationChoosing, false); // 一次性标记已消费

    chooser.success({ name: '微云合成小区', address: '微云合成小区 3 栋', latitude: 39.9, longitude: 116.4 });
    chooser.complete();
    assert.equal(locations.length, 1);
    assert.equal(locations[0].locationName, '微云合成小区');
    assert.equal(page._measureLocationChoosing, false);

    // 与选点无关的后续 onHide（如跳转其他页面）仍会关闭面板
    page._shown = true;
    page.onHide();
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(page.data.sheet, '');
    assert.equal(page.data.sheetOpen, false);
  } finally {
    global.wx = previousWx;
    global.getCurrentPages = previousPages;
  }
});
