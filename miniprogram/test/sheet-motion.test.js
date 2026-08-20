const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SHEET_MOTION_MS,
  SHEET_ENTER_DELAY_MS,
  openSheet,
  closeSheet,
  dismissSheet,
} = require('../utils/sheetMotion.js');

function createHost(initial = {}) {
  const host = {
    data: { ...initial },
    setData(patch, callback) {
      Object.assign(host.data, patch);
      if (typeof callback === 'function') callback();
    },
  };
  return host;
}

test('openSheet mounts then opens after enter delay', async () => {
  const host = createHost({ sheetMounted: false, sheetOpen: false });
  openSheet(host, { mountedKey: 'sheetMounted', openKey: 'sheetOpen' });
  assert.equal(host.data.sheetMounted, true);
  assert.equal(host.data.sheetOpen, false);
  await new Promise((resolve) => setTimeout(resolve, SHEET_ENTER_DELAY_MS + 5));
  assert.equal(host.data.sheetOpen, true);
});

test('closeSheet clears open then unmounts after motion ms', async () => {
  const host = createHost({ sheetMounted: true, sheetOpen: true });
  let closed = false;
  closeSheet(host, { mountedKey: 'sheetMounted', openKey: 'sheetOpen' }, () => {
    closed = true;
  });
  assert.equal(host.data.sheetOpen, false);
  assert.equal(host.data.sheetMounted, true);
  await new Promise((resolve) => setTimeout(resolve, SHEET_MOTION_MS + 5));
  assert.equal(host.data.sheetMounted, false);
  assert.equal(closed, true);
});

test('dismissSheet unmounts immediately without waiting', () => {
  const host = createHost({ sheetMounted: true, sheetOpen: true });
  dismissSheet(host, { mountedKey: 'sheetMounted', openKey: 'sheetOpen' });
  assert.equal(host.data.sheetMounted, false);
  assert.equal(host.data.sheetOpen, false);
});
