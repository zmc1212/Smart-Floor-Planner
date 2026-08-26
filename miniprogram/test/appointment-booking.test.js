const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const api = require('../utils/api.js');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function loadBookingPage() {
  const pagePath = require.resolve('../packages/business/appointment-booking/appointment-booking.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('designer appointment booking uses server availability and submits the selected real slot', () => {
  const appJson = read('app.json');
  const pageJs = read('packages/business/appointment-booking/appointment-booking.js');
  const pageWxml = read('packages/business/appointment-booking/appointment-booking.wxml');
  const pageWxss = read('packages/business/appointment-booking/appointment-booking.less');

  assert.match(appJson, /appointment-booking\/appointment-booking/);
  assert.match(pageJs, /appointments\/availability\?leadId=/);
  assert.match(pageJs, /maxAdvanceDays/);
  assert.match(pageJs, /nextDates\(maxAdvanceDays\)/);
  assert.match(pageJs, /api\.request\('\/appointments', 'POST'/);
  assert.match(pageJs, /customerMode: options\.mode === 'customer'/);
  assert.match(pageJs, /appointment_already_exists/);
  assert.match(pageJs, /startAt: selectedSlot\.startAt/);
  assert.match(pageJs, /endAt: selectedSlot\.endAt/);
  assert.match(pageJs, /address: addressText/);
  assert.doesNotMatch(pageJs, /shouldOfferCommunitySync/);
  assert.doesNotMatch(pageJs, /同步到客户小区/);
  assert.match(pageJs, /wx\.chooseLocation/);
  assert.match(pageJs, /coordinateSystem: 'gcj02'/);
  assert.match(pageJs, /location,/);
  assert.match(pageJs, /getMenuButtonBoundingClientRect/);
  assert.match(pageWxml, /packages\/business\/assets\/appointment-booking-v1\/schedule-guide\.png/);
  assert.match(pageWxml, /class="back-chevron"/);
  assert.doesNotMatch(pageWxml, /‹/);
  assert.match(pageJs, /actionWidth: Math\.max\(0, Number\(windowInfo\.windowWidth \|\| 390\) - 28\)/);
  assert.match(pageWxml, /class="confirm sfp-primary-action" style="width: \{\{actionWidth\}\}px;"/);
  assert.match(pageWxml, /确认预约/);
  assert.match(pageWxml, /量房地点/);
  assert.match(pageWxml, /地图选择/);
  assert.match(pageWxml, /location-picker-action sfp-icon-action[\s\S]*\/images\/leads-v4\/map-pin\.png[\s\S]*选择地点/);
  assert.match(pageWxml, /系统将安排合适的量房伙伴上门/);
  assert.match(pageWxss, /env\(safe-area-inset-bottom\)/);
  assert.match(pageWxss, /\.back-chevron/);
  assert.match(pageWxss, /\.confirm-bar/);
  assert.match(pageWxss, /\.confirm\[disabled\].*--action-disabled-bg/);
  assert.match(pageWxss, /\.confirm \{ display: block;/);
  assert.match(pageWxss, /font-size: 24rpx/);
});

test('booking saves a GCJ-02 map point and keeps manual address entry available', () => {
  const definition = loadBookingPage();
  const originalWx = global.wx;
  global.wx = {
    chooseLocation({ success }) {
      success({ name: '阳光花园', address: '广东省广州市天河区阳光路 1 号', latitude: 23.1291, longitude: 113.2644 });
    },
  };
  const context = {
    data: { ...definition.data, address: '' },
    setData(next) { Object.assign(this.data, next); },
  };
  try {
    definition.chooseLocation.call(context);
    assert.deepEqual(context.data.location, {
      locationName: '阳光花园', latitude: 23.1291, longitude: 113.2644, coordinateSystem: 'gcj02',
    });
    assert.equal(context.data.address, '广东省广州市天河区阳光路 1 号');
  } finally {
    global.wx = originalWx;
  }
});

test('designer booking keeps every date the server makes available in the existing date scroller', async () => {
  const definition = loadBookingPage();
  const originalRequest = api.request;
  api.request = async () => ({
    data: {
      maxAdvanceDays: 7,
      slots: [{ startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T03:00:00.000Z' }],
    },
  });
  const context = {
    data: { ...definition.data, leadId: '1', selectedDate: '2026-08-20' },
    setData(next) { Object.assign(this.data, next); },
  };
  try {
    await definition.loadSlots.call(context);
    assert.equal(context.data.dates.length, 8);
    assert.equal(context.data.slots[0].label, '09:00 - 11:00');
  } finally {
    api.request = originalRequest;
  }
});

test('lead detail exposes first booking to scheduling roles only without a confirmed appointment', () => {
  const detailJs = read('packages/business/lead-detail/lead-detail.js');
  const detailWxml = read('packages/business/lead-detail/lead-detail.wxml');
  const detailWxss = read('packages/business/lead-detail/lead-detail.less');

  assert.match(detailJs, /staffRole === 'enterprise_admin'/);
  assert.match(detailJs, /staffRole === 'designer'/);
  assert.match(detailJs, /staffRole === 'measurer' && lead\.source === 'staff_activity'/);
  assert.match(detailJs, /item\.status === 'confirmed'/);
  assert.match(detailJs, /appointment-booking\/appointment-booking\?leadId=/);
  assert.match(detailWxml, /wx:(?:if|elif)="\{\{canScheduleAppointment(?:\s*&&\s*canRebookAppointment)?\}\}"/);
  assert.match(detailWxml, />安排上门量房<\/button>/);
  assert.match(detailWxml, /\{\{lead\.serviceStage === 'survey_ready' \? '确认完成量房' : '查看预约'\}\}/);
  assert.match(detailJs, /customer-ai-schemes\/customer-ai-schemes\?leadId=/);
  assert.doesNotMatch(detailJs, /ai-design-result\?id=/);
  assert.match(detailWxss, /\.whole-home-appointment-action/);
});
