const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const api = require('../utils/api.js');
const miniRoot = path.resolve(__dirname, '..');

function source(relativePath) {
  return fs.readFileSync(path.join(miniRoot, relativePath), 'utf8');
}

function loadReschedulePage() {
  const pagePath = require.resolve('../packages/business/appointment-reschedule/appointment-reschedule.js');
  const originalPage = global.Page;
  let definition;
  global.Page = (next) => { definition = next; };
  delete require.cache[pagePath];
  require(pagePath);
  global.Page = originalPage;
  return definition;
}

test('customer reschedule honours the server appointment horizon and retains the selected slot identity', async () => {
  const definition = loadReschedulePage();
  const originalRequest = api.request;
  const slot = { startAt: '2026-08-20T01:00:00.000Z', endAt: '2026-08-20T03:00:00.000Z' };
  api.request = async () => ({ data: { maxAdvanceDays: 7, slots: [slot] } });
  const context = {
    data: { ...definition.data, leadId: '1', selectedDate: '2026-08-20' },
    setData(next) { Object.assign(this.data, next); },
  };
  try {
    await definition.loadSlots.call(context);
    assert.equal(context.data.maxAdvanceDays, 7);
    assert.equal(context.data.dates.length, 5);
    assert.equal(context.data.slots[0].label, '09:00 - 11:00');
    definition.chooseSlot.call(context, { currentTarget: { dataset: { slot: context.data.slots[0] } } });
    assert.equal(context.data.selectedSlotStart, slot.startAt);
  } finally {
    api.request = originalRequest;
  }
});

test('phase-5 custom-navigation pages reserve the native capsule lane and keep the calendar pager accessible', () => {
  const pages = [
    'packages/business/customer-project/customer-project',
    'packages/business/appointment-reschedule/appointment-reschedule',
    'packages/business/measurer-calendar/measurer-calendar',
    'packages/business/measurer-unavailability/measurer-unavailability',
  ];
  for (const page of pages) {
    assert.match(source(`${page}.js`), /getMenuButtonBoundingClientRect/);
    assert.match(source(`${page}.wxml`), /padding-right: \{\{navigationRight\}\}px/);
    assert.match(source(`${page}.wxml`), /bindtap="onBack"/);
  }
  const reschedule = source('packages/business/appointment-reschedule/appointment-reschedule.js');
  const rescheduleWxml = source('packages/business/appointment-reschedule/appointment-reschedule.wxml');
  assert.match(reschedule, /maxAdvanceDays/);
  assert.match(reschedule, /previousDates\(\)/);
  assert.match(reschedule, /nextDates\(\)/);
  assert.match(rescheduleWxml, /查看后续日期/);
  assert.match(reschedule, /actionWidth: Math\.max\(0, Number\(windowInfo\.windowWidth \|\| 390\) - 24\)/);
  assert.match(rescheduleWxml, /class="confirm sfp-primary-action" style="width: \{\{actionWidth\}\}px;"/);
  assert.match(source('packages/business/appointment-reschedule/appointment-reschedule.less'), /\.confirm-bar/);
  assert.match(source('packages/business/appointment-reschedule/appointment-reschedule.less'), /\.confirm\{display:block;/);
});
